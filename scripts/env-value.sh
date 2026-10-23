#!/usr/bin/env bash
# Print one setting from the root .env: the last `NAME=value` line, as written, without a trailing CR.
# Prints nothing when .env or the name is missing. For the few settings the Makefile and scripts
# need themselves (make never parses .env); never use it for a secret.
#
#   scripts/env-value.sh SIM_USERS
set -u
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
key=${1:?usage: scripts/env-value.sh <NAME>}
value=""
if [ -f "$root/.env" ]; then
  while IFS= read -r line || [ -n "$line" ]; do
    line=${line%$'\r'}
    case $line in "$key="*) value=${line#*=} ;; esac
  done < "$root/.env"
fi
printf '%s' "$value"
