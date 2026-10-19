"""`make nuke-data` empties the Postgres mirror in ClickHouse and nothing else there."""

import ast
from pathlib import Path

import nuke_data


def test_only_the_mirror_tables_are_emptied():
    rows = [
        ("categories", "SharedReplacingMergeTree"),
        ("orders", "SharedReplacingMergeTree"),
        ("order_items", "SharedReplacingMergeTree"),
        ("stock", "SharedReplacingMergeTree"),
    ]
    assert nuke_data.oltp_tables_to_truncate(rows) == ["categories", "order_items", "orders", "stock"]


def test_the_pipes_own_tables_and_views_are_kept():
    rows = [
        ("_peerdb_raw_mirror_ad9d2c04__e4f2__4fbc__a86b__b6d896f15625", "SharedMergeTree"),
        ("orders", "SharedReplacingMergeTree"),
        ("orders_view", "View"),
        ("orders_mv", "MaterializedView"),
    ]
    assert nuke_data.oltp_tables_to_truncate(rows) == ["orders"]


def test_in_step_needs_every_table_to_match():
    postgres = {"orders": 2000, "customers": 500}
    assert nuke_data.in_step(postgres, {"orders": 2000, "customers": 500})
    assert not nuke_data.in_step(postgres, {"orders": 2000, "customers": 499})
    assert not nuke_data.in_step(postgres, {"orders": 2000})  # a missing table is not in step


def test_the_module_names_no_events_or_telemetry_table():
    # The web analytics events and the ClickStack telemetry are slow to rebuild, so the
    # reset must never name them. Strings in the code (not the docstring) are checked.
    tree = ast.parse(Path(nuke_data.__file__).read_text())
    docstring = ast.get_docstring(tree, clean=False)
    strings = [
        node.value for node in ast.walk(tree)
        if isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value != docstring
    ]
    for forbidden in ("retail_otel", "snowplow_events", "credit_card_transactions", "analytics_"):
        assert not any(forbidden in text for text in strings), forbidden


def test_it_refuses_to_run_without_confirmation(monkeypatch):
    monkeypatch.setattr("sys.argv", ["nuke_data.py"])
    try:
        nuke_data.main()
    except SystemExit as exc:
        assert "--yes" in str(exc)
    else:
        raise AssertionError("ran without --yes")
