#!/usr/bin/env bash
# `docker build`, minus the notice Docker prints when its buildx plugin is missing (OrbStack, and some Docker installs):
#
#   DEPRECATED: The legacy builder is deprecated and will be removed in a future release.
#               Install the buildx component to build images with BuildKit:
#               https://docs.docker.com/go/buildx/
#
# It comes before every build, it is about the Docker install and not about anything the participant can fix, and it reads as a
# warning. Everything else the build writes to stderr, a build error above all, is shown as usual, and the exit status is Docker's.
set -u
err=$(mktemp "${TMPDIR:-/tmp}/docker-build.XXXXXX") || exit 1
trap 'rm -f "$err"' EXIT
docker build "$@" 2>"$err"
status=$?
# Drop the notice: from its first line to the blank line after it.
awk '/^DEPRECATED: The legacy builder/ { skip = 1 } skip && /^$/ { skip = 0; next } !skip' "$err" >&2
exit $status
