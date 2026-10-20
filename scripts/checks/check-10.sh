#!/usr/bin/env bash
# Module 10, Cleanup: nothing of the workshop is left on this machine. (The Cloud services are the
# participant's to delete in the console, and this cannot see them.)
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "Module 10: Cleanup"
if ! docker info >/dev/null 2>&1; then
  pass "Docker is not running, so no cluster is"
else
  [ -z "$(docker ps -a --filter name=k3d-clickshop --format '{{.Names}}')" ] && pass "no k3d-clickshop containers" || fail "k3d-clickshop containers are left: make down"
  [ -z "$(docker network ls --filter name=k3d-clickshop --format '{{.Name}}')" ] && pass "no k3d-clickshop network" || fail "the k3d-clickshop network is left: make down"
  [ -z "$(docker volume ls --filter name=k3d-clickshop --format '{{.Name}}')" ] && pass "no k3d-clickshop volume" || fail "a k3d-clickshop volume is left: make down"
fi
[ ! -f "$REPO/.workshop/kubeconfig" ] && pass "no kubeconfig left in .workshop" || fail ".workshop/kubeconfig is left: make down"
echo "  · In the console, in this order: delete the ClickPipe, then the Postgres instance, then stop and delete the ClickHouse service."
finish
