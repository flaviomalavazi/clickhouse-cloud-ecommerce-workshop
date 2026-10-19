#!/usr/bin/env python3
"""
Put the workshop's orders and inventory back to the seed.

    nuke_data.py --yes

Postgres is truncated and seeded again, and the Postgres tables mirrored in
ClickHouse (`retail_oltp`) are emptied so the ClickPipe ingests the new rows from
scratch. The order matters, because the ClickPipe ignores TRUNCATE:

  1. wait until the pipe has caught up (rows still in flight would land after step 2);
  2. empty the `retail_oltp` mirror tables (never the pipe's own `_peerdb_` tables);
  3. truncate and reseed Postgres, whose inserts the pipe does replicate;
  4. wait for the mirror tables to fill again, then refresh `products_search`
     (it rebuilds from them every minute and would stay empty until then).

Nothing else in ClickHouse is touched. The web analytics events, the card
transactions, the rollups built from them and the ClickStack telemetry are slow to
rebuild, so a reset never removes them.

Without a ClickPipe (no `retail_oltp` tables yet) only Postgres is reseeded.
"""

from __future__ import annotations

import argparse
import sys
import time

import seed_postgres
from connections import ch_client, pg_connect

OLTP_DATABASE = "retail_oltp"
SEARCH_VIEW = "products_search_refresh"
SEARCH_DATABASE = "retail_analytics"
# Tables whose row counts show that the pipe is in step with Postgres.
COUNTED = ("orders", "order_items", "customers", "products")
DRAIN_TIMEOUT_S = 120
REINGEST_TIMEOUT_S = 300
POLL_S = 5


def oltp_tables_to_truncate(rows: list[tuple[str, str]]) -> list[str]:
    """
    Which of the (name, engine) rows of `retail_oltp` to empty: the tables the pipe
    mirrors, and not its own bookkeeping (`_peerdb_raw_mirror_...`) or any view.
    """
    return sorted(
        name for name, engine in rows
        if not name.startswith("_peerdb_") and engine not in ("MaterializedView", "View")
    )


def in_step(postgres: dict[str, int], clickhouse: dict[str, int]) -> bool:
    """True when ClickHouse holds exactly as many live rows as Postgres for every counted table."""
    return all(clickhouse.get(table) == count for table, count in postgres.items())


def postgres_counts(tables: list[str]) -> dict[str, int]:
    with pg_connect() as conn:
        return {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in tables}


def clickhouse_counts(client, tables: list[str]) -> dict[str, int]:
    # The mirror tables keep a deleted row (with _peerdb_is_deleted = 1) and old versions.
    return {
        t: client.query(f"SELECT count() FROM {OLTP_DATABASE}.{t} FINAL WHERE _peerdb_is_deleted = 0").result_rows[0][0]
        for t in tables
    }


def wait_until_in_step(client, tables: list[str], timeout_s: int, what: str) -> bool:
    deadline = time.time() + timeout_s
    last_report = 0.0
    while True:
        pg, ch = postgres_counts(tables), clickhouse_counts(client, tables)
        if in_step(pg, ch):
            return True
        if time.time() > deadline:
            print(f"  not in step after {timeout_s}s ({what}): Postgres {pg}, ClickHouse {ch}")
            return False
        if time.time() - last_report > 15:
            last_report = time.time()
            print("  waiting: " + ", ".join(f"{t} {ch.get(t, 0):,}/{pg[t]:,}" for t in tables))
        time.sleep(POLL_S)


def refresh_search(client) -> None:
    exists = client.query(
        "SELECT count() FROM system.tables WHERE database = %(db)s AND name = %(name)s",
        parameters={"db": SEARCH_DATABASE, "name": SEARCH_VIEW},
    ).result_rows[0][0]
    if not exists:
        return
    view = f"{SEARCH_DATABASE}.{SEARCH_VIEW}"
    client.command(f"SYSTEM REFRESH VIEW {view}")
    client.command(f"SYSTEM WAIT VIEW {view}")
    print("products_search rebuilt")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true", help="do it (the Makefile asks first)")
    ns = ap.parse_args()
    if not ns.yes:
        sys.exit("Refusing to run without --yes. Use `make nuke-data`, which asks first.")

    client = ch_client()
    rows = client.query(
        "SELECT name, engine FROM system.tables WHERE database = %(db)s", parameters={"db": OLTP_DATABASE}
    ).result_rows
    mirrored = oltp_tables_to_truncate(rows)
    counted = [t for t in COUNTED if t in mirrored]

    if mirrored:
        print("waiting for the ClickPipe to catch up with Postgres...")
        if not wait_until_in_step(client, counted, DRAIN_TIMEOUT_S, "before the reset"):
            sys.exit("Not resetting: changes still in flight would land after the truncate and leave "
                     "rows that no longer exist in Postgres. Check the ClickPipe and run it again.")
        for table in mirrored:
            client.command(f"TRUNCATE TABLE {OLTP_DATABASE}.{table}")
        print(f"emptied {len(mirrored)} ClickHouse tables in {OLTP_DATABASE}")
    else:
        print(f"no tables in {OLTP_DATABASE} (no ClickPipe yet): only Postgres is reseeded")

    seed_postgres.run(reset=True)

    if mirrored:
        print("waiting for the ClickPipe to ingest the seed again...")
        if not wait_until_in_step(client, counted, REINGEST_TIMEOUT_S, "after the reseed"):
            print("Postgres is reseeded, but ClickHouse has not caught up. Is the ClickPipe running?")
            return 1
        print(f"{OLTP_DATABASE} is back in step with Postgres")
        refresh_search(client)
    print("Done: orders and inventory are at the seed. Web analytics events and telemetry were not touched.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
