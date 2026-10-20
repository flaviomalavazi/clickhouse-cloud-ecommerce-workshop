"""The pure parts of the module checks."""

from module_checks import CHECKS, SERVICES, Checker, compare_counts, missing_services


def test_counts_in_step_report_nothing():
    assert compare_counts({"orders": 3, "stock": 2}, {"orders": 3, "stock": 2}) == []


def test_a_difference_names_the_table_and_both_counts():
    out = compare_counts({"orders": 3}, {"orders": 2})
    assert out == ["orders (Postgres 3, ClickHouse 2)"]


def test_a_missing_clickhouse_table_is_a_difference():
    assert compare_counts({"orders": 3}, {}) == ["orders (Postgres 3, ClickHouse missing)"]


def test_the_checkout_path_has_fifteen_services():
    assert len(SERVICES) == 15 and len(set(SERVICES)) == 15
    assert missing_services(set(SERVICES)) == []
    assert missing_services(set(SERVICES) - {"demo-card-gateway"}) == ["demo-card-gateway"]


def test_the_checker_counts_failures(capsys):
    c = Checker()
    assert c.ok(True, "fine", "broken")
    assert not c.ok(False, "fine", "broken")
    assert c.failures == 1
    out = capsys.readouterr().out
    assert "✓ fine" in out and "✗ broken" in out


def test_every_module_with_a_database_side_has_a_check():
    # Module 05 lives in scripts/checks/check-05.sh, 09 comes with the agents module, 00 and 10 need no database.
    assert set(CHECKS) == {"01", "02", "03", "04", "06", "07", "08"}
