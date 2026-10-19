# clickshop-tools: the one-shot database tasks (`make pg-setup`, `ch-bootstrap`,
# `ch-search`, `ch-mvs`, `psql`). They run through `docker run`, so they work
# before the Kubernetes cluster exists.
#
# Build context is tools/. The repo itself (sql/, the catalogue, the product
# images) is bind-mounted at /workspace when the container runs, so editing a SQL
# file needs no rebuild and the image stays small.
#
# There is no ClickHouse client binary here: it is the whole ~800 MB server.
# `make ch-client` runs the official image instead.
FROM python:3.12-slim-trixie

RUN apt-get update \
 && apt-get install -y --no-install-recommends postgresql-client \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app/tools
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app/tools \
    CLICKSHOP_ROOT=/workspace
WORKDIR /workspace
