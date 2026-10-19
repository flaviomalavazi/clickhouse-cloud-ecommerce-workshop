"""Tests for the age formatting in `make status`."""

from status import format_age


def test_no_age_is_a_dash():
    assert format_age(None) == "-"


def test_units_step_up():
    assert format_age(4) == "4s"
    assert format_age(59) == "59s"
    assert format_age(60) == "1m"
    assert format_age(3599) == "59m"
    assert format_age(3600) == "1h"
    assert format_age(2 * 86400 + 5) == "2d"


def test_clock_skew_never_shows_a_negative_age():
    assert format_age(-3) == "0s"
