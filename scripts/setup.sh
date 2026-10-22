#!/usr/bin/env bash
# `make setup`: everything the workshop needs, in the order that works, in one command.
#
# For the one-hour format: after the two Cloud services exist and .env is filled in (module 01), this
# sets up what modules 01 to 08 build by hand, so the time goes on reading and exploring instead:
#
#   1  check the machine and .env            8  create the real-time rollups (module 06)
#   2  create the ClickHouse databases       9  start the cluster and the application (module 05)
#   3  apply the Postgres migrations        10  create the ClickStack sources (module 08)
#   4  create the ClickPipe (Cloud API)     11  load 30 days of history (module 06)
#   5  seed Postgres                        12  start the live generators (module 06)
#   6  wait for the pipe to bring it in     13  start the simulated shoppers (module 07)
#   7  build product search (module 04)
#
# The ClickPipe is created before Postgres is seeded: the rows reach ClickHouse as changes. Every step
# is safe to repeat, so if one fails, fix it and run `make setup` again; the steps already done are skipped.
#
#   make setup SKIP="backfill simulator"   leave steps out (names below)
#   SIM_USERS=2 in .env                    fewer browser shoppers (under 8 GB of memory for Docker)
#   make setup USERS=2                     the same, for this run only
#   SETUP_DRY_RUN=1 make setup             print the plan and run nothing
set -u
cd "$(dirname "${BASH_SOURCE[0]}")/.."

SKIP=" ${SKIP:-} "
# The browsers, as make sim-start chooses them: USERS for this run, else SIM_USERS in .env, else 4.
USERS=${USERS:-$(scripts/env-value.sh SIM_USERS)}
DRY=${SETUP_DRY_RUN:-}

# name | what | command
STEPS=(
  "doctor|Check the machine, .env and both services|make doctor"
  "bootstrap|Create the ClickHouse databases and clickstream tables|make ch-bootstrap"
  "migrate|Apply the Postgres migrations (no data yet)|make pg-migrate"
  "pipe|Create the ClickPipe through the Cloud API|make clickpipes"
  "seed|Seed Postgres: its rows reach ClickHouse through the pipe|make pg-seed"
  "sync|Wait for the pipe to bring the data into retail_oltp|make clickpipes-wait"
  "search|Build product search (the text index and its refreshable view)|make ch-search"
  "rollups|Create the real-time rollups (materialized views)|make ch-mvs"
  "app|Start the Kubernetes cluster and the application|make up"
  "clickstack|Create the ClickStack sources through the Cloud API|make clickstack-setup"
  "backfill|Load 30 days of history into ClickHouse (skipped if it is there)|make backfill"
  "generators|Start the live traffic generators|make generators-start"
  "simulator|Start the simulated shoppers (${USERS:-4} browsers)|make sim-start${USERS:+ USERS=$USERS}"
)
# A step that may fail without stopping the rest (its fix is a console step, said at the end).
SOFT=" clickstack "

line() { printf '%s\n' "────────────────────────────────────────────────────────────────────────"; }

if [ -z "$DRY" ]; then
  [ -f .env ] || { echo "ERROR: .env not found. Run: cp .env.example .env  and fill it in (module 01)." >&2; exit 1; }
  if ! grep -qE '^CLICKHOUSE_CLOUD_API_KEY_ID=.+' .env || ! grep -qE '^CLICKHOUSE_CLOUD_API_KEY_SECRET=.+' .env; then
    cat >&2 <<'MSG'
ERROR: make setup needs a ClickHouse Cloud API key, because it creates the ClickPipe and the ClickStack
sources through the Cloud API. In the console open Organization, API keys, create a key with the Admin
role, and add to .env:

  CLICKHOUSE_CLOUD_API_KEY_ID=...
  CLICKHOUSE_CLOUD_API_KEY_SECRET=...

Without a key, follow the modules one by one: they do the same things by hand.
MSG
    exit 1
  fi
fi

total=${#STEPS[@]}
begin=$(date +%s)
n=0
summary=()
todo=()
for entry in "${STEPS[@]}"; do
  n=$((n + 1))
  IFS='|' read -r name what cmd <<< "$entry"
  echo; line; echo "[$n/$total] $what"; echo "        \$ $cmd"
  case "$SKIP" in *" $name "*) echo "        skipped (SKIP)"; summary+=("skipped  $what"); continue ;; esac
  [ -n "$DRY" ] && { summary+=("(dry)    $what"); continue; }
  started=$(date +%s)
  if $cmd; then
    summary+=("$(printf '%4ss   ' $(( $(date +%s) - started )))$what")
  else
    took=$(( $(date +%s) - started ))
    case "$SOFT" in
      *" $name "*)
        echo; echo "!! \"$what\" did not work (see above). The rest goes on; to do it later:"
        summary+=("$(printf '%4ss   ' "$took")NOT DONE: $what"); todo+=("$name") ;;
      *)
        echo; echo "✗ \"$what\" failed after ${took}s. Fix it and run  make setup  again: the steps already done are skipped." >&2
        exit 1 ;;
    esac
  fi
done

echo; line; echo "Setup finished in $(( ($(date +%s) - begin) / 60 )) min $(( ($(date +%s) - begin) % 60 )) s"; line
printf '  %s\n' "${summary[@]}"
if [ -n "$DRY" ]; then exit 0; fi
echo
echo "  The storefront:   http://localhost:3000        The dashboard: http://localhost:3000/demo/analytics"
echo "  Check any module: make check-NN                Where things stand: make status"
echo "  Stop the load:    make traffic-stop            Start it again: make traffic-start"
for name in "${todo[@]+"${todo[@]}"}"; do
  case $name in
    clickstack) echo; echo "  To do by hand: the ClickStack sources. Open ClickStack from your service in the console once, then run"
                echo "  make clickstack-setup (or create the four sources as module 08, step 1, describes)." ;;
  esac
done
