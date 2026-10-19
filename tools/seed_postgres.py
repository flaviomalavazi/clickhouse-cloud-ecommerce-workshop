#!/usr/bin/env python3
"""
Create and seed the workshop's Postgres database (`make pg-setup`).

    seed_postgres.py            create the database, apply sql/postgres/*.sql,
                                seed it if it is empty
    seed_postgres.py --reset    truncate every table first, then reseed

Idempotent: if `products` already has rows the seed is skipped, so running it
twice is safe. Everything is deterministic (SEED_RANDOM_SEED, default 42), so a
given catalogue always produces the same prices, stock, customers and orders.

What is loaded:
  - products   assets/catalog_details/catalog.json, keeping the catalogue ids
  - stock      20-300 units each, about 30 products with only 3-15 so they sell
               out during the simulation
  - customers  500 (Faker)
  - orders     2,000 historical orders, 1-5 items each, over the last 2 years

Product details that are not in the catalogue:
  - price      generated per product id, 9.99-499.99, ~40% with an original_price
  - is_active  NOT flagged_for_deletion AND an image exists in
               frontend/public/images. The catalogue's own `is_active` is
               ignored (the live demo ignored it too).
  - sku        the catalogue repeats SKUs across different products, but
               products.sku is UNIQUE. The lowest id keeps the catalogue SKU and
               every later duplicate gets "-<id>" appended.
"""

from __future__ import annotations

import argparse
import json
import os
import random
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from faker import Faker
from psycopg.types.json import Jsonb

from apply_sql import apply_postgres_file
from connections import pg_connect

ROOT = Path(os.environ.get("CLICKSHOP_ROOT") or Path(__file__).resolve().parents[1])
CATALOG_PATH = ROOT / "assets" / "catalog_details" / "catalog.json"
IMAGES_DIR = ROOT / "frontend" / "public" / "images"
SQL_DIR = ROOT / "sql" / "postgres"

SEED = int(os.environ.get("SEED_RANDOM_SEED", "42"))
PLACEHOLDER_URL = "/images/product-placeholder.svg"

N_CUSTOMERS = 500
N_ORDERS = 2_000
N_LOW_STOCK = 30
ORDER_HISTORY_DAYS = 730

# Category display name in the catalogue -> slug in sql/postgres/002_categories.sql
CATEGORY_SLUGS = {
    "Shoes": "shoes",
    "Clothing": "clothing",
    "Books": "books",
    "IT Accessories": "it-accessories",
    "Electronics": "electronics",
}

HISTORIC_STATUSES = ("confirmed", "shipped", "delivered", "cancelled")
HISTORIC_STATUS_WEIGHTS = (0.15, 0.20, 0.50, 0.05)
PAYMENT_METHODS = ("credit_card", "pix", "boleto")
PAYMENT_WEIGHTS = (0.55, 0.30, 0.15)


def rng_for(*parts: object) -> random.Random:
    """A Random seeded from SEED and `parts`, independent of call order."""
    return random.Random(":".join(str(p) for p in (SEED, *parts)))


def load_catalog() -> list[dict]:
    entries = json.loads(CATALOG_PATH.read_text())
    entries.sort(key=lambda e: e["id"])
    unknown = {e["product_category"] for e in entries} - CATEGORY_SLUGS.keys()
    if unknown:
        sys.exit(f"ERROR: catalogue has categories with no slug mapping: {sorted(unknown)}")
    return entries


def image_ids() -> set[int]:
    return {int(p.stem) for p in IMAGES_DIR.glob("*.webp") if p.stem.isdigit()}


def unique_skus(entries: list[dict]) -> tuple[dict[int, str], int]:
    """Map id -> SKU, keeping the catalogue SKU for the lowest id. Returns (map, changed)."""
    seen: set[str] = set()
    out: dict[int, str] = {}
    changed = 0
    for e in entries:  # sorted by id
        sku = e["sku"]
        if sku in seen:
            sku = f"{sku}-{e['id']}"
            changed += 1
        seen.add(sku)
        out[e["id"]] = sku
    return out, changed


def apply_schema(conn) -> None:
    for path in sorted(SQL_DIR.glob("*.sql")):
        n = apply_postgres_file(conn, path)
        print(f"applied {path.relative_to(ROOT)} ({n} statements)")


def seed_products(conn, entries: list[dict], images: set[int]) -> tuple[list[int], int]:
    """Insert products and their stock. Returns (active product ids, skus changed)."""
    skus, changed = unique_skus(entries)
    with conn.cursor() as cur:
        cur.execute("SELECT slug, id FROM categories")
        category_id = dict(cur.fetchall())
        missing = set(CATEGORY_SLUGS.values()) - category_id.keys()
        if missing:
            sys.exit(f"ERROR: categories missing from the database: {sorted(missing)}")

        rows, active = [], []
        for e in entries:
            pid = e["id"]
            has_image = pid in images
            is_active = (not e.get("flagged_for_deletion")) and has_image
            if is_active:
                active.append(pid)

            rng = rng_for("product", pid)
            price = round(rng.uniform(9.99, 499.99), 2)
            original = round(price / (1 - rng.uniform(0.05, 0.40)), 2) if rng.random() < 0.4 else None

            rows.append((
                pid, category_id[CATEGORY_SLUGS[e["product_category"]]], skus[pid],
                e["name"], e["description"], e["brand"], price, original,
                f"/images/{pid}.webp" if has_image else PLACEHOLDER_URL,
                is_active, Jsonb(e.get("attributes") or {}),
                # NULL, not '', for a missing translation: the frontend falls back to English.
                e.get("name_pt") or None, e.get("name_es") or None,
                e.get("description_pt") or None, e.get("description_es") or None,
            ))
        cur.executemany(
            """INSERT INTO products
                   (id, category_id, sku, name, description, brand, price, original_price,
                    image_url, is_active, attributes, name_pt, name_es, description_pt, description_es)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            rows,
        )
        cur.execute("SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT max(id) FROM products))")

        low_stock = set(rng_for("lowstock").sample(sorted(active), N_LOW_STOCK))
        stock_rows = []
        for e in entries:
            rng = rng_for("stock", e["id"])
            qty = rng.randint(3, 15) if e["id"] in low_stock else rng.randint(20, 300)
            stock_rows.append((e["id"], qty))
        cur.executemany("INSERT INTO stock (product_id, quantity) VALUES (%s, %s)", stock_rows)
    conn.commit()
    return active, changed


def seed_customers(conn) -> None:
    Faker.seed(SEED)
    fake = Faker()
    rows = []
    for cid in range(1, N_CUSTOMERS + 1):
        rows.append((
            cid, fake.unique.email(), fake.first_name(), fake.last_name(), fake.phone_number()[:32],
            Jsonb({
                "street": fake.street_address(), "city": fake.city(), "state": fake.state_abbr(),
                "country": fake.country_code(), "zip": fake.postcode(),
            }),
        ))
    with conn.cursor() as cur:
        cur.executemany(
            "INSERT INTO customers (id, email, first_name, last_name, phone, address) VALUES (%s,%s,%s,%s,%s,%s)",
            rows,
        )
        cur.execute("SELECT setval(pg_get_serial_sequence('customers', 'id'), %s)", (N_CUSTOMERS,))
    conn.commit()


def seed_orders(conn, active: list[int]) -> None:
    Faker.seed(SEED + 1)
    fake = Faker()
    rng = rng_for("orders")
    now = datetime.now(timezone.utc)

    with conn.cursor() as cur:
        cur.execute("SELECT id, price FROM products WHERE is_active")
        price = {pid: p for pid, p in cur.fetchall()}

        orders, items = [], []
        item_id = 0
        for oid in range(1, N_ORDERS + 1):
            created = now - timedelta(seconds=rng.uniform(0, ORDER_HISTORY_DAYS * 86_400))
            # An order that old has long since been resolved: only a very recent
            # one may still be pending (D15), so the table does not start with
            # hundreds of orders "stuck" since last year.
            if now - created < timedelta(hours=1):
                status = "pending"
            else:
                status = rng.choices(HISTORIC_STATUSES, HISTORIC_STATUS_WEIGHTS)[0]

            chosen = rng.sample(active, rng.randint(1, 5))
            lines = [(pid, rng.randint(1, 3)) for pid in chosen]
            total = round(sum(price[pid] * qty for pid, qty in lines), 2)
            updated = created if status == "pending" else created + timedelta(minutes=rng.randint(1, 90))

            orders.append((
                oid, rng.randint(1, N_CUSTOMERS), status, rng.choices(PAYMENT_METHODS, PAYMENT_WEIGHTS)[0],
                total, Jsonb({"city": fake.city()}), created, updated,
            ))
            for pid, qty in lines:
                item_id += 1
                items.append((item_id, oid, pid, qty, price[pid]))

        cur.executemany(
            """INSERT INTO orders (id, customer_id, status, payment_method, total_amount,
                                   shipping_addr, created_at, updated_at)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
            orders,
        )
        cur.executemany(
            "INSERT INTO order_items (id, order_id, product_id, quantity, unit_price) VALUES (%s,%s,%s,%s,%s)",
            items,
        )
        cur.execute("SELECT setval(pg_get_serial_sequence('orders', 'id'), %s)", (N_ORDERS,))
        cur.execute("SELECT setval(pg_get_serial_sequence('order_items', 'id'), %s)", (item_id,))
    conn.commit()


# No parameters are passed with this one, so psycopg leaves the `%` alone.
PLACEHOLDER_COUNT_SQL = "SELECT count(*) FROM products WHERE image_url LIKE '%placeholder%'"


def summarise(conn) -> None:
    with conn.cursor() as cur:
        def one(q: str):
            cur.execute(q)
            return cur.fetchone()[0]

        print("\nPostgres contents:")
        print(f"  categories   {one('SELECT count(*) FROM categories'):>6,}")
        print(f"  products     {one('SELECT count(*) FROM products'):>6,}   "
              f"active {one('SELECT count(*) FROM products WHERE is_active'):,}, "
              f"on placeholder image {one(PLACEHOLDER_COUNT_SQL):,}")
        print(f"  stock        {one('SELECT count(*) FROM stock'):>6,}   "
              f"low (<=15 units) {one('SELECT count(*) FROM stock WHERE quantity <= 15'):,}")
        print(f"  customers    {one('SELECT count(*) FROM customers'):>6,}")
        print(f"  orders       {one('SELECT count(*) FROM orders'):>6,}")
        print(f"  order_items  {one('SELECT count(*) FROM order_items'):>6,}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--reset", action="store_true", help="truncate every table, then reseed")
    ns = ap.parse_args()

    for path, what in ((CATALOG_PATH, "catalogue"), (IMAGES_DIR, "image directory")):
        if not path.exists():
            sys.exit(f"ERROR: {what} not found: {path}")
    images = image_ids()
    if not images:
        sys.exit(f"ERROR: no WebP images in {IMAGES_DIR}; run `make images-webp` (see assets/scripts/build_images.py)")

    with pg_connect() as conn:
        apply_schema(conn)
        if ns.reset:
            with conn.cursor() as cur:
                cur.execute(
                    "TRUNCATE order_items, orders, customers, stock, products, categories RESTART IDENTITY CASCADE"
                )
            conn.commit()
            print("truncated all tables")
            apply_schema(conn)  # puts the categories back

        with conn.cursor() as cur:
            cur.execute("SELECT count(*) FROM products")
            existing = cur.fetchone()[0]
        if existing:
            print(f"products already seeded ({existing:,} rows) - skipping the seed. Use --reset to start over.")
            summarise(conn)
            return 0

        entries = load_catalog()
        print(f"seeding {len(entries)} catalogue products ({len(images)} images found)...")
        active, sku_changed = seed_products(conn, entries, images)
        print(f"  {len(active)} active products; {sku_changed} duplicate SKUs made unique with a -<id> suffix")
        seed_customers(conn)
        seed_orders(conn, active)
        summarise(conn)
    return 0


if __name__ == "__main__":
    sys.exit(main())
