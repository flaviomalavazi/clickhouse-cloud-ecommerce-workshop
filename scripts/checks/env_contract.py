#!/usr/bin/env python3
"""
The configuration contract (decision D21): every environment variable the code reads is
defined in `.env.example`, set by the chart or an image (so it is not configuration anyone
edits), or named in KNOWN below with the reason it needs no entry.

    python3 scripts/checks/env_contract.py

Exits 1 and lists the variables that break the contract. A new variable has to be put in
one of those three places on purpose, which is the point. It also lists the variables
`.env.example` documents that nothing reads, since those are stale.
"""

from __future__ import annotations

import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]

# Read in code, set by neither the chart nor an image, and not for participants to set.
KNOWN = {
    # Set by the runtime or the framework, not by us.
    "NODE_ENV": "Node and Next.js",
    "NEXT_RUNTIME": "Next.js tells instrumentation.ts which runtime it is in",
    "NEXT_TELEMETRY_DISABLED": "Next.js, set in the frontend Dockerfile",
    "PYTHONUNBUFFERED": "Python, set in the Dockerfiles",
    # Standard OpenTelemetry SDK variables: the app honours them, the chart sets the ones it needs.
    "OTEL_SERVICE_NAME": "OpenTelemetry standard; the demo service defaults it to demo-<role>",
    "OTEL_EXPORTER_OTLP_ENDPOINT": "OpenTelemetry standard; the chart sets it",
    "OTEL_RESOURCE_ATTRIBUTES": "OpenTelemetry standard; the chart builds it from the Downward API",
    # Tuning knobs with code defaults. Participants change the few that are in .env.example; the
    # rest are for the generators' README and for the chart (data-generators/README.md).
    "PRODUCE_WORKERS": "web producer worker count; the chart sets it explicitly",
    "PRODUCE_WORKER_MODE": "web producer thread or process mode",
    "PRODUCE_MAX_EVENTS": "web producer stop count; the backfill Job sets it",
    "PRODUCE_INTERVAL_MS": "legacy per-event sleep",
    "PRODUCE_STATS_INTERVAL_S": "web producer stats period",
    "PRODUCE_RANDOM_SEED": "web producer seed",
    "PRODUCE_SITE_URL": "page_url the generated events carry",
    "PRODUCE_APP_ID": "app_id the generated events carry",
    "PRODUCE_PURCHASE_CC": "whether purchases also emit a card transaction",
    "PRODUCE_USER_POOL": "generated visitor pool size",
    "PRODUCE_NAME_POOL": "generated name pool size",
    "PRODUCE_CATALOG_LIMIT": "how many products the producer reads from products_search",
    "PRODUCE_DWELL_SCALE": "dwell time scale of generated sessions",
    "CH_EVENTS_TABLE": "destination table name of the web producer",
    "CH_CC_TABLE": "destination table name of the card transactions",
    "CC_WORKERS": "card producer worker count; the chart sets it explicitly",
    "CC_WORKER_MODE": "card producer thread or process mode",
    "CC_MAX_TRANSACTIONS": "card producer stop count",
    "CC_INTERVAL_MS": "legacy per-worker sleep",
    "CC_POOL_SIZE": "card pool size",
    "CC_STATS_INTERVAL_S": "card producer stats period",
    "CC_RANDOM_SEED": "card producer seed",
    "CC_CH_TABLE": "destination table name of the card producer",
    "CH_BATCH_ROWS": "rows per insert (100,000)",
    "CH_FLUSH_INTERVAL_S": "seconds per insert (5)",
    "CH_ASYNC_INSERT": "opt in to async inserts",
    "CH_WAIT_FOR_ASYNC": "wait for async inserts",
    "CH_BUSY_TIMEOUT_MS": "async insert busy timeout",
    "CH_MAX_DATA_SIZE": "async insert max data size",
    "CH_MAX_RETRIES": "insert retries",
    "CH_CONNECT_ATTEMPTS": "connection attempts at startup",
    "CH_COMPRESSION": "insert compression",
    "EVENT_MODE": "live or mixed; the backfill Job sets it",
    "BACKFILL_DAYS": "history window; the backfill Job sets it",
    "BACKFILL_GAP_DAYS": "days the history stops short of now",
    "BACKFILL_RATIO": "share of sessions backdated; the backfill Job sets it",
    "STOREFRONT_CHARGEBACK_RATE": "generated chargeback rate",
    "STOREFRONT_FAULTY_RATE": "generated faulty-transaction rate",
    "SIM_REALISTIC_FUNNEL": "simulator: use the shared conversion rates",
    "SIM_URL": "simulator target; the chart sets it",
    "SIM_SESSIONS": "simulator browsers; `make sim-start USERS=n` sets it",
    "SIM_DURATION": "simulator run length",
    "SIM_DIURNAL": "simulator: scale arrivals by hour of day",
    "SIM_MAX_BACKLOG": "simulator queue cap",
    "SIM_HEARTBEAT": "simulator progress period",
    "SIM_DRAIN": "simulator shutdown grace",
    "SIM_SEED": "simulator seed",
    "CLICKHOUSE_DATABASE": "each component's own default (retail_analytics, retail_otel for ClickStack)",
    "CLICKHOUSE_ENDPOINT": "the collector's single URL, derived from host and port by its entrypoint",
    "CLICKHOUSE_TTL_DAYS": "retention of ClickStack's tables, default 30",
    "SNOWPLOW_MICRO_URL": "where Micro is; the chart sets it",
    "STOREFRONT_BFF_URL": "where the storefront-bff is; the chart sets it",
    "OTEL_COLLECTOR_METRICS_URL": "the gateway's metrics URL; the chart sets it",
    "PGPOOL_MAX": "frontend connection pool; the chart sets it",
    "POLL_INTERVAL_SECONDS": "bridge poll period; the chart sets it",
    "DEMO_ROLE": "which role a demo-service pod plays; the chart sets it",
    "DEMO_LATENCY_MS": "added latency of a demo service; the chart sets it",
    "DEMO_DOWNSTREAM_TIMEOUT_SECONDS": "demo service downstream timeout",
    "CARD_GATEWAY_TIMEOUT_MS": "how long a broken card gateway holds the request; the chart sets it",
    "CARD_GATEWAY_DOWN": "also in .env.example; the fault switch sets it through the chart",
    "NEXT_PUBLIC_BASE_URL": "baked into the frontend at build time (make images)",
    "NEXT_PUBLIC_SNOWPLOW_APP_ID": "baked into the frontend at build time",
    "CLICKSHOP_ROOT": "where the tools image finds the repo (set in its Dockerfile)",
}

PY_READ = [
    r'os\.environ\.get\(\s*["\']([A-Z][A-Z0-9_]*)["\']',
    r'os\.environ\[\s*["\']([A-Z][A-Z0-9_]*)["\']',
    r'os\.environ\.setdefault\(\s*["\']([A-Z][A-Z0-9_]*)["\']',
    r'os\.getenv\(\s*["\']([A-Z][A-Z0-9_]*)["\']',
    r'\benv_(?:int|float|bool|str)\(\s*["\']([A-Z][A-Z0-9_]*)["\']',
]
TS_READ = [r'process\.env\.([A-Z][A-Z0-9_]*)', r'process\.env\[\s*["\']([A-Z][A-Z0-9_]*)["\']']
SH_READ = [r'\$\{([A-Z][A-Z0-9_]*)(?::[-?+=]|\})', r'\$([A-Z][A-Z0-9_]*)\b']
SKIP_PARTS = ("node_modules", "/test_", "/tests/", "base_contents", ".next", "package-lock")


def tracked() -> list[str]:
    out = subprocess.run(["git", "ls-files"], cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return [f for f in out.splitlines() if not any(p in "/" + f for p in SKIP_PARTS)]


def read_by_code(files: list[str]) -> dict[str, set[str]]:
    found: dict[str, set[str]] = {}
    for f in files:
        suffix = Path(f).suffix
        if suffix == ".py":
            patterns = PY_READ
        elif suffix in (".ts", ".tsx", ".js"):
            patterns = TS_READ
        elif suffix == ".sh" and f.startswith(("otel-collector/", "data-generators/")):
            patterns = SH_READ     # the entrypoints that translate .env into what a process wants
        else:
            continue
        text = (ROOT / f).read_text(errors="replace")
        # A shell variable the script assigns itself is a local, not configuration.
        local = set(re.findall(r"^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)=", text, re.M)) if suffix == ".sh" else set()
        for pattern in patterns:
            for name in re.findall(pattern, text):
                if name not in local:
                    found.setdefault(name, set()).add(f)
    return found


def in_env_example() -> set[str]:
    names = set()
    for line in (ROOT / ".env.example").read_text().splitlines():
        m = re.match(r"^#?\s*([A-Z][A-Z0-9_]*)=", line)
        if m:
            names.add(m.group(1))
    return names


def set_by_deployment(files: list[str]) -> set[str]:
    """Variables a chart template, a values file, a Dockerfile or the Makefile sets itself."""
    names = set()
    for f in files:
        p = ROOT / f
        if f.startswith("deploy/helm/") or Path(f).name == "Dockerfile" or f == "Makefile":
            text = p.read_text(errors="replace")
            names |= set(re.findall(r"name:\s*([A-Z][A-Z0-9_]+)\b", text))                 # env entries
            names |= set(re.findall(r"^\s+([A-Z][A-Z0-9_]+):\s", text, re.M))              # values maps
            names |= set(re.findall(r"^\s*ENV\s+([A-Z][A-Z0-9_]+)", text, re.M))          # Dockerfile ENV
            names |= set(re.findall(r"\bARG\s+([A-Z][A-Z0-9_]+)", text))                  # build args
    return names


def main() -> int:
    files = tracked()
    reads = read_by_code(files)
    documented = in_env_example()
    deployed = set_by_deployment(files)
    # Shell entrypoints also read system variables; those are not ours to list.
    system = {"HOME", "PATH", "PWD", "HOSTNAME", "PORT", "TERM", "USER", "SHELL"}

    unaccounted = sorted(n for n in reads if n not in documented | deployed | set(KNOWN) | system)
    stale_known = sorted(n for n in KNOWN if n not in reads and n not in deployed)
    unread_documented = sorted(n for n in documented if n not in reads and n not in deployed)

    print(f"{len(reads)} variables read in code; {len(documented)} in .env.example, "
          f"{len(deployed)} set by the chart, images or Makefile, {len(KNOWN)} named in KNOWN")
    if unaccounted:
        print("\nREAD IN CODE BUT DEFINED NOWHERE (add each to .env.example, the chart, or KNOWN with a reason):")
        for n in unaccounted:
            print(f"  {n:45s} {', '.join(sorted(reads[n]))}")
    if stale_known:
        print("\nin KNOWN but read nowhere (remove):", ", ".join(stale_known))
    if unread_documented:
        print("\nin .env.example but read nowhere (stale?):", ", ".join(unread_documented))
    if unaccounted:
        return 1
    print("\nThe configuration contract holds.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
