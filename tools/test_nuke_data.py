"""`make nuke-data` resets orders and inventory and must never touch ClickHouse."""

from pathlib import Path

import nuke_data


def test_nuke_data_does_not_connect_to_clickhouse():
    # The web analytics events and the ClickStack telemetry are slow to rebuild, so the
    # reset leaves them alone: nothing in this module may talk to ClickHouse.
    source = Path(nuke_data.__file__).read_text()
    for forbidden in ("ch_client", "clickhouse_connect", "TRUNCATE TABLE"):
        assert forbidden not in source, forbidden


def test_it_refuses_to_run_without_confirmation(monkeypatch):
    monkeypatch.setattr("sys.argv", ["nuke_data.py"])
    try:
        nuke_data.main()
    except SystemExit as exc:
        assert "--yes" in str(exc)
    else:
        raise AssertionError("ran without --yes")
