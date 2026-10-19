#!/usr/bin/env python3
"""
Apply SQL files, in the order given, to ClickHouse or Postgres.

    apply_sql.py --clickhouse sql/clickhouse/00_databases.sql sql/clickhouse/20_clickstream.sql
    apply_sql.py --postgres   sql/postgres/001_schema.sql sql/postgres/002_categories.sql

There is no ledger of applied files: every file under sql/ is idempotent
(IF NOT EXISTS, insert-only-what-is-missing), so running one twice is safe.
Pass settings as query settings, not SET statements - ClickHouse's HTTP
interface treats each statement as its own request.

The splitter drops comments and splits on `;` outside quotes. It does not
understand Postgres dollar-quoting ($$ ... $$), which nothing under sql/ uses.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from connections import ch_client, pg_connect


def split_sql_statements(sql: str) -> list[str]:
    """Split a SQL file into executable statements.

    Comments are stripped *before* splitting on semicolons. A semicolon inside
    a `--` comment would otherwise truncate the statement that follows it and
    turn the rest of the comment into the head of the next statement.

    String literals and quoted identifiers are respected, so a `;` or `--`
    inside quotes is left alone.
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


def _fail(path: Path, idx: int, stmt: str, exc: Exception) -> None:
    # Name the file and statement that failed: a bare driver traceback makes a
    # broken statement look like a connection problem.
    head = " ".join(stmt.split())[:200]
    print(f"FAILED {path} statement #{idx}: {head}", file=sys.stderr)
    print(f"  {type(exc).__name__}: {exc}", file=sys.stderr)
    sys.exit(1)


def apply_clickhouse(files: list[Path]) -> None:
    client = ch_client()
    for path in files:
        stmts = split_sql_statements(path.read_text())
        for idx, stmt in enumerate(stmts, start=1):
            try:
                client.command(stmt)
            except Exception as exc:  # noqa: BLE001 - reported with context, then exit
                _fail(path, idx, stmt, exc)
        print(f"applied {path} ({len(stmts)} statements)")


def apply_postgres_file(conn, path: Path) -> int:
    """Apply one file in a single transaction. Returns the statement count."""
    stmts = split_sql_statements(path.read_text())
    with conn.cursor() as cur:
        for idx, stmt in enumerate(stmts, start=1):
            try:
                cur.execute(stmt)
            except Exception as exc:  # noqa: BLE001
                conn.rollback()
                _fail(path, idx, stmt, exc)
    conn.commit()
    return len(stmts)


def apply_postgres(files: list[Path]) -> None:
    with pg_connect() as conn:
        for path in files:
            print(f"applied {path} ({apply_postgres_file(conn, path)} statements)")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = ap.add_mutually_exclusive_group(required=True)
    target.add_argument("--clickhouse", action="store_true", help="apply to ClickHouse (HTTPS 8443)")
    target.add_argument("--postgres", action="store_true", help="apply to Postgres")
    ap.add_argument("files", nargs="+", type=Path, help="SQL files, applied in this order")
    ns = ap.parse_args()

    missing = [str(p) for p in ns.files if not p.is_file()]
    if missing:
        print("ERROR: not found: " + ", ".join(missing), file=sys.stderr)
        return 1

    (apply_clickhouse if ns.clickhouse else apply_postgres)(ns.files)
    return 0


if __name__ == "__main__":
    sys.exit(main())
