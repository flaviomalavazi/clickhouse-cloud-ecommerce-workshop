#!/bin/sh
# Custom entrypoint for the ClickStack OTel collector.
#
# Runs our Python migration script (which correctly respects CLICKHOUSE_DATABASE
# and skips CREATE DATABASE in cloud mode) then delegates to the original
# /entrypoint.sh with the Go-based migrate tool disabled.
set -e

if [ "${SKIP_MIGRATION:-false}" = "true" ]; then
  echo "[entrypoint] SKIP_MIGRATION=true — skipping schema migration"
else
  python3 /usr/local/bin/otel-migrate.py
fi

# Setting HYPERDX_OTEL_EXPORTER_CREATE_LEGACY_SCHEMA=true tells the base
# /entrypoint.sh to skip its Go-based migrate binary (which hardcodes 'default'
# as the target database and fails with DDL-restricted users on ClickHouse Cloud).
# We also patch standalone-config.yaml so the Go exporter itself does not attempt
# CREATE DATABASE — our Python migration handles schema creation (or SKIP_MIGRATION
# bypasses it entirely when tables are pre-existing on Cloud).
export HYPERDX_OTEL_EXPORTER_CREATE_LEGACY_SCHEMA=true
sed -i 's/create_schema: .*/create_schema: false/' /etc/otelcol-contrib/standalone-config.yaml

exec /entrypoint.sh "$@"
