"""Tests for the ClickHouse version gate in `make doctor`."""

from doctor_checks import clickhouse_ok, parse_version


def test_versions_parse_numerically_not_as_text():
    assert parse_version("26.10.1.5") > parse_version("26.2.9.1")


def test_minimum_version_is_inclusive():
    assert clickhouse_ok("26.2.1.1")
    assert clickhouse_ok("26.6.1.123")
    assert clickhouse_ok("27.1.1.1")


def test_older_versions_fail():
    assert not clickhouse_ok("25.12.4.7")
    assert not clickhouse_ok("26.1.9.9")


def test_garbage_does_not_pass():
    assert not clickhouse_ok("not-a-version")
