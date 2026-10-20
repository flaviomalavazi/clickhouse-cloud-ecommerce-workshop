"""The guard that keeps `make backfill` from loading the history twice (no network)."""

import backfill_guard


class Client:
    def __init__(self, rows):
        self.rows, self.sql = rows, []

    def query(self, sql):
        self.sql.append(sql)

        class Result:
            result_rows = [(self.rows,)]
        return Result()


def test_history_is_events_older_than_two_days():
    client = Client(5_000_000)
    assert backfill_guard.history_rows(client) == 5_000_000
    assert "collector_tstamp < now() - INTERVAL 2 DAY" in client.sql[0] and "snowplow_events" in client.sql[0]


def run(monkeypatch, rows=None, error=None):
    import connections

    def client():
        if error:
            raise error
        return Client(rows)
    monkeypatch.setattr(connections, "ch_client", client)
    return backfill_guard.main()


def test_loaded_history_means_skip(monkeypatch, capsys):
    assert run(monkeypatch, rows=5_000_000) == 0
    assert "make backfill FORCE=1" in capsys.readouterr().out


def test_a_few_old_rows_do_not_count_as_history(monkeypatch):
    assert run(monkeypatch, rows=backfill_guard.MIN_ROWS - 1) == 1


def test_an_empty_table_or_no_connection_means_load_it(monkeypatch):
    assert run(monkeypatch, rows=0) == 1
    assert run(monkeypatch, error=RuntimeError("unreachable")) == 1
