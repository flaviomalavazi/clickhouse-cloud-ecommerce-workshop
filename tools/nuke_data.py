#!/usr/bin/env python3
"""
Put the workshop's orders and inventory back to the seed.

    nuke_data.py --yes

Postgres goes back to what `make pg-setup` seeded: the orders and customers the
storefront added are deleted and the stock levels are restored. The ClickPipe
carries those deletes and updates to `retail_oltp` within about a minute.

It touches nothing in ClickHouse. The web analytics events (`snowplow_events`,
`credit_card_transactions` and the rollups built from them) and the ClickStack
telemetry (`retail_otel`) are slow to rebuild, so a reset never removes them.
Postgres is not truncated either: the CDC ClickPipe does not replicate TRUNCATE
(see seed_postgres.restore_seed).
"""

from __future__ import annotations

import argparse
import sys

from connections import pg_connect
from seed_postgres import restore_seed


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--yes", action="store_true", help="do it (the Makefile asks first)")
    ns = ap.parse_args()
    if not ns.yes:
        sys.exit("Refusing to run without --yes. Use `make nuke-data`, which asks first.")

    with pg_connect() as conn:
        changed = restore_seed(conn)
    print("Postgres restored to the seed: " + ", ".join(f"{n:,} {what}" for what, n in changed.items()) + " changed")
    print("ClickHouse was not touched: events and telemetry are kept. The ClickPipe brings retail_oltp in step.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
