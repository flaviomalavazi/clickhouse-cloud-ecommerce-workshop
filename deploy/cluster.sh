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
    deploy/bin/kubectl wait --for=condition=Ready nodes --all --timeout=120s
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
