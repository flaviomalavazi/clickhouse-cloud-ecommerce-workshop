#!/usr/bin/env python3
"""
One-off product image converter, kept so the committed WebPs are reproducible.

    python assets/scripts/build_images.py assets/product_images frontend/public/images

Converts `image_{id}.jpg` to `{id}.webp`: longest side at most 800 px, quality
85. Only the WebP output is committed (the ~437 MB of source JPEGs stay
gitignored). Participants never run this; `make images-webp` is the documented
way to regenerate the images.

Needs Pillow (`pip install pillow`).
"""

from __future__ import annotations

import argparse
import re
import sys
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

from PIL import Image

MAX_PX = 800
QUALITY = 85
SOURCE_RE = re.compile(r"^image_(\d+)\.jpe?g$", re.IGNORECASE)


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
    ns = ap.parse_args()

    if not ns.src_dir.is_dir():
        print(f"ERROR: source directory not found: {ns.src_dir}", file=sys.stderr)
        return 1
    ns.dest_dir.mkdir(parents=True, exist_ok=True)

    jobs: list[tuple[str, str, int, int]] = []
    skipped = 0
    for src in sorted(ns.src_dir.iterdir()):
        m = SOURCE_RE.match(src.name)
        if not m:
            continue
        dest = ns.dest_dir / f"{int(m.group(1))}.webp"
        if dest.exists() and not ns.force:
            skipped += 1
            continue
        jobs.append((str(src), str(dest), ns.max_px, ns.quality))

    total = 0
    with ProcessPoolExecutor() as pool:
        for _, size in pool.map(convert, jobs, chunksize=8):
            total += size

    all_webp = list(ns.dest_dir.glob("*.webp"))
    size_all = sum(p.stat().st_size for p in all_webp)
    print(
        f"converted {len(jobs)}, skipped {skipped} existing | "
        f"{len(all_webp)} WebP files in {ns.dest_dir}, {size_all / 2**20:.1f} MiB"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
