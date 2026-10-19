"""
Which sslmode to use for a PostgreSQL connection.

ClickHouse Cloud's managed PostgreSQL refuses any connection that is not TLS:

    FATAL: SSL required

None of the psycopg2 callers passed sslmode, so they got libpq's default,
`prefer`. `prefer` asks for TLS and **silently falls back to plaintext** if the
server does not take it up, which makes encryption a property of the server's
reply rather than of our configuration — and against Cloud that fallback is
what produced the FATAL above. Setting it explicitly removes the ambiguity:
a remote host either gets TLS or fails loudly.

(`prefer` does negotiate TLS correctly against a well-behaved TLS-only server,
so this is about not depending on the fallback, not about `prefer` being
broken.)

The rule matches what the frontend pool already does in
frontend/src/lib/postgres.ts — TLS for anything that is not the local compose
database — so the two halves of the app agree without extra configuration:

  local  (localhost / 127.0.0.1 / the `postgres` compose service)  -> prefer
  remote (anything else, i.e. Cloud or another managed instance)   -> require

`prefer` rather than `disable` locally, so a local server that does happen to
speak TLS still gets it.

Set PGSSLMODE to override — `verify-full` with PGSSLROOTCERT to pin the CA, or
`disable` for a remote host that genuinely has no TLS.
"""
import os

from psycopg2 import sql

# Hostnames that mean "the database in this docker compose project".
LOCAL_PG_HOSTS = frozenset({"localhost", "127.0.0.1", "::1", "postgres"})


def pg_sslmode(host: str) -> str:
    override = os.environ.get("PGSSLMODE", "").strip()
    if override:
        return override
    return "prefer" if host in LOCAL_PG_HOSTS else "require"


def apply_search_path(conn, schema: str) -> None:
    """
    Put `schema` on the connection's search_path.

    This cannot be done with the `options=-c search_path=...` startup parameter
    the seed used to pass. ClickHouse Cloud fronts PostgreSQL with pgbouncer on
    port 6432, and pgbouncer rejects the connection outright rather than
    ignoring the parameter it does not understand:

        FATAL: unsupported startup parameter in options: search_path

    Issuing it as a statement after connecting works against both pgbouncer and
    a direct server, and is what frontend/src/lib/postgres.ts already does for
    the node pool (there as an onConnect hook, for the same reason).
    """
    with conn.cursor() as cur:
        cur.execute(sql.SQL("SET search_path TO {}").format(sql.Identifier(schema)))
    conn.commit()
