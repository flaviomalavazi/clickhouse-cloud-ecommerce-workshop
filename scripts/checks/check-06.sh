#!/usr/bin/env bash
# Module 06, Real-time analytics: rollups, history, live events and the dashboard.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "Module 06: Real-time analytics"
run_db_check 06
check "the dashboard's KPIs answer (/api/demo/analytics/kpis)" http_ok http://localhost:3000/api/demo/analytics/kpis
check "the Pipeline tile reads the gateway's metrics (/api/demo/analytics/telemetry)" http_ok http://localhost:3000/api/demo/analytics/telemetry
finish
