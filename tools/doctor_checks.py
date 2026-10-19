#!/usr/bin/env python3
"""
The database checks of `make doctor`: can this machine reach ClickHouse Cloud and
Managed Postgres with what is in .env, and is ClickHouse new enough?

    doctor_checks.py

Prints one line per check and exits 1 if any failed. The values from .env are never
printed.
"""

from __future__ import annotations

import sys

from connections import ch_client, pg_connect

# The text index the workshop uses is generally available from this version.
MIN_CLICKHOUSE = (26, 2)


def parse_version(text: str) -> tuple[int, ...]:
    """'26.6.1.123' -> (26, 6, 1, 123). Anything unparseable sorts below every real version."""
    try:
        return tuple(int(part) for part in text.strip().split("."))
    except ValueError:
        return (0,)


def clickhouse_ok(version: str) -> bool:
    return parse_version(version)[: len(MIN_CLICKHOUSE)] >= MIN_CLICKHOUSE


def check_clickhouse() -> bool:
    try:
        version = ch_client().query("SELECT version()").result_rows[0][0]
    except SystemExit as exc:
        print(f"  ✗ ClickHouse: {exc}")
        return False
    except Exception as exc:
        print(f"  ✗ ClickHouse: could not connect ({str(exc).splitlines()[0][:120]})")
        return False
    wanted = ".".join(str(n) for n in MIN_CLICKHOUSE)
    if not clickhouse_ok(version):
        print(f"  ✗ ClickHouse {version}: the workshop needs {wanted} or newer (text index)")
        return False
    print(f"  ✓ ClickHouse {version} (needs {wanted}+)")
    return True


def check_postgres() -> bool:
    try:
        with pg_connect() as conn:
            version = conn.execute("SHOW server_version").fetchone()[0].split()[0]
            ssl = conn.execute("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()").fetchone()
            wal = conn.execute("SHOW wal_level").fetchone()[0]
    except SystemExit as exc:
        print(f"  ✗ Postgres: {exc}")
        return False
    except Exception as exc:
        print(f"  ✗ Postgres: could not connect ({str(exc).splitlines()[0][:120]})")
        return False
    encrypted = "TLS" if ssl and ssl[0] else "NOT encrypted"
    print(f"  ✓ Postgres {version} ({encrypted}, wal_level={wal})")
    return True


def main() -> int:
    results = [check_clickhouse(), check_postgres()]
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
