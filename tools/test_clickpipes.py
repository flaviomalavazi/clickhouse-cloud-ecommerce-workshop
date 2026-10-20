"""The ClickPipe request and how it is created, against a fake API (no network)."""

import json

import pytest

import clickpipes
from cloud_api import Context

CTX = Context("org-1", "svc-1", "clickshop")
CA = "-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n"


def payload(**kw):
    args = dict(name="clickshop-cdc", host="pg.example.cloud", port=5432, database="clickshop", username="postgres",
                password="s3cret!", ca_certificate=CA)
    return clickpipes.build_pipe_payload(**{**args, **kw})


class FakeAPI:
    def __init__(self, pipes=(), states=("Running",)):
        self.pipes, self.states, self.calls = list(pipes), list(states), []

    def result(self, method, path, body=None):
        self.calls.append((method, path))
        if method == "GET" and path.endswith("/clickpipes"):
            return self.pipes
        if method == "POST":
            return {"id": "pipe-1", "name": body["name"], "state": "Provisioning"}
        return {"id": "pipe-1", "state": self.states.pop(0) if len(self.states) > 1 else self.states[0]}

    def request(self, method, path, body=None):
        self.calls.append((method, path))
        return {}


def test_the_request_has_the_documented_shape():
    p = payload()
    pg = p["source"]["postgres"]
    assert p["destination"] == {"database": "retail_oltp"} and p["name"] == "clickshop-cdc"
    assert (pg["host"], pg["port"], pg["database"], pg["authentication"], pg["tlsHost"]) == ("pg.example.cloud", 5432, "clickshop", "basic", "pg.example.cloud")
    assert pg["credentials"] == {"username": "postgres", "password": "s3cret!"}
    assert pg["caCertificate"] == CA and pg["disableTls"] is False and pg["skipCertVerification"] is False


def test_the_settings_are_module_03s_choices():
    s = payload()["source"]["postgres"]["settings"]
    assert s == {"replicationMode": "cdc", "syncIntervalSeconds": 60, "allowNullableColumns": False, "deleteOnMerge": False}
    assert payload(sync_interval_seconds=10)["source"]["postgres"]["settings"]["syncIntervalSeconds"] == 10


def test_all_six_tables_keep_their_names_as_replacing_merge_trees():
    maps = payload()["source"]["postgres"]["tableMappings"]
    assert [m["sourceTable"] for m in maps] == ["categories", "products", "stock", "customers", "orders", "order_items"]
    assert all(m["sourceSchemaName"] == "public" and m["targetTable"] == m["sourceTable"] and m["tableEngine"] == "ReplacingMergeTree" for m in maps)


def test_the_printable_copy_hides_the_password_and_the_certificate_body():
    shown = json.dumps(clickpipes.redacted(payload()))
    assert "s3cret!" not in shown and "MIIB" not in shown and "BEGIN CERTIFICATE" in shown
    assert payload()["source"]["postgres"]["credentials"]["password"] == "s3cret!"      # the original is untouched


def test_the_host_is_shortened_like_in_make_doctor():
    shown = clickpipes.redacted(payload(host="pg-abc123def456.c0.us-east-2.aws.pg.clickhouse.cloud"))["source"]["postgres"]
    assert shown["host"] == "pg-…" + ".c0.us-east-2.aws.pg.clickhouse.cloud" and shown["tlsHost"] == shown["host"]
    assert clickpipes.mask_host("localhost") == "loc…"


def test_a_missing_certificate_is_explained(tmp_path):
    with pytest.raises(SystemExit, match="PGSSLROOTCERT is not set"):
        clickpipes.read_ca_certificate("")
    with pytest.raises(SystemExit, match="was not found"):
        clickpipes.read_ca_certificate(str(tmp_path / "nope.pem"))
    (tmp_path / "ca.pem").write_text(CA)
    assert clickpipes.read_ca_certificate(str(tmp_path / "ca.pem")) == CA


def test_an_existing_pipe_is_left_alone():
    api = FakeAPI(pipes=[{"id": "p9", "name": "clickshop-cdc", "state": "Running"}])
    pipe, created = clickpipes.create_pipe(api, CTX, payload())
    assert (pipe["id"], created) == ("p9", False)
    assert [c[0] for c in api.calls] == ["GET"]


def test_a_pipe_made_by_hand_under_the_consoles_name_counts_as_ours():
    mine = payload()
    by_hand = {"id": "p7", "name": "clickpipe-workshop", "state": "Running",
               "source": {"postgres": {"host": "pg.example.cloud", "database": "clickshop"}}, "destination": {"database": "retail_oltp"}}
    api = FakeAPI(pipes=[by_hand])
    pipe, created = clickpipes.create_pipe(api, CTX, mine)
    assert (pipe["id"], created) == ("p7", False)
    assert [c[0] for c in api.calls] == ["GET"]           # nothing is posted: a second pipe would write every row twice


def test_a_pipe_for_another_database_or_destination_is_not_ours():
    other_db = {"id": "p1", "name": "x", "source": {"postgres": {"host": "pg.example.cloud", "database": "clickshop_apitest"}}, "destination": {"database": "retail_oltp"}}
    other_dest = {"id": "p2", "name": "y", "source": {"postgres": {"host": "pg.example.cloud", "database": "clickshop"}}, "destination": {"database": "retail_oltp_apitest"}}
    other_host = {"id": "p3", "name": "z", "source": {"postgres": {"host": "elsewhere.example", "database": "clickshop"}}, "destination": {"database": "retail_oltp"}}
    api = FakeAPI(pipes=[other_db, other_dest, other_host])
    pipe, created = clickpipes.create_pipe(api, CTX, payload())
    assert created and pipe["id"] == "pipe-1"


def test_a_new_pipe_is_posted_once():
    api = FakeAPI()
    pipe, created = clickpipes.create_pipe(api, CTX, payload())
    assert created and pipe["id"] == "pipe-1"
    assert api.calls == [("GET", "/organizations/org-1/services/svc-1/clickpipes"), ("POST", "/organizations/org-1/services/svc-1/clickpipes")]


def test_waiting_follows_the_states_to_running():
    api, said = FakeAPI(states=("Provisioning", "Setup", "Snapshot", "Running")), []
    assert clickpipes.wait_until_running(api, CTX, "pipe-1", sleep=lambda s: None, out=said.append) == "Running"
    assert said == ["  pipe state: Provisioning", "  pipe state: Setup", "  pipe state: Snapshot", "  pipe state: Running"]


def test_a_failed_pipe_stops_the_wait_with_a_pointer_to_the_console():
    with pytest.raises(SystemExit, match="Failed.*console"):
        clickpipes.wait_until_running(FakeAPI(states=("Setup", "Failed")), CTX, "pipe-1", sleep=lambda s: None, out=lambda s: None)


def test_a_pipe_that_never_gets_there_times_out():
    with pytest.raises(SystemExit, match="still Snapshot after 10 s"):
        clickpipes.wait_until_running(FakeAPI(states=("Snapshot",)), CTX, "pipe-1", timeout=10, poll=5, sleep=lambda s: None, out=lambda s: None)
