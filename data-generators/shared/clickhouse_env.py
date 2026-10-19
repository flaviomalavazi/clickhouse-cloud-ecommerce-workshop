"""Resolves ClickHouse credentials from the repo root's env file, shared with
the rest of the demo, instead of a copy in data-generators/.env.

These generators INSERT directly into ClickHouse, so they need the root
file's write-capable CLICKHOUSE_INGEST_URL/_USER/_PASSWORD — the same pair the
Snowplow bridge prefers — falling back to CLICKHOUSE_URL/_USER/_PASSWORD (the
read-only credentials in Cloud mode) only when the ingest ones are unset, per
the root .env.example's own documented fallback. Normalizes whichever URL/user
wins into the CLICKHOUSE_HOST/PORT/USERNAME/SSL names clickhouse_sink.py and
the producers here read. A value already present in os.environ (e.g. an
explicit override in data-generators/.env) always wins.
"""

from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

from dotenv import load_dotenv


def _find_repo_root() -> Path | None:
    # Walk up from this file looking for the repo root. In a local checkout
    # that's two levels up (data-generators/shared/); in a container this file
    # is copied flat alongside the generator code, so there is no repo root to
    # find at all — in that case CLICKHOUSE_* already arrived via docker
    # compose's `environment:` block, and the caller never gets here (see the
    # early return below).
    directory = Path(__file__).resolve().parent
    for _ in range(6):
        if (directory / "docker-compose.yml").is_file() and (directory / ".env.example").is_file():
            return directory
        if directory.parent == directory:
            break
        directory = directory.parent
    return None


def load_root_clickhouse_env() -> None:
    if os.environ.get("CLICKHOUSE_HOST"):
        return

    # Reading the root env file is best-effort: it is how this works from a
    # checkout, but in a container only the handful of .py files are copied in,
    # so there is no repo root to find. Returning here would skip the
    # URL-to-HOST/PORT/SSL translation below and leave CLICKHOUSE_HOST empty —
    # which is why a container given a perfectly good CLICKHOUSE_URL still
    # could not connect. Fall through and translate whatever is in the
    # environment instead.
    repo_root = _find_repo_root()
    if repo_root is not None:
        root_file = os.environ.get("ROOT_ENV_FILE")
        candidates = (
            [repo_root / root_file]
            if root_file
            else [repo_root / ".env.local", repo_root / ".env.cloud"]
        )
        for candidate in candidates:
            if candidate.is_file():
                load_dotenv(candidate)
                break

    ingest_url = os.environ.get("CLICKHOUSE_INGEST_URL")
    url = ingest_url or os.environ.get("CLICKHOUSE_URL")
    if url and not os.environ.get("CLICKHOUSE_HOST"):
        parsed = urlparse(url)
        os.environ["CLICKHOUSE_HOST"] = parsed.hostname or ""
        os.environ["CLICKHOUSE_PORT"] = str(
            parsed.port or (8443 if parsed.scheme == "https" else 8123)
        )
        os.environ["CLICKHOUSE_SSL"] = "true" if parsed.scheme == "https" else "false"

    if ingest_url:
        user = os.environ.get("CLICKHOUSE_INGEST_USER") or os.environ.get("CLICKHOUSE_USER")
        ingest_password = os.environ.get("CLICKHOUSE_INGEST_PASSWORD")
        if ingest_password is not None:
            os.environ["CLICKHOUSE_PASSWORD"] = ingest_password
    else:
        user = os.environ.get("CLICKHOUSE_USER")

    if user and not os.environ.get("CLICKHOUSE_USERNAME"):
        os.environ["CLICKHOUSE_USERNAME"] = user
