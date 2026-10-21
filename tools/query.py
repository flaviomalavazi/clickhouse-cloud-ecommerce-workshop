#!/usr/bin/env python3
"""
Run SQL on the workshop's databases without a prompt.

    query.py clickhouse --sql "SELECT count() FROM retail_oltp.orders FINAL"
    query.py postgres   --sql "SELECT count(*) FROM orders"
    query.py clickhouse --file sql/clickhouse/examples/06_real_time_analytics.sql --only 2

`make psql` and `make ch-client` open a prompt and need a terminal; this is for the places that have
none, such as a coding agent running the workshop (agent-mode/), and for one-off questions in a script.

--only N runs what sits under the comment numbered N ("-- 2. ...") in an example file: one query, or
two when the file shows a pair. Without it, every statement of the file runs, in order.

Results print as a table (at most --max-rows rows; wider values are cut at --width characters). A
result of one column is printed as it is, uncut: `SHOW CREATE TABLE` and `EXPLAIN` read that way.
Statements that return no rows (DDL, `SYSTEM REFRESH VIEW`, INSERT) print OK.
"""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

from apply_sql import split_sql_statements

# ClickHouse: these return rows (clickhouse-connect `query`); anything else is run as a command.
READ_KEYWORDS = frozenset({"SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXPLAIN", "EXISTS"})


def numbered_sections(text: str) -> dict[int, str]:
    """An example file's queries by the number in their comment: {2: "-- 2. ...\\nSELECT ...;", ...}."""
    heads = list(re.finditer(r"^-- (\d+)\. ", text, flags=re.M))
    return {
        int(h.group(1)): text[h.start(): heads[i + 1].start() if i + 1 < len(heads) else len(text)]
        for i, h in enumerate(heads)
    }


def statements_from(sql: str | None, path: Path | None, only: int | None) -> list[str]:
    if sql is not None:
        return split_sql_statements(sql)
    text = path.read_text()
    if only is None:
        return split_sql_statements(text)
    sections = numbered_sections(text)
    if only not in sections:
        raise SystemExit(f"ERROR: {path} has no query numbered {only} (it has {', '.join(map(str, sections)) or 'none'})")
    return split_sql_statements(sections[only])


def first_keyword(statement: str) -> str:
    match = re.match(r"[\s(]*([A-Za-z]+)", statement)
    return match.group(1).upper() if match else ""


def cell(value, width: int | None) -> str:
    text = "NULL" if value is None else str(value)
    if width is None:
        return text
    text = " ".join(text.split())
    return text if len(text) <= width else text[: width - 1] + "…"


def format_result(columns: list[str], rows: list[tuple], max_rows: int = 100, width: int = 60) -> str:
    """The result as text. Rows beyond max_rows are not printed (the caller may have fetched one more to know)."""
    shown, more = rows[:max_rows], len(rows) > max_rows
    if len(columns) == 1:                       # SHOW CREATE TABLE, EXPLAIN, a single value: as it is
        lines = [cell(r[0], None) for r in shown]
        if len(shown) == 1:
            return lines[0]
        out = [columns[0], "-" * len(columns[0]), *lines]
    else:
        table = [[cell(v, width) for v in r] for r in shown]
        widths = [max(len(c), *(len(r[i]) for r in table)) if table else len(c) for i, c in enumerate(columns)]
        line = lambda cells: "  ".join(c.ljust(w) for c, w in zip(cells, widths)).rstrip()
        out = [line(columns), line(["-" * w for w in widths]), *(line(r) for r in table)]
    out.append(f"({len(shown)} row{'s' if len(shown) != 1 else ''}{', more not shown: add a LIMIT or raise --max-rows' if more else ''})")
    return "\n".join(out)


def run_clickhouse(client, statement: str, max_rows: int, width: int) -> str:
    if first_keyword(statement) not in READ_KEYWORDS:
        client.command(statement)
        return "OK"
    result = client.query(statement, settings={"max_result_rows": max_rows + 1, "result_overflow_mode": "break"})
    return format_result(list(result.column_names), [tuple(r) for r in result.result_rows], max_rows, width)


def run_postgres(conn, statement: str, max_rows: int, width: int) -> str:
    with conn.cursor() as cur:
        cur.execute(statement)
        if cur.description is None:
            return f"OK ({cur.rowcount} row{'s' if cur.rowcount != 1 else ''} affected)" if cur.rowcount >= 0 else "OK"
        columns = [d.name for d in cur.description]
        return format_result(columns, [tuple(r) for r in cur.fetchmany(max_rows + 1)], max_rows, width)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("database", choices=["clickhouse", "postgres"])
    source = ap.add_mutually_exclusive_group(required=True)
    source.add_argument("--sql", help="the statement(s) to run")
    source.add_argument("--file", type=Path, help="a SQL file")
    ap.add_argument("--only", type=int, help="with --file: the query numbered N in its comments")
    ap.add_argument("--max-rows", type=int, default=100)
    ap.add_argument("--width", type=int, default=60)
    ns = ap.parse_args()
    if ns.only is not None and ns.file is None:
        ap.error("--only goes with --file")
    if ns.file is not None and not ns.file.is_file():
        print(f"ERROR: not found: {ns.file}", file=sys.stderr)
        return 1

    statements = statements_from(ns.sql, ns.file, ns.only)
    if not statements:
        print("ERROR: no SQL to run", file=sys.stderr)
        return 1

    from connections import ch_client, pg_connect

    connection = None
    try:
        if ns.database == "clickhouse":
            client = ch_client()
            run = lambda s: run_clickhouse(client, s, ns.max_rows, ns.width)
        else:
            connection = pg_connect()
            connection.autocommit = True        # as psql: each statement stands alone, BEGIN ... COMMIT still works
            run = lambda s: run_postgres(connection, s, ns.max_rows, ns.width)
        for i, statement in enumerate(statements, 1):
            if len(statements) > 1:
                print(f"\n[{i}/{len(statements)}] {' '.join(statement.split())[:100]}")
            print(run(statement))
    except Exception as exc:  # noqa: BLE001 - one readable line, not a traceback
        print(f"ERROR: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 1
    finally:
        if connection is not None:
            connection.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
