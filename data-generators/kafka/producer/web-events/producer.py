#!/usr/bin/env python3
"""
Retail web-event producer — session-coherent, multi-process.

Generates complete e-commerce *sessions* as Snowplow-shaped rows, plus the
matching credit-card transaction for every order it closes, and routes them to
one of two sinks (``PRODUCE_SINK``):

  kafka       – produce JSON to the retail_events and credit_card_transactions
                topics, for Kafka Connect to sink (default)
  clickhouse  – INSERT straight into retail_analytics.snowplow_events and
                .credit_card_transactions over HTTP using async_insert, with no
                broker or Kafka Connect in the path

Which sink to pick
  kafka       when the demo is about the streaming pipeline itself, or when
              something else also consumes the topics.
  clickhouse  when you just want rows in the tables. Fewer moving parts, no
              broker RAM to size, no connector to register — and no Kafka
              retention window to out-run.

Why sessions
------------
This producer used to sample existing rows from
`retail_analytics.snowplow_events` and re-emit them with fresh ids, choosing
each event's type independently from a weighted bucket. That reproduced the
right *marginal* distribution but destroyed every relationship in the data: a
row's `domain_sessionid` came from whichever source row was drawn, so a session
had events from unrelated users in no particular order, a `purchase` had no cart
before it, and nothing connected an order to a payment.

It now runs the same `plan_session()` from `traffic_profile.py` that the
simulator uses, so a session is internally consistent — one user, one session id,
one device, ordered timestamps, a cart that precedes its checkout — and the
funnel matches the simulator by construction rather than by hand-copied
constants. It also no longer needs ClickHouse on the hot path; ClickHouse is
consulted once at startup for the real product catalog and is optional.

Credit-card alignment
---------------------
Every order that completes with a card payment also produces one row on the
credit-card topic, whose `transaction_id` is the order id the purchase event
carried in `se_property`:

    SELECT e.domain_sessionid, e.se_value AS order_total,
           t.bill_value, t.card_network, t.type
    FROM       retail_analytics.snowplow_events        AS e
    INNER JOIN retail_analytics.credit_card_transactions AS t
            ON t.transaction_id = toUUID(e.se_property)
    WHERE e.event_name = 'checkout_payment_confirmed'

Set PRODUCE_PURCHASE_CC=false to emit web events only. This holds for either
sink: with PRODUCE_SINK=clickhouse the transaction is inserted into
credit_card_transactions directly instead of being produced to its topic.

Run modes (EVENT_MODE)
----------------------
  live   – every session is stamped at ~now. Nothing is backdated, so all of the
           day's throughput lands in today's partition. This is the mode for
           "how fast can we ingest" and for dashboards that show today.
  mixed  – BACKFILL_RATIO of sessions are dated at a random hour-of-day-weighted
           point inside the last BACKFILL_DAYS; the rest are live. Use this to
           build history and a live tail in one run.

Rate
----
PRODUCE_TARGET_EPS is a *daily-average* events/second target: the instantaneous
rate is scaled by the hour-of-day curve, so it dips to ~0.10× overnight and
peaks at ~2.94× around 20:00 UTC-03 while averaging the configured value.
Leave it at 0 (the default) to run flat out — no pacing, maximum throughput.
"""

import multiprocessing as mp
import os
import signal
import sys
import threading
import time
from datetime import timedelta
from urllib.parse import urlsplit

import orjson
from dotenv import load_dotenv

# In the container the shared traffic profile is copied to /app, one directory up.
# For a local checkout it lives in data-generators/shared. Try both.
_PRODUCER_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, _PRODUCER_DIR)
_SHARED = os.path.join(os.path.dirname(os.path.dirname(_PRODUCER_DIR)), "shared")
if os.path.isdir(_SHARED):
    sys.path.append(_SHARED)

import traffic_profile as tp   # noqa: E402
import event_render             # noqa: E402

load_dotenv()

from clickhouse_env import load_root_clickhouse_env  # noqa: E402

load_root_clickhouse_env()

# ─── Configuration ────────────────────────────────────────────────────────────
# Where rows go: the Kafka topics, or straight into ClickHouse via async_insert.
SINK              = os.getenv("PRODUCE_SINK", "kafka").strip().lower()
BOOTSTRAP_SERVERS = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
TOPIC             = os.getenv("KAFKA_TOPIC", "retail_events")
CC_TOPIC          = os.getenv("CC_TOPIC", "credit_card_transactions")
# Target tables when PRODUCE_SINK=clickhouse. Insert behaviour is configured by
# the CH_* variables — see clickhouse_sink.py.
CH_EVENTS_TABLE   = os.getenv("CH_EVENTS_TABLE", "snowplow_events")
CH_CC_TABLE       = os.getenv("CH_CC_TABLE", "credit_card_transactions")

# PRODUCE_THREADS is the legacy name for this knob; PRODUCE_WORKERS wins if set.
NUM_WORKERS       = tp.env_int("PRODUCE_WORKERS", tp.env_int("PRODUCE_THREADS", os.cpu_count() or 4))
WORKER_MODE       = os.getenv("PRODUCE_WORKER_MODE", "process").lower()
MAX_EVENTS        = tp.env_int("PRODUCE_MAX_EVENTS", 0)          # 0 = run forever
TARGET_EPS        = tp.env_float("PRODUCE_TARGET_EPS", 0.0)      # 0 = unthrottled
INTERVAL_MS       = tp.env_float("PRODUCE_INTERVAL_MS", 0.0)     # legacy per-event sleep
STATS_INTERVAL_S  = tp.env_int("PRODUCE_STATS_INTERVAL_S", 5)
RANDOM_SEED       = tp.env_int("PRODUCE_RANDOM_SEED", 42)

SITE_URL          = os.getenv("PRODUCE_SITE_URL", "https://clickhouse-demos.app.br").rstrip("/")
APP_ID            = os.getenv("PRODUCE_APP_ID", "clickshop")
EMIT_PURCHASE_CC  = tp.env_bool("PRODUCE_PURCHASE_CC", True)
USER_POOL_SIZE    = tp.env_int("PRODUCE_USER_POOL", 200_000)
NAME_POOL_SIZE    = tp.env_int("PRODUCE_NAME_POOL", 20_000)
CATALOG_LIMIT     = tp.env_int("PRODUCE_CATALOG_LIMIT", 20_000)
DWELL_SCALE       = tp.env_float("PRODUCE_DWELL_SCALE", 1.0)

CLICKHOUSE_HOST     = os.getenv("CLICKHOUSE_HOST", "")
CLICKHOUSE_PORT     = tp.env_int("CLICKHOUSE_PORT", 8123)
CLICKHOUSE_DATABASE = os.getenv("CLICKHOUSE_DATABASE", "retail_analytics")
CLICKHOUSE_USERNAME = os.getenv("CLICKHOUSE_USERNAME", "default")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "")
CLICKHOUSE_SSL      = tp.env_bool("CLICKHOUSE_SSL", False)

CONFLUENT_API_KEY    = os.getenv("CONFLUENT_API_KEY", "")
CONFLUENT_API_SECRET = os.getenv("CONFLUENT_API_SECRET", "")

# Counter slots, flushed from worker-local variables every _COUNT_BATCH events so
# the hot path never touches shared memory.
_EVENTS, _SESSIONS, _PURCHASES, _TXNS = 0, 1, 2, 3
_SLOTS = 4
_COUNT_BATCH = 200


# ─── Product catalog ──────────────────────────────────────────────────────────

def load_catalog() -> dict[str, list[tuple[int, float]]]:
    """
    Real (product_id, price) pairs per category from ClickHouse.

    Best-effort: the producer must be able to run against a broker with no
    ClickHouse reachable at all, so any failure falls back to a synthetic
    catalog matching the 1 000-product seed. Unlike the previous design this is
    a one-shot startup call — nothing queries ClickHouse per event.
    """
    catalog: dict[str, list[tuple[int, float]]] = {}

    if CLICKHOUSE_HOST:
        try:
            import clickhouse_connect

            print(f"[INFO] Loading product catalog from ClickHouse {CLICKHOUSE_HOST}:{CLICKHOUSE_PORT} …",
                  flush=True)
            client = clickhouse_connect.get_client(
                host=CLICKHOUSE_HOST,
                port=CLICKHOUSE_PORT,
                username=CLICKHOUSE_USERNAME,
                password=CLICKHOUSE_PASSWORD,
                database=CLICKHOUSE_DATABASE,
                secure=CLICKHOUSE_SSL,
                connect_timeout=30,
            )
            result = client.query(
                f"""
                SELECT product_id, category_slug, price
                FROM {CLICKHOUSE_DATABASE}.products_search FINAL
                WHERE is_active = 1
                LIMIT {CATALOG_LIMIT}
                """,
                settings={"max_execution_time": 30},
            )
            client.close()
            for product_id, slug, price in result.result_rows:
                catalog.setdefault(str(slug), []).append((int(product_id), float(price)))
            if catalog:
                total = sum(len(v) for v in catalog.values())
                print(f"[INFO] Loaded {total:,} products across {len(catalog)} categories.",
                      flush=True)
        except Exception as exc:
            print(f"[WARN] Could not load the catalog from ClickHouse ({type(exc).__name__}: {exc}).",
                  flush=True)

    # Fill in any storefront category the catalog does not cover.
    missing = [c for c in tp.CATEGORIES if not catalog.get(c)]
    if missing:
        if catalog:
            print(f"[WARN] No catalog rows for {', '.join(missing)} — using synthetic ids.",
                  flush=True)
        else:
            print("[INFO] Using synthetic product ids 1-1000.", flush=True)
        import random as _random
        for i, cat in enumerate(tp.CATEGORIES):
            if catalog.get(cat):
                continue
            lo = i * 200 + 1
            catalog[cat] = [
                (j, round(_random.uniform(9.99, 499.99), 2)) for j in range(lo, lo + 200)
            ]
    return catalog


# ─── Session rendering ────────────────────────────────────────────────────
# render_session(), _ctx_for(), _blank_row() and _STRUCT moved to
# shared/event_render.py (docs/fraud-detection/PLAN.md WS0-T5) so the fraud
# generator renders byte-identical rows without duplicating this logic.

# ─── Sinks ────────────────────────────────────────────────────────────────────
# Both sinks take a whole session at a time: the events, then the card
# transactions the session produced. Keeping the interface session-shaped is what
# lets the ClickHouse sink write both tables through one connection and keeps the
# worker loop identical for either.

def _delivery_error(err, msg):
    if err:
        print(f"[ERROR] Delivery failed: {err}", flush=True)


class KafkaSink:
    """Produces events to KAFKA_TOPIC and storefront transactions to CC_TOPIC."""

    def __init__(self, worker_id: int):
        from confluent_kafka import Producer

        config = {
            "bootstrap.servers":            BOOTSTRAP_SERVERS,
            "linger.ms":                    10,
            "batch.num.messages":           10_000,
            "compression.type":             "lz4",
            "acks":                         "1",
            # Bounded so N workers cannot collectively exhaust the box's RAM:
            # 128 MiB of buffered messages per worker.
            "queue.buffering.max.messages": 100_000,
            "queue.buffering.max.kbytes":   131_072,
        }
        if CONFLUENT_API_KEY and CONFLUENT_API_SECRET:
            config.update({
                "security.protocol": "SASL_SSL",
                "sasl.mechanism":    "PLAIN",
                "sasl.username":     CONFLUENT_API_KEY,
                "sasl.password":     CONFLUENT_API_SECRET,
            })
        self._producer = Producer(config)

    def _produce(self, topic: str, key: str | None, row: dict, stop) -> None:
        value = orjson.dumps(row)
        while not stop.is_set():
            try:
                self._producer.produce(topic, key=key, value=value,
                                       on_delivery=_delivery_error)
                return
            except BufferError:
                self._producer.poll(0.05)

    def write_session(self, rows: list[dict], txns: list[dict], pacer, stop) -> None:
        # Keyed by session, not by event: Kafka only guarantees order within a
        # partition, so keying on event_id would scatter one session's events
        # across all of them and lose the ordering a stream consumer needs to
        # sessionise. ClickHouse doesn't care (it sorts on read), but anything
        # reading the topic directly does.
        key = rows[0]["domain_sessionid"] if rows else None
        for row in rows:
            pacer.tick()
            self._produce(TOPIC, key, row, stop)
        for txn in txns:
            self._produce(CC_TOPIC, txn["transaction_id"], txn, stop)
        self._producer.poll(0)

    def close(self) -> None:
        print("[INFO] Flushing to Kafka…", flush=True)
        self._producer.flush(30)


class ClickHouseSink:
    """
    Inserts events and storefront transactions straight into ClickHouse, no
    Kafka involved.

    A session's events and its card transactions go into two different tables
    through one client and one connection, batched and flushed independently. The
    transactions are written after the events, so a transaction can never be
    visible before the purchase that produced it.
    """

    def __init__(self, worker_id: int):
        from clickhouse_sink import ClickHouseInserter

        self._inserter = ClickHouseInserter(
            (CH_EVENTS_TABLE, CH_CC_TABLE), worker_id=worker_id
        )

    def write_session(self, rows: list[dict], txns: list[dict], pacer, stop) -> None:
        for row in rows:
            pacer.tick()
            self._inserter.write(CH_EVENTS_TABLE, row)
        for txn in txns:
            self._inserter.write(CH_CC_TABLE, txn)

    def close(self) -> None:
        print("[INFO] Flushing to ClickHouse…", flush=True)
        self._inserter.close()


def make_sink(worker_id: int):
    if SINK == "kafka":
        return KafkaSink(worker_id)
    if SINK == "clickhouse":
        return ClickHouseSink(worker_id)
    raise SystemExit(f"[ERROR] Unknown PRODUCE_SINK '{SINK}' (expected kafka|clickhouse)")


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

    sink  = make_sink(worker_id)
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
        sink.close()


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
    if SINK not in ("kafka", "clickhouse"):
        raise SystemExit(f"[ERROR] PRODUCE_SINK must be kafka|clickhouse (got '{SINK}')")
    NUM_WORKERS = max(1, NUM_WORKERS)

    clock = tp.Clock()      # validates EVENT_MODE before any worker starts
    tp.set_dwell_scale(DWELL_SCALE)
    catalog = load_catalog()

    if SINK == "clickhouse":
        import clickhouse_sink

        if not clickhouse_sink.CLICKHOUSE_HOST:
            raise SystemExit("[ERROR] PRODUCE_SINK=clickhouse requires CLICKHOUSE_HOST")
        target = (
            f"[INFO] Inserting into {clickhouse_sink.CLICKHOUSE_DATABASE}."
            f"{CH_EVENTS_TABLE}"
            + (f" + .{CH_CC_TABLE}" if EMIT_PURCHASE_CC else "")
            + f"\n[INFO] {clickhouse_sink.describe()}"
        )
        cc_target = f"→ {CH_CC_TABLE}"
    else:
        target = f"[INFO] Producing to '{TOPIC}' on {BOOTSTRAP_SERVERS}"
        cc_target = f"→ {CC_TOPIC}"

    print(
        f"[INFO] sink={SINK}\n"
        f"{target}\n"
        f"[INFO] mode={clock.describe()}\n"
        f"[INFO] workers={NUM_WORKERS} ({WORKER_MODE}) | "
        f"rate={'unthrottled (flat out)' if TARGET_EPS <= 0 else f'{TARGET_EPS:,.0f} ev/s daily avg, {TARGET_EPS * tp.PEAK_MULTIPLIER:,.0f}/s at peak'} | "
        f"max={MAX_EVENTS or 'unlimited'}\n"
        f"[INFO] site={SITE_URL} | dwell scale={DWELL_SCALE:g} | "
        f"card transactions {cc_target if EMIT_PURCHASE_CC else 'disabled'}",
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
        ev, se, pu, tx = _totals(counts)
        print(
            f"[INFO] Totals: {ev:,} events across {se:,} sessions "
            f"({ev / se if se else 0:.2f} ev/session), {pu:,} orders, {tx:,} card transactions",
            flush=True,
        )


if __name__ == "__main__":
    main()
