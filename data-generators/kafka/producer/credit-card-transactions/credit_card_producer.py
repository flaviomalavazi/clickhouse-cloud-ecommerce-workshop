#!/usr/bin/env python3
"""
Credit-card transaction producer — background traffic, high throughput.

Generates synthetic Brazilian credit-card transactions for merchants *outside*
the storefront — restaurants, retail chains, pharmacies, cinemas — and routes
them to one of four sinks (``--sink`` / ``CC_SINK``):

  kafka       – produce JSON to the credit_card_transactions Kafka topic (default)
  clickhouse  – insert straight into ClickHouse over HTTP using async_insert,
                with no broker or Kafka Connect in the path
  file        – write newline-delimited JSON to local files
  s3          – write local files, then upload each to S3 via boto3

Which sink to pick
  kafka       when the demo is about the streaming pipeline itself, or when
              something else also consumes the topic.
  clickhouse  when you just want rows in the table. Fewer moving parts, no
              broker RAM to size, no connector to register — and no Kafka
              retention window to out-run. This is the simplest way to load a
              lot of transactions quickly.
  file / s3   when the demo is about object-storage ingestion (s3 table function,
              ClickPipes) or you want a reusable dataset on disk.

What this producer is *not*
---------------------------
It deliberately does not invent storefront orders. Transactions that belong to a
ClickShop purchase are emitted by whichever generator created that purchase —
the web-events producer or the simulator — because only they know the order id
that makes the transaction joinable to its purchase event. This producer
provides the surrounding volume, so `merchant_name = 'ClickShop'` selects
exactly the reconcilable population and everything else is background.

Transaction model
  Each transaction is one of three kinds (weighted mix):
    legitimate  – a normal expense
    chargeback  – a refund/dispute (negative bill_value, type="chargeback")
    faulty      – exactly one corrupted field, the demo's fraud/anomaly signal
                  (null merchant_name/card_holder, negative bill_value,
                   installments=0, invalid card_network "UCB", a card_bin that
                   contradicts the network, or a future timestamp)

  The corruption itself lives in `traffic_profile.corrupt_transaction()`, shared
  with the storefront path, so an anomaly-detection query behaves identically on
  either population.

Timestamps (EVENT_MODE)
  live   – stamped at ~now. This producer used to date every transaction 61-120
           days in the past unconditionally, which made it useless for any demo
           about *today*.
  mixed  – BACKFILL_RATIO dated at a random hour-of-day-weighted point inside the
           last BACKFILL_DAYS; the rest live.

Rate
  CC_TARGET_TPS is a *daily-average* transactions/second target, scaled by the
  hour-of-day curve (≈0.10× overnight, ≈2.94× at the 20:00 peak UTC-03). Leave
  it at 0 to run flat out.

Throughput
  Cardholder names and expiry dates are drawn once at startup into in-memory
  pools, then sampled with random.choice — no per-row library calls. Records are
  serialised with orjson. Generation is CPU-bound, so workers default to
  multiprocessing (CC_WORKER_MODE=process); CC_WORKER_MODE=thread is lighter.
"""

import argparse
import multiprocessing as mp
import os
import random
import signal
import sys
import threading
import time
from datetime import datetime, timezone

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

load_dotenv()

from clickhouse_env import load_root_clickhouse_env  # noqa: E402

load_root_clickhouse_env()

# ─── Configuration ──────────────────────────────────────────────────────────────
CC_SINK             = os.getenv("CC_SINK", "kafka").lower()
CC_TOPIC            = os.getenv("CC_TOPIC", "credit_card_transactions")
CC_WORKERS          = tp.env_int("CC_WORKERS", os.cpu_count() or 4)
CC_WORKER_MODE      = os.getenv("CC_WORKER_MODE", "process").lower()
CC_MAX              = tp.env_int("CC_MAX_TRANSACTIONS", 0)   # 0 = run forever
CC_INTERVAL_MS      = tp.env_float("CC_INTERVAL_MS", 0.0)    # legacy per-worker sleep
CC_TARGET_TPS       = tp.env_float("CC_TARGET_TPS", 0.0)     # 0 = flat out
CC_POOL_SIZE        = tp.env_int("CC_POOL_SIZE", 100_000)
CC_STATS_INTERVAL_S = tp.env_int("CC_STATS_INTERVAL_S", 5)
CC_RANDOM_SEED      = tp.env_int("CC_RANDOM_SEED", 42)

# File / S3 sink
CC_OUTPUT_DIR    = os.getenv("CC_OUTPUT_DIR", "./output")
CC_FILE_ROWS     = tp.env_int("CC_FILE_ROWS", 50_000)
CC_S3_BUCKET     = os.getenv("CC_S3_BUCKET", "")
CC_S3_PREFIX     = os.getenv("CC_S3_PREFIX", "credit-card-transactions")
CC_S3_REGION     = os.getenv("CC_S3_REGION", "")
CC_S3_KEEP_LOCAL = tp.env_bool("CC_S3_KEEP_LOCAL", False)

# Direct-to-ClickHouse sink. The insert behaviour (batching, async_insert,
# compression, retries) and the connection settings are shared with the
# web-events producer — see clickhouse_sink.py and the CH_* variables.
CC_CH_TABLE = os.getenv("CC_CH_TABLE", "credit_card_transactions")

# Kafka
BOOTSTRAP_SERVERS    = os.getenv("KAFKA_BOOTSTRAP_SERVERS", "localhost:9092")
CONFLUENT_API_KEY    = os.getenv("CONFLUENT_API_KEY", "")
CONFLUENT_API_SECRET = os.getenv("CONFLUENT_API_SECRET", "")

# ─── Static reference data ────────────────────────────────────────────────────────
RESTAURANTS = (
    "Taste it Restaurante", "V.E.R.A Restaurante", "Trencadís Restaurante", "Nagarê Sushi", "L'entrecote de Paris",
    "Seen São Paulo", "Allora Vino e Birra", "Pizzaria Napoli Centrale", "Temakeria e Cia Pinheiros", "Niks Bar",
    "Sushi Papaia", "Brown Sugar Restaurante", "Zendô Sushi", "Qceviche", "Bar Paribar", "Poke Me Up",
    "Latitude 12 SP Bar e Restaurante", "Smart Burger", "Fiori d'Itália", "Riqs Burguer Shop", "Japa 25",
    "Wanderlust Bar", "O Holanddês Hamburgueria", "Acarajé e Delícias da Bahia", "Doña Luz Empanadas", "Da Vinci Burger",
    "Bawarchi", "Raw Veggie Burger", "Rosso Burguer", "Itsu Restaurante", "Parm", "Forneria Sant'Antonio", "Rudá Restaurante",
    "Worst Burguer", "Soggiorno da Vila", "Pecorino", "Rueiro Parrilla Bar", "Harumi Tatuapé", "Restaurante Banri", "Poke Haus",
    "Grecco Bar e Cucina", "Hunter We Burger", "We Pizza", "Ydaygorô Sushi", "Casale di Pizza", "The Choice Hamburgueria",
    "BBOPQ Grill", "2nd House Bar", "Mama África La Bonne Bouffe", "Pasta Nostra Ristorante", "Mais Burguinho",
    "Bem Torta Bistro & Lounge", "BBC Burger & Crepe", "LIL' Square", "La Forchetta", "Di Bari Pizza",
    "Nacho Libre", "Di Fondi Pizza", "Galeto di Paolo", "Kalili Restaurante", "Pacífico Taco Shop", "La Innocent Bistrô & Bar",
    "Figone", "1101 bar", "Le Burger Hamburgueria", "The Pitchers Burger Baseball", "Forno da Vila", "Montemerano Pizzeria",
    "Oriba Restaurante", "Café Kidoairaku", "The Bowl", "Peixaria Império dos Pescados", "Reino do Churrasco", "Lá da Torta",
    "Projeto Burguer Vila Burguer", "Espeto de la Vaca", "O Kebab SP", "Low BBQ", "Posto 9", "Craft Burguer", "BnB Hamburgueria",
    "North Beer", "Burger Match", "Ursus Rock Burger", "Restaurante Shisá", "Let's Poke", "Hamburgueria Invictus",
    "Twins Pizza & Burger", "Bistro Bar Vila Olímpia", "Mussanela Pizzaria", "Santô Sushi", "Basic Burger",
    "Restaurante Migá", "Vila Milagro", "Burger 700", "Flying Sushi", "Bologna", "Pizzaria Copan", "FiChips", "Taco Bell",
)

RETAIL = (
    "Mercado Livre", "B2W Americanas", "Amazon", "Via Varejo", "Magalu", "OLX", "Shopee", "Carrefour",
    "Global Fashion Group (GFG)", "Submarino", "Elo7", "Enjoei", "Shopfácil", "Centauro", "Netshoes", "MadeiraMadeira",
    "Wish", "Estante Virtual", "Atacado.com", "2Collab", "Boobam", "Infoar/Webcontinental", "Alluagro",
    "Loja Integrada", "Canal da Peça",
)

DRUGSTORE_AND_AESTHETICS = (
    "Grupo Boticário", "RaiaDrogasil", "Grupo DPSP", "Farmácias Pague Menos", "Farmácias Associadas",
    "Farmácias São João", "Natura&Co", "Clamed Farmácias/Drogaria Caterinense", "Panvel Farmácias", "Extrafarma",
)

MOVIES = (
    "A2 Filmes", "AFA Cinemas", "Alpha Filmes", "Arcoplex Cinemas", "Box Cinemas", "Bretz Filmes", "California Filmes", "Cavídeo",
    "Centerplex", "Cine A", "Cine Filmes", "Cine Gracher", "Cineart", "Cineflix", "Cinema Virtual", "Cinemagic",
    "Cinemais", "Cinemark", "Cinemas Premier", "Cinematográfica Araújo", "Cinemaxx", "Cineplus", "Cinépolis",
    "Cinespaço", "Cinesystem", "Circuito Entretenimento e Cinemas", "Copacabana Filmes", "Diamond Films", "Downtown Filmes",
    "Elite Filmes", "Embracine", "Empresa de Cinemas Sercla", "Esfera Filmes", "Espaço Filmes", "Espaço Itaú de Cinema", "Europa Filmes",
    "FamDVD", "Fênix Filmes", "Filmicca", "Galeria Distribuidora", "GNC Cinemas", "Grupo Cine", "Grupo Estação",
    "Grupo Mobi Cine", "Grupo SaladeArte", "H2O Films", "Imagem Filmes", "Imovision", "Kinoplex", "Laser Cinemas",
    "Lume Filmes", "Lumière Brasil", "Lumière Empresa Cinematográfica", "Mares Filmes", "Moviecom", "Moviemax", "Multicine",
    "Nossa Distribuidora", "Orient Cinemas", "Pagu Pictures", "Pandora Filmes", "Paris Filmes", "Petra Belas Artes", "Pinheiro Cinemas",
    "Rede Cine Show", "RioFilme", "Roxy Cinemas", "Sofa Digital", "UCI Kinoplex", "UCI Orient", "Uniplex", "United Cinemas International",
    "Versátil Home Vídeo", "Videocamp", "VideoFilmes", "Vitrine Filmes", "Zeta Filmes",
)

# merchant_type → tuple of merchant names. traffic_profile.STOREFRONT_MERCHANT
# ("ClickShop") is deliberately absent from every segment.
SEGMENTS: dict[str, tuple[str, ...]] = {
    "restaurants": RESTAURANTS,
    "retail": RETAIL,
    "drugstore_and_aesthetics": DRUGSTORE_AND_AESTHETICS,
    "movies": MOVIES,
}
SEGMENT_KEYS = tuple(SEGMENTS.keys())

# Pre-computed bill multipliers (replaces per-row match statements).
_CARD_MULTIPLIER = {"Mastercard": 0.95, "Visa": 1.0, "Amex": 1.25, "Elo": 0.9}
_MERCHANT_MULTIPLIER = {"restaurants": 1.4, "retail": 2.0, "drugstore_and_aesthetics": 1.0, "movies": 0.8}

# Transaction-kind mix: ~57% legit, ~29% chargeback, ~14% faulty.
_MESSAGE_TYPES = ("legitimate", "legitimate", "legitimate", "legitimate", "chargeback", "chargeback", "faulty")


# ─── Pre-generated value pools ────────────────────────────────────────────────────
def build_pools(pool_size: int) -> dict[str, tuple]:
    """
    Build fake-value pools once. Sampling these with random.choice per
    transaction is dramatically faster than composing a name per row, and the
    names come from traffic_profile so storefront and background transactions
    draw from the same population.
    """
    return {
        "names": tp.build_name_pool(pool_size),
        "expirations": tp.build_expiration_pool(),
    }


# ─── Transaction generation ─────────────────────────────────────────────────────
def _bill_value(card_network: str, merchant_type: str) -> float:
    base = random.gauss(100, 50) + random.randint(-20, 20)
    return round(base * _CARD_MULTIPLIER[card_network] * _MERCHANT_MULTIPLIER[merchant_type], 2)


def generate_legitimate(pools: dict[str, tuple], clock: tp.Clock) -> dict:
    card_network  = tp.pick_card_network()
    merchant_type = random.choice(SEGMENT_KEYS)
    bill          = _bill_value(card_network, merchant_type)
    return {
        "transaction_id":       tp.new_id(),
        "timestamp":            tp.format_ts(clock.event_time()),
        "merchant_name":        random.choice(SEGMENTS[merchant_type]),
        "merchant_type":        merchant_type,
        "bill_value":           bill,
        "installments":         tp.pick_installments(bill),
        "card_network":         card_network,
        "card_bin":             tp.card_bin_for(card_network),
        "card_holder":          random.choice(pools["names"]),
        "card_expiration_date": random.choice(pools["expirations"]),
        "currency":             tp.pick_currency(),
        "type":                 "expense",
    }


def generate_chargeback(pools: dict[str, tuple], clock: tp.Clock) -> dict:
    txn = generate_legitimate(pools, clock)
    txn["type"] = "chargeback"
    txn["bill_value"] = -txn["bill_value"]
    return txn


def generate_faulty(pools: dict[str, tuple], clock: tp.Clock) -> dict:
    return tp.corrupt_transaction(generate_legitimate(pools, clock))


def generate_transaction(pools: dict[str, tuple], clock: tp.Clock) -> dict:
    kind = random.choice(_MESSAGE_TYPES)
    if kind == "legitimate":
        return generate_legitimate(pools, clock)
    if kind == "chargeback":
        return generate_chargeback(pools, clock)
    return generate_faulty(pools, clock)


# ─── Sinks ────────────────────────────────────────────────────────────────────────
class KafkaSink:
    """Produces JSON transactions to a Kafka topic via confluent-kafka."""

    def __init__(self, worker_id: int):
        from confluent_kafka import Producer

        config: dict = {
            "bootstrap.servers":            BOOTSTRAP_SERVERS,
            "linger.ms":                    10,
            "batch.num.messages":           10_000,
            "compression.type":             "lz4",
            "acks":                         "1",
            # 128 MiB of buffered messages per worker, so N workers cannot
            # collectively exhaust the box's RAM.
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

    def write(self, txn: dict) -> None:
        value = orjson.dumps(txn)
        while True:
            try:
                self._producer.produce(CC_TOPIC, key=txn["transaction_id"], value=value)
                break
            except BufferError:
                self._producer.poll(0.05)
        self._producer.poll(0)

    def close(self) -> None:
        self._producer.flush(30)


class FileSink:
    """Buffers transactions into newline-delimited JSON files. When CC_SINK=s3,
    each completed file is uploaded to S3 and (optionally) removed locally."""

    def __init__(self, worker_id: int, upload: bool):
        self._worker_id = worker_id
        self._upload = upload
        self._buf: list[bytes] = []
        self._s3 = None
        if upload:
            import boto3

            self._s3 = boto3.client("s3", region_name=CC_S3_REGION or None)
        os.makedirs(CC_OUTPUT_DIR, exist_ok=True)

    def write(self, txn: dict) -> None:
        self._buf.append(orjson.dumps(txn))
        if len(self._buf) >= CC_FILE_ROWS:
            self._flush()

    def _flush(self) -> None:
        if not self._buf:
            return
        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f")
        name = f"cc_{ts}_w{self._worker_id}.json"
        path = os.path.join(CC_OUTPUT_DIR, name)
        with open(path, "wb") as fh:
            fh.write(b"\n".join(self._buf))
            fh.write(b"\n")
        self._buf.clear()
        if self._upload and self._s3 is not None:
            key = f"{CC_S3_PREFIX.rstrip('/')}/{name}"
            self._s3.upload_file(path, CC_S3_BUCKET, key)
            if not CC_S3_KEEP_LOCAL:
                os.remove(path)

    def close(self) -> None:
        self._flush()


class ClickHouseSink:
    """
    Inserts transactions straight into ClickHouse, no Kafka involved.

    A thin adapter over the shared ClickHouseInserter, which the web-events
    producer uses too — so both producers batch, compress, retry, and use
    async_insert identically.
    """

    def __init__(self, worker_id: int):
        from clickhouse_sink import ClickHouseInserter

        self._inserter = ClickHouseInserter((CC_CH_TABLE,), worker_id=worker_id)

    def write(self, txn: dict) -> None:
        self._inserter.write(CC_CH_TABLE, txn)

    def close(self) -> None:
        self._inserter.close()


def make_sink(worker_id: int):
    if CC_SINK == "kafka":
        return KafkaSink(worker_id)
    if CC_SINK == "clickhouse":
        return ClickHouseSink(worker_id)
    if CC_SINK == "file":
        return FileSink(worker_id, upload=False)
    if CC_SINK == "s3":
        return FileSink(worker_id, upload=True)
    raise SystemExit(
        f"[ERROR] Unknown CC_SINK '{CC_SINK}' (expected kafka|clickhouse|file|s3)"
    )


# Workers flush their local count to the shared slot every _COUNT_BATCH txns,
# so the hot path never touches a lock. CC_MAX is enforced at this granularity
# (a small overrun across workers is acceptable for a demo generator).
_COUNT_BATCH = 1000


# ─── Worker loop ──────────────────────────────────────────────────────────────────
def worker_loop(worker_id: int, pools: dict[str, tuple], counts, stop) -> None:
    """Generate transactions until the global total hits CC_MAX (0 = forever) or
    stop is set. ``counts`` is a per-worker shared array; each worker writes only
    its own slot, so no locking is needed on the hot path."""
    # Stable per-worker streams make the generated choices and IDs replayable
    # while preventing forked workers from producing identical sequences.
    random.seed(CC_RANDOM_SEED + worker_id)
    sink       = make_sink(worker_id)
    clock      = tp.Clock()
    pacer      = tp.Pacer(CC_TARGET_TPS / CC_WORKERS if CC_TARGET_TPS > 0 else 0.0)
    interval_s = CC_INTERVAL_MS / 1000.0
    local = 0
    try:
        while not stop.is_set():
            pacer.tick()
            sink.write(generate_transaction(pools, clock))
            local += 1
            if local % _COUNT_BATCH == 0:
                counts[worker_id] = local
                if CC_MAX and sum(counts) >= CC_MAX:
                    break
            if interval_s > 0:
                time.sleep(interval_s)
    finally:
        counts[worker_id] = local
        sink.close()


# ─── Stats reporter ─────────────────────────────────────────────────────────────
def stats_reporter(counts, stop) -> None:
    last_total = 0
    last_ts = time.monotonic()
    while not stop.wait(timeout=CC_STATS_INTERVAL_S):
        now = time.monotonic()
        total = sum(counts)
        rate = (total - last_total) / (now - last_ts) if now > last_ts else 0.0
        last_total, last_ts = total, now
        target = ""
        if CC_TARGET_TPS > 0:
            mult = tp.hour_multiplier()
            target = f" | target {CC_TARGET_TPS * mult:>9,.0f}/s (x{mult:.2f})"
        print(f"[INFO] {total:>12,} transactions | {rate:>10,.0f} txn/s{target}", flush=True)


# ─── Main ─────────────────────────────────────────────────────────────────────────
def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--sink", choices=["kafka", "clickhouse", "file", "s3"], default=None,
                   help="Where to route transactions (overrides CC_SINK)")
    p.add_argument("--workers", type=int, default=None, help="Number of workers (overrides CC_WORKERS)")
    p.add_argument("--max", type=int, default=None, help="Total transactions, 0=forever (overrides CC_MAX_TRANSACTIONS)")
    p.add_argument("--interval-ms", type=float, default=None, dest="interval_ms",
                   help="Per-worker sleep between transactions in ms, 0=flat out (overrides CC_INTERVAL_MS)")
    p.add_argument("--target-tps", type=float, default=None, dest="target_tps",
                   help="Daily-average transactions/second, shaped by the hour-of-day curve; "
                        "0=flat out (overrides CC_TARGET_TPS)")
    p.add_argument("--mode", choices=["live", "mixed"], default=None,
                   help="live: stamp everything now | mixed: backfill a share of history "
                        "(overrides EVENT_MODE)")
    return p.parse_args()


def main() -> None:
    global CC_SINK, CC_WORKERS, CC_MAX, CC_INTERVAL_MS, CC_TARGET_TPS
    args = _parse_args()
    if args.sink is not None:
        CC_SINK = args.sink
    if args.workers is not None:
        CC_WORKERS = args.workers
    if args.max is not None:
        CC_MAX = args.max
    if args.interval_ms is not None:
        CC_INTERVAL_MS = args.interval_ms
    if args.target_tps is not None:
        CC_TARGET_TPS = args.target_tps
    if args.mode is not None:
        os.environ["EVENT_MODE"] = args.mode

    CC_WORKERS = max(1, CC_WORKERS)

    # Propagate resolved overrides via the environment so that workers spawned
    # with the 'spawn' start method (macOS default) — which re-import this module
    # and re-read config from os.environ rather than inheriting parent globals —
    # see the same values as the parent.
    os.environ["CC_SINK"] = CC_SINK
    os.environ["CC_WORKERS"] = str(CC_WORKERS)
    os.environ["CC_MAX_TRANSACTIONS"] = str(CC_MAX)
    os.environ["CC_INTERVAL_MS"] = str(CC_INTERVAL_MS)
    os.environ["CC_TARGET_TPS"] = str(CC_TARGET_TPS)

    clock = tp.Clock()      # validates EVENT_MODE before any worker starts

    random.seed(CC_RANDOM_SEED)
    print(f"[INFO] Building value pools (size={CC_POOL_SIZE:,}) …", flush=True)
    pools = build_pools(CC_POOL_SIZE)

    rate_desc = (
        "unthrottled (flat out)" if CC_TARGET_TPS <= 0 else
        f"{CC_TARGET_TPS:,.0f} txn/s daily avg, {CC_TARGET_TPS * tp.PEAK_MULTIPLIER:,.0f}/s at peak"
    )
    print(
        f"[INFO] sink={CC_SINK} topic={CC_TOPIC} workers={CC_WORKERS} "
        f"mode={CC_WORKER_MODE} rate={rate_desc} max={CC_MAX or 'unlimited'}\n"
        f"[INFO] timestamps={clock.describe()}",
        flush=True,
    )
    if CC_SINK == "kafka":
        print(f"[INFO] Producing to '{CC_TOPIC}' on {BOOTSTRAP_SERVERS}", flush=True)
    elif CC_SINK == "clickhouse":
        import clickhouse_sink

        if not clickhouse_sink.CLICKHOUSE_HOST:
            raise SystemExit("[ERROR] CC_SINK=clickhouse requires CLICKHOUSE_HOST")
        print(
            f"[INFO] Inserting into {clickhouse_sink.CLICKHOUSE_DATABASE}.{CC_CH_TABLE}\n"
            f"[INFO] {clickhouse_sink.describe()}",
            flush=True,
        )
    elif CC_SINK == "s3" and not CC_S3_BUCKET:
        raise SystemExit("[ERROR] CC_SINK=s3 requires CC_S3_BUCKET")

    if CC_WORKER_MODE == "process":
        counts = mp.Array("q", CC_WORKERS)   # one signed-64 slot per worker
        stop = mp.Event()
        procs = [
            mp.Process(target=worker_loop, args=(i, pools, counts, stop), daemon=True)
            for i in range(CC_WORKERS)
        ]
        reporter = mp.Process(target=stats_reporter, args=(counts, stop), daemon=True)
    elif CC_WORKER_MODE == "thread":
        counts = [0] * CC_WORKERS   # each thread writes only its own index
        stop = threading.Event()
        procs = [
            threading.Thread(target=worker_loop, args=(i, pools, counts, stop), daemon=True)
            for i in range(CC_WORKERS)
        ]
        reporter = threading.Thread(target=stats_reporter, args=(counts, stop), daemon=True)
    else:
        raise SystemExit(f"[ERROR] Unknown CC_WORKER_MODE '{CC_WORKER_MODE}' (expected process|thread)")

    def _shutdown(*_):
        print("\n[INFO] Shutting down …", flush=True)
        stop.set()

    signal.signal(signal.SIGINT, _shutdown)
    signal.signal(signal.SIGTERM, _shutdown)

    for w in procs:
        w.start()
    reporter.start()

    try:
        for w in procs:
            w.join()
    finally:
        stop.set()
        print(f"[INFO] Total transactions: {sum(counts):,}", flush=True)


if __name__ == "__main__":
    main()
