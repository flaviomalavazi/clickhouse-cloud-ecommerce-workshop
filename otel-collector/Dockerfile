FROM clickhouse/clickstack-otel-collector:latest

USER root

# python3 is needed for the custom migration script
RUN apk add --no-cache python3

COPY migrate.py    /usr/local/bin/otel-migrate.py
COPY entrypoint.sh /otel-entrypoint.sh
RUN chmod +x /otel-entrypoint.sh

ENTRYPOINT ["/otel-entrypoint.sh", "/opampsupervisor"]
