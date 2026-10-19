#!/usr/bin/env python3
"""
Row counts and freshness for the tables the workshop fills, in Postgres and ClickHouse.

    status.py

"Newest" is the timestamp of the latest row and "age" is how long ago that was, so a
table that has stopped growing shows an age that keeps climbing. This is what
`make status` prints below the pod list.
"""

from __future__ import annotations

import sys

from connections import ch_client, pg_connect

# (table, timestamp column or None, extra WHERE). A table with no timestamp column
# (the rollups) shows a row count only.
CLICKHOUSE_TABLES = (
    ("retail_analytics.snowplow_events", "collector_tstamp", ""),
    ("retail_analytics.credit_card_transactions", "timestamp", ""),
    ("retail_analytics.analytics_live_events", "collector_tstamp", ""),
    ("retail_analytics.analytics_events_1m", None, ""),
    ("retail_analytics.products_search", None, ""),
    # CDC mirrors: a deleted row stays in the table with _peerdb_is_deleted = 1.
    ("retail_oltp.orders FINAL", "updated_at", "_peerdb_is_deleted = 0"),
    ("retail_oltp.stock FINAL", "updated_at", "_peerdb_is_deleted = 0"),
    ("retail_otel.otel_logs", "Timestamp", ""),
    ("retail_otel.otel_traces", "Timestamp", ""),
    ("retail_otel.otel_metrics_gauge", "TimeUnix", ""),
    ("retail_otel.hyperdx_sessions", "Timestamp", ""),
)

POSTGRES_TABLES = (
    ("orders", "updated_at"),
    ("order_items", None),
    ("customers", "created_at"),
    ("stock", "updated_at"),
)


def format_age(seconds: float | None) -> str:
    """'4s', '3m', '2h', '5d'; '-' when there is no row to measure."""
    if seconds is None:
        return "-"
    seconds = max(0, int(seconds))
    for unit, size in (("d", 86400), ("h", 3600), ("m", 60)):
        if seconds >= size:
            return f"{seconds // size}{unit}"
    return f"{seconds}s"


def _row(name: str, count: int | None, newest, age) -> str:
    shown = "-" if count is None else f"{count:,}"
    return f"  {name:<46} {shown:>12}  {str(newest or '-'):<19}  {format_age(age):>5}"


def _header() -> str:
    return f"  {'table':<46} {'rows':>12}  {'newest':<19}  {'age':>5}"


def clickhouse_section() -> None:
    print("ClickHouse")
    print(_header())
    client = ch_client()
    for table, ts, where in CLICKHOUSE_TABLES:
        label = table.replace(" FINAL", "")
        clause = f"WHERE {where}" if where else ""
        select = "count()" if ts is None else f"count(), max({ts}), dateDiff('second', max({ts}), now())"
        try:
            row = client.query(f"SELECT {select} FROM {table} {clause}").result_rows[0]
        except Exception as exc:  # a table that does not exist yet is not an error here
            reason = str(exc).splitlines()[0][:60]
            print(f"  {label:<46} {'missing':>12}  ({reason})")
            continue
        count = row[0]
        newest, age = (row[1], row[2]) if ts and count else (None, None)
        print(_row(label, count, str(newest)[:19] if newest else None, age))


def postgres_section() -> None:
    print("Postgres")
    print(_header())
    with pg_connect() as conn:
        for table, ts in POSTGRES_TABLES:
            select = "count(*)" if ts is None else f"count(*), max({ts}), extract(epoch FROM now() - max({ts}))"
            row = conn.execute(f"SELECT {select} FROM {table}").fetchone()
            count = row[0]
            newest, age = (row[1], row[2]) if ts and count else (None, None)
            print(_row(table, count, str(newest)[:19] if newest else None, age))


def main() -> int:
    for section in (postgres_section, clickhouse_section):
        try:
            section()
        except SystemExit as exc:  # missing credentials: say so and carry on
            print(f"  {exc}")
        except Exception as exc:
            print(f"  could not connect: {str(exc).splitlines()[0][:100]}")
        print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
