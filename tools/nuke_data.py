#!/usr/bin/env python3
"""
Put the workshop's data back to its starting state, keeping every table, view and
the ClickPipe.

    nuke_data.py --yes

Postgres goes back to what `make pg-setup` seeded: the orders and customers the
storefront added are deleted and the stock is restored. It is not truncated, because
the CDC ClickPipe does not replicate TRUNCATE (see seed_postgres.restore_seed).

ClickHouse loses the generated data: the clickstream and card transactions, the
real-time rollups, and everything ClickStack stored in retail_otel. The tables that
mirror Postgres (retail_oltp) and `products_search` are left alone; the first
follows the Postgres reset through the pipe within about a minute.
"""

from __future__ import annotations

import argparse
import sys

from connections import ch_client, pg_connect
from seed_postgres import restore_seed

# ClickHouse tables that hold generated data and nothing else. The rollups are
# found by prefix (analytics_*) so a table added to 30_realtime_mvs.sql is covered.
GENERATED_TABLES = (
    ("retail_analytics", "snowplow_events"),
    ("retail_analytics", "credit_card_transactions"),
)
ROLLUP_PREFIX = ("retail_analytics", "analytics_")
OTEL_DATABASE = "retail_otel"


def tables_to_truncate(rows: list[tuple[str, str, str]]) -> list[tuple[str, str]]:
    """
    Which of the (database, table, engine) rows from system.tables to truncate.

    Views hold no rows of their own (a materialized view writes into its `TO` table,
    which is in the list), and TRUNCATE on a view is an error.
    """
    chosen = []
    for database, table, engine in rows:
        if engine in ("MaterializedView", "View"):
            continue
        db_prefix, name_prefix = ROLLUP_PREFIX
        generated = (
            (database, table) in GENERATED_TABLES
            or (database == db_prefix and table.startswith(name_prefix))
            or database == OTEL_DATABASE
        )
        if generated:
            chosen.append((database, table))
    return sorted(chosen)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true", help="do it (the Makefile asks first)")
    ns = ap.parse_args()
    if not ns.yes:
        sys.exit("Refusing to run without --yes. Use `make nuke-data`, which asks first.")

    with pg_connect() as conn:
        changed = restore_seed(conn)
    print("Postgres restored to the seed: " + ", ".join(f"{n:,} {what}" for what, n in changed.items()) + " changed")

    client = ch_client()
    rows = client.query(
        "SELECT database, name, engine FROM system.tables "
        "WHERE database IN ('retail_analytics', %(otel)s)",
        parameters={"otel": OTEL_DATABASE},
    ).result_rows
    for database, table in tables_to_truncate(rows):
        client.command(f"TRUNCATE TABLE {database}.{table}")
        print(f"truncated {database}.{table}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
