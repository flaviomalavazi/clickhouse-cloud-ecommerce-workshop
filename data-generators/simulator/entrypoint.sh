#!/bin/sh
# Translate environment variables into CLI flags so the container is
# configurable via -e flags (docker run / kubectl) as well as by
# passing arguments directly (docker run image --sessions 20 --duration 60).
#
# Environment variables (all optional, shown with defaults):
#   SIM_URL                  http://localhost:3000
#   SIM_SESSIONS             4         concurrent browsers (about 300 MB each)
#   SIM_DURATION             0         seconds; 0 = run until stopped
#   SIM_ARRIVALS_PER_MINUTE  6         daily-average arrival rate
#   SIM_DIURNAL              false     true = scale the arrival rate by hour of day
#   SIM_DWELL_SCALE          0.1       multiplier on every dwell time
#   SIM_MAX_BACKLOG          4         queued-session cap, as a x SIM_SESSIONS
#   SIM_HEARTBEAT            30        seconds between progress lines
#   SIM_DRAIN                10        shutdown grace for in-flight sessions
#   SIM_SEED                           (unset → no seed)
#
# Read directly by the simulator rather than passed as flags:
#   SIM_REALISTIC_FUNNEL     false     true = the shared conversion rates (~2.5%)
#                                      instead of the workshop's (~1 in 6 buy)

set -e

# --diurnal is off in the simulator (a flat rate is predictable), so only the
# positive case needs a flag.
DIURNAL_FLAG=""
case "$(printf '%s' "${SIM_DIURNAL:-false}" | tr '[:upper:]' '[:lower:]')" in
  1|true|yes|on) DIURNAL_FLAG="--diurnal" ;;
esac

exec python simulate.py \
  --url                  "${SIM_URL:-http://localhost:3000}" \
  --sessions             "${SIM_SESSIONS:-4}" \
  --duration             "${SIM_DURATION:-0}" \
  --arrivals-per-minute  "${SIM_ARRIVALS_PER_MINUTE:-6}" \
  --dwell-scale          "${SIM_DWELL_SCALE:-0.1}" \
  --max-backlog          "${SIM_MAX_BACKLOG:-4}" \
  --heartbeat            "${SIM_HEARTBEAT:-30}" \
  --drain                "${SIM_DRAIN:-10}" \
  ${DIURNAL_FLAG} \
  ${SIM_SEED:+--seed "${SIM_SEED}"} \
  "$@"
