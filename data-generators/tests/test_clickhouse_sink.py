"""The batched insert path: few, large inserts; one in flight per table; nothing lost to a retry."""

import threading
import time

import pytest

import clickhouse_env
import clickhouse_sink as sink


class FakeClient:
    """Records every insert. `delay` makes inserts slow; `fail_first` makes the first N raise."""

    def __init__(self, delay: float = 0.0, fail_first: int = 0, always_fail: bool = False):
        self.delay, self.fail_first, self.always_fail = delay, fail_first, always_fail
        self.calls: list[tuple[str, int]] = []      # (table, rows)
        self.attempts = 0
        self._active = 0
        self.max_concurrent = 0
        self._lock = threading.Lock()

    def command(self, *_):
        return 1

    def close(self):
        pass

    def raw_insert(self, table, insert_block, fmt, settings, compression):
        with self._lock:
            self.attempts += 1
            self._active += 1
            self.max_concurrent = max(self.max_concurrent, self._active)
            attempt = self.attempts
        try:
            time.sleep(self.delay)
            if self.always_fail or attempt <= self.fail_first:
                raise RuntimeError("boom")
            rows = len(insert_block.split(b"\n"))
            with self._lock:
                self.calls.append((table, rows))
            return type("Summary", (), {"written_rows": rows})()
        finally:
            with self._lock:
                self._active -= 1


@pytest.fixture
def make(monkeypatch):
    """Build an inserter whose per-table clients are FakeClients (one per table, as in production)."""
    monkeypatch.setattr(clickhouse_env, "CLICKHOUSE_HOST", "test-host")
    monkeypatch.setattr(sink, "CH_COMPRESSION", "")
    monkeypatch.setattr(sink, "CH_MAX_RETRIES", 3)
    monkeypatch.setattr(sink.time, "sleep", time.sleep)   # retries use real, short sleeps below
    sink._INSERTERS.clear()
    clients: dict[str, FakeClient] = {}

    def build(tables, batch_rows=5, interval=1000.0, **client_kwargs):
        monkeypatch.setattr(sink, "CH_BATCH_ROWS", batch_rows)
        monkeypatch.setattr(sink, "CH_FLUSH_INTERVAL_S", interval)

        def fake_connect():
            c = FakeClient(**client_kwargs)
            clients[f"c{len(clients)}"] = c
            return c

        monkeypatch.setattr(sink, "_connect", fake_connect)
        inserter = sink.ClickHouseInserter(tuple(tables))
        by_table = {t: w._client for t, w in inserter._writers.items()}
        return inserter, by_table

    yield build
    sink._INSERTERS.clear()


def test_a_batch_is_sent_when_it_reaches_the_row_bound(make):
    ins, clients = make(["t"], batch_rows=5)
    for i in range(12):
        ins.write("t", {"i": i})
    assert [rows for _, rows in clients["t"].calls] == [5, 5]          # two full batches sent
    ins.flush()
    assert [rows for _, rows in clients["t"].calls] == [5, 5, 2]       # the remainder on flush


def test_a_partial_batch_is_sent_once_it_has_waited_long_enough(make):
    ins, clients = make(["t"], batch_rows=1000, interval=0.05)
    ins.write("t", {"i": 1})
    assert clients["t"].calls == []                                     # not due yet
    time.sleep(0.08)
    ins.write("t", {"i": 2})                                            # the next row finds it overdue
    assert [rows for _, rows in clients["t"].calls] == [2]


def test_rows_are_sent_as_newline_delimited_json(make):
    ins, clients = make(["t"], batch_rows=2)
    captured = []
    clients["t"].raw_insert = lambda table, insert_block, **kw: captured.append(insert_block)
    ins.write("t", {"a": 1})
    ins.write("t", {"a": 2})
    assert captured == [b'{"a":1}\n{"a":2}']


def test_tables_have_independent_buffers(make):
    ins, clients = make(["events", "txns"], batch_rows=3)
    for i in range(3):
        ins.write("events", {"i": i})
    ins.write("txns", {"i": 0})
    assert [r for _, r in clients["events"].calls] == [3]
    assert clients["txns"].calls == []


def test_only_one_insert_per_table_is_in_flight_across_threads(make):
    ins, clients = make(["t"], batch_rows=10, delay=0.05)

    def worker():
        for i in range(100):
            ins.write("t", {"i": i})

    threads = [threading.Thread(target=worker) for _ in range(4)]
    for t in threads: t.start()
    for t in threads: t.join()
    ins.flush()
    assert clients["t"].max_concurrent == 1                              # a slow insert pushes back
    assert sum(rows for _, rows in clients["t"].calls) == 400            # and nothing was lost


def test_the_age_bound_is_not_applied_while_an_insert_is_in_flight(make):
    # With a tiny age bound, every row written during a slow insert would look overdue and
    # flush a one-row batch the moment the lock freed up.
    ins, clients = make(["t"], batch_rows=5, interval=0.01, delay=0.3)
    sender = threading.Thread(target=lambda: [ins.write("t", {"i": i}) for i in range(5)])
    sender.start()
    time.sleep(0.1)                                                      # the 5-row insert is in flight
    for i in range(3):
        ins.write("t", {"i": 100 + i})                                   # age bound is long past
    sender.join()
    ins.flush()
    assert [rows for _, rows in clients["t"].calls] == [5, 3]            # not [5, 1, 1, 1]


def test_a_failed_insert_is_retried_and_then_succeeds(make, monkeypatch):
    monkeypatch.setattr(sink.time, "sleep", lambda s: None)
    ins, clients = make(["t"], batch_rows=2, fail_first=2)
    ins.write("t", {"i": 1}); ins.write("t", {"i": 2})
    assert clients["t"].attempts == 3 and [r for _, r in clients["t"].calls] == [2]
    assert ins.stats()["t"] == {"inserts": 1, "rows": 2, "dropped_batches": 0}


def test_a_batch_that_keeps_failing_is_dropped_without_wedging_the_producer(make, monkeypatch):
    monkeypatch.setattr(sink.time, "sleep", lambda s: None)
    ins, clients = make(["t"], batch_rows=2, always_fail=True)
    ins.write("t", {"i": 1}); ins.write("t", {"i": 2})                   # does not raise
    assert ins.stats()["t"]["dropped_batches"] == 1
    ins.write("t", {"i": 3})                                             # and the writer is still usable
    assert clients["t"].attempts == 3


def test_one_inserter_per_process_per_set_of_tables(make, monkeypatch):
    monkeypatch.setattr(sink, "_connect", lambda: FakeClient())
    monkeypatch.setattr(clickhouse_env, "CLICKHOUSE_HOST", "test-host")
    a = sink.get_inserter(("events", "txns"))
    b = sink.get_inserter(("txns", "events"))
    assert a is b
    totals = sink.close_all()
    assert set(totals) == {"events", "txns"} and sink._INSERTERS == {}
