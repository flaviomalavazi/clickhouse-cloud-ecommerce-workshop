#!/usr/bin/env bash
# Module 02, Postgres OLTP: the catalogue, customers and orders are seeded.
. "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

echo "Module 02: Postgres OLTP: the catalogue, customers and orders are seeded"
run_db_check 02
finish
