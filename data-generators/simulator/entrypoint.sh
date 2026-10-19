#!/bin/sh
# Translate environment variables into CLI flags so the container is
# configurable via -e flags (docker run / kubectl) as well as by
# passing arguments directly (docker run image --sessions 20 --duration 60).
#
# Environment variables (all optional, shown with defaults):
#   SIM_URL                  http://localhost:3000
#   SIM_SESSIONS             5         max concurrent sessions
#   SIM_DURATION             120       seconds; 0 = run until stopped
#   SIM_ARRIVALS_PER_MINUTE  10        daily-average arrival rate
#   SIM_DIURNAL              true      scale the arrival rate by hour of day
#   SIM_DWELL_SCALE          1         multiplier on every dwell time
#   SIM_MAX_BACKLOG          4         queued-session cap, as a x SIM_SESSIONS
#   SIM_HEARTBEAT            30        seconds between progress lines
#   SIM_DRAIN                10        shutdown grace for in-flight sessions
#   SIM_SEED                           (unset → no seed)
#
# Read directly by the simulator rather than passed as flags:
#   PURCHASE_PIX_SHARE       0         share of orders paid by pix (no card row)

set -e

# --diurnal defaults on in the simulator, so only the negative case needs a flag.
DIURNAL_FLAG=""
case "$(printf '%s' "${SIM_DIURNAL:-true}" | tr '[:upper:]' '[:lower:]')" in
  0|false|no|off) DIURNAL_FLAG="--no-diurnal" ;;
esac

exec python simulate.py \
  --url                  "${SIM_URL:-http://localhost:3000}" \
  --sessions             "${SIM_SESSIONS:-5}" \
  --duration             "${SIM_DURATION:-120}" \
  --arrivals-per-minute  "${SIM_ARRIVALS_PER_MINUTE:-10}" \
  --dwell-scale          "${SIM_DWELL_SCALE:-1}" \
  --max-backlog          "${SIM_MAX_BACKLOG:-4}" \
  --heartbeat            "${SIM_HEARTBEAT:-30}" \
  --drain                "${SIM_DRAIN:-10}" \
  ${DIURNAL_FLAG} \
  ${SIM_SEED:+--seed "${SIM_SEED}"} \
  "$@"
