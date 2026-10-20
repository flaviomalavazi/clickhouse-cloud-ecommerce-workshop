#!/usr/bin/env python3
"""
Create the workshop's Postgres CDC ClickPipe through the ClickHouse Cloud API.

    clickpipes.py create [--no-wait]   create the pipe (or leave the existing one alone) and wait for it
    clickpipes.py status               the pipe's state
    clickpipes.py wait-sync            wait until retail_oltp holds what Postgres holds
    clickpipes.py payload              print the request that `create` sends, secrets masked
    clickpipes.py delete               delete the pipe

It is what you do by hand in module 03, as a request: the same six tables, replicated with "Initial
load + CDC" into retail_oltp, a 60 second sync interval, no schema prefix on the table names, NULLs
turned into defaults and deleted rows kept. The API key comes from `.env` (see cloud_api.py), the
Postgres connection from the same PG* variables and certificate as everything else.

`make clickpipes` runs `create`, and notebooks/01_create_clickpipes.ipynb walks through the same calls.
"""

from __future__ import annotations

import argparse
import copy
import os
import sys
import time
from collections.abc import Callable
from pathlib import Path

from cloud_api import CloudAPI, Context, context_from_env

PIPE_NAME = "clickshop-cdc"
TABLES = ("categories", "products", "stock", "customers", "orders", "order_items")
DESTINATION_DATABASE = "retail_oltp"
SYNC_INTERVAL_SECONDS = 60

# The states of a database pipe, in the order it goes through them, and the ones it does not come back from.
PROGRESS = ("Provisioning", "Setup", "Snapshot", "Running")
FATAL = ("Failed", "InternalError", "Stopped", "Paused")


def pipes_path(ctx: Context) -> str:
    return f"/organizations/{ctx.organization_id}/services/{ctx.service_id}/clickpipes"


def read_ca_certificate(path: str) -> str:
    """The PEM of the Postgres instance's CA: the pipe checks the server's certificate against it."""
    if not path:
        raise SystemExit("ERROR: PGSSLROOTCERT is not set. The ClickPipe verifies your Postgres certificate: download it "
                         "(module 01) and set PGSSLROOTCERT=assets/certs/ca-certificate.pem in .env")
    pem = Path(path)
    if not pem.is_file():
        raise SystemExit(f"ERROR: PGSSLROOTCERT={path} was not found (the path is relative to the repo root)")
    return pem.read_text()


def build_pipe_payload(
    *,
    name: str,
    host: str,
    port: int,
    database: str,
    username: str,
    password: str,
    ca_certificate: str,
    tables: tuple[str, ...] = TABLES,
    destination_database: str = DESTINATION_DATABASE,
    sync_interval_seconds: int = SYNC_INTERVAL_SECONDS,
) -> dict:
    """
    The body of POST /organizations/{org}/services/{service}/clickpipes for a Postgres CDC pipe.

    The settings match module 03's console choices: replicationMode cdc is "Initial load + CDC";
    allowNullableColumns false is "Preserve NULL values from source" off; deleteOnMerge false is
    "Remove deleted rows during merges" off; and each table keeps its own name (no schema prefix),
    as a ReplacingMergeTree keyed by the Postgres primary key.
    """
    return {
        "name": name,
        "source": {
            "postgres": {
                "type": "postgres",
                "host": host,
                "port": port,
                "database": database,
                "authentication": "basic",
                "credentials": {"username": username, "password": password},
                "tlsHost": host,
                "caCertificate": ca_certificate,
                "disableTls": False,
                "skipCertVerification": False,
                "settings": {
                    "replicationMode": "cdc",
                    "syncIntervalSeconds": sync_interval_seconds,
                    "allowNullableColumns": False,
                    "deleteOnMerge": False,
                },
                "tableMappings": [
                    {"sourceSchemaName": "public", "sourceTable": t, "targetTable": t, "tableEngine": "ReplacingMergeTree"}
                    for t in tables
                ],
            }
        },
        "destination": {"database": destination_database},
    }


def payload_from_env(env=os.environ, name: str = PIPE_NAME, destination_database: str = DESTINATION_DATABASE) -> dict:
    missing = [k for k in ("PGHOST", "PGUSER", "PGPASSWORD", "PGDATABASE") if not env.get(k, "").strip()]
    if missing:
        raise SystemExit("ERROR: " + ", ".join(missing) + " is not set in .env")
    return build_pipe_payload(
        name=name,
        host=env["PGHOST"].strip(),
        port=int(env.get("PGPORT", "").strip() or 5432),
        database=env["PGDATABASE"].strip(),
        username=env["PGUSER"].strip(),
        password=env["PGPASSWORD"],
        ca_certificate=read_ca_certificate(env.get("PGSSLROOTCERT", "").strip()),
        destination_database=destination_database,
    )


def mask_host(host: str) -> str:
    """The first three characters and the domain, as `make doctor` shows a host."""
    rest = host.split(".", 1)[1] if "." in host else ""
    return f"{host[:3]}…" + (f".{rest}" if rest else "")


def redacted(payload: dict) -> dict:
    """A copy that is safe to print: the password and the certificate are masked, and the host is shortened."""
    safe = copy.deepcopy(payload)
    pg = safe.get("source", {}).get("postgres", {})
    if "credentials" in pg:
        pg["credentials"]["password"] = "********"
    if pg.get("caCertificate"):
        pg["caCertificate"] = pg["caCertificate"].splitlines()[0] + " ... (certificate)"
    for key in ("host", "tlsHost"):
        if pg.get(key):
            pg[key] = mask_host(pg[key])
    return safe


def list_pipes(api: CloudAPI, ctx: Context) -> list[dict]:
    return api.result("GET", pipes_path(ctx)) or []


def find_pipe(pipes: list[dict], name: str) -> dict | None:
    return next((p for p in pipes if p.get("name") == name), None)


def find_equivalent(pipes: list[dict], payload: dict) -> dict | None:
    """A pipe, whatever its name, that already copies this Postgres database into this ClickHouse database.

    The console names a pipe `clickpipe-<service>`, so a pipe made by hand in module 03 does not carry our name; a
    second pipe into the same tables would write every row twice, so it counts as the one we wanted.
    """
    want = payload["source"]["postgres"]
    for p in pipes:
        have = (p.get("source") or {}).get("postgres") or {}
        if (have.get("host") == want["host"] and have.get("database") == want["database"]
                and (p.get("destination") or {}).get("database") == payload["destination"]["database"]):
            return p
    return None


def get_pipe(api: CloudAPI, ctx: Context, pipe_id: str) -> dict:
    return api.result("GET", f"{pipes_path(ctx)}/{pipe_id}")


def wait_until_running(
    api: CloudAPI, ctx: Context, pipe_id: str, timeout: float = 900, poll: float = 5,
    sleep: Callable[[float], None] = time.sleep, out: Callable[[str], None] = print,
) -> str:
    """Poll until the pipe is Running. Raises if it fails, stops, or takes longer than `timeout`."""
    waited, last = 0.0, None
    while True:
        state = get_pipe(api, ctx, pipe_id).get("state", "Unknown")
        if state != last:
            out(f"  pipe state: {state}")
            last = state
        if state == "Running":
            return state
        if state in FATAL:
            raise SystemExit(f"ERROR: the ClickPipe is {state}. Open it in the console (Postgres instance, Sync to ClickHouse) and read its error.")
        if waited >= timeout:
            raise SystemExit(f"ERROR: the ClickPipe is still {state} after {int(timeout)} s. Look at it in the console.")
        sleep(poll)
        waited += poll


def create_pipe(api: CloudAPI, ctx: Context, payload: dict) -> tuple[dict, bool]:
    """Create the pipe unless it exists (by name, or the same source and destination under another name).

    Returns (the pipe, whether it was just created).
    """
    pipes = list_pipes(api, ctx)
    existing = find_pipe(pipes, payload["name"]) or find_equivalent(pipes, payload)
    if existing:
        return existing, False
    return api.result("POST", pipes_path(ctx), payload), True


def wait_for_mirror(timeout: float = 900, poll: float = 5, out: Callable[[str], None] = print) -> bool:
    """Wait until every retail_oltp table holds as many live rows as its Postgres table."""
    from connections import ch_client
    from nuke_data import clickhouse_counts, in_step, postgres_counts

    client, deadline, last = ch_client(), time.time() + timeout, 0.0
    while True:
        pg = postgres_counts(list(TABLES))
        try:
            ch = clickhouse_counts(client, list(TABLES))
        except Exception:       # a table the pipe has not created yet
            ch = {}
        if ch and in_step(pg, ch):
            return True
        if time.time() > deadline:
            out(f"  not in step after {int(timeout)} s: Postgres {pg}, ClickHouse {ch}")
            return False
        if time.time() - last > 15:
            last = time.time()
            out("  waiting: " + ", ".join(f"{t} {ch.get(t, 0):,}/{pg[t]:,}" for t in TABLES))
        time.sleep(poll)


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["create", "status", "wait-sync", "payload", "delete"])
    ap.add_argument("--name", default=None, help=f"the pipe's name (default {PIPE_NAME}; status and delete also find a pipe made by hand with the same source and destination)")
    ap.add_argument("--destination", default=DESTINATION_DATABASE, help="create, payload: the ClickHouse database to write to (default retail_oltp)")
    ap.add_argument("--no-wait", action="store_true", help="create: do not wait for the pipe to be Running")
    ns = ap.parse_args()
    name = ns.name or PIPE_NAME

    if ns.command == "payload":
        import json
        print(json.dumps(redacted(payload_from_env(name=name, destination_database=ns.destination)), indent=2))
        return 0
    if ns.command == "wait-sync":
        return 0 if wait_for_mirror() else 1

    api, ctx = context_from_env()
    print(f"service {ctx.service_name} ({ctx.service_id})")
    if ns.command == "create":
        pipe, created = create_pipe(api, ctx, payload_from_env(name=name, destination_database=ns.destination))
        print(("created" if created else "already there:"), f"ClickPipe {pipe['name']} ({pipe['id']}), state {pipe.get('state')}")
        if not ns.no_wait:
            wait_until_running(api, ctx, pipe["id"])
        return 0
    pipes = list_pipes(api, ctx)
    pipe = find_pipe(pipes, name)
    if not pipe and ns.name is None:        # no name asked for: the pipe that copies this database, by whoever made it
        pipe = find_equivalent(pipes, payload_from_env(name=name, destination_database=ns.destination))
    if ns.command == "status":
        if not pipe:
            print(f"no ClickPipe named {name}")
            return 1
        print(f"ClickPipe {pipe['name']} ({pipe['id']}): {pipe.get('state')}")
        return 0
    if not pipe:                       # delete
        print(f"no ClickPipe named {name}: nothing to delete")
        return 0
    api.request("DELETE", f"{pipes_path(ctx)}/{pipe['id']}")
    print(f"deleted ClickPipe {pipe['name']} ({pipe['id']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
