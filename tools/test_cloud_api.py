"""The Cloud API client, against a fake HTTP session (no network, no credentials)."""

import pytest

import cloud_api
from cloud_api import CloudAPI, CloudAPIError, find_service


class FakeResponse:
    def __init__(self, status, payload):
        self.status_code, self._payload, self.text = status, payload, str(payload)

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class FakeSession:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []

    def request(self, method, url, json=None, auth=None, timeout=None):
        self.calls.append((method, url, json, auth))
        return self.responses.pop(0)


def api(*responses):
    return CloudAPI("key", "secret", session=FakeSession(*responses))


SERVICE = {"id": "svc-1", "name": "clickshop", "endpoints": [{"protocol": "https", "host": "abc123.us-east-2.aws.clickhouse.cloud", "port": 8443}]}


def test_the_service_is_found_by_its_host_ignoring_case():
    assert find_service([SERVICE], "ABC123.us-east-2.aws.clickhouse.cloud")["id"] == "svc-1"
    assert find_service([SERVICE], "other.clickhouse.cloud") is None


def test_the_context_comes_from_the_only_organisation():
    a = api(FakeResponse(200, {"result": [{"id": "org-1", "name": "Acme"}]}), FakeResponse(200, {"result": [SERVICE]}))
    ctx = a.context("abc123.us-east-2.aws.clickhouse.cloud")
    assert (ctx.organization_id, ctx.service_id, ctx.service_name) == ("org-1", "svc-1", "clickshop")
    assert [c[1].rsplit("/v1", 1)[1] for c in a.session.calls] == ["/organizations", "/organizations/org-1/services"]


def test_several_organisations_need_the_override_and_the_message_says_so():
    a = api(FakeResponse(200, {"result": [{"id": "o1", "name": "A"}, {"id": "o2", "name": "B"}]}))
    with pytest.raises(SystemExit, match="CLICKHOUSE_CLOUD_ORGANIZATION_ID"):
        a.organization_id()
    assert api().organization_id("given") == "given"


def test_an_unknown_host_lists_the_hosts_the_organisation_has():
    a = api(FakeResponse(200, {"result": [{"id": "org-1"}]}), FakeResponse(200, {"result": [SERVICE]}))
    with pytest.raises(SystemExit, match="abc123.us-east-2"):
        a.context("nope.clickhouse.cloud")


def test_errors_carry_the_status_a_hint_and_the_request_id():
    a = api(FakeResponse(403, {"error": "forbidden", "requestId": "req-9"}))
    with pytest.raises(CloudAPIError) as e:
        a.request("GET", "/x")
    assert e.value.status == 403 and "Admin role" in str(e.value) and "req-9" in str(e.value)


def test_throttling_is_retried_and_the_secret_is_only_the_auth_tuple(monkeypatch):
    monkeypatch.setattr(cloud_api.time, "sleep", lambda s: None)
    a = api(FakeResponse(429, {"error": "slow down"}), FakeResponse(200, {"result": 1}))
    assert a.result("GET", "/y") == 1 and len(a.session.calls) == 2
    assert all(call[3] == ("key", "secret") for call in a.session.calls)


def test_a_missing_key_is_explained():
    with pytest.raises(SystemExit, match="API key"):
        CloudAPI.from_env({})
    assert CloudAPI.from_env({"CLICKHOUSE_CLOUD_API_KEY_ID": "k", "CLICKHOUSE_CLOUD_API_KEY_SECRET": "s"}).auth == ("k", "s")
