# Build context is data-generators/ — NOT this directory — so the image can pull
# in shared/traffic_profile.py alongside the producer code.
# See data-generators/docker-compose.kafka.yml.
FROM python:3.14-slim

WORKDIR /app

# All dependencies ship prebuilt wheels for this Python (confluent-kafka bundles
# its own librdkafka), so no compiler / -dev packages are needed.
COPY kafka/producer/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The shared traffic profile: funnel rates, hour-of-day curve, run modes, and the
# storefront transaction builder. The simulator image copies this same file,
# which is what keeps the two generators emitting the same funnel.
COPY shared/traffic_profile.py ./
COPY shared/event_render.py ./
# Root .env.local/.env.cloud credential resolver (see shared/clickhouse_env.py).
COPY shared/clickhouse_env.py ./

# Direct-to-ClickHouse insert path, shared by both producers.
COPY kafka/producer/clickhouse_sink.py ./

COPY kafka/producer/web-events/ ./web-events/
COPY kafka/producer/credit-card-transactions/ ./credit-card-transactions/

# Default to the web-events producer; the cc-producer service overrides the command.
CMD ["python", "-u", "web-events/producer.py"]
