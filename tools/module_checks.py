#!/usr/bin/env python3
"""
The database side of `make check-NN`: what must be true at the end of a workshop module.

    module_checks.py 01      (run through `make check-01`, which runs it in the tools container)

Each check prints one line per assertion (the same ✓ / ✗ as scripts/checks/lib.sh) and the
script exits 1 if any failed. A failing line says what to do. Credentials are never printed.
Module 05 (the app) and the parts of 06 to 08 that need the cluster are in scripts/checks/.
"""

from __future__ import annotations

import sys
from collections.abc import Callable

from connections import ch_client, pg_connect
from doctor_checks import clickhouse_ok

# What the seed makes (tools/seed_postgres.py). `active` follows the catalogue (D43).
SEED_PRODUCTS = 978
SEED_ACTIVE = 691
SEED_CUSTOMERS = 500
SEED_ORDERS = 2000
CDC_TABLES = ("categories", "products", "stock", "customers", "orders", "order_items")
SERVICES = (
    "retail-demo-frontend", "demo-storefront-bff", "demo-catalog-svc", "demo-checkout-svc", "demo-pricing-svc",
    "demo-inventory-svc", "demo-payment-card-svc", "demo-card-gateway", "demo-payment-pix-svc",
    "demo-pix-psp-gateway", "demo-payment-boleto-svc", "demo-boleto-gateway", "demo-order-svc",
    "demo-ledger-svc", "demo-email-gateway",
)

Result = list[tuple[bool, str]]


def compare_counts(postgres: dict[str, int], clickhouse: dict[str, int]) -> list[str]:
    """The tables whose ClickHouse count is not Postgres'. A missing table counts as different."""
    return [f"{t} (Postgres {n:,}, ClickHouse {clickhouse.get(t, 'missing')})" for t, n in postgres.items() if clickhouse.get(t) != n]


def missing_services(seen: set[str], wanted: tuple[str, ...] = SERVICES) -> list[str]:
    return [s for s in wanted if s not in seen]


def still_on_their_way(differences: dict[str, int], recent: dict[str, int]) -> dict[str, int]:
    """What is NOT explained by recent writes. `differences` is Postgres minus ClickHouse per table; a row written to Postgres in the
    last couple of minutes may not have crossed the pipe yet (the sync interval is 60 s), so up to `recent` missing rows are fine."""
    return {t: d for t, d in differences.items() if d != 0 and not (0 < d <= recent.get(t, 0))}


# Rows written to Postgres in the last two minutes, per table: what the pipe may still be carrying.
RECENT_SQL = {
    "orders": "SELECT count(*) FROM orders WHERE created_at > now() - interval '2 minutes'",
    "order_items": "SELECT count(*) FROM order_items WHERE order_id IN (SELECT id FROM orders WHERE created_at > now() - interval '2 minutes')",
    "customers": "SELECT count(*) FROM customers WHERE created_at > now() - interval '2 minutes'",
}


def _recent_writes() -> dict[str, int]:
    with pg_connect() as conn:
        return {t: conn.execute(sql).fetchone()[0] for t, sql in RECENT_SQL.items()}


class Checker:
    """Collects ✓/✗ lines; `ok(cond, good, bad)` records one."""

    def __init__(self) -> None:
        self.failures = 0

    def ok(self, condition: bool, good: str, bad: str) -> bool:
        print(f"  {'✓' if condition else '✗'} {good if condition else bad}")
        if not condition:
            self.failures += 1
        return condition


def _pg_counts(tables: tuple[str, ...]) -> dict[str, int]:
    with pg_connect() as conn:
        return {t: conn.execute(f"SELECT count(*) FROM {t}").fetchone()[0] for t in tables}


def _ch_counts(client, tables: tuple[str, ...]) -> dict[str, int]:
    out = {}
    for t in tables:
        try:
            out[t] = client.query(f"SELECT count() FROM retail_oltp.{t} FINAL WHERE _peerdb_is_deleted = 0").result_rows[0][0]
        except Exception:
            pass
    return out


def check_01(c: Checker) -> None:
    ch = ch_client()
    version = ch.query("SELECT version()").result_rows[0][0]
    c.ok(clickhouse_ok(version), f"ClickHouse {version} answers (the text index needs 26.2+)", f"ClickHouse {version} is older than 26.2")
    with pg_connect() as pg:
        ssl = pg.execute("SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()").fetchone()
        wal = pg.execute("SHOW wal_level").fetchone()[0]
    c.ok(bool(ssl and ssl[0]), "Postgres answers over TLS", "the Postgres connection is not encrypted")
    c.ok(wal == "logical", "Postgres wal_level is logical (CDC needs it)", f"wal_level is {wal!r}, the ClickPipe needs 'logical'")
    dbs = {r[0] for r in ch.query("SELECT name FROM system.databases").result_rows}
    for db in ("retail_analytics", "retail_oltp", "retail_otel"):
        c.ok(db in dbs, f"database {db} exists", f"database {db} is missing: run make ch-bootstrap")
    tables = {r[0] for r in ch.query("SELECT name FROM system.tables WHERE database = 'retail_analytics'").result_rows}
    for t in ("snowplow_events", "credit_card_transactions"):
        c.ok(t in tables, f"retail_analytics.{t} exists", f"retail_analytics.{t} is missing: run make ch-bootstrap")


def check_02(c: Checker) -> None:
    n = _pg_counts(("categories", "products", "stock", "customers", "orders", "order_items"))
    with pg_connect() as pg:
        active = pg.execute("SELECT count(*) FROM products WHERE is_active").fetchone()[0]
    c.ok(n["categories"] == 5, "5 categories", f"{n['categories']} categories, expected 5")
    c.ok(n["products"] == SEED_PRODUCTS, f"{n['products']:,} products ({active} active)", f"{n['products']:,} products, expected {SEED_PRODUCTS}: run make pg-setup")
    c.ok(active == SEED_ACTIVE, f"{active} products are active (the catalogue's active ones)", f"{active} active products, expected {SEED_ACTIVE}")
    c.ok(n["stock"] == n["products"], f"a stock row for every product ({n['stock']:,})", f"{n['stock']:,} stock rows for {n['products']:,} products")
    c.ok(n["customers"] >= SEED_CUSTOMERS, f"{n['customers']:,} customers", f"{n['customers']} customers, expected at least {SEED_CUSTOMERS}")
    c.ok(n["orders"] >= SEED_ORDERS and n["order_items"] > 0, f"{n['orders']:,} orders with {n['order_items']:,} items", f"{n['orders']} orders, expected at least {SEED_ORDERS}")


def check_03(c: Checker) -> None:
    ch = ch_client()
    cols = {}
    for db, name, col in ch.query("SELECT database, table, name FROM system.columns WHERE database = 'retail_oltp'").result_rows:
        cols.setdefault(name, set()).add(col)
    present = [t for t in CDC_TABLES if t in cols]
    c.ok(len(present) == len(CDC_TABLES), "all 6 tables are in retail_oltp", f"retail_oltp has {present or 'no'} tables of {list(CDC_TABLES)}: is the ClickPipe running and are the 6 tables selected?")
    c.ok(bool(present) and all({"_peerdb_is_deleted", "_peerdb_version"} <= cols[t] for t in present),
         "every table has _peerdb_version and _peerdb_is_deleted", "a table lacks the _peerdb_ columns: it was not created by the ClickPipe")
    pg_n, ch_n = _pg_counts(CDC_TABLES), _ch_counts(ch, CDC_TABLES)
    diff = compare_counts(pg_n, ch_n)
    if diff and all(t in ch_n for t in pg_n):        # every table is there: is the difference only what the pipe is still carrying?
        outstanding = still_on_their_way({t: pg_n[t] - ch_n[t] for t in pg_n}, _recent_writes())
        if not outstanding:
            carrying = {t: pg_n[t] - ch_n[t] for t in pg_n if pg_n[t] != ch_n[t]}
            c.ok(True, "row counts match Postgres (read with FINAL, deleted rows left out); "
                       + ", ".join(f"{n} new {t} from the last two minutes are still on their way" for t, n in carrying.items()), "")
            return
    c.ok(not diff, "row counts match Postgres (read with FINAL, deleted rows left out)",
         "not in step with Postgres yet, wait for the next sync (up to a minute) and run it again: " + "; ".join(diff))


def check_04(c: Checker) -> None:
    ch = ch_client()
    q = lambda sql: ch.query(sql).result_rows
    total, active = q("SELECT count(), countIf(is_active = 1) FROM retail_analytics.products_search")[0]
    c.ok(total == SEED_PRODUCTS and active == SEED_ACTIVE, f"products_search has {total:,} products, {active} active",
         f"products_search has {total} rows ({active} active): run make ch-search, then SYSTEM REFRESH VIEW retail_analytics.products_search_refresh and SYSTEM WAIT VIEW retail_analytics.products_search_refresh")
    ddl = q("SHOW CREATE TABLE retail_analytics.products_search")[0][0]
    c.ok("TYPE text" in ddl or "text(" in ddl, "products_search has text indexes", "products_search has no text index")
    explain = "\n".join(r[0] for r in q("EXPLAIN indexes = 1 SELECT product_id FROM retail_analytics.products_search WHERE is_active = 1 AND hasAllTokens(search_en, 'running shoes')"))
    c.ok("idx_search_en" in explain, "a hasAllTokens search uses the text index (EXPLAIN indexes = 1)", "EXPLAIN does not show idx_search_en")
    hits = q("SELECT count() FROM retail_analytics.products_search WHERE is_active = 1 AND hasAllTokens(search_en, 'running shoes')")[0][0]
    c.ok(hits > 0, f"'running shoes' finds {hits} products", "'running shoes' finds nothing")
    r = q("SELECT status, dateDiff('second', last_success_time, now()), exception FROM system.view_refreshes WHERE view = 'products_search_refresh'")
    c.ok(bool(r) and not r[0][2] and r[0][1] < 400, f"the view refreshes every 5 minutes (last success {r[0][1] if r else '?'} s ago)",
         "products_search_refresh has not refreshed lately: " + (r[0][2] if r and r[0][2] else "check system.view_refreshes"))


def check_06(c: Checker) -> None:
    ch = ch_client()
    q = lambda sql: ch.query(sql).result_rows
    events, days = q("SELECT count(), uniqExact(toDate(collector_tstamp)) FROM retail_analytics.snowplow_events")[0]
    c.ok(events >= 1_000_000 and days >= 7, f"snowplow_events holds {events:,} events over {days} days", f"only {events:,} events over {days} days: run make backfill")
    cut = "toStartOfMinute(now() - INTERVAL 3 MINUTE)"
    raw = q(f"SELECT count() FROM retail_analytics.snowplow_events WHERE toStartOfMinute(collector_tstamp) < {cut}")[0][0]
    roll = q(f"SELECT countMerge(events) FROM retail_analytics.analytics_events_1m WHERE minute < {cut}")[0][0]
    c.ok(raw == roll, f"the one-minute rollup equals the raw events ({roll:,})", f"rollup {roll:,} against raw {raw:,}: run make ch-mvs before the backfill, or again after it")
    cards = q("SELECT count() FROM retail_analytics.credit_card_transactions")[0][0]
    c.ok(cards > 0, f"{cards:,} card transactions", "no card transactions: run make backfill")
    age = q("SELECT dateDiff('second', maxIf(collector_tstamp, collector_tstamp <= now()), now()) FROM retail_analytics.snowplow_events")[0][0]
    c.ok(age < 300, f"events are arriving (newest {age} s ago)", f"the newest event is {age // 60} min old: run make generators-start")


def check_07(c: Checker) -> None:
    with pg_connect() as pg:
        rows = pg.execute("SELECT payment_method, count(*) FILTER (WHERE status = 'confirmed') FROM orders WHERE id > %s GROUP BY 1", (SEED_ORDERS,)).fetchall()
    by_method = {m: n for m, n in rows}
    missing = [m for m in ("credit_card", "pix", "boleto") if not by_method.get(m)]
    c.ok(not missing, "confirmed orders with all three payment methods: " + ", ".join(f"{m} {n}" for m, n in sorted(by_method.items())),
         f"no confirmed {', '.join(missing)} order yet: run make sim-start and give it ten minutes")
    ch = ch_client()
    joined = ch.query("""SELECT count() FROM retail_oltp.orders AS o FINAL
                         INNER JOIN retail_analytics.snowplow_events AS e ON toString(o.id) = e.se_property AND e.event_name = 'checkout_payment_confirmed'
                         WHERE o._peerdb_is_deleted = 0 AND o.id > %(seed)s""", parameters={"seed": SEED_ORDERS}).result_rows[0][0]
    c.ok(joined >= 3, f"{joined} orders join to their checkout events (orders x clickstream)", f"only {joined} orders join to a checkout event: the ClickPipe may still be catching up")


def check_08(c: Checker) -> None:
    ch = ch_client()
    q = lambda sql: ch.query(sql).result_rows
    W = "INTERVAL 24 HOUR"
    seen = {r[0] for r in q(f"SELECT DISTINCT ServiceName FROM retail_otel.otel_traces WHERE Timestamp > now() - {W}")}
    absent = missing_services(seen)
    c.ok(not absent, f"traces from all {len(SERVICES)} services (the checkout path)", "no traces yet from " + ", ".join(absent) + ": run make sim-start for a few minutes")
    names = {r[0] for r in q(f"SELECT DISTINCT SpanName FROM retail_otel.otel_traces WHERE ServiceName = 'retail-demo-frontend' AND Timestamp > now() - {W}")}
    c.ok(any(n.startswith("pg.query") for n in names) and "clickhouse.query" in names and "search.products" in names,
         "frontend traces have pg.query, clickhouse.query and search.products spans", "the frontend lacks pg.query, clickhouse.query or search.products spans")
    sessions = q("SELECT count(), uniqExact(ResourceAttributes['rum.sessionId']) FROM retail_otel.hyperdx_sessions")[0]
    c.ok(sessions[0] > 0, f"{sessions[1]} session replays recorded", "no session replays: run make sim-start, replays come from the simulator's browsers")
    nodes = q(f"SELECT uniqExact(ResourceAttributes['k8s.node.name']) FROM retail_otel.otel_metrics_gauge WHERE MetricName = 'k8s.node.cpu.utilization' AND TimeUnix > now() - {W}")[0][0]
    c.ok(nodes == 3, "Kubernetes metrics from 3 nodes", f"Kubernetes metrics from {nodes} nodes, expected 3: check the collectors in namespace observability")
    logs = q(f"SELECT countIf(ServiceName LIKE 'demo-%'), count() FROM retail_otel.otel_logs WHERE Timestamp > now() - {W}")[0]
    c.ok(logs[0] > 0, f"{logs[1]:,} log lines, {logs[0]:,} from the demo services", "no log lines from the demo services yet")
    hits = q(f"SELECT count() FROM retail_otel.otel_logs WHERE Timestamp > now() - {W} AND hasAllTokens(Body, 'card gateway unavailable')")[0][0]
    print(f"  · {hits} log lines mention card_gateway_unavailable " + ("" if hits else "(none yet: that is the module's exercise, make break-card-gateway)"))


CHECKS: dict[str, Callable[[Checker], None]] = {
    "01": check_01, "02": check_02, "03": check_03, "04": check_04, "06": check_06, "07": check_07, "08": check_08,
}


def main() -> int:
    if len(sys.argv) != 2 or sys.argv[1] not in CHECKS:
        sys.exit(f"usage: module_checks.py {'|'.join(CHECKS)}")
    checker = Checker()
    try:
        CHECKS[sys.argv[1]](checker)
    except SystemExit as exc:         # a missing credential, for example
        print(f"  ✗ {exc}")
        return 1
    except Exception as exc:
        print(f"  ✗ could not run the check: {str(exc).splitlines()[0][:160]}")
        return 1
    print()
    if checker.failures:
        print(f"{checker.failures} check(s) failed")
        return 1
    print("All checks passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
