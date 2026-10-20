#!/usr/bin/env python3
"""
Is the 30-day history already in ClickHouse?  Exit 0 if it is, 1 if it is not.

`make backfill` asks this first and skips the load when the history is there: running it twice would
load every session twice, and a ClickHouse event table cannot be emptied for a second try (events are
the data that takes the longest to produce). `make backfill FORCE=1` loads it anyway.

History is "events older than two days": only a backfill, or days of live traffic, puts those there.
"""

from __future__ import annotations

import sys

OLDER_THAN_DAYS = 2
MIN_ROWS = 100_000


def history_rows(client) -> int:
    return client.query(
        f"SELECT count() FROM retail_analytics.snowplow_events WHERE collector_tstamp < now() - INTERVAL {OLDER_THAN_DAYS} DAY"
    ).result_rows[0][0]


def main() -> int:
    from connections import ch_client

    try:
        rows = history_rows(ch_client())
    except Exception:           # no table yet, or ClickHouse unreachable: let the backfill find out
        return 1
    if rows < MIN_ROWS:
        return 1
    print(f"history is already loaded ({rows:,} events older than {OLDER_THAN_DAYS} days in snowplow_events): not loading it twice.")
    print("  To load it again anyway:  make backfill FORCE=1")
    return 0


if __name__ == "__main__":
    sys.exit(main())
