#!/usr/bin/env python3
"""
Custom OTel collector schema migration.

Replaces the upstream migrate binary which hardcodes 'default' as the target
database regardless of any environment variable.

Behaviour
---------
  Cloud mode  (CLICKHOUSE_ENDPOINT starts with https://)
    - Skips CREATE DATABASE — the database must already exist.
    - Applies every other SQL file (table creation) to CLICKHOUSE_DATABASE.

  Local mode  (HTTP endpoint)
    - Creates CLICKHOUSE_DATABASE if it does not exist.
    - Applies every SQL file in order.

  In both modes:
    - ${DATABASE} is replaced with CLICKHOUSE_DATABASE
    - ${TABLES_TTL}, ${LOGS_TTL}, ${METRICS_TTL}, ${SESSIONS_TTL}, ${TRACES_TTL}
      are all replaced with toIntervalDay(CLICKHOUSE_TTL_DAYS)
    - The compatibility schema is selected for ClickHouse versions before 26.2
    - Statements that fail with "already exists" are silently skipped.

Environment variables
---------------------
  CLICKHOUSE_ENDPOINT   HTTP(S) base URL (e.g. https://host:8443)
  CLICKHOUSE_USER       ClickHouse username
  CLICKHOUSE_PASSWORD   ClickHouse password (passed as HTTP header; special
                        characters are safe)
  CLICKHOUSE_DATABASE   Target database name (required; no default)
  CLICKHOUSE_TTL_DAYS   Table TTL in days (default: 30)
"""

import os
import re
import ssl
import sys
import urllib.error
import urllib.request
from pathlib import Path

ENDPOINT   = os.environ.get("CLICKHOUSE_ENDPOINT", "http://clickhouse:8123").rstrip("/")
USER       = os.environ.get("CLICKHOUSE_USER", "default")
PASSWORD   = os.environ.get("CLICKHOUSE_PASSWORD", "")
DB         = os.environ.get("CLICKHOUSE_DATABASE", "")
TTL_DAYS   = int(os.environ.get("CLICKHOUSE_TTL_DAYS", "30"))
SEED_DIR   = Path("/etc/otel/schema/seed")
CLOUD_MODE = ENDPOINT.startswith("https://")

if not DB:
    print("[migrate] ERROR: CLICKHOUSE_DATABASE is not set", file=sys.stderr)
    sys.exit(1)

TABLES_TTL = f"toIntervalDay({TTL_DAYS})"

print(f"[migrate] {'='*52}")
print(f"[migrate] Database : {DB}")
print(f"[migrate] TTL      : {TABLES_TTL}")
print(f"[migrate] Cloud    : {CLOUD_MODE}")
print(f"[migrate] Endpoint : {ENDPOINT}")
print(f"[migrate] {'='*52}")

# In cloud mode, skip TLS verification errors from self-signed certs (not needed
# for ClickHouse Cloud which has valid certs, but useful for self-hosted TLS).
_ssl_ctx = ssl.create_default_context() if CLOUD_MODE else None


def run_sql(sql: str, description: str = "") -> None:
    sql = sql.strip()
    if not sql:
        return

    req = urllib.request.Request(
        ENDPOINT,
        data=sql.encode("utf-8"),
        headers={
            "X-ClickHouse-User": USER,
            "X-ClickHouse-Key":  PASSWORD,
            "Content-Type":      "text/plain; charset=utf-8",
        },
        method="POST",
    )
    try:
        kwargs = {"context": _ssl_ctx} if _ssl_ctx else {}
        with urllib.request.urlopen(req, **kwargs) as resp:
            resp.read()
    except urllib.error.HTTPError as exc:
        body = exc.read().decode(errors="replace")
        if "already exists" in body or "ALREADY_EXISTS" in body:
            label = f" ({description})" if description else ""
            print(f"[migrate]   Already exists{label}, skipping")
            return
        if "SETTING_CONSTRAINT_VIOLATION" in body and "allow_experimental_time_series_table" in body:
            # ClickHouse Cloud locks this setting at the service level — the
            # TimeSeries table it guards (metrics_ts) is unused by this demo.
            label = f" ({description})" if description else ""
            print(f"[migrate]   Experimental setting locked on Cloud{label}, skipping")
            return
        label = f" in {description}" if description else ""
        print(f"[migrate] ERROR{label}: HTTP {exc.code}\n{body}", file=sys.stderr)
        sys.exit(1)


def clickhouse_version() -> tuple[int, int]:
    req = urllib.request.Request(
        ENDPOINT,
        data=b"SELECT version()",
        headers={
            "X-ClickHouse-User": USER,
            "X-ClickHouse-Key": PASSWORD,
            "Content-Type": "text/plain; charset=utf-8",
        },
        method="POST",
    )
    kwargs = {"context": _ssl_ctx} if _ssl_ctx else {}
    with urllib.request.urlopen(req, **kwargs) as resp:
        major, minor, *_ = resp.read().decode().strip().split(".")
    return int(major), int(minor)


def extract_statements(sql_content: str) -> list:
    """
    Split a goose-annotated SQL file into individual ClickHouse statements.

    Goose markers (-- +goose ...) are stripped. Statements are delimited by
    a semicolon that is the last non-whitespace character on its line.
    """
    lines = [
        line for line in sql_content.splitlines()
        if not line.strip().startswith("-- +goose")
    ]
    content = "\n".join(lines)

    # Split on semicolons that end a line (optionally followed by whitespace)
    raw = re.split(r";\s*(?=\n|$)", content)
    result = []
    for stmt in raw:
        stmt = stmt.strip()
        if stmt:
            result.append(stmt + ";")
    return result


use_compat_schema = clickhouse_version() < (26, 2)
print(f"[migrate] Schema   : {'compat' if use_compat_schema else 'current'}")

for sql_file in sorted(SEED_DIR.glob("*.sql")):
    fname = sql_file.name

    if fname in {"00002_otel_logs.sql", "00005_otel_traces.sql"} and use_compat_schema:
        continue
    if fname in {"00002_otel_logs_compat.sql", "00005_otel_traces_compat.sql"} and not use_compat_schema:
        continue
    if use_compat_schema and fname in {
        "00006_otel_logs_rollups.sql",
        "00007_otel_traces_rollups.sql",
        "00008_otel_metrics_timeseries.sql",
    }:
        continue
    if CLOUD_MODE and fname == "00008_otel_metrics_timeseries.sql":
        continue

    if fname == "00001_create_database.sql":
        if CLOUD_MODE:
            print(f"[migrate] Skipping {fname} — cloud mode, database must be pre-created")
            continue
        print(f"[migrate] Applying {fname}")
        run_sql(f"CREATE DATABASE IF NOT EXISTS {DB}", fname)
        continue

    print(f"[migrate] Applying {fname}")
    content = sql_file.read_text(encoding="utf-8")
    content = content.replace("${DATABASE}", DB)
    content = re.sub(
        r"\$\{(?:TABLES|LOGS|TRACES|METRICS|SESSIONS)_TTL\}",
        TABLES_TTL,
        content,
    )

    for stmt in extract_statements(content):
        run_sql(stmt, fname)

print(f"[migrate] Schema migration complete → {DB}")
