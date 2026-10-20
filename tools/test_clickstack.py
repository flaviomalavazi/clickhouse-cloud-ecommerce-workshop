"""The ClickStack sources, against a fake API (no network)."""

import pytest

import clickstack
from cloud_api import Context

CTX = Context("org-1", "svc-1", "clickshop")
PATH = "/organizations/org-1/services/svc-1/clickstack/sources"


class FakeAPI:
    """Remembers sources the way ClickStack would: POST assigns an id, PUT replaces, GET lists."""

    def __init__(self, sources=()):
        self.sources = {s["id"]: dict(s) for s in sources}
        self.calls, self._n = [], 0

    def result(self, method, path, body=None):
        self.calls.append((method, path))
        if method == "GET":
            return list(self.sources.values())
        if method == "POST":
            self._n += 1
            sid = f"new-{self._n}"
            self.sources[sid] = {**body, "id": sid}
            return self.sources[sid]
        if method == "PUT":
            sid = path.rsplit("/", 1)[1]
            self.sources[sid] = {**body, "id": sid}
            return self.sources[sid]


def existing(kind, table, sid, name="mine", db="retail_otel", connection="conn-1"):
    src = {"id": sid, "kind": kind, "name": name, "connection": connection, "from": {"databaseName": db}}
    if table:
        src["from"]["tableName"] = table
    return src


def test_each_definition_points_at_the_collectors_tables():
    for kind, table in (("log", "otel_logs"), ("trace", "otel_traces"), ("session", "hyperdx_sessions")):
        s = clickstack.build_source(kind, "c")
        assert s["kind"] == kind and s["connection"] == "c" and s["from"] == {"databaseName": "retail_otel", "tableName": table}
    metric = clickstack.build_source("metric", "c")
    # the live API rejects a metric source without from.tableName; the console sends "" there and for the table it does not read
    assert metric["from"] == {"databaseName": "retail_otel", "tableName": ""} and metric["metricTables"]["exponential histogram"] == ""
    assert set(metric["metricTables"]) == {"gauge", "histogram", "sum", "summary", "exponential histogram"}


def test_the_required_fields_of_the_api_schema_are_there():
    required = {  # from the OpenAPI schemas ClickStackLogSource, ClickStackTraceSource, ClickStackMetricSource
        "log": {"name", "kind", "connection", "from", "defaultTableSelectExpression", "timestampValueExpression"},
        "trace": {"name", "kind", "connection", "from", "defaultTableSelectExpression", "timestampValueExpression", "durationExpression",
                  "durationPrecision", "traceIdExpression", "spanIdExpression", "parentSpanIdExpression", "spanNameExpression", "spanKindExpression"},
        "metric": {"name", "kind", "connection", "from", "metricTables", "timestampValueExpression", "resourceAttributesExpression"},
    }
    for kind, fields in required.items():
        assert fields <= set(clickstack.build_source(kind, "c")), kind
    session = clickstack.build_source("session", "c")
    assert {"name", "kind", "connection", "from"} <= set(session)        # traceSourceId is added when it is created


def test_the_columns_used_exist_in_the_collectors_tables():
    # Timestamp is the primary time column of logs and traces; sessions use TimestampTime, metrics TimeUnix
    assert clickstack.build_source("log", "c")["timestampValueExpression"] == "Timestamp"
    assert clickstack.build_source("session", "c")["timestampValueExpression"] == "TimestampTime"
    assert clickstack.build_source("metric", "c")["timestampValueExpression"] == "TimeUnix"
    assert clickstack.build_source("trace", "c")["durationPrecision"] == 9      # Duration is in nanoseconds


def test_without_any_source_there_is_no_connection_and_the_message_says_what_to_do():
    with pytest.raises(SystemExit, match="Open ClickStack once"):
        clickstack.ensure_sources(FakeAPI(), CTX, out=lambda s: None)


def test_all_four_are_created_and_linked_when_only_a_foreign_source_exists():
    api = FakeAPI([existing("log", "otel_logs", "other", db="default")])          # a source for another database: not ours
    ids = clickstack.ensure_sources(api, CTX, out=lambda s: None)
    assert set(ids) == {"trace", "log", "metric", "session"} and all(i.startswith("new-") for i in ids.values())
    s = api.sources
    assert s[ids["trace"]]["logSourceId"] == ids["log"] and s[ids["trace"]]["sessionSourceId"] == ids["session"] and s[ids["trace"]]["metricSourceId"] == ids["metric"]
    assert s[ids["log"]]["traceSourceId"] == ids["trace"] and s[ids["log"]]["metricSourceId"] == ids["metric"]
    assert s[ids["metric"]]["logSourceId"] == ids["log"] and s[ids["session"]]["traceSourceId"] == ids["trace"]
    assert all(src["connection"] == "conn-1" for src in s.values())


def test_a_second_run_changes_nothing():
    api = FakeAPI([existing("log", "otel_logs", "other", db="default")])
    clickstack.ensure_sources(api, CTX, out=lambda s: None)
    api.calls.clear()
    clickstack.ensure_sources(api, CTX, out=lambda s: None)
    assert {c[0] for c in api.calls} == {"GET"}


def test_sources_made_by_hand_are_left_alone_and_only_the_missing_ones_are_made():
    api = FakeAPI([existing("log", "otel_logs", "L", name="my logs"), existing("trace", "otel_traces", "T", name="my traces")])
    ids = clickstack.ensure_sources(api, CTX, out=lambda s: None)
    assert ids["log"] == "L" and ids["trace"] == "T" and api.sources["L"]["name"] == "my logs"
    assert {k for k, v in ids.items() if v.startswith("new-")} == {"metric", "session"}
    assert "traceSourceId" not in api.sources["L"]                      # an existing source's links are not rewritten
    assert api.sources[ids["session"]]["traceSourceId"] == "T"          # but the new ones point at the existing ones


def test_force_rewrites_the_existing_sources():
    api = FakeAPI([existing("log", "otel_logs", "L", name="my logs")])
    clickstack.ensure_sources(api, CTX, force=True, out=lambda s: None)
    assert api.sources["L"]["name"] == "ClickShop Logs"
