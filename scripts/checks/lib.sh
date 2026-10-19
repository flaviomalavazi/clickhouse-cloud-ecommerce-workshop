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

# check "what is being asserted" command...   (passes when the command succeeds)
check() {
  local what=$1; shift
  if "$@" >/dev/null 2>&1; then pass "$what"; else fail "$what"; fi
}

# All the pods in a namespace are Ready (and there is at least one).
pods_ready() {
  local ns=$1
  local not_ready
  not_ready=$("$KUBECTL" -n "$ns" get pods --no-headers 2>/dev/null | awk '{split($2, r, "/"); if ($3 != "Completed" && (r[1] != r[2] || $3 != "Running")) print $1}')
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
