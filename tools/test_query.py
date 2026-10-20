"""The SQL runner agents use instead of a prompt: formatting, which statements run, and the example files (no network)."""

import pytest

import query
import seed_postgres

EXAMPLES = seed_postgres.ROOT / "sql" / "clickhouse" / "examples"


def test_a_result_is_an_aligned_table_with_a_row_count():
    out = query.format_result(["id", "status"], [(1, "pending"), (22, "confirmed")])
    assert out.splitlines() == ["id  status", "--  ---------", "1   pending", "22  confirmed", "(2 rows)"]


def test_nulls_show_and_long_values_are_cut():
    out = query.format_result(["a", "b"], [(None, "x" * 100)], width=10)
    assert "NULL" in out and "x" * 9 + "…" in out and "x" * 10 not in out


def test_a_single_value_is_printed_as_it_is_so_show_create_table_stays_readable():
    ddl = "CREATE TABLE t\n(\n    id UInt64\n)\nENGINE = MergeTree"
    assert query.format_result(["statement"], [(ddl,)]) == ddl


def test_one_column_of_many_rows_is_not_cut_either():
    line = "Skip " + "x" * 120
    out = query.format_result(["explain"], [("Expression",), (line,)])
    assert line in out and out.splitlines()[0] == "explain" and out.splitlines()[-1] == "(2 rows)"


def test_rows_past_the_limit_are_not_printed_and_the_footer_says_so():
    out = query.format_result(["n"], [(i,) for i in range(5)], max_rows=3)
    assert out.splitlines()[-1].startswith("(3 rows, more not shown")
    assert "3" not in out.splitlines()[2:5]


def test_no_rows_is_still_a_table():
    assert query.format_result(["a", "b"], []).splitlines() == ["a  b", "-  -", "(0 rows)"]


@pytest.mark.parametrize("statement, reads", [
    ("SELECT 1", True), ("  select 1", True), ("WITH x AS (SELECT 1) SELECT * FROM x", True),
    ("(SELECT 1) UNION ALL (SELECT 2)", True), ("SHOW CREATE TABLE t", True),
    ("EXPLAIN indexes = 1 SELECT 1", True), ("DESCRIBE t", True),
    ("SYSTEM REFRESH VIEW v", False), ("CREATE TABLE t (a Int8) ENGINE = Memory", False), ("INSERT INTO t VALUES (1)", False),
])
def test_clickhouse_statements_that_return_rows_are_queries_and_the_rest_commands(statement, reads):
    assert (query.first_keyword(statement) in query.READ_KEYWORDS) is reads


class FakeClickHouse:
    def __init__(self):
        self.commands, self.queries = [], []

    def command(self, statement):
        self.commands.append(statement)

    def query(self, statement, settings=None):
        self.queries.append((statement, settings))

        class Result:
            column_names = ("n",)
            result_rows = [(1,), (2,)]
        return Result()


def test_clickhouse_reads_cap_the_rows_the_server_sends():
    client = FakeClickHouse()
    out = query.run_clickhouse(client, "SELECT n FROM t", max_rows=100, width=60)
    assert client.queries[0][1] == {"max_result_rows": 101, "result_overflow_mode": "break"}
    assert out.splitlines()[-1] == "(2 rows)"


def test_clickhouse_statements_without_rows_are_commands_and_print_ok():
    client = FakeClickHouse()
    assert query.run_clickhouse(client, "SYSTEM REFRESH VIEW retail_analytics.v", 100, 60) == "OK"
    assert client.commands == ["SYSTEM REFRESH VIEW retail_analytics.v"] and not client.queries


class Column:
    def __init__(self, name):
        self.name = name


class FakeCursor:
    def __init__(self, description, rows, rowcount):
        self.description, self.rows, self.rowcount = description, rows, rowcount

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement):
        self.statement = statement

    def fetchmany(self, n):
        return self.rows[:n]


class FakePostgres:
    def __init__(self, description=None, rows=(), rowcount=-1):
        self.cursor_ = FakeCursor(description, list(rows), rowcount)

    def cursor(self):
        return self.cursor_


def test_postgres_rows_come_back_as_a_table():
    conn = FakePostgres([Column("id"), Column("name")], [(1, "a")])
    assert query.run_postgres(conn, "SELECT id, name FROM t", 100, 60).splitlines()[-1] == "(1 row)"


def test_postgres_writes_say_how_many_rows_they_touched():
    assert query.run_postgres(FakePostgres(rowcount=3), "UPDATE t SET a = 1", 100, 60) == "OK (3 rows affected)"
    assert query.run_postgres(FakePostgres(rowcount=1), "DELETE FROM t WHERE id = 1", 100, 60) == "OK (1 row affected)"
    assert query.run_postgres(FakePostgres(rowcount=-1), "BEGIN", 100, 60) == "OK"


SAMPLE = """-- Module X: intro

-- 1. The first one.
SELECT 1;

-- 2. A pair.
SELECT 2;
SELECT 3;

-- 3. The last.
SELECT 4;
"""


def test_a_numbered_query_is_what_sits_under_its_comment():
    sections = query.numbered_sections(SAMPLE)
    assert sorted(sections) == [1, 2, 3]
    assert query.split_sql_statements(sections[2]) == ["SELECT 2", "SELECT 3"]
    assert query.split_sql_statements(sections[3]) == ["SELECT 4"]


def test_only_picks_those_statements_from_a_file(tmp_path):
    path = tmp_path / "x.sql"
    path.write_text(SAMPLE)
    assert query.statements_from(None, path, 2) == ["SELECT 2", "SELECT 3"]
    assert query.statements_from(None, path, None) == ["SELECT 1", "SELECT 2", "SELECT 3", "SELECT 4"]
    with pytest.raises(SystemExit, match="no query numbered 9"):
        query.statements_from(None, path, 9)


def test_inline_sql_may_hold_several_statements():
    assert query.statements_from("SELECT 1; SELECT 2;", None, None) == ["SELECT 1", "SELECT 2"]


@pytest.mark.skipif(not EXAMPLES.exists(), reason="the repo is not mounted")
def test_every_numbered_query_of_every_example_file_resolves_to_sql():
    files = sorted(EXAMPLES.glob("*.sql"))
    assert files
    for path in files:
        sections = query.numbered_sections(path.read_text())
        assert sorted(sections) == list(range(1, len(sections) + 1)), f"{path.name}: numbers must run 1..n"
        for number in sections:
            assert query.statements_from(None, path, number), f"{path.name} query {number} has no statement"
