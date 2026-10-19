#!/usr/bin/env python3
"""
One-off product image converter, kept so the committed WebPs are reproducible.

    python assets/scripts/build_images.py assets/product_images frontend/public/images [--prune]

Converts `image_{id}.jpg` to `{id}.webp`: longest side at most 800 px, quality
85. Only the WebP output is committed (the ~437 MB of source JPEGs stay
gitignored). Participants never run this; `make images-webp` is the documented
way to regenerate the images.

Only products that are active in the catalogue get an image: `is_active` true and
not `flagged_for_deletion`, the same test as tools/seed_postgres.py. The workshop does
not carry photos of products it does not sell. `--prune` also deletes the WebPs in the
destination that do not belong to an active product.

Needs Pillow (`pip install pillow`).
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

MAX_PX = 800
QUALITY = 85
CATALOG = Path(__file__).resolve().parents[1] / "catalog_details" / "catalog.json"
SOURCE_RE = re.compile(r"^image_(\d+)\.jpe?g$", re.IGNORECASE)


def active_ids(catalog: Path) -> set[int]:
    """Ids of the products the workshop sells (see tools/seed_postgres.is_active_product)."""
    entries = json.loads(catalog.read_text())
    return {e["id"] for e in entries if e.get("is_active") and not e.get("flagged_for_deletion")}


def convert(args: tuple[str, str, int, int]) -> tuple[str, int]:
    """Convert one file. Returns (destination name, bytes written)."""
    src, dest, max_px, quality = args
    with Image.open(src) as im:
        im = im.convert("RGB")
        im.thumbnail((max_px, max_px), Image.Resampling.LANCZOS)
        # method=6 is the slowest/smallest encoder setting; this runs once.
        im.save(dest, "WEBP", quality=quality, method=6)
    return Path(dest).name, Path(dest).stat().st_size


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("src_dir", type=Path, help="directory holding image_{id}.jpg")
    ap.add_argument("dest_dir", type=Path, help="directory to write {id}.webp into")
    ap.add_argument("--max-px", type=int, default=MAX_PX, help=f"longest side in px (default {MAX_PX})")
    ap.add_argument("--quality", type=int, default=QUALITY, help=f"WebP quality (default {QUALITY})")
    ap.add_argument("--force", action="store_true", help="re-encode files that already exist")
    ap.add_argument("--catalog", type=Path, default=CATALOG, help="catalogue that says which products are active")
    ap.add_argument("--prune", action="store_true", help="delete WebPs in dest_dir that are not for an active product")
    ns = ap.parse_args()

    if not ns.src_dir.is_dir():
        print(f"ERROR: source directory not found: {ns.src_dir}", file=sys.stderr)
        return 1
    ns.dest_dir.mkdir(parents=True, exist_ok=True)

    active = active_ids(ns.catalog)
    jobs: list[tuple[str, str, int, int]] = []
    skipped = inactive = 0
    for src in sorted(ns.src_dir.iterdir()):
        m = SOURCE_RE.match(src.name)
        if not m:
            continue
        if int(m.group(1)) not in active:
            inactive += 1
            continue
        dest = ns.dest_dir / f"{int(m.group(1))}.webp"
        if dest.exists() and not ns.force:
            skipped += 1
            continue
        jobs.append((str(src), str(dest), ns.max_px, ns.quality))

    pruned = 0
    if ns.prune:
        for webp in ns.dest_dir.glob("*.webp"):
            if webp.stem.isdigit() and int(webp.stem) not in active:
                webp.unlink()
                pruned += 1

    total = 0
    with ProcessPoolExecutor() as pool:
        for _, size in pool.map(convert, jobs, chunksize=8):
            total += size

    all_webp = list(ns.dest_dir.glob("*.webp"))
    size_all = sum(p.stat().st_size for p in all_webp)
    print(
        f"converted {len(jobs)}, skipped {skipped} existing, left out {inactive} inactive, pruned {pruned} | "
        f"{len(all_webp)} WebP files in {ns.dest_dir}, {size_all / 2**20:.1f} MiB"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
