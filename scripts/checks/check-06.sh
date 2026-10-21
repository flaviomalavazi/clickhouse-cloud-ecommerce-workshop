#!/usr/bin/env bash
# Module 06, Real-time analytics: rollups, history, live events and the dashboard.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "Module 06: Real-time analytics"
need_cluster
run_db_check 06
check "the dashboard's KPIs answer (/api/demo/analytics/kpis)" http_ok http://localhost:3000/api/demo/analytics/kpis || hint "the dashboard needs the application (make app) and the rollups (make ch-mvs, module 06)"
check "the Pipeline tile reads the gateway's metrics (/api/demo/analytics/telemetry)" http_ok http://localhost:3000/api/demo/analytics/telemetry || hint "it reads the collector's counters: make logs S=otel-gateway"
finish
