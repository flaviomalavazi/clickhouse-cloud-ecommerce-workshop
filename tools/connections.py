"""
Connections to the workshop's two databases, configured only from the
environment (the root `.env`, see .env.example).

  Postgres    PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE   (+ PGSSLMODE)
  ClickHouse  CLICKHOUSE_HOST, CLICKHOUSE_PORT, CLICKHOUSE_USER,
              CLICKHOUSE_PASSWORD                              (+ CLICKHOUSE_SECURE)

Both default to TLS. The two overrides exist for the implementer's local test
containers; participants never set them.
"""

from __future__ import annotations

import os
import sys

import clickhouse_connect
import psycopg
from psycopg import sql

# Hosts that mean "a database on this machine": no TLS needed.
LOCAL_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "host.docker.internal"})

# ClickHouse Managed Postgres puts pgbouncer on 6432. Logical replication (the
# CDC ClickPipe) needs the direct endpoint, so warn rather than let a pooler
# address slip through module 01 unnoticed.
POOLER_PORT = "6432"


def _required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.exit(f"ERROR: {name} is not set. Copy .env.example to .env and fill it in.")
    return value


def pg_kwargs(dbname: str | None = None) -> dict:
    """libpq keyword arguments for the workshop Postgres instance."""
    host = _required("PGHOST")
    port = os.environ.get("PGPORT", "5432").strip() or "5432"
    if port == POOLER_PORT:
        print(
            f"WARNING: PGPORT={port} looks like the connection pooler. Use the "
            "direct endpoint (5432): the CDC ClickPipe needs a direct connection.",
            file=sys.stderr,
        )
    # An explicit sslmode removes libpq's `prefer`, which silently falls back to
    # plaintext. A remote host either gets TLS or fails loudly.
    sslmode = os.environ.get("PGSSLMODE", "").strip() or (
        "prefer" if host in LOCAL_HOSTS else "require"
    )
    return {
        "host": host,
        "port": int(port),
        "user": _required("PGUSER"),
        "password": os.environ.get("PGPASSWORD", ""),
        "dbname": dbname or os.environ.get("PGDATABASE", "").strip() or "clickshop",
        "sslmode": sslmode,
    }


def ensure_pg_database() -> None:
    """Create the workshop database if it is missing (connecting via `postgres`)."""
    target = pg_kwargs()["dbname"]
    with psycopg.connect(**pg_kwargs("postgres"), autocommit=True) as conn:
        exists = conn.execute(
            "SELECT 1 FROM pg_database WHERE datname = %s", (target,)
        ).fetchone()
        if not exists:
            conn.execute(sql.SQL("CREATE DATABASE {}").format(sql.Identifier(target)))
            print(f"Created database {target}")


def pg_connect() -> psycopg.Connection:
    """Connect to the workshop database, creating it first if needed."""
    ensure_pg_database()
    return psycopg.connect(**pg_kwargs())


def ch_client(database: str | None = None):
    """A clickhouse-connect client for the workshop ClickHouse service."""
    host = _required("CLICKHOUSE_HOST")
    port = int(os.environ.get("CLICKHOUSE_PORT", "8443").strip() or "8443")
    secure_env = os.environ.get("CLICKHOUSE_SECURE", "").strip().lower()
    secure = (secure_env not in ("0", "false", "no")) if secure_env else host not in LOCAL_HOSTS
    return clickhouse_connect.get_client(
        host=host,
        port=port,
        username=os.environ.get("CLICKHOUSE_USER", "default"),
        password=os.environ.get("CLICKHOUSE_PASSWORD", ""),
        database=database or "default",
        secure=secure,
        # Backfills in 30_realtime_mvs.sql scan a lot of data on a cold service.
        send_receive_timeout=600,
    )
