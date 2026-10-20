#!/usr/bin/env bash
# Module 03, CDC ClickPipe: Postgres is replicated into retail_oltp.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "Module 03: CDC ClickPipe: Postgres is replicated into retail_oltp"
run_db_check 03
finish
