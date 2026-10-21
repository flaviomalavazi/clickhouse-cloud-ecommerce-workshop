# Helpers for the module checks (scripts/checks/check-NN.sh), sourced by each.
# A check prints one line per assertion and `finish` sets the exit code, so
# `make check-NN` reads the same way for a participant and for a guide agent.
# shellcheck shell=bash

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$REPO"
KUBECTL=deploy/bin/kubectl
failures=0

pass() { printf '  ✓ %s\n' "$*"; }
fail() { printf '  ✗ %s\n' "$*"; failures=$((failures + 1)); }

# check "what is being asserted" command...   (passes when the command succeeds; returns 1 when it does not)
check() {
  local what=$1; shift
  if "$@" >/dev/null 2>&1; then pass "$what"; else fail "$what"; return 1; fi
}

# check "..." command || hint "what to do"      the fix, right under the line that failed
hint() { printf '      -> %s\n' "$*"; }

# The checks of modules 05 and 06 look at the running application. Without the cluster every line would fail,
# so say so once, with the fix, and stop.
need_cluster() {
  if ! docker inspect -f '{{.State.Running}}' k3d-clickshop-server-0 2>/dev/null | grep -q true; then
    fail "the local cluster is not running: create it with  make up  (module 05), or run  make setup"
    finish
  fi
}

# All the pods in a namespace are Ready (and there is at least one). A pod that is being deleted
# (STATUS Terminating, as right after `make traffic-stop`) is on its way out and does not count.
pods_ready() {
  local ns=$1
  local not_ready
  not_ready=$("$KUBECTL" -n "$ns" get pods --no-headers 2>/dev/null | awk '{split($2, r, "/"); if ($3 != "Completed" && $3 != "Terminating" && (r[1] != r[2] || $3 != "Running")) print $1}')
  [ -z "$not_ready" ] && [ -n "$("$KUBECTL" -n "$ns" get pods --no-headers 2>/dev/null)" ]
}

http_ok() { curl -sf --max-time 10 -o /dev/null "$1"; }

# Print a JSON field of a URL's response using python (present on macOS and Linux).
json_get() { curl -sf --max-time 15 "$1" | python3 -c "import json, sys; d = json.load(sys.stdin); print($2)"; }

finish() {
  echo
  if [ "$failures" -gt 0 ]; then echo "$failures check(s) failed"; exit 1; fi
  echo "All checks passed"
}

# Run the database side of a module's check (tools/module_checks.py) in the tools container.
# The repo is mounted read-only; .env goes in as the environment, exactly as for make pg-setup.
run_db_check() {
  local module=$1
  [ -f "$REPO/.env" ] || { fail ".env not found: run  cp .env.example .env  and fill it in (module 01)"; return; }
  docker image inspect clickshop-tools >/dev/null 2>&1 || docker build -q -t clickshop-tools "$REPO/tools" >/dev/null
  if ! docker run --rm --env-file "$REPO/.env" -v "$REPO":/workspace:ro clickshop-tools python /app/tools/module_checks.py "$module" > /tmp/clickshop-check-$$.out 2>&1; then
    failures=$((failures + 1))
  fi
  # Its own ✓ / ✗ lines, without its closing summary (finish prints ours).
  grep -vE '^(All checks passed|[0-9]+ check\(s\) failed)$|^$' /tmp/clickshop-check-$$.out
  rm -f /tmp/clickshop-check-$$.out
}
