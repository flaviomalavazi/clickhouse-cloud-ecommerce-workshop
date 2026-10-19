"""Tests for the SQL splitter. Run with `python -m pytest tools`."""

from apply_sql import split_sql_statements


def test_splits_on_semicolons():
    assert split_sql_statements("SELECT 1; SELECT 2;") == ["SELECT 1", "SELECT 2"]


def test_trailing_statement_without_semicolon():
    assert split_sql_statements("SELECT 1; SELECT 2") == ["SELECT 1", "SELECT 2"]


def test_semicolon_inside_line_comment_does_not_split():
    sql = "-- replaced the active one; stale rows remain\nSELECT 1;"
    assert split_sql_statements(sql) == ["SELECT 1"]


def test_semicolon_inside_block_comment_does_not_split():
    assert split_sql_statements("/* a; b */ SELECT 1;") == ["SELECT 1"]


def test_semicolon_and_dashes_inside_string_literal_are_kept():
    sql = "SELECT 'a;b -- c'; SELECT 2;"
    assert split_sql_statements(sql) == ["SELECT 'a;b -- c'", "SELECT 2"]


def test_escaped_quote_inside_literal():
    sql = r"SELECT 'it\'s; fine'; SELECT 2;"
    assert split_sql_statements(sql) == [r"SELECT 'it\'s; fine'", "SELECT 2"]


def test_quoted_identifier_keeps_semicolon():
    assert split_sql_statements('SELECT 1 AS "a;b";') == ['SELECT 1 AS "a;b"']


def test_empty_and_comment_only_input():
    assert split_sql_statements("") == []
    assert split_sql_statements("-- nothing here\n;;") == []
