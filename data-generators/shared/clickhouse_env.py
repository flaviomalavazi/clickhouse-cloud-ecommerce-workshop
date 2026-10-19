"""ClickHouse connection settings for the generators, read from the environment.

Every component in the workshop reads the same variables, which arrive from the
root `.env` (through the cluster's Secret):

  CLICKHOUSE_HOST      service host, no scheme and no port
  CLICKHOUSE_PORT      HTTP(S) port                                (8443)
  CLICKHOUSE_USER      user                                        (default)
  CLICKHOUSE_PASSWORD  password
  CLICKHOUSE_DATABASE  database the tables live in                 (retail_analytics)
  CLICKHOUSE_SECURE    TLS; on unless the host is local            (auto)

Nothing here looks for an env file: if the variables are not in the environment,
the generator has nothing to connect to and says so.
"""

from __future__ import annotations

import os

_LOCAL_HOSTS = ("localhost", "127.0.0.1", "host.docker.internal")


def _secure(host: str) -> bool:
    raw = os.environ.get("CLICKHOUSE_SECURE", "").strip().lower()
    if raw:
        return raw not in ("0", "false", "no")
    return host not in _LOCAL_HOSTS


CLICKHOUSE_HOST     = os.environ.get("CLICKHOUSE_HOST", "").strip()
CLICKHOUSE_PORT     = int(os.environ.get("CLICKHOUSE_PORT", "").strip() or 8443)
CLICKHOUSE_USER     = os.environ.get("CLICKHOUSE_USER", "default")
CLICKHOUSE_PASSWORD = os.environ.get("CLICKHOUSE_PASSWORD", "")
CLICKHOUSE_DATABASE = os.environ.get("CLICKHOUSE_DATABASE", "retail_analytics")
CLICKHOUSE_SECURE   = _secure(CLICKHOUSE_HOST)


def require_host() -> None:
    """Exit with a clear message when there is no ClickHouse to talk to."""
    if not CLICKHOUSE_HOST:
        raise SystemExit(
            "[ERROR] CLICKHOUSE_HOST is not set. The generators write to ClickHouse "
            "Cloud; copy .env.example to .env and fill it in."
        )


def connect(**overrides):
    """A clickhouse-connect client for the workshop service.

    Sessions are switched off: the client is shared between threads, and two
    queries in one session make the server answer "Session is locked".
    """
    import clickhouse_connect

    require_host()
    kwargs = dict(
        host=CLICKHOUSE_HOST,
        port=CLICKHOUSE_PORT,
        username=CLICKHOUSE_USER,
        password=CLICKHOUSE_PASSWORD,
        database=CLICKHOUSE_DATABASE,
        secure=CLICKHOUSE_SECURE,
        connect_timeout=30,
        send_receive_timeout=120,
        autogenerate_session_id=False,
    )
    kwargs.update(overrides)
    return clickhouse_connect.get_client(**kwargs)


def describe() -> str:
    scheme = "https" if CLICKHOUSE_SECURE else "http"
    return f"{scheme}://{CLICKHOUSE_HOST}:{CLICKHOUSE_PORT}/{CLICKHOUSE_DATABASE}"
