#!/usr/bin/env python3
"""Sync products from PostgreSQL to ClickHouse and generate CLIP embeddings."""
from __future__ import annotations

import json
import os
import time
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx
import psycopg2
import clickhouse_connect

from pg_ssl import apply_search_path, pg_sslmode

_PGDATABASE = os.environ.get("PGDATABASE", "retail_db")
_PGHOST = os.environ.get("PGHOST", "localhost")

PG_CONNECT_KWARGS = {
    "host":     _PGHOST,
    "port":     int(os.environ.get("PGPORT", "5432")),
    "user":     os.environ.get("PGUSER",     "retail_user"),
    "password": os.environ.get("PGPASSWORD", "retail_pass"),
    "dbname":   _PGDATABASE,
    "sslmode":  pg_sslmode(_PGHOST),
}
CLICKHOUSE_URL    = os.environ.get("CLICKHOUSE_URL", "http://localhost:8123")
CLICKHOUSE_USER   = os.environ.get("CLICKHOUSE_USER", "default")
CLICKHOUSE_PASS   = os.environ.get("CLICKHOUSE_PASSWORD", "")
CH_MIGRATION_USER = os.environ.get("CLICKHOUSE_MIGRATION_USER", "").strip()
CH_MIGRATION_PASS = os.environ.get("CLICKHOUSE_MIGRATION_PASSWORD", "")
CLICKHOUSE_DB     = os.environ.get("CLICKHOUSE_DB", "retail_analytics")
EMBEDDING_SERVICE = os.environ.get("EMBEDDING_SERVICE_URL", "http://localhost:8001")
MIGRATE_ONLY       = os.environ.get("MIGRATE_ONLY", "false").strip().lower() in {
    "1", "true", "yes", "on",
}
CH_MIGRATION_FILES = tuple(
    name.strip()
    for name in os.environ.get("CH_MIGRATION_FILES", "").split(",")
    if name.strip()
)

_parsed    = urlparse(CLICKHOUSE_URL)
_CH_HOST   = _parsed.hostname or "localhost"
_CH_PORT   = _parsed.port or (8443 if _parsed.scheme == "https" else 8123)
_CH_SECURE = _parsed.scheme == "https"

BATCH_SIZE = 100  # per insert-batch-size best practice (minimum 1000, this is a 1000-row seed)

PRODUCTS_SEARCH_COLUMNS = [
    "product_id", "category_slug", "sku", "name", "description",
    "brand", "price", "original_price", "image_url", "is_active",
    "attributes", "updated_at",
    # Carried through from Postgres so a plain seed produces a searchable
    # catalogue in every locale. Leaving them out meant migration 009 added the
    # columns and their full-text indexes, the seed wrote nothing into them, and
    # a pt/es query matched zero rows until the out-of-band assets pipeline ran.
    "name_pt", "name_es", "description_pt", "description_es",
]

EMBEDDINGS_COLUMNS = ["product_id", "sku", "name", "image_url", "embedding"]


def get_postgres_products(pg_conn):
    cur = pg_conn.cursor()
    cur.execute(
        """SELECT p.id, c.slug AS category_slug, p.sku, p.name, p.description,
                  p.brand, p.price, p.original_price, p.image_url, p.is_active,
                  p.attributes, p.updated_at,
                  p.name_pt, p.name_es, p.description_pt, p.description_es
           FROM products p
           JOIN categories c ON c.id = p.category_id
           WHERE p.is_active = true
           ORDER BY p.id"""
    )
    cols = [d[0] for d in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


def sync_products_search(ch_client: clickhouse_connect.driver.Client, products: list[dict]):
    print(f"Syncing {len(products)} products to products_search...")
    rows = []
    for p in products:
        rows.append({
            "product_id":     p["id"],
            "category_slug":  p["category_slug"],
            "sku":            p["sku"],
            "name":           p["name"],
            "description":    p["description"] or "",
            "brand":          p["brand"] or "",
            "price":          float(p["price"]),
            "original_price": float(p["original_price"]) if p["original_price"] else 0.0,
            "image_url":      p["image_url"] or "",
            "is_active":      1 if p["is_active"] else 0,
            "attributes":     json.dumps(p["attributes"]) if p["attributes"] else "{}",
            "updated_at":     p["updated_at"].replace(tzinfo=None) if p["updated_at"] else datetime.now(),
            # NULL in Postgres for an untranslated product; the ClickHouse
            # columns are String DEFAULT '' and the storefront treats '' as
            # "fall back to English", so coerce rather than pass None.
            "name_pt":        p["name_pt"] or "",
            "name_es":        p["name_es"] or "",
            "description_pt": p["description_pt"] or "",
            "description_es": p["description_es"] or "",
        })

    for i in range(0, len(rows), BATCH_SIZE):
        batch = rows[i : i + BATCH_SIZE]
        data = [[row[col] for col in PRODUCTS_SEARCH_COLUMNS] for row in batch]
        ch_client.insert(
            "products_search",
            data,
            column_names=PRODUCTS_SEARCH_COLUMNS,
            database=CLICKHOUSE_DB,
        )
        print(f"  products_search: inserted batch {i//BATCH_SIZE + 1}/{(len(rows)-1)//BATCH_SIZE + 1}")

    print("products_search sync complete.")


def get_embedding(url: str, image_url: str, retries: int = 3) -> list[float] | None:
    if not image_url.startswith(("http://", "https://")):
        return None
    for attempt in range(retries):
        try:
            response = httpx.post(
                f"{url}/embed/url",
                json={"url": image_url},
                timeout=30,
            )
            response.raise_for_status()
            return response.json()["vector"]
        except Exception as e:
            print(f"    Embedding attempt {attempt+1} failed for {image_url}: {e}")
            if attempt < retries - 1:
                time.sleep(2 ** attempt)
    return None


def seed_embeddings(ch_client: clickhouse_connect.driver.Client, products: list[dict]):
    # Skip if embeddings already present (re-run safety)
    result = ch_client.query("SELECT count() FROM product_embeddings")
    if result.first_row[0] > 0:
        print(f"Embeddings already present ({result.first_row[0]} rows) — skipping.")
        return
    print(f"Generating embeddings for {len(products)} products...")
    rows = []
    failed = 0

    for i, p in enumerate(products):
        vec = get_embedding(EMBEDDING_SERVICE, p["image_url"])
        if vec is None:
            print(f"  Skipping product {p['id']} – embedding failed")
            failed += 1
            continue

        rows.append({
            "product_id": p["id"],
            "sku":        p["sku"],
            "name":       p["name"],
            "image_url":  p["image_url"],
            "embedding":  vec,
        })

        if i % 50 == 0:
            print(f"  Embedded {i}/{len(products)} products...")

        # Insert in batches of BATCH_SIZE
        if len(rows) >= BATCH_SIZE:
            data = [[row[col] for col in EMBEDDINGS_COLUMNS] for row in rows]
            ch_client.insert(
                "product_embeddings",
                data,
                column_names=EMBEDDINGS_COLUMNS,
                database=CLICKHOUSE_DB,
            )
            print(f"  Inserted embedding batch of {len(rows)}")
            rows.clear()

    # Flush remaining
    if rows:
        data = [[row[col] for col in EMBEDDINGS_COLUMNS] for row in rows]
        ch_client.insert(
            "product_embeddings",
            data,
            column_names=EMBEDDINGS_COLUMNS,
            database=CLICKHOUSE_DB,
        )
        print(f"  Inserted final embedding batch of {len(rows)}")

    print(f"Embeddings complete. Failed: {failed}/{len(products)}")


def split_sql_statements(sql: str) -> list[str]:
    """Split a migration file into executable statements.

    Line comments are stripped *before* splitting on semicolons. This matters:
    a semicolon inside a `--` comment used to truncate the statement that
    followed it, turning the rest of the comment into the head of the next
    statement. Migration 004 tripped over exactly that ("...replaced the active
    one; stale is_active=1 rows...") and raised a syntax error, which aborted
    run_ch_migrations before any product ever reached products_search.

    String literals are respected so a semicolon or `--` inside quotes is left
    alone.
    """
    out: list[str] = []
    buf: list[str] = []
    quote: str | None = None
    i, n = 0, len(sql)

    while i < n:
        ch = sql[i]

        if quote:
            buf.append(ch)
            if ch == "\\" and i + 1 < n:      # escaped char inside a literal
                buf.append(sql[i + 1])
                i += 2
                continue
            if ch == quote:
                quote = None
            i += 1
            continue

        if ch in ("'", '"', "`"):
            quote = ch
            buf.append(ch)
            i += 1
            continue

        if sql.startswith("--", i):           # line comment - drop to EOL
            j = sql.find("\n", i)
            i = n if j == -1 else j
            continue

        if sql.startswith("/*", i):           # block comment - drop to close
            j = sql.find("*/", i + 2)
            i = n if j == -1 else j + 2
            continue

        if ch == ";":
            out.append("".join(buf).strip())
            buf = []
            i += 1
            continue

        buf.append(ch)
        i += 1

    out.append("".join(buf).strip())
    return [s for s in out if s]


def run_ch_migrations(ch_client, selected_names: tuple[str, ...] = ()) -> None:
    """Apply all migrations for seeding, or track an explicit deploy allowlist."""
    import glob
    migration_dir = os.path.join(os.path.dirname(__file__), "ch_migrations")
    if not os.path.isdir(migration_dir):
        print("No ch_migrations directory found, skipping ClickHouse schema migration.")
        return
    files = sorted(glob.glob(os.path.join(migration_dir, "*.sql")))
    if not files:
        print("No ClickHouse migration files found.")
        return
    if selected_names:
        by_name = {os.path.basename(path): path for path in files}
        missing = [name for name in selected_names if name not in by_name]
        if missing:
            raise RuntimeError(
                "Unknown ClickHouse migration(s): " + ", ".join(missing)
            )
        files = [by_name[name] for name in selected_names]
    applied: set[str] = set()
    if selected_names:
        migration_table = f"{CLICKHOUSE_DB}.clickshop_schema_migrations"
        ch_client.command(
            f"""
            CREATE TABLE IF NOT EXISTS {migration_table} (
                migration String,
                applied_at DateTime DEFAULT now()
            ) ENGINE = MergeTree
            ORDER BY migration
            """
        )
        result = ch_client.query(
            f"SELECT migration FROM {migration_table}"
        )
        applied = {row[0] for row in result.result_rows}

    for path in files:
        name = os.path.basename(path)
        if name in applied:
            print(f"  Skipping applied ClickHouse migration: {name}")
            continue
        print(f"  Applying ClickHouse migration: {name}")
        with open(path) as f:
            sql = f.read()
        # Strip SET statements that are read-only on ClickHouse Cloud
        if _CH_SECURE:
            sql = "\n".join(
                line for line in sql.splitlines()
                if not line.strip().upper().startswith("SET ")
            )
        for idx, stmt in enumerate(split_sql_statements(sql), start=1):
            try:
                ch_client.command(stmt)
            except Exception:
                # Name the file and statement that failed. Without this the
                # traceback only showed the driver frame, so a broken migration
                # looked like a connection problem.
                head = " ".join(stmt.split())[:200]
                print(f"    FAILED {name} statement #{idx}: {head}")
                raise
        if selected_names:
            # One synchronous row per release is intentional migration metadata,
            # not a high-frequency ingestion path that needs batching.
            ch_client.insert(
                migration_table,
                [[name]],
                column_names=["migration"],
            )
    print(f"ClickHouse migrations checked: {len(files)} file(s)")


if __name__ == "__main__":
    if MIGRATE_ONLY and not CH_MIGRATION_FILES:
        raise SystemExit(
            "MIGRATE_ONLY=true requires an explicit CH_MIGRATION_FILES allowlist"
        )

    print(f"Connecting to ClickHouse at {CLICKHOUSE_URL}...")
    ch_settings: dict = {}
    use_migration_credentials = MIGRATE_ONLY and bool(CH_MIGRATION_USER)
    ch_client = clickhouse_connect.get_client(
        host=_CH_HOST,
        port=_CH_PORT,
        username=CH_MIGRATION_USER if use_migration_credentials else CLICKHOUSE_USER,
        password=CH_MIGRATION_PASS if use_migration_credentials else CLICKHOUSE_PASS,
        database=CLICKHOUSE_DB,
        secure=_CH_SECURE,
        settings=ch_settings,
    )

    run_ch_migrations(ch_client, CH_MIGRATION_FILES if MIGRATE_ONLY else ())

    if MIGRATE_ONLY:
        ch_client.close()
        print("ClickHouse migrations complete — product sync and embeddings skipped.")
        raise SystemExit(0)

    print("Connecting to PostgreSQL...")
    pg_conn = psycopg2.connect(**PG_CONNECT_KWARGS)
    apply_search_path(pg_conn, _PGDATABASE)

    products = get_postgres_products(pg_conn)
    print(f"Loaded {len(products)} products from PostgreSQL")

    sync_products_search(ch_client, products)

    # Force a one-time synchronous merge after the full re-seed so that any
    # stale rows from before the ORDER BY fix are physically removed and only
    # the highest-updated_at version per (category_slug, product_id) survives.
    # Acceptable here as a deliberate seed-time operation, not a routine workflow.
    print("Optimizing products_search (forcing merge of deactivated primary keys)...")
    ch_client.command(f"OPTIMIZE TABLE {CLICKHOUSE_DB}.products_search FINAL")
    print("OPTIMIZE TABLE products_search FINAL complete.")

    seed_embeddings(ch_client, products)

    pg_conn.close()
    ch_client.close()
    print("All done!")
