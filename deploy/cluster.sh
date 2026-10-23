#!/usr/bin/env bash
# The cluster's lifecycle, behind `make cluster`, `make stop` and `make down`.
#
#   deploy/cluster.sh up     create the cluster (or start it again), write the kubeconfig
#   deploy/cluster.sh stop   stop its containers and keep everything in them
#   deploy/cluster.sh down   delete the cluster and everything that belongs to it
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
. deploy/versions.env
NAME=clickshop
K3D=deploy/bin/k3d

exists() { "$K3D" cluster list --no-headers 2>/dev/null | awk '{print $1}' | grep -qx "$NAME"; }

# k3d talks about the participant's own kubeconfig, which the workshop never touches
# (it writes .workshop/kubeconfig), and tells them to export a KUBECONFIG that does
# not exist. Drop those lines; every other line, and k3d's exit status, is kept.
quiet() { "$@" 2>&1 | { grep -vE 'default kubeconfig|You can now use it like this|^export KUBECONFIG=|^kubectl cluster-info' || true; }; }

# When Docker restarts under a running cluster (an update, a reboot), k3s can start on a
# node before the node's network is up, and exit. The container keeps running, so nothing
# starts k3s again and the node stays NotReady. Restart those nodes' containers.
# Not grep -q: it would stop reading early and pipefail would count ps's broken pipe.
k3s_running() { docker exec "$1" ps -o args 2>/dev/null | grep -E '^/bin/k3s (server|agent)' >/dev/null; }
revive_nodes() {
  local node stuck=()
  for node in $(docker ps --filter "label=k3d.cluster=$NAME" --format '{{.Names}} {{.Label "k3d.role"}}' \
                  | awk '$2 == "server" || $2 == "agent" {print $1}'); do
    k3s_running "$node" || { sleep 5; k3s_running "$node"; } || stuck+=("$node")
  done
  [ ${#stuck[@]} -gt 0 ] || return 0
  echo "k3s is not running on ${stuck[*]} (Docker restarted under the cluster): restarting them"
  docker restart "${stuck[@]}" >/dev/null
  # A restarted server takes a while to answer again, and kubectl wait gives up at once until it does.
  local i
  for i in $(seq 30); do
    deploy/bin/kubectl get --raw /readyz >/dev/null 2>&1 && return 0
    sleep 3
  done
}

case ${1:-} in
  up)
    mkdir -p .workshop
    if exists; then
      echo "cluster '$NAME' already exists"
      "$K3D" cluster start "$NAME" >/dev/null   # a no-op when it is running
    else
      quiet "$K3D" cluster create --config deploy/k3d/cluster.yaml
      # Anything imported before belonged to a cluster that no longer exists.
      rm -rf .workshop/imported
    fi
    # The tools run in containers on the cluster's network, so they reach the API
    # server by its name there, not through the port published on the host.
    "$K3D" kubeconfig get "$NAME" \
      | sed -E "s#server: https://[^:]+:[0-9]+#server: https://k3d-${NAME}-serverlb:6443#" \
      > .workshop/kubeconfig
    revive_nodes
    deploy/bin/kubectl wait --for=condition=Ready nodes --all --timeout=120s || {
      echo "ERROR: the cluster's nodes are not Ready (deploy/bin/kubectl get nodes shows which)." >&2
      echo "Restart Docker and run make up again; if they still are not, make down and make up rebuild the cluster." >&2
      exit 1
    }
    ;;
  stop)
    # The containers keep the application, the images loaded into the nodes and the Helm values,
    # so `make up` brings it back as it was, the load included if it was running.
    if exists; then
      quiet "$K3D" cluster stop "$NAME"
      echo "cluster '$NAME' stopped: the application and its images are kept, the Cloud services keep running"
      echo "start it again with:  make up  (as it was, the load too if it was running), or  make start  (with the load)"
    else
      echo "cluster '$NAME' does not exist: nothing to stop"
    fi
    ;;
  down)
    if exists; then quiet "$K3D" cluster delete "$NAME"; else echo "cluster '$NAME' does not exist"; fi
    rm -rf .workshop/kubeconfig .workshop/imported
    ;;
  *)
    echo "usage: $0 up|stop|down" >&2; exit 2 ;;
esac
