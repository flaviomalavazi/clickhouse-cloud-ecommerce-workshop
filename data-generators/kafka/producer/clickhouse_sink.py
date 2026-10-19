"""
Direct-to-ClickHouse insert path, shared by both producers.

Both the web-events producer and the credit-card producer can bypass Kafka
entirely and INSERT straight into ClickHouse over HTTP. The batching, retry, and
compression behaviour is identical for both, so it lives here once rather than
being reimplemented per producer.

Rows are POSTed as JSONEachRow — the same JSON the Kafka path produces, so the
column mapping is identical and there is no Python→native type conversion on the
hot path. ClickHouse parses the DateTime64 strings, the Decimals, and the JSON
nulls that carry the faulty-row signal.

Inserts use async_insert, so the server coalesces batches from every worker into
its own buffer and writes a few large parts rather than one part per request. In
testing, 21 client requests carrying 203,000 rows became 23 server-side flushes
and a single 203,000-row part.

Configuration is read from the environment (shared by both producers, so they
behave the same way):

  CH_BATCH_ROWS        rows per HTTP insert                            (10000)
  CH_FLUSH_INTERVAL_S  flush a partial batch after this long           (1.0)
  CH_WAIT_FOR_ASYNC    wait for a durable write                        (false)
  CH_BUSY_TIMEOUT_MS   server-side async_insert flush timer   (1000, or 100 when
                       CH_WAIT_FOR_ASYNC=true — see the note below)
  CH_MAX_DATA_SIZE     server-side async_insert buffer size            (10 MiB)
  CH_COMPRESSION       zstd | lz4 | gzip | deflate, or empty for none  (zstd)
  CH_MAX_RETRIES       attempts per batch before dropping it           (5)
  CH_CONNECT_ATTEMPTS  startup connection attempts                     (8)

plus the usual CLICKHOUSE_HOST / _PORT / _DATABASE / _USERNAME / _PASSWORD / _SSL.
"""

from __future__ import annotations

import os
import time

import orjson

import traffic_profile as tp


# ─── Configuration ────────────────────────────────────────────────────────────
CLICKHOUSE_HOST     = os.getenv("CLICKHOUSE_HOST", "")
CLICKHOUSE_PORT     = tp.env_int("CLICKHOUSE_PORT", 8123)
CLICKHOUSE_DATABASE = os.getenv("CLICKHOUSE_DATABASE", "retail_analytics")
CLICKHOUSE_USERNAME = os.getenv("CLICKHOUSE_USERNAME", "default")
CLICKHOUSE_PASSWORD = os.getenv("CLICKHOUSE_PASSWORD", "")
CLICKHOUSE_SSL      = tp.env_bool("CLICKHOUSE_SSL", False)

CH_BATCH_ROWS       = tp.env_int("CH_BATCH_ROWS", 10_000)
CH_FLUSH_INTERVAL_S = tp.env_float("CH_FLUSH_INTERVAL_S", 1.0)
CH_WAIT_FOR_ASYNC   = tp.env_bool("CH_WAIT_FOR_ASYNC", False)

# The server-side async_insert flush timer, and the single most important setting
# when CH_WAIT_FOR_ASYNC is on.
#
# With wait_for_async_insert=1 the client's HTTP request blocks until the server
# actually flushes its async buffer — which it does when this timer fires. So the
# timer becomes a hard cap on how many inserts a worker can complete per second:
# at 1000 ms a worker manages roughly one flush per second, and since the client
# also flushes on its own CH_FLUSH_INTERVAL_S age bound with a partial batch, the
# achieved rate collapses to about one batch per second per worker. Measured on
# the web producer at a 17,580 ev/s target: 1000 ms → ~2,000 ev/s (11 % of
# target), 200 ms → 17,729 ev/s (on target).
#
# So the default depends on the durability mode: 1000 ms is right for
# fire-and-forget (fewer, larger parts, and nothing is waiting on it), but with
# durable writes it has to be short enough not to throttle the client.
CH_BUSY_TIMEOUT_MS  = tp.env_int("CH_BUSY_TIMEOUT_MS", 100 if CH_WAIT_FOR_ASYNC else 1_000)
CH_MAX_DATA_SIZE    = tp.env_int("CH_MAX_DATA_SIZE", 10_485_760)
CH_MAX_RETRIES      = tp.env_int("CH_MAX_RETRIES", 5)
CH_CONNECT_ATTEMPTS = tp.env_int("CH_CONNECT_ATTEMPTS", 8)

# Measured on a realistic 10,000-row batch (3.4 MB of JSON), against the ~34 ms of
# CPU it takes to generate that batch:
#     zstd   7.0x smaller   +11% CPU   ← default: best ratio per cycle
#     lz4    4.0x smaller    +8% CPU
#     gzip   6.5x smaller   +70% CPU   ← too expensive to be worth it here
# Set empty when ClickHouse is on the same host and bandwidth is free.
CH_COMPRESSION      = os.getenv("CH_COMPRESSION", "zstd").strip().lower()


def make_compressor(codec: str):
    """
    Return a function turning a payload into one complete compressed frame, or
    None for no compression.

    Deliberately built on the codecs' one-shot APIs rather than
    clickhouse-connect's internal Compressor classes: those are stateful stream
    compressors whose `compress_block` does not terminate the frame for gzip and
    whose `flush` returns None, so naive reuse produces bodies the server rejects
    with ZLIB_INFLATE_FAILED / LZ4_DECODER_FAILED. Each batch is an independent
    HTTP request and therefore needs an independent, complete frame.
    """
    if not codec:
        return None

    if codec in ("gzip", "deflate"):
        import zlib

        # wbits=31 → gzip container; -15 → raw deflate.
        wbits = 31 if codec == "gzip" else -15

        def compress(payload: bytes) -> bytes:
            obj = zlib.compressobj(level=6, wbits=wbits)
            return obj.compress(payload) + obj.flush()

        return compress

    if codec == "zstd":
        try:
            import zstandard
        except ImportError:
            raise SystemExit("[ERROR] CH_COMPRESSION=zstd requires the 'zstandard' package")
        return lambda payload: zstandard.compress(payload, 3)

    if codec == "lz4":
        try:
            import lz4.frame
        except ImportError:
            raise SystemExit("[ERROR] CH_COMPRESSION=lz4 requires the 'lz4' package")
        return lz4.frame.compress

    raise SystemExit(
        f"[ERROR] Unknown CH_COMPRESSION '{codec}' (expected gzip|zstd|lz4|deflate, or empty)"
    )


def describe() -> str:
    """One-line summary of the insert configuration, for startup logging."""
    scheme = "https" if CLICKHOUSE_SSL else "http"
    return (
        f"{scheme}://{CLICKHOUSE_HOST}:{CLICKHOUSE_PORT}/{CLICKHOUSE_DATABASE} | "
        f"async_insert=1 wait_for_async_insert={1 if CH_WAIT_FOR_ASYNC else 0} | "
        f"batch={CH_BATCH_ROWS:,} rows / {CH_FLUSH_INTERVAL_S:g}s | "
        f"compression={CH_COMPRESSION or 'none'}"
    )


class ClickHouseInserter:
    """
    Buffered async_insert writer over one or more tables.

    One instance per worker owns one HTTP client and one buffer per table, which
    is what lets the web-events producer write events and their matching card
    transactions through a single connection.

    Batching is by size *and* age. The age bound is what makes a paced producer
    usable: at 50 rows/s a 10,000-row batch would take three minutes to fill.
    """

    def __init__(self, tables: tuple[str, ...], worker_id: int = 0):
        import clickhouse_connect

        if not CLICKHOUSE_HOST:
            raise SystemExit(
                "[ERROR] The clickhouse sink requires CLICKHOUSE_HOST to be set"
            )

        self._compress = make_compressor(CH_COMPRESSION)
        self._settings = {
            "async_insert": 1,
            "wait_for_async_insert": 1 if CH_WAIT_FOR_ASYNC else 0,
            "async_insert_busy_timeout_ms": CH_BUSY_TIMEOUT_MS,
            "async_insert_max_data_size": CH_MAX_DATA_SIZE,
        }
        now = time.monotonic()
        # table alias → (qualified name, buffer, last-flush timestamp)
        self._buf: dict[str, list[bytes]] = {t: [] for t in tables}
        self._last: dict[str, float] = {t: now for t in tables}
        self._qualified = {t: f"{CLICKHOUSE_DATABASE}.{t}" for t in tables}
        self.dropped = 0

        # Retry on startup: a compose-managed ClickHouse may still be booting.
        last_error: Exception | None = None
        for attempt in range(max(1, CH_CONNECT_ATTEMPTS)):
            try:
                self._client = clickhouse_connect.get_client(
                    host=CLICKHOUSE_HOST,
                    port=CLICKHOUSE_PORT,
                    username=CLICKHOUSE_USERNAME,
                    password=CLICKHOUSE_PASSWORD,
                    database=CLICKHOUSE_DATABASE,
                    secure=CLICKHOUSE_SSL,
                    connect_timeout=30,
                    send_receive_timeout=120,
                    # The client-level `compress` setting governs *response*
                    # compression, which is irrelevant here — this only ever
                    # writes. Request bodies are compressed explicitly in _flush.
                    compress=False,
                )
                self._client.command("SELECT 1")
                return
            except Exception as exc:      # noqa: BLE001 — retry any connection failure
                last_error = exc
                delay = min(2 ** attempt, 15)
                if worker_id == 0:        # one worker reports, so logs stay readable
                    print(
                        f"[WARN] ClickHouse not reachable at {CLICKHOUSE_HOST}:{CLICKHOUSE_PORT} "
                        f"(attempt {attempt + 1}/{CH_CONNECT_ATTEMPTS}), retrying in {delay}s: "
                        f"{type(exc).__name__}",
                        flush=True,
                    )
                time.sleep(delay)
        raise SystemExit(
            f"[ERROR] Worker {worker_id} could not reach ClickHouse at "
            f"{CLICKHOUSE_HOST}:{CLICKHOUSE_PORT}: {last_error}"
        )

    def write(self, table: str, row: dict) -> None:
        """Buffer one row for `table`, flushing if a bound is reached."""
        buf = self._buf[table]
        buf.append(orjson.dumps(row))
        # Both bounds are checked on every row. Sampling the clock every N rows
        # would be cheaper, but it silently converts the age bound into a
        # row-count bound at exactly the low rates the age bound exists for: at
        # 35 rows/s, "check the clock every 256 rows" means a flush every 7 s no
        # matter what CH_FLUSH_INTERVAL_S says. monotonic() costs ~0.03 µs
        # against ~3.4 µs to generate a row, so this is under 1 %.
        if (
            len(buf) >= CH_BATCH_ROWS
            or time.monotonic() - self._last[table] >= CH_FLUSH_INTERVAL_S
        ):
            self._flush(table)

    def write_many(self, table: str, rows) -> None:
        for row in rows:
            self.write(table, row)

    def _flush(self, table: str) -> None:
        buf = self._buf[table]
        if not buf:
            self._last[table] = time.monotonic()
            return
        payload = b"\n".join(buf)
        buf.clear()

        if self._compress is not None:
            # raw_insert's `compression` argument only sets the Content-Encoding
            # header — it does not compress for us — so the body must already be
            # a complete frame in that codec.
            payload = self._compress(payload)

        # The age bound is stamped in the `finally` below — *after* the round trip,
        # never before it. It measures how long a row is allowed to wait in the
        # buffer; if it also counted the insert latency it would already be
        # expired the moment the insert returned, so the very next row would
        # flush a batch of one. That state is self-sustaining — the size bound
        # never gets a chance to fill again — and it triggers whenever a single
        # insert takes longer than CH_FLUSH_INTERVAL_S, which against a remote
        # ClickHouse with wait_for_async_insert=1 is the normal case rather than
        # the edge case. Measured on the web producer at a 20,000 ev/s target
        # against ClickHouse Cloud: 3.2 rows per insert and 7 ev/s achieved.
        try:
            for attempt in range(CH_MAX_RETRIES):
                try:
                    self._client.raw_insert(
                        self._qualified[table],
                        insert_block=payload,
                        fmt="JSONEachRow",
                        settings=self._settings,
                        compression=CH_COMPRESSION or None,
                    )
                    return
                except Exception as exc:     # noqa: BLE001
                    if attempt == CH_MAX_RETRIES - 1:
                        # Drop the batch rather than block generation forever. Losing
                        # synthetic rows is acceptable; wedging the producer is not.
                        self.dropped += 1
                        print(
                            f"[ERROR] ClickHouse insert into {self._qualified[table]} failed "
                            f"after {CH_MAX_RETRIES} attempts, dropping batch: "
                            f"{type(exc).__name__}: {exc}",
                            flush=True,
                        )
                        return
                    time.sleep(0.25 * (2 ** attempt))
        finally:
            self._last[table] = time.monotonic()

    def flush(self) -> None:
        for table in self._buf:
            self._flush(table)

    def close(self) -> None:
        self.flush()
        try:
            self._client.close()
        except Exception:                # noqa: BLE001 — closing is best-effort
            pass
