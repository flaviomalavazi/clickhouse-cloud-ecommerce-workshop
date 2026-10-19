#!/usr/bin/env bash
# Run a command with the root .env exported, for the implementer's local work
# (`make dev-frontend`). The file is read line by line, as written: it is never
# sourced, so a password with $ # or spaces survives. A relative PGSSLROOTCERT is
# made absolute, because the command may run from another directory.
#
#   scripts/with-env.sh npm --prefix frontend run dev
set -euo pipefail
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
[ -f "$root/.env" ] || { echo "ERROR: .env not found. Run: cp .env.example .env" >&2; exit 1; }

while IFS= read -r line || [ -n "$line" ]; do
  line=${line%$'\r'}
  case $line in ''|'#'*) continue ;; esac
  case $line in *=*) export "$line" ;; esac
done < "$root/.env"

case ${PGSSLROOTCERT:-} in
  ''|/*) ;;
  *) export PGSSLROOTCERT="$root/$PGSSLROOTCERT" ;;
esac
cd "$root"
exec "$@"
