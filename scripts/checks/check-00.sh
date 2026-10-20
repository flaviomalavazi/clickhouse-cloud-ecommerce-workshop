#!/usr/bin/env bash
# Module 00, Prerequisites: Docker is running with enough room, and `make prefetch` has been done.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
. "$REPO/deploy/versions.env"

echo "Module 00: Prerequisites"
if ! docker info >/dev/null 2>&1; then
  fail "the Docker daemon is not running: start Docker Desktop or OrbStack"
  finish
fi
pass "Docker $(docker version --format '{{.Server.Version}}') is running ($(docker info --format '{{.OperatingSystem}}'))"
mem=$(docker info --format '{{.MemTotal}}'); cpus=$(docker info --format '{{.NCPU}}')
# Docker Desktop reports a little under its setting: an 8 GB setting shows about 7.7 GiB.
if [ "$mem" -ge 7500000000 ]; then pass "Docker has $(awk -v b="$mem" 'BEGIN { printf "%.1f", b / 1073741824 }') GiB of memory (needs 8 GB)"; else fail "Docker has less than 8 GB of memory: Docker Desktop, Settings, Resources"; fi
if [ "$cpus" -ge 4 ]; then pass "Docker has $cpus CPUs (needs 4)"; else fail "Docker has $cpus CPUs, the cluster needs 4"; fi
if docker image inspect clickshop-tools >/dev/null 2>&1; then
  free_gb=$(docker run --rm --entrypoint df clickshop-tools -Pk / 2>/dev/null | awk 'NR == 2 { printf "%.0f", $4 / 1048576 }')
  if [ "${free_gb:-0}" -ge 10 ]; then pass "${free_gb} GB free in Docker's disk (needs about 10)"; else fail "${free_gb:-?} GB free in Docker's disk, the images need about 10"; fi
fi
for image in "$K3D_IMAGE" "$HELM_IMAGE" "$KUBECTL_IMAGE" "$K3D_TOOLS_IMAGE" "$K3D_PROXY_IMAGE" rancher/k3s; do
  case $image in rancher/k3s) image=$(awk '/^image:/{print $2}' "$REPO/deploy/k3d/cluster.yaml") ;; esac
  check "image $image is downloaded" docker image inspect "$image"
done
for image in frontend demo-service snowplow-bridge otel-gateway producers simulator; do
  check "image clickshop-$image:workshop is built" docker image inspect "clickshop-$image:workshop"
done
check "the collector chart is downloaded" test -f "$REPO/.workshop/charts/opentelemetry-collector-$OTEL_CHART_VERSION.tgz"
if docker ps --format '{{.Names}}' | grep -qx "k3d-clickshop-serverlb" || ! (exec 3<>/dev/tcp/127.0.0.1/3000) 2>/dev/null; then
  pass "port 3000 is free (or already the clickshop cluster's)"
else
  fail "port 3000 is in use: stop whatever listens on it before make cluster"
fi
[ "$failures" -gt 0 ] && echo "  (the downloads and builds are one command: make prefetch)"
finish
