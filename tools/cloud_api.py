"""
A small client for the ClickHouse Cloud API (https://api.clickhouse.cloud/v1), for the parts the
workshop automates: finding the organisation and the service, the ClickPipe, and the ClickStack sources.

Authentication is an API key (a key ID and a secret) over HTTP Basic, from the root `.env`:

  CLICKHOUSE_CLOUD_API_KEY_ID       the key ID
  CLICKHOUSE_CLOUD_API_KEY_SECRET   the key secret
  CLICKHOUSE_CLOUD_ORGANIZATION_ID  only needed if the key can see more than one organisation

The service is found by its host name: it is the one whose endpoint is CLICKHOUSE_HOST. Nothing here
prints the key or the secret.
"""

from __future__ import annotations

import os
import time
from dataclasses import dataclass

import requests

API_URL = "https://api.clickhouse.cloud/v1"

NO_KEY_MESSAGE = (
    "ERROR: no ClickHouse Cloud API key. In the console open Organization, API keys, create a key with the "
    "Admin role, and put it in .env:\n"
    "  CLICKHOUSE_CLOUD_API_KEY_ID=...\n  CLICKHOUSE_CLOUD_API_KEY_SECRET=...\n"
    "(the manual way, in the console, needs no key: see the module READMEs)"
)

PERMISSIONS = {
    "clickpipes": "control-plane:service:manage-clickpipes",
    "clickstack": "control-plane:service:manage-clickstack-api",
}


class CloudAPIError(RuntimeError):
    """The API answered with an error; carries what it said and the request id for support."""

    def __init__(self, status: int, message: str, path: str, request_id: str | None = None):
        self.status, self.path, self.request_id = status, path, request_id
        hint = ""
        if status == 401:
            hint = " (the API key or secret is wrong)"
        elif status == 403:
            hint = " (the API key lacks a permission for this call: give it the Admin role)"
        super().__init__(f"{status} from {path}: {message}{hint}" + (f" [request {request_id}]" if request_id else ""))


@dataclass(frozen=True)
class Context:
    """Where the workshop's ClickHouse service lives in the Cloud API."""

    organization_id: str
    service_id: str
    service_name: str


class CloudAPI:
    def __init__(self, key_id: str, key_secret: str, base_url: str = API_URL, session: requests.Session | None = None):
        self.auth = (key_id, key_secret)
        self.base_url = base_url.rstrip("/")
        self.session = session or requests.Session()

    @classmethod
    def from_env(cls, env=os.environ) -> "CloudAPI":
        key, secret = env.get("CLICKHOUSE_CLOUD_API_KEY_ID", "").strip(), env.get("CLICKHOUSE_CLOUD_API_KEY_SECRET", "").strip()
        if not key or not secret:
            raise SystemExit(NO_KEY_MESSAGE)
        return cls(key, secret)

    def request(self, method: str, path: str, body: dict | None = None, retries: int = 3) -> dict:
        """Call the API and return the parsed JSON. Retries throttling and server errors."""
        response = None
        for attempt in range(retries):
            response = self.session.request(method, self.base_url + path, json=body, auth=self.auth, timeout=60)
            if response.status_code in (429, 500, 502, 503, 504) and attempt < retries - 1:
                time.sleep(2 ** attempt)
                continue
            break
        try:
            payload = response.json()
        except ValueError:
            payload = {}
        if response.status_code >= 400:
            raise CloudAPIError(response.status_code, str(payload.get("error") or response.text[:200]), path, payload.get("requestId"))
        return payload

    def result(self, method: str, path: str, body: dict | None = None):
        return self.request(method, path, body).get("result")

    # -- finding the service ------------------------------------------------------------------

    def organization_id(self, override: str = "") -> str:
        if override:
            return override
        orgs = self.result("GET", "/organizations") or []
        if len(orgs) == 1:
            return orgs[0]["id"]
        names = ", ".join(f"{o.get('name')} ({o['id']})" for o in orgs) or "none"
        raise SystemExit("ERROR: the API key sees " + ("no organisation" if not orgs else f"{len(orgs)} organisations: {names}") +
                         ". Set CLICKHOUSE_CLOUD_ORGANIZATION_ID in .env to the one that holds your service.")

    def context(self, clickhouse_host: str, organization_override: str = "") -> Context:
        org = self.organization_id(organization_override)
        services = self.result("GET", f"/organizations/{org}/services") or []
        service = find_service(services, clickhouse_host)
        if service is None:
            hosts = sorted(e["host"] for s in services for e in s.get("endpoints", []) if e.get("protocol") == "https")
            raise SystemExit(f"ERROR: no service in the organisation has the host {clickhouse_host}. Its services' hosts: {hosts or 'none'}")
        return Context(org, service["id"], service.get("name", ""))


def find_service(services: list[dict], host: str) -> dict | None:
    """The service one of whose endpoints is `host`."""
    wanted = host.strip().lower()
    for service in services:
        if any(str(e.get("host", "")).lower() == wanted for e in service.get("endpoints", [])):
            return service
    return None


def format_ids(ctx: Context) -> str:
    """The two ids an agent's instructions need, one per line (they are not secrets)."""
    return f"organization id  {ctx.organization_id}\nservice id       {ctx.service_id}   ({ctx.service_name})"


def context_from_env(api: CloudAPI | None = None, env=os.environ) -> tuple[CloudAPI, Context]:
    api = api or CloudAPI.from_env(env)
    host = env.get("CLICKHOUSE_HOST", "").strip()
    if not host:
        raise SystemExit("ERROR: CLICKHOUSE_HOST is not set in .env")
    return api, api.context(host, env.get("CLICKHOUSE_CLOUD_ORGANIZATION_ID", "").strip())


def main() -> int:
    """`cloud_api.py ids`: print the organization id and the service id of the service in .env."""
    import sys
    if sys.argv[1:] != ["ids"]:
        sys.exit("usage: cloud_api.py ids")
    print(format_ids(context_from_env()[1]))
    return 0


if __name__ == "__main__":
    import sys
    sys.exit(main())
