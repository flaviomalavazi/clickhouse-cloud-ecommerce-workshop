#!/usr/bin/env python3
"""
Retail web-event producer — session-coherent, straight into ClickHouse.

Generates complete e-commerce *sessions* as Snowplow-shaped rows, plus the
matching credit-card transaction for every card order it closes, and INSERTs them
into retail_analytics.snowplow_events and .credit_card_transactions over HTTP.
There is no broker in the path.

Two ways to run it
------------------
  live      (the default)  A steady trickle stamped at ~now, paced to
            PRODUCE_TARGET_EPS events/second, with 2 worker threads sharing one
            writer per table. This is what keeps the dashboard moving.
  backfill  EVENT_MODE=mixed, PRODUCE_WORKER_MODE=process, PRODUCE_TARGET_EPS=0
            Builds BACKFILL_DAYS of history as fast as it can, in large batches
            (see shared/clickhouse_sink.py), and stops after PRODUCE_MAX_EVENTS.

Why sessions
------------
A session is internally consistent — one user, one session id, one device,
ordered timestamps, a cart that precedes its checkout — because it comes from the
same `plan_session()` the browser simulator uses. The funnel matches by
construction rather than by hand-copied constants.

The product catalogue comes from `products_search`, which module 04 builds from
the replicated Postgres tables. If that table is empty the producer stops with an
error instead of inventing product ids, because ids that match no product would
make every product join meaningless.

Credit-card alignment
---------------------
Every order that completes with a card payment also produces one row in
credit_card_transactions, whose `transaction_id` is the order id the purchase
event carried in `se_property`:

    SELECT e.domain_sessionid, e.se_value AS order_total,
           t.bill_value, t.card_network, t.type
    FROM       retail_analytics.snowplow_events        AS e
    INNER JOIN retail_analytics.credit_card_transactions AS t
            ON t.transaction_id = toUUID(e.se_property)
    WHERE e.event_name = 'checkout_payment_confirmed'

Pix and boleto purchases leave no card transaction. Set PRODUCE_PURCHASE_CC=false
to emit web events only. (Orders placed through the storefront carry a Postgres
order id instead; they never come from this producer.)

Run modes (EVENT_MODE)
----------------------
  live   – every session is stamped at ~now.
  mixed  – BACKFILL_RATIO of sessions are dated at a random hour-of-day-weighted
           point inside the last BACKFILL_DAYS; the rest are live.

Rate
----
PRODUCE_TARGET_EPS is a *daily-average* events/second target: the instantaneous
rate is scaled by the hour-of-day curve, so it dips to ~0.10× overnight and
peaks at ~2.94× around 20:00 UTC-03 while averaging the configured value. Set it
to 0 to run flat out.
"""

import multiprocessing as mp
import os
import signal
import sys
import threading
import time

# In a checkout the shared modules sit next to this directory; in the image
# everything is copied flat into /app and is already importable.
_SHARED = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "shared")
if os.path.isdir(_SHARED):
    sys.path.insert(0, _SHARED)

import traffic_profile as tp   # noqa: E402
import event_render             # noqa: E402
import clickhouse_env as env    # noqa: E402
import clickhouse_sink          # noqa: E402

# ─── Configuration ────────────────────────────────────────────────────────────
# Target tables. Insert behaviour is configured by the CH_* variables — see
# clickhouse_sink.py.
CH_EVENTS_TABLE   = os.getenv("CH_EVENTS_TABLE", "snowplow_events")
CH_CC_TABLE       = os.getenv("CH_CC_TABLE", "credit_card_transactions")

# `PRODUCE_WORKERS` has to be set explicitly in a pod: os.cpu_count() reports the
# node's CPUs, not the pod's limit.
NUM_WORKERS       = tp.env_int("PRODUCE_WORKERS", 2)
WORKER_MODE       = os.getenv("PRODUCE_WORKER_MODE", "thread").lower()
MAX_EVENTS        = tp.env_int("PRODUCE_MAX_EVENTS", 0)          # 0 = run forever
TARGET_EPS        = tp.env_float("PRODUCE_TARGET_EPS", 200.0)    # 0 = unthrottled
INTERVAL_MS       = tp.env_float("PRODUCE_INTERVAL_MS", 0.0)     # legacy per-event sleep
STATS_INTERVAL_S  = tp.env_int("PRODUCE_STATS_INTERVAL_S", 5)
RANDOM_SEED       = tp.env_int("PRODUCE_RANDOM_SEED", 42)

SITE_URL          = os.getenv("PRODUCE_SITE_URL", "http://localhost:3000").rstrip("/")
APP_ID            = os.getenv("PRODUCE_APP_ID", "clickshop")
EMIT_PURCHASE_CC  = tp.env_bool("PRODUCE_PURCHASE_CC", True)
USER_POOL_SIZE    = tp.env_int("PRODUCE_USER_POOL", 200_000)
NAME_POOL_SIZE    = tp.env_int("PRODUCE_NAME_POOL", 20_000)
CATALOG_LIMIT     = tp.env_int("PRODUCE_CATALOG_LIMIT", 20_000)
DWELL_SCALE       = tp.env_float("PRODUCE_DWELL_SCALE", 1.0)

# Counter slots, flushed from worker-local variables every _COUNT_BATCH events so
# the hot path never touches shared memory.
_EVENTS, _SESSIONS, _PURCHASES, _TXNS = 0, 1, 2, 3
_SLOTS = 4
_COUNT_BATCH = 200


# ─── Product catalog ──────────────────────────────────────────────────────────

def load_catalog() -> dict[str, list[tuple[int, float]]]:
    """
    Real (product_id, price) pairs per category, from products_search.

    A one-shot startup call: nothing queries ClickHouse per event. Exits with a
    clear message when the table cannot be read or has no products, rather than
    falling back to made-up ids.
    """
    env.require_host()
    print(f"[INFO] Loading product catalog from {env.describe()} …", flush=True)
    try:
        client = env.connect()
        try:
            rows = client.query(
                f"""
                SELECT product_id, category_slug, price
                FROM {env.CLICKHOUSE_DATABASE}.products_search
                WHERE is_active = 1
                LIMIT {CATALOG_LIMIT}
                """,
                settings={"max_execution_time": 30},
            ).result_rows
        finally:
            client.close()
    except Exception as exc:  # noqa: BLE001
        raise SystemExit(
            f"[ERROR] Could not read {env.CLICKHOUSE_DATABASE}.products_search "
            f"({type(exc).__name__}: {exc}). It is built in module 04: run `make ch-search` "
            "once the Postgres ClickPipe has replicated the catalogue."
        )

    catalog: dict[str, list[tuple[int, float]]] = {}
    for product_id, slug, price in rows:
        catalog.setdefault(str(slug), []).append((int(product_id), float(price)))

    if not catalog:
        raise SystemExit(
            f"[ERROR] {env.CLICKHOUSE_DATABASE}.products_search has no active products. "
            "Run module 04 first (`make ch-search`, after the ClickPipe has replicated the catalogue)."
        )
    missing = [c for c in tp.CATEGORIES if not catalog.get(c)]
    if missing:
        raise SystemExit(
            f"[ERROR] products_search has no active products in: {', '.join(missing)}. "
            "The catalogue looks incomplete; check the ClickPipe and re-run `make ch-search`."
        )
    print(f"[INFO] Loaded {sum(len(v) for v in catalog.values()):,} products "
          f"across {len(catalog)} categories.", flush=True)
    return catalog


# ─── Sink ─────────────────────────────────────────────────────────────────────
# A sink takes a whole session at a time: the events, then the card transactions
# the session produced. The transactions are written after the events, so a
# transaction can never become visible before the purchase that produced it.

class ClickHouseSink:
    """
    A worker's handle on the process-wide inserter. All the workers in a process
    share one writer per table, which is what keeps the number of inserts down.
    """

    def __init__(self):
        tables = (CH_EVENTS_TABLE,) + ((CH_CC_TABLE,) if EMIT_PURCHASE_CC else ())
        self._inserter = clickhouse_sink.get_inserter(tables)

    def write_session(self, rows: list[dict], txns: list[dict], pacer, stop) -> None:
        for row in rows:
            pacer.tick()
            self._inserter.write(CH_EVENTS_TABLE, row)
        for txn in txns:
            self._inserter.write(CH_CC_TABLE, txn)


# ─── Worker loop ──────────────────────────────────────────────────────────────

class _RowThrottle:
    """
    The diurnal Pacer plus the legacy per-event sleep, behind one `tick()`, so a
    sink only has to know about a single throttle.
    """

    __slots__ = ("_pacer", "_interval")

    def __init__(self, pacer, interval_s: float):
        self._pacer = pacer
        self._interval = interval_s if interval_s > 0 else 0.0

    def tick(self) -> None:
        self._pacer.tick()
        if self._interval:
            time.sleep(self._interval)


def worker_loop(worker_id: int, catalog: dict, counts, stop) -> None:
    import random

    worker_seed = RANDOM_SEED + worker_id
    rng = random.Random(worker_seed)  # each worker gets a stable independent stream
    random.seed(worker_seed)          # plan_session() and new_id() use this stream
    tp.set_dwell_scale(DWELL_SCALE)

    users       = tuple(tp.new_id() for _ in range(max(1, USER_POOL_SIZE // NUM_WORKERS)))
    names       = tp.build_name_pool(max(1, NAME_POOL_SIZE // NUM_WORKERS))
    expirations = tp.build_expiration_pool()
    clock       = tp.Clock()
    throttle    = _RowThrottle(
        tp.Pacer(TARGET_EPS / NUM_WORKERS if TARGET_EPS > 0 else 0.0),
        INTERVAL_MS / 1000.0,
    )

    def pick_product(category: str) -> dict:
        pid, price = rng.choice(catalog[category])
        return {"id": pid, "price": price}

    sink  = ClickHouseSink()
    local = [0] * _SLOTS

    try:
        while not stop.is_set():
            plan = tp.plan_session(pick_product)
            rows, txns = event_render.render_session(
                plan, clock, rng, users, names, expirations,
                site_url=SITE_URL, app_id=APP_ID, user_id="",
                emit_purchase_cc=EMIT_PURCHASE_CC,
            )

            sink.write_session(rows, txns, throttle, stop)

            local[_EVENTS]    += len(rows)
            local[_SESSIONS]  += 1
            local[_PURCHASES] += 1 if plan.order else 0
            local[_TXNS]      += len(txns)

            if local[_SESSIONS] % _COUNT_BATCH == 0:
                _publish(counts, worker_id, local)
                if MAX_EVENTS and sum(counts[i * _SLOTS + _EVENTS] for i in range(NUM_WORKERS)) >= MAX_EVENTS:
                    break
    finally:
        _publish(counts, worker_id, local)
        if WORKER_MODE == "process":
            # A worker process has its own inserter and flushes it here. Threads
            # share the main process's one, which main() flushes once, after every
            # thread has finished: flushing it from each thread as it exits would
            # send the other threads' half-built batches early.
            stats = clickhouse_sink.close_all()
            print(f"[INFO] worker {worker_id} inserts: " + ", ".join(
                f"{t}={st['inserts']:,} ({st['rows']:,} rows)" for t, st in stats.items()
            ), flush=True)


def _publish(counts, worker_id: int, local: list[int]) -> None:
    off = worker_id * _SLOTS
    for i in range(_SLOTS):
        counts[off + i] = local[i]


def _totals(counts) -> list[int]:
    return [
        sum(counts[w * _SLOTS + i] for w in range(NUM_WORKERS))
        for i in range(_SLOTS)
    ]


# ─── Stats reporter ───────────────────────────────────────────────────────────

def stats_reporter(counts, stop) -> None:
    last_ev, last_se, last_t = 0, 0, time.monotonic()
    while not stop.wait(timeout=STATS_INTERVAL_S):
        now = time.monotonic()
        ev, se, pu, tx = _totals(counts)
        span = max(1e-9, now - last_t)
        ev_rate, se_rate = (ev - last_ev) / span, (se - last_se) / span
        last_ev, last_se, last_t = ev, se, now

        target = ""
        if TARGET_EPS > 0:
            target = f" | target {TARGET_EPS * tp.hour_multiplier():>8,.0f}/s (x{tp.hour_multiplier():.2f})"
        print(
            f"[INFO] {ev:>12,} events | {ev_rate:>9,.0f} ev/s | "
            f"{se:>10,} sessions ({se_rate:>7,.1f}/s) | "
            f"{ev / se if se else 0:>4.2f} ev/session | "
            f"{pu:>8,} orders | {tx:>8,} card txns{target}",
            flush=True,
        )


# ─── Main ─────────────────────────────────────────────────────────────────────

def main() -> None:
    global NUM_WORKERS

    if WORKER_MODE not in ("process", "thread"):
        raise SystemExit(f"[ERROR] PRODUCE_WORKER_MODE must be process|thread (got '{WORKER_MODE}')")
    NUM_WORKERS = max(1, NUM_WORKERS)

    env.require_host()
    clock = tp.Clock()      # validates EVENT_MODE before any worker starts
    tp.set_dwell_scale(DWELL_SCALE)
    catalog = load_catalog()

    print(
        f"[INFO] Inserting into {env.CLICKHOUSE_DATABASE}.{CH_EVENTS_TABLE}"
        + (f" + .{CH_CC_TABLE}" if EMIT_PURCHASE_CC else "")
        + f"\n[INFO] {clickhouse_sink.describe()}\n"
        f"[INFO] mode={clock.describe()}\n"
        f"[INFO] workers={NUM_WORKERS} ({WORKER_MODE}) | "
        f"rate={'unthrottled (flat out)' if TARGET_EPS <= 0 else f'{TARGET_EPS:,.0f} ev/s daily avg, {TARGET_EPS * tp.PEAK_MULTIPLIER:,.0f}/s at peak'} | "
        f"max={MAX_EVENTS or 'unlimited'}\n"
        f"[INFO] site={SITE_URL} | dwell scale={DWELL_SCALE:g} | "
        f"card transactions {'→ ' + CH_CC_TABLE if EMIT_PURCHASE_CC else 'disabled'}",
        flush=True,
    )

    if WORKER_MODE == "process":
        counts  = mp.Array("q", NUM_WORKERS * _SLOTS)
        stop    = mp.Event()
        workers = [
            mp.Process(target=worker_loop, args=(i, catalog, counts, stop), daemon=True)
            for i in range(NUM_WORKERS)
        ]
        reporter = mp.Process(target=stats_reporter, args=(counts, stop), daemon=True)
    else:
        counts  = [0] * (NUM_WORKERS * _SLOTS)
        stop    = threading.Event()
        workers = [
            threading.Thread(target=worker_loop, args=(i, catalog, counts, stop), daemon=True)
            for i in range(NUM_WORKERS)
        ]
        reporter = threading.Thread(target=stats_reporter, args=(counts, stop), daemon=True)

    def _shutdown(*_):
        print("\n[INFO] Shutting down…", flush=True)
        stop.set()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    for w in workers:
        w.start()
    reporter.start()

    try:
        for w in workers:
            w.join()
    finally:
        stop.set()
        inserts = clickhouse_sink.close_all()
        ev, se, pu, tx = _totals(counts)
        print(
            f"[INFO] Totals: {ev:,} events across {se:,} sessions "
            f"({ev / se if se else 0:.2f} ev/session), {pu:,} orders, {tx:,} card transactions",
            flush=True,
        )
        if inserts:
            print("[INFO] Inserts: " + ", ".join(
                f"{t}={s['inserts']:,} ({s['rows']:,} rows, {s['dropped_batches']} dropped)"
                for t, s in inserts.items()
            ), flush=True)


if __name__ == "__main__":
    main()
