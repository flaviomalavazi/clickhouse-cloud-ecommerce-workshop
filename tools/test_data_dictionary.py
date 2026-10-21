"""docs/data-dictionary.md keeps up with the schemas it describes.

The dictionary is the raw material for the ClickHouse Agents instructions, so a column added to `sql/` and not described is a column
an agent will misuse. This reads every CREATE TABLE under sql/ and requires each table and each column to be named in the dictionary.
"""

import re

import pytest

import seed_postgres

ROOT = seed_postgres.ROOT
DICTIONARY = ROOT / "docs" / "data-dictionary.md"
pytestmark = pytest.mark.skipif(not DICTIONARY.exists(), reason="the repo is not mounted")

NOT_A_COLUMN = {"INDEX", "PRIMARY", "CONSTRAINT", "UNIQUE", "CHECK", "FOREIGN", "KEY"}
# Written in the dictionary as a group, not one by one.
PIPE_COLUMNS = {"_peerdb_version", "_peerdb_is_deleted", "_peerdb_synced_at"}


def create_tables(sql_text: str) -> dict[str, list[str]]:
    """{table: [columns]} for every `CREATE TABLE IF NOT EXISTS` in a SQL file (comments and indexes left out)."""
    found, lines = {}, sql_text.splitlines()
    for i, line in enumerate(lines):
        match = re.match(r"CREATE TABLE IF NOT EXISTS ([\w.]+)", line)
        if not match:
            continue
        columns = []
        for body in lines[i + 1:]:
            if body.startswith(")"):
                break
            column = re.match(r"\s+(\w+)\s+[A-Za-z]", body.split("--")[0])
            if column and column.group(1).upper() not in NOT_A_COLUMN:
                columns.append(column.group(1))
        found[match.group(1).split(".")[-1]] = columns
    return found


def schemas():
    out = {}
    for path in sorted((ROOT / "sql").glob("*/*.sql")):
        for table, columns in create_tables(path.read_text()).items():
            out[f"{path.parent.name}/{table}"] = columns
    return out


def test_the_parser_finds_the_tables_and_leaves_indexes_out():
    sample = "CREATE TABLE IF NOT EXISTS a.t\n(\n    x UInt8,   -- note\n    y String,\n    INDEX i y TYPE set(1)\n)\nENGINE = MergeTree;\n"
    assert create_tables(sample) == {"t": ["x", "y"]}


def test_every_table_under_sql_is_in_the_dictionary():
    text = DICTIONARY.read_text()
    tables = schemas()
    assert len(tables) >= 14, "the parser should find the Postgres, clickstream, search and rollup tables"
    missing = [name for name in tables if f"`{name.split('/')[-1]}`" not in text and f"### `{name.split('/')[-1]}`" not in text]
    assert not missing, f"tables missing from docs/data-dictionary.md: {missing}"


def test_every_column_under_sql_is_in_the_dictionary():
    text = DICTIONARY.read_text()
    missing = {}
    for name, columns in schemas().items():
        gone = [c for c in columns if f"`{c}`" not in text]
        if gone:
            missing[name] = gone
    assert not missing, f"columns missing from docs/data-dictionary.md (write them as `name`): {missing}"


def test_the_replica_columns_and_the_pipe_columns_are_described():
    text = DICTIONARY.read_text()
    for column in PIPE_COLUMNS:
        assert f"`{column}`" in text


def test_the_dictionary_says_the_rules_the_agents_instructions_depend_on():
    text = DICTIONARY.read_text()
    for must in ("FINAL", "_peerdb_is_deleted = 0", "USD", "countMerge", "hasAllTokens", "se_value = 0", "chargeback", "nanoseconds"):
        assert must in text, f"the dictionary lost: {must}"


def test_no_example_converts_se_property_to_a_uuid_unguarded():
    """`toUUID(se_property)` throws CANNOT_PARSE_UUID on other events' values, filter or not: the SQL and the docs use toUUIDOrNull."""
    skip = ("node_modules", "/base_contents/", "/.workshop/", "/docs/decisions.md", "/tools/test_data_dictionary.py")
    bad = []
    for pattern in ("**/*.md", "**/*.sql", "**/*.ipynb"):
        for path in ROOT.glob(pattern):
            rel = "/" + path.relative_to(ROOT).as_posix()
            if path.is_file() and not any(x in rel for x in skip) and re.search(r"toUUID\((?:\w+\.)?se_property\)", path.read_text(errors="ignore")):
                bad.append(rel)
    assert not bad, f"use toUUIDOrNull(se_property): {bad}"
