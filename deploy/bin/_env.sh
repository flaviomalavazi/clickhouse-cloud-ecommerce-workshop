# Shared by the k3d, helm and kubectl wrappers (sourced, not run).
#
# The platform tools run from pinned container images, so the workshop needs
# nothing installed on the machine beyond Docker and make. The wrappers behave
# like the real binaries: same arguments, same exit code, and `-` for stdin.

CLUSTER_NAME=clickshop
CLUSTER_NETWORK=k3d-${CLUSTER_NAME}
SERVERLB=k3d-${CLUSTER_NAME}-serverlb

here=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
REPO=$(cd "$here/../.." && pwd)
# shellcheck source=../versions.env
. "$REPO/deploy/versions.env"

# The kubeconfig the wrappers use. It is project-scoped, so the workshop never
# reads or changes the participant's own ~/.kube/config.
KUBECONFIG_HOST=$REPO/.workshop/kubeconfig
KUBECONFIG_IN=/workspace/.workshop/kubeconfig

# -i keeps `kubectl apply -f -` working; -t only when a person is typing.
tty_flags=(-i)
if [ -t 0 ] && [ -t 1 ]; then tty_flags=(-it); fi

# Containers join the cluster's Docker network so they can reach the API server
# at its in-network name. Before the cluster exists there is no such network.
net_flags=()
if docker network inspect "$CLUSTER_NETWORK" >/dev/null 2>&1; then
  net_flags=(--network "$CLUSTER_NETWORK")
fi

# The repo is mounted read-only: the tools read charts, values files and .env
# from it and write nothing back, except the kubeconfig below.
repo_flags=(-v "$REPO":/workspace:ro -w /workspace)
if [ -d "$REPO/.workshop" ]; then
  repo_flags+=(-v "$REPO/.workshop":/workspace/.workshop)
fi
