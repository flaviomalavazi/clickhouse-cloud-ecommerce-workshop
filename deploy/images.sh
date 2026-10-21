#!/usr/bin/env bash
# Build the workshop's images and load them, with the third-party ones, into the
# cluster. Behind `make images`, `make prefetch` and `make sim-start`.
#
#   deploy/images.sh                     build and import everything but the simulator
#   deploy/images.sh simulator           build and import the named images
#   deploy/images.sh --no-import         build only (what `make prefetch` does)
#   deploy/images.sh --all               include the simulator
#
# Images are tagged :workshop and the pods use imagePullPolicy IfNotPresent, so
# nothing is pulled while the cluster runs. An image is imported again only when it
# changed, and the Deployments that run a changed image are restarted.
#
# The simulator goes onto one node only (labelled clickshop/simulator-image=present, which
# the chart's nodeSelector asks for): it is the biggest image and only one pod ever uses it.
#
# The import is done here rather than with `k3d image import`: with Docker's
# containerd image store (the default since Docker 29, and in recent Docker Desktop)
# `docker save` writes a multi-platform index whose other platforms are not in the
# archive, containerd in the node refuses it ("content digest ... not found"), and
# k3d still prints "Successfully imported" and exits 0. Saving only this machine's
# platform avoids it, and the result is checked on every node.
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
. deploy/versions.env
TAG=workshop
NS=clickshop
KUBECTL=deploy/bin/kubectl

# name | build context | extra docker build arguments
build() {
  case $1 in
    frontend)        scripts/docker-build.sh -q --target production \
                       --build-arg NEXT_PUBLIC_BASE_URL=http://localhost:3000 \
                       -t clickshop-frontend:$TAG frontend ;;
    demo-service)    scripts/docker-build.sh -q -t clickshop-demo-service:$TAG services/demo-service ;;
    snowplow-bridge) scripts/docker-build.sh -q -t clickshop-snowplow-bridge:$TAG snowplow-bridge ;;
    otel-gateway)    scripts/docker-build.sh -q -t clickshop-otel-gateway:$TAG otel-collector ;;
    producers)       scripts/docker-build.sh -q -t clickshop-producers:$TAG \
                       -f data-generators/producers/Dockerfile data-generators ;;
    simulator)       scripts/docker-build.sh -q -t clickshop-simulator:$TAG \
                       -f data-generators/simulator/Dockerfile data-generators ;;
    *) echo "unknown image: $1" >&2; return 2 ;;
  esac
}

# The simulator's base image is 2.8 GB and every node gets its own copy, so it is
# built and imported when someone starts it (make sim-start), not with the rest.
DEFAULT_IMAGES="frontend demo-service snowplow-bridge otel-gateway producers"
ALL_IMAGES="$DEFAULT_IMAGES simulator"

do_import=1
names=""
for arg in "$@"; do
  case $arg in
    --no-import) do_import=0 ;;
    --all)       names="$ALL_IMAGES" ;;
    -*)          echo "unknown option: $arg" >&2; exit 2 ;;
    *)           names="$names $arg" ;;
  esac
done
names=${names:-$DEFAULT_IMAGES}

mkdir -p .workshop/imported
# The archive `docker save` writes for the import; removed even if the script fails.
TAR=.workshop/images.tar
trap 'rm -f "$TAR"' EXIT
to_import=()
changed_images=()

# Third-party images the chart and the collectors run, found by rendering them.
third_party() {
  local chart=.workshop/charts/opentelemetry-collector-$OTEL_CHART_VERSION.tgz values
  {
    deploy/bin/helm template x deploy/helm/clickshop
    if [ -f "$chart" ]; then
      for values in node cluster; do
        deploy/bin/helm template x "$chart" -f "deploy/helm/otel-k8s/$values.values.yaml"
      done
    fi
  } 2>/dev/null | sed -nE 's/^[[:space:]]*image:[[:space:]]*"?([^"[:space:]]+)"?.*/\1/p' | grep -v '^clickshop-' | sort -u
}

stamp_of() { echo ".workshop/imported/$(printf '%s' "$1" | tr '/:' '__')"; }
# What identifies an image's content: its layers and its config (command, environment,
# ports), not its ID. With Docker's containerd image store a cached rebuild gets a new
# ID every time (the config carries the build time), which would re-import and restart
# everything on every `make images`.
fingerprint() {
  docker image inspect -f '{{json .RootFS.Layers}} {{json .Config}}' "$1" | { shasum -a 256 2>/dev/null || sha256sum; } | cut -d' ' -f1
}
needs_import() { # image: true unless the cluster already has exactly this image
  [ "$(cat "$(stamp_of "$1")" 2>/dev/null || true)" != "$(fingerprint "$1")" ]
}

for name in $names; do
  image=clickshop-$name:$TAG
  echo "building $image"
  start=$(date +%s)
  build "$name" >/dev/null
  echo "  built in $(( $(date +%s) - start ))s ($(docker image inspect -f '{{.Size}}' "$image" | awk '{printf "%.0f MB", $1/1048576}'))"
  if needs_import "$image"; then to_import+=("$image"); changed_images+=("$image"); fi
done

# Third-party images are pulled once and imported like the others. They are only
# looked up when the cluster is going to receive them.
if [ "$do_import" = 1 ] && [ "$names" = "$DEFAULT_IMAGES" ]; then
  for image in $(third_party); do
    docker image inspect "$image" >/dev/null 2>&1 || { echo "pulling $image"; docker pull -q "$image" >/dev/null; }
    needs_import "$image" && to_import+=("$image")
  done
elif [ "$do_import" = 0 ]; then
  for image in $(third_party); do
    docker image inspect "$image" >/dev/null 2>&1 || { echo "pulling $image"; docker pull -q "$image" >/dev/null; }
  done
fi

if [ "$do_import" = 0 ]; then echo "built, not imported (--no-import)"; exit 0; fi
if [ "${#to_import[@]}" -eq 0 ]; then echo "the cluster already has every image"; exit 0; fi

# Docker's name for this machine's platform, and the name containerd stores an image under.
arch=$(docker version --format '{{.Server.Arch}}')
containerd_name() {
  local ref=$1 first=${1%%/*}
  case $ref in
    */*) case $first in *.*|*:*|localhost) echo "$ref" ;; *) echo "docker.io/$ref" ;; esac ;;
    *)   echo "docker.io/library/$ref" ;;
  esac
}
all_nodes=$(docker ps --filter label=k3d.cluster=clickshop --format '{{.Names}}' | grep -E '^k3d-clickshop-(server|agent)-[0-9]+$' || true)
[ -n "$all_nodes" ] || { echo "ERROR: the cluster has no running nodes. Run: make up" >&2; exit 1; }
# The node that already has the simulator image (a rebuild replaces it there), or the first agent.
simulator_node=$(deploy/bin/kubectl get nodes -l clickshop/simulator-image=present -o jsonpath='{.items[0].metadata.name}' 2>/dev/null || true)
[ -n "$simulator_node" ] || simulator_node=$(printf '%s\n' "$all_nodes" | grep -E -- '-agent-[0-9]+$' | sort | head -1)

# Every node keeps its own copy of what it imports (about 1.1 times the image size
# once unpacked), on the one disk Docker has. Refuse to start rather than fill it.
free_mb() { docker run --rm --entrypoint df clickshop-tools -Pk / 2>/dev/null | awk 'NR == 2 { printf "%d", $4 / 1024 }'; }
check_room() { # node-count image...
  local nodes=$1 need_mb=500 image size free; shift
  for image in "$@"; do
    size=$(docker image inspect -f '{{.Size}}' "$image")
    need_mb=$(( need_mb + size / 1048576 * nodes * 11 / 10 ))
  done
  free=$(free_mb || true)
  if [ -n "$free" ] && [ "$free" -lt "$need_mb" ]; then
    echo "ERROR: importing needs about $(( need_mb / 1024 )) GB free in Docker's disk and only $(( free / 1024 )) GB is free." >&2
    echo "       docker system df shows what takes the space; docker builder prune frees build cache." >&2
    exit 1
  fi
}

import_into() { # "node node ..." image...   (loads the images and checks every node has them)
  local nodes=$1 node image present; shift
  local count; count=$(printf '%s\n' $nodes | wc -l | tr -d ' ')
  check_room "$count" "$@"
  # --platform needs Docker 28+; older Docker has no containerd store and no such problem.
  local platform_flag=()
  if docker save --help 2>&1 | grep -q -- '--platform'; then platform_flag=(--platform "linux/$arch"); fi
  docker save "${platform_flag[@]+"${platform_flag[@]}"}" -o "$TAR" "$@"
  for node in $nodes; do
    docker exec -i "$node" ctr -n k8s.io images import - < "$TAR" >/dev/null
    present=$(docker exec "$node" ctr -n k8s.io images ls -q)
    for image in "$@"; do
      printf '%s\n' "$present" | grep -qx "$(containerd_name "$image")" \
        || { echo "ERROR: $image is not in $node after the import" >&2; exit 1; }
    done
  done
  rm -f "$TAR"
  for image in "$@"; do fingerprint "$image" > "$(stamp_of "$image")"; done
}

start=$(date +%s)
sim_images=(); other_images=()
for image in "${to_import[@]}"; do
  case $image in clickshop-simulator:*) sim_images+=("$image") ;; *) other_images+=("$image") ;; esac
done
echo "importing into the cluster: ${to_import[*]}"
if [ "${#other_images[@]}" -gt 0 ]; then import_into "$all_nodes" "${other_images[@]}"; fi
if [ "${#sim_images[@]}" -gt 0 ]; then
  import_into "$simulator_node" "${sim_images[@]}"
  # Exactly one node carries the label, and it is the one that has the image.
  deploy/bin/kubectl label nodes --all clickshop/simulator-image- >/dev/null 2>&1 || true
  deploy/bin/kubectl label node "$simulator_node" clickshop/simulator-image=present --overwrite >/dev/null
fi
echo "imported in $(( $(date +%s) - start ))s"

# A pod keeps running the image it started with: restart the Deployments whose
# image was just replaced.
if [ "${#changed_images[@]}" -gt 0 ]; then
  running=$("$KUBECTL" -n "$NS" get deploy -o jsonpath='{range .items[*]}{.metadata.name}{" "}{.spec.template.spec.containers[0].image}{"\n"}{end}' 2>/dev/null || true)
  for image in "${changed_images[@]}"; do
    for deployment in $(printf '%s\n' "$running" | awk -v img="$image" '$2 == img {print $1}'); do
      "$KUBECTL" -n "$NS" rollout restart "deployment/$deployment"
    done
  done
fi
