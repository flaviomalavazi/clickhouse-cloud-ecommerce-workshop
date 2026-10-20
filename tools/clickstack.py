#!/usr/bin/env python3
"""
Create the workshop's ClickStack data sources through the ClickHouse Cloud API (the ClickStack
"sources" endpoints), instead of in the console.

    clickstack.py setup [--force]   create the sources that are missing
    clickstack.py list              the sources ClickStack has now
    clickstack.py payload           print the four source definitions

ClickStack reads four kinds of source from the tables the OpenTelemetry collector fills in the
database `retail_otel`: logs, traces, metrics and sessions. This creates one of each, linked to each
other the way the console's forms do (logs to traces, traces to sessions and metrics, and so on), so
a log line opens its trace and a trace opens its session.

A source that already exists (same kind, same table) is left as it is, so running this twice, or after
you made the sources by hand, changes nothing; `--force` overwrites them with these definitions.

One limit: every source names the ClickHouse *connection* it queries, and the API has no call that
lists connections. It is read from a source that exists; on a service where ClickStack has never been
opened there is none, and the message says what to do.
"""

from __future__ import annotations

import argparse
import json
import sys

from cloud_api import CloudAPI, Context, context_from_env

DATABASE = "retail_otel"
# kind -> the table it reads
TABLES = {
    "trace": "otel_traces",
    "log": "otel_logs",
    "metric": None,                 # a metric source reads five tables, below
    "session": "hyperdx_sessions",
}
METRIC_TABLES = {
    "gauge": "otel_metrics_gauge",
    "histogram": "otel_metrics_histogram",
    "sum": "otel_metrics_sum",
    "summary": "otel_metrics_summary",
    "exponential histogram": "",    # blank, as the console leaves it (the table exists; ClickStack does not read it)
}
ORDER = ("trace", "log", "metric", "session")


def sources_path(ctx: Context) -> str:
    return f"/organizations/{ctx.organization_id}/services/{ctx.service_id}/clickstack/sources"


def build_source(kind: str, connection: str, database: str = DATABASE) -> dict:
    """The definition of one source, for the tables the workshop's collector creates (see sql/clickhouse/ and otel-collector/)."""
    base = {"name": f"ClickShop {kind.capitalize()}s" if kind != "metric" else "ClickShop Metrics", "kind": kind, "connection": connection}
    if kind == "log":
        return {**base, "name": "ClickShop Logs", "from": {"databaseName": database, "tableName": TABLES[kind]},
                "defaultTableSelectExpression": "Timestamp, ServiceName as service, SeverityText as level, Body",
                "timestampValueExpression": "Timestamp", "displayedTimestampValueExpression": "Timestamp",
                "serviceNameExpression": "ServiceName", "severityTextExpression": "SeverityText", "bodyExpression": "Body",
                "eventAttributesExpression": "LogAttributes", "resourceAttributesExpression": "ResourceAttributes",
                "traceIdExpression": "TraceId", "spanIdExpression": "SpanId", "implicitColumnExpression": "Body",
                # otel_logs has a text index on lower(Body): let a log search use it (module 08)
                "useTextIndexForImplicitColumn": "auto"}
    if kind == "trace":
        return {**base, "name": "ClickShop Traces", "from": {"databaseName": database, "tableName": TABLES[kind]},
                "defaultTableSelectExpression": "Timestamp, ServiceName as service, StatusCode as level, round(Duration / 1e6) as duration, SpanName",
                "timestampValueExpression": "Timestamp", "displayedTimestampValueExpression": "Timestamp", "durationExpression": "Duration", "durationPrecision": 9,
                "traceIdExpression": "TraceId", "spanIdExpression": "SpanId", "parentSpanIdExpression": "ParentSpanId",
                "spanNameExpression": "SpanName", "spanKindExpression": "SpanKind", "statusCodeExpression": "StatusCode",
                "statusMessageExpression": "StatusMessage", "serviceNameExpression": "ServiceName",
                "resourceAttributesExpression": "ResourceAttributes", "eventAttributesExpression": "SpanAttributes",
                "spanEventsValueExpression": "Events", "spanLinksValueExpression": "Links",
                "implicitColumnExpression": "SpanName"}
    if kind == "metric":
        # the API rejects a metric source without from.tableName (its docs do not say so); the console sends ""
        return {**base, "from": {"databaseName": database, "tableName": ""}, "metricTables": dict(METRIC_TABLES),
                "timestampValueExpression": "TimeUnix", "resourceAttributesExpression": "ResourceAttributes",
                "serviceNameExpression": "ServiceName"}
    if kind == "session":
        return {**base, "name": "ClickShop Sessions", "from": {"databaseName": database, "tableName": TABLES[kind]},
                "timestampValueExpression": "TimestampTime", "resourceAttributesExpression": "ResourceAttributes"}
    raise ValueError(kind)


def connection_id(existing: list[dict]) -> str:
    """The ClickHouse connection ClickStack uses, as the sources it already has name it."""
    ids = [s["connection"] for s in existing if s.get("connection")]
    if not ids:
        raise SystemExit(
            "ERROR: ClickStack has no source yet, so there is no connection to read. Open ClickStack once from your "
            "service in the console (that creates its connection), then run this again, or create the sources by hand "
            "(module 08, step 1).")
    return ids[0]


def matches(source: dict, kind: str, database: str = DATABASE) -> bool:
    """Is this existing source the workshop's source of that kind?"""
    if source.get("kind") != kind:
        return False
    src = source.get("from") or {}
    if src.get("databaseName") != database:
        return False
    return kind == "metric" or src.get("tableName") == TABLES[kind]


def links(ids: dict[str, str]) -> dict[str, dict]:
    """The cross-references between the four sources, once all of them have an id."""
    return {
        "trace": {"logSourceId": ids["log"], "sessionSourceId": ids["session"], "metricSourceId": ids["metric"]},
        "log": {"traceSourceId": ids["trace"], "metricSourceId": ids["metric"]},
        "metric": {"logSourceId": ids["log"]},
        "session": {"traceSourceId": ids["trace"]},
    }


def ensure_sources(api: CloudAPI, ctx: Context, database: str = DATABASE, force: bool = False, out=print) -> dict[str, str]:
    """Create the missing sources (or, with `force`, rewrite all four) and link them. Returns kind -> source id."""
    path = sources_path(ctx)
    existing = api.result("GET", path) or []
    connection = connection_id(existing)
    ids: dict[str, str] = {}
    created: set[str] = set()

    # 1. every source, in an order that gives each one the id it must point at
    for kind in ORDER:
        have = next((s for s in existing if matches(s, kind, database)), None)
        body = build_source(kind, connection, database)
        if kind == "session":
            body["traceSourceId"] = ids["trace"]              # required when a session source is created
        if kind == "log":
            body["traceSourceId"] = ids["trace"]
        if have and not force:
            ids[kind] = have["id"]
            out(f"  {kind:8s} exists   {have.get('name')}")
            continue
        if have:
            api.result("PUT", f"{path}/{have['id']}", body)
            ids[kind] = have["id"]
            out(f"  {kind:8s} rewritten {have.get('name')}")
        else:
            made = api.result("POST", path, body)
            ids[kind] = made["id"]
            created.add(kind)
            out(f"  {kind:8s} created  {body['name']}")

    # 2. the links that needed ids that did not exist yet: only on what we just made (or forced)
    current = {s["id"]: s for s in api.result("GET", path) or []}
    for kind, extra in links(ids).items():
        if kind not in created and not force:
            continue
        source = current.get(ids[kind]) or build_source(kind, connection, database)
        wanted = {**source, **extra}
        if wanted != source:
            api.result("PUT", f"{path}/{ids[kind]}", {k: v for k, v in wanted.items() if k != "id"})
    return ids


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("command", choices=["setup", "list", "payload"])
    ap.add_argument("--force", action="store_true", help="setup: overwrite sources that already exist")
    ns = ap.parse_args()
    if ns.command == "payload":
        print(json.dumps({k: build_source(k, "<connection-id>") for k in ORDER}, indent=2))
        return 0
    api, ctx = context_from_env()
    print(f"service {ctx.service_name} ({ctx.service_id})")
    if ns.command == "list":
        for s in api.result("GET", sources_path(ctx)) or []:
            print(f"  {s.get('kind'):8s} {s.get('name')}  <- {(s.get('from') or {}).get('databaseName')}.{(s.get('from') or {}).get('tableName') or '*'}")
        return 0
    ensure_sources(api, ctx, force=ns.force)
    print("ClickStack sources are set up")
    return 0


if __name__ == "__main__":
    sys.exit(main())
