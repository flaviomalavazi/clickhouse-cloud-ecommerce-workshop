"""Tests for which ClickHouse tables `make nuke-data` truncates."""

from nuke_data import tables_to_truncate


def test_generated_and_rollup_tables_are_truncated():
    rows = [
        ("retail_analytics", "snowplow_events", "SharedMergeTree"),
        ("retail_analytics", "credit_card_transactions", "SharedMergeTree"),
        ("retail_analytics", "analytics_events_1m", "SharedAggregatingMergeTree"),
        ("retail_analytics", "analytics_live_events", "SharedMergeTree"),
    ]
    assert tables_to_truncate(rows) == sorted((d, t) for d, t, _ in rows)


def test_search_table_and_views_are_kept():
    rows = [
        ("retail_analytics", "products_search", "SharedMergeTree"),
        ("retail_analytics", "products_search_refresh", "MaterializedView"),
        ("retail_analytics", "analytics_events_1m_mv", "MaterializedView"),
    ]
    assert tables_to_truncate(rows) == []


def test_every_clickstack_table_is_truncated_but_not_its_views():
    rows = [
        ("retail_otel", "otel_logs", "SharedMergeTree"),
        ("retail_otel", "otel_logs_kv_rollup_15m", "SharedSummingMergeTree"),
        ("retail_otel", "otel_logs_attr_kv_rollup_15m_mv", "MaterializedView"),
        ("retail_otel", "hyperdx_sessions", "SharedMergeTree"),
    ]
    assert tables_to_truncate(rows) == [
        ("retail_otel", "hyperdx_sessions"),
        ("retail_otel", "otel_logs"),
        ("retail_otel", "otel_logs_kv_rollup_15m"),
    ]


def test_postgres_mirror_tables_are_never_in_the_list():
    # nuke_data only asks system.tables about retail_analytics and retail_otel, but
    # the selection must hold even if a row from retail_oltp slipped in.
    rows = [("retail_oltp", "orders", "SharedReplacingMergeTree")]
    assert tables_to_truncate(rows) == []
