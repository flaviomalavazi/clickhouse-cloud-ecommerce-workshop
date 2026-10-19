#!/usr/bin/env python3
"""Seed PostgreSQL with categories, products, stock, customers, orders, order_items."""

import json
import os
import random
from datetime import datetime, timedelta

import psycopg2
from faker import Faker

from pg_ssl import apply_search_path, pg_sslmode

fake = Faker()
_PGDATABASE = os.environ.get("PGDATABASE", "retail_db")
_RANDOM_SEED = int(os.environ.get("SEED_RANDOM_SEED", "42"))
_MIGRATE_ONLY = os.environ.get("MIGRATE_ONLY", "false").strip().lower() in {
    "1", "true", "yes", "on",
}
_PG_MIGRATION_FILES = tuple(
    name.strip()
    for name in os.environ.get("PG_MIGRATION_FILES", "").split(",")
    if name.strip()
)
_PG_MIGRATION_USER = os.environ.get("PG_MIGRATION_USER", "").strip()
_PG_MIGRATION_PASSWORD = os.environ.get("PG_MIGRATION_PASSWORD", "")
random.seed(_RANDOM_SEED)
Faker.seed(_RANDOM_SEED)

# Image URLs follow the same convention as build_image_url() in
# assets/scripts/pipeline.py: the flat {id}.webp on the CDN. This used to be a
# picsum.photos URL, which broke two consumers at once.
#
# The frontend runs every image_url through proxyImageUrl()
# (frontend/src/lib/constants.ts), which keeps only the last path segment and
# prepends /images/ — so "picsum.photos/seed/prod7/400/400" collapsed to
# "/images/400", the same extension-less path for all 1000 products. And
# seed_clickhouse.py feeds image_url straight to the embedding service's
# /embed/url, where picsum's 302 to its CDN meant every embedding failed and
# product_embeddings came out empty.
#
# The CloudFront form (rather than https://{CADDY_DOMAIN}/images/{id}.webp)
# serves both: the browser only ever sees the filename, and the embedding
# service — running inside Docker, where localhost is its own container — can
# actually reach a public host. Without a CDN, fresh local installs use a
# repository-owned placeholder; seed_clickhouse deliberately skips embedding
# relative URLs, while the rest of the catalogue remains fully usable.
_CLOUDFRONT_DOMAIN = os.environ.get("CLOUDFRONT_DOMAIN", "")


def product_image_url(seq: int) -> str:
    if _CLOUDFRONT_DOMAIN:
        return f"https://{_CLOUDFRONT_DOMAIN}/{seq}.webp"
    return "/images/product-placeholder.svg"

_PGHOST = os.environ.get("PGHOST", "localhost")

PG_CONNECT_KWARGS = {
    "host":       _PGHOST,
    "port":       int(os.environ.get("PGPORT", "5432")),
    "user":       os.environ.get("PGUSER",     "retail_user"),
    "password":   os.environ.get("PGPASSWORD", "retail_pass"),
    "dbname":     _PGDATABASE,
    "sslmode":    pg_sslmode(_PGHOST),
}

# ── Category-specific product generation config ────────────────────────────
CATEGORY_CONFIG = {
    "shoes": {
        "brands": ["Nike", "Adidas", "Puma", "Vans", "New Balance", "Reebok", "Converse", "Skechers"],
        "name_patterns": [
            "{brand} {adj} Runner", "{brand} Classic {n}", "{brand} Air {adj}",
            "{brand} Pro {adj} {n}", "{brand} Sport {adj}",
        ],
        "attr_keys": ["size", "color", "material"],
        "sizes": ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45"],
        "colors": ["black", "white", "red", "blue", "grey", "navy", "green"],
        "materials": ["leather", "mesh", "canvas", "synthetic", "suede"],
    },
    "clothing": {
        "brands": ["Zara", "H&M", "Uniqlo", "Levi's", "Gap", "Calvin Klein", "Tommy Hilfiger", "Ralph Lauren"],
        "name_patterns": [
            "{brand} {adj} Tee", "{brand} Slim Fit Jeans", "{brand} {adj} Hoodie",
            "{brand} Classic Shirt", "{brand} {adj} Dress",
        ],
        "attr_keys": ["size", "color", "gender", "material"],
        "sizes": ["XS", "S", "M", "L", "XL", "XXL"],
        "colors": ["black", "white", "blue", "grey", "red", "green", "beige"],
        "genders": ["men", "women", "unisex"],
        "materials": ["cotton", "polyester", "denim", "wool", "linen"],
    },
    "books": {
        "brands": ["Penguin", "O'Reilly", "HarperCollins", "MIT Press", "Wiley", "McGraw-Hill", "Springer"],
        "name_patterns": [
            "The {adj} Guide to {topic}", "{adj} {topic}: A Handbook",
            "Mastering {topic}", "{topic} in Practice", "Learning {topic}",
        ],
        "attr_keys": ["author", "pages", "language", "format"],
        "topics": ["Python", "Data Science", "Machine Learning", "SQL", "Leadership", "Design",
                   "Marketing", "Finance", "History", "Philosophy", "Biology", "Chemistry"],
        "formats": ["hardcover", "paperback", "ebook"],
        "languages": ["English", "Spanish", "French", "German"],
    },
    "it-accessories": {
        "brands": ["Logitech", "Anker", "Belkin", "Razer", "Corsair", "SteelSeries", "HyperX", "Jabra"],
        "name_patterns": [
            "{brand} {adj} {type}", "{brand} Pro {type}", "{brand} Wireless {type}",
            "{brand} {type} {n}", "{brand} Ultra {type}",
        ],
        "types": ["Keyboard", "Mouse", "Webcam", "Headset", "Hub", "Cable", "Mousepad", "Microphone"],
        "attr_keys": ["color", "connectivity", "compatibility"],
        "connectivities": ["USB-A", "USB-C", "Bluetooth", "2.4GHz Wireless", "Wired"],
        "compatibilities": ["Windows", "macOS", "Linux", "Universal"],
    },
    "electronics": {
        "brands": ["Sony", "Samsung", "LG", "Bose", "Apple", "Panasonic", "Philips", "JBL"],
        "name_patterns": [
            "{brand} {adj} {type} {model}", "{brand} {type} Pro {model}",
            "{brand} Ultra {type}", "{brand} {type} {n}",
        ],
        "types": ["TV", "Speaker", "Headphones", "Monitor", "Projector", "Camera", "Tablet"],
        "attr_keys": ["color", "wattage", "warranty_years"],
        "colors": ["black", "white", "silver", "gold", "space-grey"],
    },
}

ADJECTIVES = ["Premium", "Elite", "Signature", "Essential", "Pro", "Ultra", "Classic", "Modern",
               "Advanced", "Compact", "Sleek", "Rugged", "Smart", "Wireless", "Portable"]


def build_name(cat_slug: str, brand: str, seq: int) -> str:
    cfg = CATEGORY_CONFIG[cat_slug]
    pattern = random.choice(cfg["name_patterns"])
    adj = random.choice(ADJECTIVES)
    n = str(random.randint(100, 999))
    name = pattern.format(
        brand=brand, adj=adj, n=n,
        topic=random.choice(cfg.get("topics", ["Technology"])),
        type=random.choice(cfg.get("types", ["Product"])),
        model=f"v{random.randint(1,5)}.{random.randint(0,9)}",
    )
    return name[:256]


def build_attributes(cat_slug: str) -> dict:
    cfg = CATEGORY_CONFIG[cat_slug]
    attrs = {}
    for key in cfg["attr_keys"]:
        if key == "size":
            attrs[key] = random.choice(cfg.get("sizes", ["M"]))
        elif key == "color":
            attrs[key] = random.choice(cfg.get("colors", ["black"]))
        elif key == "gender":
            attrs[key] = random.choice(cfg.get("genders", ["unisex"]))
        elif key == "material":
            attrs[key] = random.choice(cfg.get("materials", ["mixed"]))
        elif key == "format":
            attrs[key] = random.choice(cfg.get("formats", ["paperback"]))
        elif key == "language":
            attrs[key] = random.choice(cfg.get("languages", ["English"]))
        elif key == "author":
            attrs[key] = fake.name()
        elif key == "pages":
            attrs[key] = str(random.randint(80, 1200))
        elif key == "connectivity":
            attrs[key] = random.choice(cfg.get("connectivities", ["USB"]))
        elif key == "compatibility":
            attrs[key] = random.choice(cfg.get("compatibilities", ["Universal"]))
        elif key == "wattage":
            attrs[key] = str(random.choice([20, 40, 60, 100, 150, 200, 500]))
        elif key == "warranty_years":
            attrs[key] = str(random.choice([1, 2, 3, 5]))
        else:
            attrs[key] = fake.word()
    return attrs


def seed(conn):
    cur = conn.cursor()

    # Get category IDs
    cur.execute("SELECT id, slug FROM categories ORDER BY slug")
    categories = {row[1]: row[0] for row in cur.fetchall()}
    print(f"Found categories: {list(categories.keys())}")

    # ── Skip if already seeded ────────────────────────────────────────────────
    cur.execute("SELECT COUNT(*) FROM products")
    if cur.fetchone()[0] > 0:
        print("Products already seeded — loading existing IDs, skipping insert.")
        cur.execute("SELECT id FROM products ORDER BY id")
        product_ids = [row[0] for row in cur.fetchall()]
        return  # customers and orders are keyed to these products; skip all if present

    # ── Products (200 per category = 1000 total) ──────────────────────────────
    print("Seeding products...")
    product_ids = []
    seq = 1
    for cat_slug, cat_id in categories.items():
        cfg = CATEGORY_CONFIG[cat_slug]
        for i in range(200):
            brand = random.choice(cfg["brands"])
            price = round(random.uniform(9.99, 499.99), 2)
            # ~40% have a discount
            original_price = None
            if random.random() < 0.4:
                original_price = round(price / (1 - random.uniform(0.05, 0.40)), 2)

            cur.execute(
                """INSERT INTO products (category_id, sku, name, description, brand, price,
                   original_price, image_url, attributes)
                   VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id""",
                (
                    cat_id,
                    f"{cat_slug[:3].upper()}-{seq:06d}",
                    build_name(cat_slug, brand, seq),
                    fake.paragraph(nb_sentences=3),
                    brand,
                    price,
                    original_price,
                    product_image_url(seq),
                    json.dumps(build_attributes(cat_slug)),
                ),
            )
            product_ids.append(cur.fetchone()[0])
            seq += 1

    conn.commit()
    print(f"Inserted {len(product_ids)} products")

    # ── Stock ──────────────────────────────────────────────────────────────────
    print("Seeding stock...")
    for pid in product_ids:
        qty = random.randint(0, 500)
        cur.execute(
            "INSERT INTO stock (product_id, quantity) VALUES (%s, %s) ON CONFLICT (product_id) DO NOTHING",
            (pid, qty),
        )
    conn.commit()
    print(f"Seeded stock for {len(product_ids)} products")

    # ── Customers (500) ────────────────────────────────────────────────────────
    print("Seeding customers...")
    customer_ids = []
    for _ in range(500):
        cur.execute(
            """INSERT INTO customers (email, first_name, last_name, phone, address)
               VALUES (%s, %s, %s, %s, %s) ON CONFLICT (email) DO NOTHING RETURNING id""",
            (
                fake.unique.email(),
                fake.first_name(),
                fake.last_name(),
                fake.phone_number()[:32],
                json.dumps({
                    "street":  fake.street_address(),
                    "city":    fake.city(),
                    "state":   fake.state_abbr(),
                    "country": fake.country_code(),
                    "zip":     fake.postcode(),
                }),
            ),
        )
        row = cur.fetchone()
        if row:
            customer_ids.append(row[0])
    conn.commit()
    print(f"Inserted {len(customer_ids)} customers")

    # ── Orders + Order Items (2000 orders) ────────────────────────────────────
    print("Seeding orders...")
    statuses = ["pending", "confirmed", "shipped", "delivered", "cancelled"]
    status_weights = [0.1, 0.15, 0.2, 0.5, 0.05]
    order_count = 0
    for _ in range(2000):
        cust_id = random.choice(customer_ids)
        n_items = random.randint(1, 5)
        items = [(random.choice(product_ids), random.randint(1, 3)) for _ in range(n_items)]

        # Fetch prices
        pids = [i[0] for i in items]
        cur.execute("SELECT id, price FROM products WHERE id = ANY(%s)", (pids,))
        price_map = {row[0]: float(row[1]) for row in cur.fetchall()}

        total = sum(price_map.get(pid, 0) * qty for pid, qty in items)
        status = random.choices(statuses, status_weights)[0]
        created = fake.date_time_between(start_date="-2y", end_date="now")

        cur.execute(
            """INSERT INTO orders (customer_id, status, total_amount, shipping_addr, created_at, updated_at)
               VALUES (%s, %s, %s, %s, %s, %s) RETURNING id""",
            (cust_id, status, round(total, 2), json.dumps({"city": fake.city()}), created, created),
        )
        order_id = cur.fetchone()[0]

        for pid, qty in items:
            unit_price = price_map.get(pid, 9.99)
            cur.execute(
                "INSERT INTO order_items (order_id, product_id, quantity, unit_price) VALUES (%s, %s, %s, %s)",
                (order_id, pid, qty, unit_price),
            )
        order_count += 1

    conn.commit()
    print(f"Inserted {order_count} orders")
    print("PostgreSQL seeding complete!")


def run_migrations(conn, selected_names: tuple[str, ...] = ()) -> None:
    """Apply all migrations for seeding, or track an explicit deploy allowlist."""
    import glob
    migration_dir = os.path.join(os.path.dirname(__file__), "pg_migrations")
    if not os.path.isdir(migration_dir):
        print("No pg_migrations directory found, skipping schema migration.")
        return
    files = sorted(glob.glob(os.path.join(migration_dir, "*.sql")))
    if not files:
        print("No migration files found.")
        return
    if selected_names:
        by_name = {os.path.basename(path): path for path in files}
        missing = [name for name in selected_names if name not in by_name]
        if missing:
            raise RuntimeError(
                "Unknown PostgreSQL migration(s): " + ", ".join(missing)
            )
        files = [by_name[name] for name in selected_names]
    applied: set[str] = set()
    with conn.cursor() as cur:
        # Ensure the schema exists (safe to run even if it already exists)
        cur.execute(f"CREATE SCHEMA IF NOT EXISTS {_PGDATABASE}")
        if selected_names:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS clickshop_schema_migrations (
                    migration VARCHAR(255) PRIMARY KEY,
                    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )
                """
            )
            cur.execute(
                "SELECT migration FROM clickshop_schema_migrations "
                "WHERE migration = ANY(%s)",
                (list(selected_names),),
            )
            applied = {row[0] for row in cur.fetchall()}
        conn.commit()
        for path in files:
            name = os.path.basename(path)
            if name in applied:
                print(f"  Skipping applied migration: {name}")
                continue
            print(f"  Applying migration: {name}")
            with open(path) as f:
                sql = f.read()
            cur.execute(sql)
            if selected_names:
                cur.execute(
                    "INSERT INTO clickshop_schema_migrations (migration) VALUES (%s)",
                    (name,),
                )
            conn.commit()
    print(f"Migrations checked: {len(files)} file(s)")


if __name__ == "__main__":
    if _MIGRATE_ONLY and not _PG_MIGRATION_FILES:
        raise SystemExit(
            "MIGRATE_ONLY=true requires an explicit PG_MIGRATION_FILES allowlist"
        )
    connect_kwargs = dict(PG_CONNECT_KWARGS)
    if _MIGRATE_ONLY and _PG_MIGRATION_USER:
        connect_kwargs["user"] = _PG_MIGRATION_USER
        connect_kwargs["password"] = _PG_MIGRATION_PASSWORD
    conn = psycopg2.connect(**connect_kwargs)
    apply_search_path(conn, _PGDATABASE)
    try:
        run_migrations(conn, _PG_MIGRATION_FILES if _MIGRATE_ONLY else ())
        if _MIGRATE_ONLY:
            print("PostgreSQL migrations complete — data seed skipped.")
        else:
            print("Seeding data...")
            seed(conn)
    finally:
        conn.close()
