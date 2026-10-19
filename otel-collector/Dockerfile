# Pinned: 2.41.0 is the first version checked to read HYPERDX_OTEL_EXPORTER_TIMEOUT
# (2.19.0 hard-codes the 5 s exporter timeout) and to match entrypoint.sh's patch.
# The collector's memory_limiter is set to 1500 MiB, so the pod needs a memory
# limit of at least 2 GiB.
FROM clickhouse/clickstack-otel-collector:2.41.0

USER root

# The image's 5 s exporter timeout becomes max_execution_time=9 on the insert.
# Against ClickHouse Cloud the metrics batches (the widest schema) regularly
# exceed it and are dropped after their retries ("failed to determine columns
# for HTTP insert: context deadline exceeded"). 30 s clears the observed worst case.
ENV HYPERDX_OTEL_EXPORTER_TIMEOUT=30s

# python3 is needed for the custom migration script
RUN apk add --no-cache python3

COPY migrate.py    /usr/local/bin/otel-migrate.py
COPY entrypoint.sh /otel-entrypoint.sh
RUN chmod +x /otel-entrypoint.sh

ENTRYPOINT ["/otel-entrypoint.sh", "/opampsupervisor"]
