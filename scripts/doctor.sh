#!/usr/bin/env bash
# `make doctor`: is this machine ready for the workshop?
#
# Checks Docker and its resources, port 3000, the platform tool images, and .env
# (complete and well-formed, with every value shown masked). The two database
# checks (ClickHouse version, Postgres) run in the tools container at the end.
#
# .env is read line by line, never sourced: a password may contain $ # or spaces,
# and the same file is handed to `docker run --env-file`, which keeps every
# character as written.
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."
. deploy/versions.env

problems=0
ok()   { printf '  ✓ %s\n' "$*"; }
warn() { printf '  ! %s\n' "$*"; }
bad()  { printf '  ✗ %s\n' "$*"; problems=$((problems + 1)); }

# ── Tools ────────────────────────────────────────────────────────────────────
echo "Tools"
if ! command -v docker >/dev/null 2>&1; then
  bad "docker is not installed (Docker Desktop, OrbStack or Colima)"
  echo; echo "Fix the above, then run: make doctor"; exit 1
fi
if ! docker info >/dev/null 2>&1; then
  bad "docker is installed but its daemon is not running: start Docker and retry"
  echo; echo "Fix the above, then run: make doctor"; exit 1
fi
ok "docker $(docker version --format '{{.Server.Version}}' 2>/dev/null) ($(docker info --format '{{.OperatingSystem}}'))"
if command -v make >/dev/null 2>&1; then ok "make $(make --version | head -1 | sed 's/GNU Make //')"; else bad "make is not installed"; fi
# k3d, kubectl and helm run from pinned container images (deploy/bin), so there
# is nothing to install; `make prefetch` downloads them ahead of the workshop.
for image in "$K3D_IMAGE" "$HELM_IMAGE" "$KUBECTL_IMAGE"; do
  tool=${image##*/}; tool=${tool%%:*}
  if docker image inspect "$image" >/dev/null 2>&1; then
    ok "$tool: container image $image is present"
  else
    warn "$tool: runs from $image, which is not downloaded yet (make prefetch, or the first command pulls it)"
  fi
done

# ── Docker resources ─────────────────────────────────────────────────────────
echo "Docker resources"
mem_bytes=$(docker info --format '{{.MemTotal}}')
cpus=$(docker info --format '{{.NCPU}}')
mem_gb=$(awk -v b="$mem_bytes" 'BEGIN { printf "%.1f", b / 1073741824 }')
# Docker Desktop reports a little under its setting (an 8 GB setting shows ~7.7 GiB).
if [ "$mem_bytes" -ge 7500000000 ]; then ok "memory ${mem_gb} GiB (needs 8 GB)"; else bad "memory ${mem_gb} GiB: the cluster needs 8 GB (Docker Desktop: Settings > Resources)"; fi
if [ "$cpus" -ge 4 ]; then ok "${cpus} CPUs (needs 4)"; else bad "${cpus} CPUs: the cluster needs 4"; fi
# Docker keeps its images on one virtual disk, and the three nodes each hold their
# own copy of every image they run: about 10 GB for the workshop.
if docker image inspect clickshop-tools >/dev/null 2>&1; then
  free_gb=$(docker run --rm --entrypoint df clickshop-tools -Pk / 2>/dev/null | awk 'NR == 2 { printf "%.0f", $4 / 1048576 }')
  if [ -z "$free_gb" ]; then warn "could not measure the free disk space in Docker"
  elif [ "$free_gb" -ge 15 ]; then ok "${free_gb} GB free in Docker's disk (needs about 10)"
  elif [ "$free_gb" -ge 8 ]; then warn "${free_gb} GB free in Docker's disk: enough, but tight (docker system df shows what takes the space; docker builder prune frees build cache)"
  else bad "${free_gb} GB free in Docker's disk: the images need about 10 GB (docker system df shows what takes the space; docker builder prune frees build cache)"; fi
fi

# ── Port 3000 ────────────────────────────────────────────────────────────────
echo "Ports"
if docker ps --format '{{.Names}}' | grep -qx "k3d-${CLUSTER_NAME:-clickshop}-serverlb"; then
  ok "port 3000 is the clickshop cluster's (already created)"
elif (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null; then
  bad "port 3000 is in use: stop whatever listens on it (a local 'npm run dev'?) before 'make up'"
else
  ok "port 3000 is free"
fi

# ── .env ─────────────────────────────────────────────────────────────────────
echo ".env"
if [ ! -f .env ]; then
  bad ".env not found: run  cp .env.example .env  and fill in the required block"
  echo; echo "Fix the above, then run: make doctor"; exit 1
fi

get() { # last assignment of KEY in .env, raw, without a trailing CR
  local key=$1 line value=""
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case $line in "$key="*) value=${line#*=} ;; esac
  done < .env
  printf '%s' "$value"
}
mask_secret() { if [ -z "$1" ]; then printf '(empty)'; else printf '•••••••• (%d characters)' "${#1}"; fi; }
mask_host() {
  local h=$1 rest
  [ -z "$h" ] && { printf '(empty)'; return; }
  rest=${h#*.}
  if [ "$rest" = "$h" ]; then printf '%s…' "${h:0:3}"; else printf '%s….%s' "${h:0:3}" "$rest"; fi
}

if grep -q $'\r' .env; then bad ".env has Windows line endings (CRLF): every value would end in an invisible character; convert it to LF"; fi

for key in CLICKHOUSE_HOST CLICKHOUSE_USER CLICKHOUSE_PASSWORD PGHOST PGPORT PGUSER PGPASSWORD PGDATABASE; do
  value=$(get "$key")
  case $key in
    *PASSWORD) shown=$(mask_secret "$value") ;;
    *HOST)     shown=$(mask_host "$value") ;;
    *)         shown=${value:-(empty)} ;;
  esac
  if [ -z "$value" ]; then bad "$key is empty"; continue; fi
  problem=""
  case $value in
    \"*|\'*) problem="has quotes: docker --env-file and kubectl keep them as part of the value, so remove them" ;;
    *" #"*)  problem="has a comment after the value: put comments on their own line" ;;
  esac
  case $key in
    CLICKHOUSE_HOST|PGHOST)
      case $value in
        *://*|*/*) problem="must be a bare host name, no scheme or path (got something with :// or /)" ;;
        *:*)       problem="must not include a port (the port has its own variable)" ;;
        *" "*)     problem="contains a space" ;;
      esac ;;
    PGPORT)
      case $value in
        *[!0-9]*) problem="must be a number" ;;
        6432)     problem="is the pooler's port: the CDC ClickPipe needs the direct endpoint (5432)" ;;
      esac ;;
  esac
  if [ -n "$problem" ]; then bad "$key=$shown $problem"; else ok "$key=$shown"; fi
done

cert=$(get PGSSLROOTCERT)
if [ -n "$cert" ]; then
  if [ -f "$cert" ]; then ok "PGSSLROOTCERT=$cert (Postgres certificate verified: verify-full)"
  else bad "PGSSLROOTCERT=$cert was not found (the path is relative to the repo root)"; fi
else
  warn "PGSSLROOTCERT is not set: the Postgres connection is encrypted but the server is not verified (see .env.example)"
fi

# A stray CARD_GATEWAY_DOWN=true makes every card payment fail on every new cluster (the gateway reads it from here).
# Module 08 breaks the gateway with `make break-card-gateway`, which is undone with `make fix-card-gateway`.
if [ "$(get CARD_GATEWAY_DOWN | tr '[:upper:]' '[:lower:]')" = "true" ]; then
  warn "CARD_GATEWAY_DOWN is true in .env: every card payment will fail. Remove that line (module 08 uses make break-card-gateway instead) and, if the cluster is running, run make apply-env"
fi

# ── Databases (in the tools container) ───────────────────────────────────────
echo "Databases"
if [ "$problems" -gt 0 ]; then
  warn "skipped until the problems above are fixed"
else
  docker image inspect clickshop-tools >/dev/null 2>&1 || scripts/docker-build.sh -q -t clickshop-tools tools >/dev/null
  if ! docker run --rm --env-file .env -v "$PWD":/workspace:ro clickshop-tools python /app/tools/doctor_checks.py; then
    problems=$((problems + 1))
  fi
fi

echo
if [ "$problems" -gt 0 ]; then
  echo "$problems problem(s). Fix them and run: make doctor"
  exit 1
fi
echo "All good. Next: make ch-bootstrap, then make pg-setup (module 01), or make setup to do everything at once."
