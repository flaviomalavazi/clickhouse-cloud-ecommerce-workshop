#!/usr/bin/env bash
# Module 01, Cloud services: .env is complete and both services answer.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "Module 01: Cloud services"
if [ ! -f "$REPO/.env" ]; then
  fail ".env not found: run  cp .env.example .env  and fill in the required block"
  finish
fi
if "$REPO/scripts/doctor.sh" > /tmp/clickshop-doctor-$$.out 2>&1; then
  pass ".env is complete and well formed (make doctor passes)"
  rm -f /tmp/clickshop-doctor-$$.out
  run_db_check 01
else
  fail ".env or the services have a problem; make doctor says:"
  grep -E '✗|!' /tmp/clickshop-doctor-$$.out | sed 's/^/      /'
  rm -f /tmp/clickshop-doctor-$$.out
fi
finish
