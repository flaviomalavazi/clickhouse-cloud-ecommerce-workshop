#!/usr/bin/env bash
# `make secrets`: put the root .env into the cluster.
#
#   clickshop-secrets   every KEY=value of .env, read as written by kubectl
#   clickshop-pg-ca     the Postgres CA certificate, when PGSSLROOTCERT is set
#
# Pods read the first through envFrom; the frontend mounts the second (the path in
# .env is a path on this machine, so it means nothing inside a pod).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
KUBECTL=deploy/bin/kubectl
NS=clickshop

[ -f .env ] || { echo "ERROR: .env not found. Run: cp .env.example .env  and fill in the required block." >&2; exit 1; }

apply() { "$KUBECTL" apply -f - >/dev/null; }

"$KUBECTL" create namespace "$NS" --dry-run=client -o yaml | apply
"$KUBECTL" -n "$NS" create secret generic clickshop-secrets --from-env-file=.env --dry-run=client -o yaml | apply
echo "secret/clickshop-secrets: $("$KUBECTL" -n "$NS" get secret clickshop-secrets -o go-template='{{len .data}}') keys from .env"

cert=$(grep -E '^PGSSLROOTCERT=' .env | tail -1 | cut -d= -f2- | tr -d '\r' || true)
if [ -n "$cert" ]; then
  [ -f "$cert" ] || { echo "ERROR: PGSSLROOTCERT=$cert was not found (the path is relative to the repo root)." >&2; exit 1; }
  case $cert in /*) echo "ERROR: PGSSLROOTCERT must be inside the repo (for example assets/certs/ca.pem), not an absolute path." >&2; exit 1 ;; esac
  "$KUBECTL" -n "$NS" create secret generic clickshop-pg-ca --from-file=ca.pem="$cert" --dry-run=client -o yaml | apply
  echo "secret/clickshop-pg-ca: Postgres certificate from $cert"
else
  "$KUBECTL" -n "$NS" delete secret clickshop-pg-ca --ignore-not-found >/dev/null
  echo "PGSSLROOTCERT is not set: no Postgres certificate mounted"
fi
