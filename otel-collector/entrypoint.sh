#!/bin/sh
# Custom entrypoint for the ClickStack OTel collector.
#
# Maps the workshop's shared settings (CLICKHOUSE_HOST / PORT / USER / PASSWORD
# from the root .env) onto what the collector expects, runs our Python migration
# script (which respects CLICKHOUSE_DATABASE and skips CREATE DATABASE against
# Cloud), then delegates to the original /entrypoint.sh with the Go-based
# migrate tool disabled.
set -e

# The collector wants one URL; TLS unless CLICKHOUSE_SECURE says otherwise
# (a local test database).
if [ -z "${CLICKHOUSE_ENDPOINT:-}" ]; then
  : "${CLICKHOUSE_HOST:?CLICKHOUSE_HOST is not set}"
  case "$(printf '%s' "${CLICKHOUSE_SECURE:-true}" | tr '[:upper:]' '[:lower:]')" in
    0|false|no) scheme=http ;;
    *)          scheme=https ;;
  esac
  export CLICKHOUSE_ENDPOINT="${scheme}://${CLICKHOUSE_HOST}:${CLICKHOUSE_PORT:-8443}"
fi

# ClickStack's own tables live in retail_otel. The exporter reads the database
# from its own variable, the migration script from CLICKHOUSE_DATABASE.
export CLICKHOUSE_DATABASE="${CLICKHOUSE_DATABASE:-retail_otel}"
export HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE="${HYPERDX_OTEL_EXPORTER_CLICKHOUSE_DATABASE:-$CLICKHOUSE_DATABASE}"

python3 /usr/local/bin/otel-migrate.py

# Setting HYPERDX_OTEL_EXPORTER_CREATE_LEGACY_SCHEMA=true tells the base
# /entrypoint.sh to skip its Go-based migrate binary (which hardcodes 'default'
# as the target database and fails with DDL-restricted users on ClickHouse Cloud).
# We also patch standalone-config.yaml so the Go exporter itself does not attempt
# CREATE DATABASE — our Python migration handles schema creation.
export HYPERDX_OTEL_EXPORTER_CREATE_LEGACY_SCHEMA=true
sed -i 's/create_schema: .*/create_schema: false/' /etc/otelcol-contrib/standalone-config.yaml

exec /entrypoint.sh "$@"
