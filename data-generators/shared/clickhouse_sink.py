"""
Direct-to-ClickHouse insert path, shared by both producers.

Rows are POSTed to ClickHouse over HTTP as JSONEachRow, so there is no
Python-to-native type conversion on the hot path: ClickHouse parses the
DateTime64 strings, the Decimals, and the JSON nulls that carry the faulty-row
signal.

Large batches, few inserts
--------------------------
Every insert into `snowplow_events` fires five materialized views and creates a
part that background merges have to clean up, so the goal is the fewest, largest
inserts the freshness budget allows. There is one writer per table per
*process*, shared by every worker thread in it, and at most one insert in flight
per table. A batch is sent when it reaches CH_BATCH_ROWS or has waited
CH_FLUSH_INTERVAL_S, whichever comes first: at the default live rate that is one
insert every few seconds per table, and in a backfill it is one per 100,000 rows.

Each flush logs one line (table, rows, bytes, time, and the rows the server says
it wrote), so the batching is visible in `kubectl logs`.

Configuration, from the environment:

  CH_BATCH_ROWS        rows per insert                                (100000)
  CH_FLUSH_INTERVAL_S  send a partial batch after this long           (5)
  CH_ASYNC_INSERT      let the server batch too (async_insert)        (0)
  CH_WAIT_FOR_ASYNC    with async: wait for the durable write         (false)
  CH_BUSY_TIMEOUT_MS   with async: the server's flush timer   (1000, or 100 when
                       CH_WAIT_FOR_ASYNC=true — see the note below)
  CH_MAX_DATA_SIZE     with async: the server's buffer size           (10 MiB)
  CH_COMPRESSION       zstd | lz4 | gzip | deflate, or empty for none (zstd)
  CH_MAX_RETRIES       attempts per batch before dropping it          (5)
  CH_CONNECT_ATTEMPTS  startup connection attempts                    (8)

plus the CLICKHOUSE_* connection settings in clickhouse_env.py.
"""

from __future__ import annotations

import os
import threading
import time

import orjson

import clickhouse_env as env
import traffic_profile as tp


# ─── Configuration ────────────────────────────────────────────────────────────
CH_BATCH_ROWS       = tp.env_int("CH_BATCH_ROWS", 100_000)
CH_FLUSH_INTERVAL_S = tp.env_float("CH_FLUSH_INTERVAL_S", 5.0)

# Off by default: with big client-side batches there is nothing for the server to
# coalesce, and a synchronous insert is what makes "rows inserted" mean "rows
# durable". Kept as an opt-in for many small writers.
CH_ASYNC_INSERT     = tp.env_bool("CH_ASYNC_INSERT", False)
CH_WAIT_FOR_ASYNC   = tp.env_bool("CH_WAIT_FOR_ASYNC", False)

# With async_insert and wait_for_async_insert=1 the client's request blocks until
# the server flushes its buffer, which it does when this timer fires, so the
# timer caps how many inserts a worker can complete per second. Measured on a
# 17,580 ev/s target: 1000 ms gave ~2,000 ev/s (11 % of target); 200 ms gave
# 17,729 ev/s. So the default depends on the durability mode.
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
    mode = (
        f"async_insert=1 wait={1 if CH_WAIT_FOR_ASYNC else 0}" if CH_ASYNC_INSERT else "synchronous inserts"
    )
    return (
        f"{env.describe()} | {mode} | "
        f"batch={CH_BATCH_ROWS:,} rows / {CH_FLUSH_INTERVAL_S:g}s | "
        f"compression={CH_COMPRESSION or 'none'}"
    )


def _written_rows(summary) -> int | None:
    """The server's own count of rows written, from the insert's summary."""
    value = getattr(summary, "written_rows", None)
    if callable(value):
        value = value()
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _connect():
    """A client, retrying: a freshly started cluster may not have ClickHouse reachable yet."""
    last_error: Exception | None = None
    for attempt in range(max(1, CH_CONNECT_ATTEMPTS)):
        try:
            client = env.connect(compress=False)   # `compress` is response compression; irrelevant here
            client.command("SELECT 1")
            return client
        except Exception as exc:      # noqa: BLE001 — retry any connection failure
            last_error = exc
            delay = min(2 ** attempt, 15)
            print(
                f"[WARN] ClickHouse not reachable at {env.CLICKHOUSE_HOST}:{env.CLICKHOUSE_PORT} "
                f"(attempt {attempt + 1}/{CH_CONNECT_ATTEMPTS}), retrying in {delay}s: {type(exc).__name__}",
                flush=True,
            )
            time.sleep(delay)
    raise SystemExit(
        f"[ERROR] Could not reach ClickHouse at {env.CLICKHOUSE_HOST}:{env.CLICKHOUSE_PORT}: {last_error}"
    )


class _TableWriter:
    """
    Buffer and writer for one table. Safe to call from any number of threads.

    Rows are serialised outside the lock; the lock only guards the list swap. A
    batch is sent by whichever thread fills it, under a second lock that allows a
    single insert in flight, so a slow insert pushes back on the generators
    instead of piling up concurrent inserts.
    """

    def __init__(self, table: str, settings: dict, compress):
        self.table = table
        self._qualified = f"{env.CLICKHOUSE_DATABASE}.{table}"
        self._settings = settings
        self._compress = compress
        self._client = _connect()      # one client per table: no cross-thread sharing

        self._buf: list[bytes] = []
        self._buf_lock = threading.Lock()
        self._send_lock = threading.Lock()
        self._pending_sends = 0
        self._last = time.monotonic()

        self.inserts = 0
        self.rows = 0
        self.dropped_batches = 0

    def write(self, row: dict) -> None:
        data = orjson.dumps(row)
        batch = None
        with self._buf_lock:
            self._buf.append(data)
            # Both bounds are checked on every row: sampling the clock every N rows
            # would turn the age bound into a row-count bound at exactly the low
            # rates it exists for. monotonic() costs ~0.03 µs per row.
            #
            # The age bound is not applied while an insert is in flight. `_last` is
            # stamped only when an insert *finishes*, so during a long one every
            # waiting row would look overdue and each would flush a tiny batch the
            # moment the lock freed up.
            due = len(self._buf) >= CH_BATCH_ROWS or (
                self._pending_sends == 0 and time.monotonic() - self._last >= CH_FLUSH_INTERVAL_S
            )
            if due:
                batch, self._buf = self._buf, []
                self._pending_sends += 1
        if batch:
            self._send(batch)

    def flush(self) -> None:
        with self._buf_lock:
            batch, self._buf = self._buf, []
            if batch:
                self._pending_sends += 1
        if batch:
            self._send(batch)

    def _send(self, batch: list[bytes]) -> None:
        try:
            with self._send_lock:
                self._insert(batch)
        finally:
            with self._buf_lock:
                self._pending_sends -= 1

    def _insert(self, batch: list[bytes]) -> None:
        payload = b"\n".join(batch)
        raw_bytes = len(payload)
        if self._compress is not None:
            # raw_insert's `compression` argument only sets the Content-Encoding
            # header — it does not compress — so the body has to be a complete
            # frame in that codec already.
            payload = self._compress(payload)

        # `_last` is stamped in the `finally`, after the round trip and never
        # before it: it measures how long a row may wait in the buffer, and if it
        # also counted the insert's own latency it would be expired the moment the
        # insert returned, so the next row would flush a batch of one.
        started = time.monotonic()
        try:
            for attempt in range(CH_MAX_RETRIES):
                try:
                    summary = self._client.raw_insert(
                        self._qualified,
                        insert_block=payload,
                        fmt="JSONEachRow",
                        settings=self._settings,
                        compression=CH_COMPRESSION or None,
                    )
                    self.inserts += 1
                    self.rows += len(batch)
                    print(
                        f"[flush] {self.table} rows={len(batch):,} bytes={raw_bytes:,} "
                        f"wire={len(payload):,} ms={(time.monotonic() - started) * 1000:,.0f} "
                        f"server_written_rows={_written_rows(summary)}",
                        flush=True,
                    )
                    return
                except Exception as exc:     # noqa: BLE001
                    if attempt == CH_MAX_RETRIES - 1:
                        # Drop the batch rather than block generation forever. Losing
                        # synthetic rows is acceptable; wedging the producer is not.
                        self.dropped_batches += 1
                        print(
                            f"[ERROR] ClickHouse insert into {self._qualified} failed after "
                            f"{CH_MAX_RETRIES} attempts, dropping {len(batch):,} rows: "
                            f"{type(exc).__name__}: {exc}",
                            flush=True,
                        )
                        return
                    time.sleep(0.25 * (2 ** attempt))
        finally:
            self._last = time.monotonic()

    def close(self) -> None:
        self.flush()
        try:
            self._client.close()
        except Exception:                # noqa: BLE001 — closing is best-effort
            pass


class ClickHouseInserter:
    """Writers for a set of tables. Use `get_inserter()`: one per process."""

    def __init__(self, tables: tuple[str, ...]):
        env.require_host()
        settings: dict = {}
        if CH_ASYNC_INSERT:
            settings = {
                "async_insert": 1,
                "wait_for_async_insert": 1 if CH_WAIT_FOR_ASYNC else 0,
                "async_insert_busy_timeout_ms": CH_BUSY_TIMEOUT_MS,
                "async_insert_max_data_size": CH_MAX_DATA_SIZE,
            }
        compress = make_compressor(CH_COMPRESSION)
        self._writers = {t: _TableWriter(t, settings, compress) for t in tables}

    def write(self, table: str, row: dict) -> None:
        """Buffer one row for `table`, sending a batch if a bound is reached."""
        self._writers[table].write(row)

    def flush(self) -> None:
        for writer in self._writers.values():
            writer.flush()

    def stats(self) -> dict[str, dict[str, int]]:
        return {
            t: {"inserts": w.inserts, "rows": w.rows, "dropped_batches": w.dropped_batches}
            for t, w in self._writers.items()
        }

    def close(self) -> None:
        for writer in self._writers.values():
            writer.close()


# ─── One inserter per process ────────────────────────────────────────────────
# Worker threads share it (that is what keeps the insert count down); worker
# processes each get their own, because the registry is per interpreter.
_INSERTERS: dict[tuple[str, ...], ClickHouseInserter] = {}
_REGISTRY_LOCK = threading.Lock()


def get_inserter(tables: tuple[str, ...]) -> ClickHouseInserter:
    key = tuple(sorted(tables))
    with _REGISTRY_LOCK:
        if key not in _INSERTERS:
            _INSERTERS[key] = ClickHouseInserter(key)
        return _INSERTERS[key]


def close_all() -> dict[str, dict[str, int]]:
    """Flush and close every inserter in this process. Returns the final stats."""
    totals: dict[str, dict[str, int]] = {}
    with _REGISTRY_LOCK:
        for inserter in _INSERTERS.values():
            inserter.close()
            totals.update(inserter.stats())
        _INSERTERS.clear()
    return totals
