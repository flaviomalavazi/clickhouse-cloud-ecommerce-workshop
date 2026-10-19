# ClickShop — E-commerce Demo

A full-stack e-commerce demo that showcases how [ClickHouse](https://clickhouse.com/) powers analytical and search workloads in a modern retail application, alongside PostgreSQL for transactional data.

---

## What this demo covers

| Capability | Implementation |
| --- | --- |
| Full-text product search | ClickHouse `tokenbf_v1` skip indexes on name, description, brand |
| Image & text similarity search | CLIP embeddings (512-dim) stored in ClickHouse with `vector_similarity` ANN index |
| Behavioural analytics | Real Snowplow pipeline: browser tracker → Snowplow Micro → bridge → ClickHouse |
| Behavioural fraud detection | Per-user baseline + a scikit-learn model running *inside* ClickHouse as a Python UDF, scoring live sessions every 10s — see [docs/fraud-detection/](docs/fraud-detection/PLAN.md) |
| Application observability | OpenTelemetry auto-instrumentation → ClickStack collector → ClickHouse |
| Transactional data | PostgreSQL — products, stock, customers, orders |
| Product recommendations | ClickHouse query on live product catalogue |

---

## Architecture

```text
Browser
  ├─ @snowplow/browser-tracker ──────────────► /api/snowplow (Next.js proxy)
  │                                                    │
  │                                            Snowplow Micro :9090
  │                                            snowplow-bridge
  │                                                    │
  └─ Next.js 14 frontend :3000                         ▼
       │                                        ┌─────────────────┐
       ├─ Product / search APIs ───────────────►│   ClickHouse    │
       │   (full-text + vector search)          │  (local or Cloud)|
       ├─ Recommendation API ─────────────────► │                 │
       │                                        └─────────────────┘
       ├─ Postgres APIs ──────────────────────► PostgreSQL
       │   (catalogue, cart, orders)            (local or Cloud)
       │
       └─ /api/otlp (Next.js proxy) ──────────► OTel Collector :4318
                                                        │
                                                        ▼
                                               ClickHouse (otel_*)
```

### Services

| Service | Image / Build | Port | Purpose |
| --- | --- | --- | --- |
| `frontend` | `./frontend` | 3000 | Next.js 14 storefront + admin |
| `postgres` | `postgres:16-alpine` | 5432 | Transactional data *(local only)* |
| `clickhouse` | `clickhouse/clickhouse-server:24.8` | 8123 / 9000 | Analytics, search, events *(local only)* |
| `snowplow-micro` | `snowplow/snowplow-micro:latest` | 9090 | Snowplow event collector |
| `snowplow-bridge` | `./snowplow-bridge` | — | Polls Micro → inserts into ClickHouse |
| `embedding-service` | `./embedding-service` | 8001 | CLIP model (text + image → 512-dim vectors) |
| `otel-collector` | `clickhouse/clickstack-otel-collector` | 4317 / 4318 | OTLP collector → ClickHouse |
| `hyperdx` | `docker.hyperdx.io/hyperdx/hyperdx:2` | 8080 | Observability UI *(local only)* |

The storefront also includes 16 roles using the shared `services/demo-service`
image: `storefront-bff` routes to catalog,
search, and checkout; checkout fans out to pricing, inventory, card, Pix, and
boleto services; payment and order services call their gateway, fraud, ledger,
and email edges over Docker DNS. Each container sets an exact `DEMO_ROLE` and
`OTEL_SERVICE_NAME`, emits OTLP to `otel-collector`, and has a healthcheck.
The existing `embedding-service` remains the real CLIP embedding runtime.

---

## Prerequisites

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) (or Docker Engine + Compose v2)
- `git`

No local Node.js, Python, or database installs required.

---

## Option A — Run fully locally

Everything runs in Docker on your machine. No external accounts needed.

### 1. Clone the repository

```bash
git clone git@github.com:flaviomalavazi/clickhouse-ecommerce-demo.git
cd clickhouse-ecommerce-demo
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

The defaults in `.env.local` point at the local Docker services — no edits required for a basic local run.

### 3. Start all services

```bash
docker compose --profile local up -d
```

The `--profile local` flag starts the local PostgreSQL and ClickHouse containers alongside all other services.

The first run downloads images and builds the `frontend`, `embedding-service`, and `snowplow-bridge` containers. The embedding service downloads the CLIP model weights (~350 MB) on first start — cached in a Docker volume for subsequent runs.

Wait until all services are healthy (roughly 2–3 minutes on first run):

```bash
docker compose --profile local ps
```

All services should show `(healthy)` or `Up`.

### 4. Seed the database

```bash
docker compose --profile seed run --rm seed
```

This populates:

| Table | Records |
| --- | --- |
| Products | 1 000 |
| Stock | 1 000 |
| Customers | 500 |
| Orders | 2 000 |

The seed script also generates CLIP embeddings for every product and inserts them into ClickHouse.

### 5. Open the demo

| URL | What you'll find |
| --- | --- |
| <http://localhost:3000> | ClickShop storefront |
| <http://localhost:3000/demo/analytics> | Behavioural analytics dashboard |
| <http://localhost:8080> | HyperDX — APM traces, logs, and metrics |
| <http://localhost:9090/micro/all> | Snowplow Micro event counts |

### 6. Generate traffic (optional)

See [Generating data](#generating-data) below.

### Manual UI and service journeys

Open `http://localhost:3000` for the storefront or
`http://localhost:3000/demo/analytics` for the analytics UI. The prompt-role
journeys can be exercised from inside the Compose network with `POST` requests,
for example:

```bash
docker compose exec frontend sh -c \
  "wget -qO- --post-data='{}' http://storefront-bff:8000/v1/journeys/catalog"
```

For existing backend load generation, use `data-generators/run.sh` with
`GENERATORS=simulator`, `SIM_MODE=backend`, and `SIM_URL` set to the storefront;
see [Generating data](#generating-data) for local and remote paths.

---

## Option B — Run with ClickHouse Cloud (local Docker + Cloud databases)

PostgreSQL and ClickHouse run on [ClickHouse Cloud](https://clickhouse.com/cloud). Only the frontend, embedding service, OTel collector, and Snowplow services run locally in Docker.

### B-1. Clone the repository

```bash
git clone git@github.com:flaviomalavazi/clickhouse-ecommerce-demo.git
cd clickhouse-ecommerce-demo
```

### B-2. Create databases in ClickHouse Cloud

You need two databases in your ClickHouse Cloud service:

- `retail_analytics` — application data (products, search, events)
- `retail_otel` — OpenTelemetry traces, logs, and metrics

Create them in the ClickHouse Cloud SQL console:

```sql
CREATE DATABASE IF NOT EXISTS retail_analytics;
CREATE DATABASE IF NOT EXISTS retail_otel;
```

Then apply the `retail_analytics` schema migrations (run each file in order):

```sql
-- scripts/migrations/clickhouse/001_products_search.sql
-- scripts/migrations/clickhouse/002_product_embeddings.sql
-- scripts/migrations/clickhouse/003_snowplow_events.sql
```

> The `retail_otel` tables are created automatically by the OTel collector on first start.

### B-3. Set up PostgreSQL

If you are using ClickHouse Cloud managed PostgreSQL, apply the schema once:

```bash
psql "postgres://<user>:<password>@<host>:5432/retail_db?sslmode=require" \
  -f scripts/migrations/postgres/001_create_schema.sql \
  -f scripts/migrations/postgres/002_seed_categories.sql
```

### B-4. Configure environment variables

```bash
cp .env.example .env.local
```

Edit `.env.local` with your ClickHouse Cloud credentials:

```bash
# PostgreSQL (ClickHouse Cloud managed Postgres)
PGHOST=<host>.pg.clickhouse.cloud
PGPORT=5432
PGUSER=<pg-user>
PGPASSWORD=<pg-password>
PGDATABASE=retail_db

# ClickHouse Cloud
CLICKHOUSE_URL=https://<host>.clickhouse.cloud:8443
CLICKHOUSE_DATABASE=retail_analytics
CLICKHOUSE_USER=<ch-user>
CLICKHOUSE_PASSWORD=<ch-password>

# OTel Collector → ClickHouse Cloud
OTEL_CLICKHOUSE_ENDPOINT=https://<host>.clickhouse.cloud:8443
OTEL_CLICKHOUSE_USER=<otel-user>
OTEL_CLICKHOUSE_PASSWORD=<otel-password>
OTEL_CLICKHOUSE_DATABASE=retail_otel

# HyperDX UI → ClickHouse Cloud
HYPERDX_CLICKHOUSE_URL=https://<host>.clickhouse.cloud:8443
```

### B-5. Start all services

```bash
docker compose --env-file .env.local up -d
```

Do **not** add `--profile local` — this keeps the local PostgreSQL and ClickHouse containers stopped since you are using Cloud instead.

Wait until all services are healthy:

```bash
docker compose --env-file .env.local ps
```

### B-6. Seed the database

```bash
docker compose --env-file .env.local --profile seed run --rm seed
```

### B-7. Open the demo

| URL | What you'll find |
| --- | --- |
| <http://localhost:3000> | ClickShop storefront |
| <http://localhost:3000/demo/analytics> | Behavioural analytics dashboard |
| <http://localhost:9090/micro/all> | Snowplow Micro event counts |

Observability (traces, logs, metrics) is available in the **ClickHouse Cloud UI** under the ClickStack / HyperDX integration — no local HyperDX needed.

### B-8. Generate traffic (optional)

See [Generating data](#generating-data) below.

> **Tip — HTTPS tunnels:** All browser telemetry (Snowplow and OTel) is proxied through the Next.js frontend via `/api/snowplow` and `/api/otlp`. You can expose the demo over HTTPS (Azure Dev Tunnels, ngrok) without mixed-content errors — the browser always talks to the same origin.

---

## Option C — Deploy to EC2 (production)

Run the full stack on an EC2 instance behind a real domain with automatic TLS. Docker images are built locally on your machine and streamed to EC2 — no container registry required.

### EC2 prerequisites

- An EC2 instance: **arm64**, Amazon Linux 2023 recommended, `t4g.medium` or larger (4 GB RAM minimum).
- A domain name with an A record you can point at the EC2 public IP.
- An AWS S3 bucket + CloudFront distribution for product images (see [Product image pipeline](#product-image-pipeline)).
- EC2 Security Group open on: TCP 22 (your IP), TCP 80 (all), TCP 443 (all), UDP 443 (all), TCP 9040 (simulator IP only).

### C-1. Bootstrap the EC2 instance (one time)

```bash
ssh -i key.pem ec2-user@<EC2_IP> "bash -s" < scripts/ec2-setup.sh
```

Installs Docker, the Compose v2 plugin, `git`, `rsync`, and tunes kernel parameters. Safe to re-run.

### C-2. Create `.env.cloud`

```bash
cp .env.example .env.cloud
```

Edit `.env.cloud` with ClickHouse Cloud credentials plus these production-specific settings:

```bash
# The public domain Caddy listens on and provisions TLS for.
CADDY_DOMAIN=shop.example.com
NEXT_PUBLIC_BASE_URL=https://shop.example.com

# CloudFront distribution domain (Caddy proxies /images/* here).
CLOUDFRONT_DOMAIN=<DIST_ID>.cloudfront.net

# Public IP of the traffic simulator machine (Caddy restricts port 9040 to this).
# Find yours: curl -s https://checkip.amazonaws.com
SIM_IP=1.2.3.4
```

If the normal PostgreSQL or ClickHouse users cannot create/alter schema objects,
also set `PG_MIGRATION_USER` / `PG_MIGRATION_PASSWORD` and
`CLICKHOUSE_MIGRATION_USER` / `CLICKHOUSE_MIGRATION_PASSWORD` to DDL-capable
credentials. The deploy runner uses them only for its migration-only step and
otherwise falls back to `PGUSER` / `CLICKHOUSE_USER`.

`.env.cloud` is gitignored — never commit it.

### C-3. Create `.deploy.env`

Create `.deploy.env` in the project root (also gitignored):

```bash
EC2_HOST=<your-ec2-public-ip>
EC2_USER=ec2-user
EC2_KEY=~/.ssh/your-key.pem
ENV_FILE=.env.cloud
```

### C-4. Deploy

```bash
./deploy.sh
```

The script automatically:

1. Verifies SSH connectivity.
2. Builds all custom Docker images for `linux/arm64`, including the topology services and migration runner.
3. Streams images to EC2 via `docker save | gzip | ssh | gunzip | docker load`.
4. Syncs config files (`docker-compose.yml`, `Caddyfile`, `otel-hostmetrics.yaml`).
5. Syncs `.env.cloud` as `.env.local` on EC2.
6. Applies the release's PostgreSQL and ClickHouse migrations in migration-only mode.
7. Runs `sudo docker compose --env-file .env.local up -d --remove-orphans` on EC2.
8. Polls the frontend health check and prints the deployment URL.

The migration step uses an explicit filename allowlist, records successful
applications in `clickshop_schema_migrations`, and aborts if a selected file is
missing. It does not seed catalog data, orders, transactions, or embeddings, and
it does not replay applied or older one-time rebuild/backfill migrations. This
release selects PostgreSQL `003_product_locales.sql` and ClickHouse
`009_products_search_locales.sql`.

Force a full rebuild from scratch:

```bash
FORCE_REBUILD=true ./deploy.sh
```

Leave an unchanged image out of the transfer (the box keeps the copy it has).
The root volume is 8 GiB, so this is how to deploy when the biggest image,
`embedding-service` (~1.5 GB), will not fit:

```bash
SKIP_IMAGES=embedding-service ./deploy.sh
```

Names are comma- or space-separated, the `clickshop-` prefix is optional, and an
unknown name fails the deploy rather than silently shipping everything. It only
narrows the transfer: the images are still built and `docker-compose.yml` is
unchanged. The pre-transfer free-space check (`MIN_FREE_MB`, default 1536 for
the full set) is scaled to the share of image bytes still being shipped, and the
deploy prints the number it used; set `MIN_FREE_MB` yourself to override it.

`SKIP_IMAGES=all` ships nothing: for a config-only deploy, or when the images are
already on the box (for example after an interrupted run that got past the
transfer). There is nothing to load, so the free-space check is dropped too.
Naming every image individually is refused as a likely mistake; `all` says it on
purpose.

`deploy.sh` also sets SSH keepalives (`ServerAliveInterval=15`,
`ServerAliveCountMax=4`), so a connection that dies mid-deploy fails after about
75 seconds instead of hanging. Every step is safe to re-run, so re-run it.

The target matches the documented arm64 EC2 instance even when the deploy runs
from an x86 host. Override it only for a different EC2 architecture with
`TARGET_PLATFORM=linux/amd64` in `.deploy.env`.

> **⚠️ Fresh instance — CLIP model weights.** The `embedding-service` image does **not** bake the CLIP weights (keeps the image ~1.4 GB instead of ~3.4 GB). At runtime the weights are read from the `huggingface_cache` Docker volume, and [`clip_model.py`](embedding-service/clip_model.py) loads with `local_files_only=True`. On an existing box the volume is already populated, so deploys just work. **On a brand-new instance the volume is empty and the service will fail to start** (it won't download the model). Seed it once, either by:
>
> - temporarily setting `local_files_only=False` in [`clip_model.py`](embedding-service/clip_model.py) for the first deploy so it downloads (~350 MB) into the volume, then reverting; **or**
> - copying a populated `huggingface_cache` volume from another environment onto the box before the first `up`.
>
> Once the volume holds `models--openai--clip-vit-base-patch32`, subsequent deploys need no special handling.

### C-5. DNS

Add an A record for your domain pointing to the EC2 public IP. Caddy provisions a TLS certificate automatically via Let's Encrypt on the first HTTPS request after DNS propagates.

> **Important for `.com.br` / registro.br:** After delegating to Route 53 nameservers, registro.br shows a "DNS in transition" message with an estimated completion time (~2 hours). Wait for the transition to finish before making any HTTPS requests — the Let's Encrypt HTTP-01 challenge will fail during propagation. Accessing the EC2 IP directly over HTTPS will show `ERR_SSL_PROTOCOL_ERROR`; this is expected (certs are domain-specific, not issued for bare IPs).

### C-6. Set up product images

After the first deployment and seed, run the image pipeline to generate product images and publish them to S3/CloudFront. See [Product image pipeline](#product-image-pipeline) below.

---

## Product image pipeline

Product images are generated and uploaded by the scripts in `assets/scripts/`. Run this pipeline once after seeding, and again whenever product data changes.

### What it does

1. Generates PNG product images using AI image generation.
2. Compresses each PNG to WebP (≤ 800 px, quality 85) and uploads to S3.
3. Generates a 512-dim CLIP embedding per image via the embedding service.
4. Inserts embeddings into `retail_analytics.product_embeddings` in ClickHouse.
5. Updates `image_url` in both the PostgreSQL `products` table and ClickHouse `products_search`.

### Image URL convention

Images are stored in S3 but are **not** served from CloudFront directly. Caddy proxies `/images/*` to CloudFront (stripping the prefix), so all images are served through your domain:

```text
https://{CADDY_DOMAIN}/images/{id}.webp
  → Caddy handle_path /images/* → CloudFront → S3
```

All four locations must use this URL consistently: `next.config.js` `remotePatterns`, `CATEGORY_HERO_IMAGES` in `constants.ts`, `products_search.image_url` in ClickHouse, and any component fallbacks. Mixing domains causes `next/image` to reject images at runtime.

### Running the pipeline

```bash
cd assets/scripts
cp .env.example .env        # fill in S3_BUCKET, CLOUDFRONT_DOMAIN, CADDY_DOMAIN, etc.
pip install -r requirements.txt
python image_pipeline.py    # add DRY_RUN=true to validate without writing
```

---

## Generating data

All three synthetic data generators live under
**[data-generators/](data-generators/)** behind one config file and one launcher:

| Generator | Produces |
| --- | --- |
| Web-events producer | Complete synthetic sessions → Kafka → ClickHouse, plus the card transaction for every order it closes |
| Credit-card producer | Background non-storefront transactions → Kafka, files, or S3 |
| Simulator | Real HTTP or headless-browser sessions against a running storefront |

```bash
cd data-generators
cp .env.example .env      # edit CLICKHOUSE_*, GENERATORS, EVENT_MODE, rates
./run.sh config           # print the resolved plan, start nothing
./run.sh                  # start it
./run.sh logs             # watch throughput
./run.sh down             # stop and clean up
```

`GENERATORS` in `.env` selects what runs (`web`, `credit-card`, `simulator`, in
any combination) and `run.sh` starts only the infrastructure that selection needs
— `GENERATORS=simulator` brings up no broker at all.

### Generation modes

| `EVENT_MODE` | Timestamps | Use for |
| --- | --- | --- |
| `live` | Everything stamped at ~now, so the whole run lands in today's partition | Maximum ingest today; live dashboards |
| `mixed` | A configurable share backdated across `BACKFILL_DAYS`, hour-of-day weighted; the rest live | Building history and a live tail in one run |

The hour-of-day curve (UTC-03, peaking ~2.94× at 20:00) shapes both backfilled
timestamps and the live emission rate, so `PRODUCE_TARGET_EPS`, `CC_TARGET_TPS`,
and `SIM_ARRIVALS_PER_MINUTE` are all **daily averages**. Set a rate to `0` to
run flat out.

### Simulator modes

| Mode | How it works | When to use |
| --- | --- | --- |
| `backend` | Posts events directly to the Snowplow collector via HTTP | Fast load generation, CI, and the only mode that can emit card transactions |
| `browser` | Drives headless Chromium via Playwright | Full end-to-end fidelity |
| `both` | Alternates 50/50 | Mixed testing |

### Running against EC2

Snowplow Micro is exposed on port 9040 (Caddy-restricted to `SIM_IP`). Set in
`data-generators/.env`:

```ini
GENERATORS=simulator
SIM_URL=https://shop.example.com
SIM_SNOWPLOW_URL=https://shop.example.com:9040
SIM_STOREFRONT_BFF_URL=https://shop.example.com
OTEL_EXPORTER_OTLP_ENDPOINT=https://shop.example.com/api/otlp
SIM_MODE=backend
SIM_SESSIONS=400
SIM_DURATION=0
SIM_ARRIVALS_PER_MINUTE=120
```

```bash
cd data-generators && ./run.sh --remote
```

The machine running this must have its IP set in `SIM_IP` in `.env.cloud`.
The backend simulator uses the same public origin for `/v1/journeys/*`; Caddy
allows those BFF routes only from `SIM_IP`. Its loadgen spans use the existing
same-origin `/api/otlp` proxy, so no collector port needs to be public.

### How the data lines up

Every generator reads one shared model,
[data-generators/shared/traffic_profile.py](data-generators/shared/traffic_profile.py):
the funnel rates, the hour-of-day curve, the run modes, and the transaction
builder. Both Docker images copy that single file in, so the halves stay
independently runnable — on different machines if you like — without the model
ever being duplicated.

Purchases and card transactions join on the order id, which the purchase event
carries in `se_property` and which *is* the transaction's `transaction_id`:

```sql
SELECT e.domain_sessionid, e.se_value AS order_total,
       t.bill_value, t.card_network, t.type
FROM       retail_analytics.snowplow_events           AS e
INNER JOIN retail_analytics.credit_card_transactions  AS t
        ON t.transaction_id = toUUID(e.se_property)
WHERE e.event_name = 'checkout_payment_confirmed'
  AND t.merchant_name = 'ClickShop'   -- storefront orders; the rest is background
```

Two caveats: browser-mode purchases are **not** joinable (their payloads come
from the frontend tracker, which has no order id to emit), and
`PURCHASE_PIX_SHARE > 0` deliberately creates orders with no card transaction.

**See [data-generators/README.md](data-generators/README.md)** for the full guide:
every parameter, throughput tuning, verification queries, and troubleshooting.

---

## Pages and features

### Storefront

- **Home** — hero banner + product recommendations (ClickHouse query, revalidated every 60 s)
- **Category pages** — best deals + full product grid (`/category/shoes`, `/category/clothing`, `/category/books`, `/category/it-accessories`, `/category/electronics`)
- **Product detail** — stock level, add to cart
- **Cart** — persistent across page reloads (localStorage)
- **Checkout** — simulated Pix payment with QR code

### Search

- **Text search** (`/search`) — ClickHouse full-text search with `tokenbf_v1` indexes on name, description, brand
- **Image search** — upload any photo; CLIP embedding service encodes it; ClickHouse finds similar products via `cosineDistance` ANN search

### Analytics dashboard (`/demo/analytics`)

Built on ClickHouse queries against `snowplow_events`:

- **Active now** — unique users in the last 10 seconds (auto-refresh every 10 s)
- **Live visitors** — current page per active user
- **Today's totals** — page views, sessions, total events, unique users
- **Hourly activity** — page views and users over the last 24 hours
- **Top pages**, **event breakdown**, **top search queries**, **category interest**, **sessions per day**

Use **Load Demo Data** to pre-populate 3 days of synthetic events.

---

## Behavioural event tracking (Snowplow)

```text
@snowplow/browser-tracker (browser)
  → POST /api/snowplow (Next.js proxy, same-origin)
  → Snowplow Micro :9090
  → snowplow-bridge (polls /micro/good every 2 s)
  → INSERT INTO retail_analytics.snowplow_events (ClickHouse)
```

| Event | Trigger |
| --- | --- |
| `page_view` | Every route change |
| `engagement_scroll` | 25 / 50 / 75 / 90 % scroll milestones |
| `product_click` | Clicking a product card |
| `cart_add_to_cart` | Adding an item to the cart |
| `search_text_search` | Submitting a text search |
| `search_image_search` | Submitting an image search |
| `checkout_start` | Reaching the checkout page |
| `checkout_payment_initiated` | Clicking "Pay with Pix" |
| `checkout_payment_confirmed` | Confirming payment |
| `account_login` / `account_logout` | Signing in/out at [`/account`](frontend/src/app/account/page.tsx) — the fraud-detection feature's identity events |

---

## Behavioural fraud detection

Detects account takeover — a bot, a stolen credential, or a stolen device —
by modelling each signed-in user's own normal behaviour and scoring live
sessions for deviation from it, entirely inside ClickHouse. Full design in
**[docs/fraud-detection/PLAN.md](docs/fraud-detection/PLAN.md)**; the
end-to-end setup is **[docs/fraud-detection/RUNBOOK.md](docs/fraud-detection/RUNBOOK.md)**.

```text
data-generators/fraud/  → snowplow_events (user_id set) + fraud_session_labels
                              │
                    hourly refreshable MV        every-10s refreshable MV
                              ▼                              ▼
                  user_behavior_baseline  ──►  web_analytics_behavioral_fraud_score(features)  ──► fraud_session_scores
                  (+ dictionary)               a scikit-learn model         → fraud_alerts
                                                running AS A ClickHouse           │
                                                executable UDF                    ▼
                                                                          /demo/fraud dashboard
```

- Sign in as one of six personas at [`/account`](frontend/src/app/account/page.tsx) to attach a
  `user_id` to your own browsing.
- Watch it live, or trigger an attack, at [`/demo/fraud`](frontend/src/app/demo/fraud/page.tsx).
- The model (`HistGradientBoostingClassifier`, trained in
  [`ml/`](ml/README.md)) runs inside ClickHouse as a Python `executable_pool`
  UDF — locally, on ClickHouse Cloud, or compiled to a pure-SQL function.
- Traffic comes from [`data-generators/fraud/`](data-generators/fraud/README.md):
  a population of users with persistent behaviour profiles, normal sessions,
  and three labelled attack playbooks.

---

## Observability (OpenTelemetry)

The Next.js server is auto-instrumented via `@opentelemetry/auto-instrumentations-node`. Traces, logs, and metrics are exported via OTLP HTTP to the ClickStack collector → ClickHouse.

Browser telemetry (HyperDX SDK) is proxied through `/api/otlp` — the browser never connects directly to the collector, so there are no mixed-content issues over HTTPS.

Use HyperDX or ClickHouse queries filtered by `ServiceName` for any of the
exact prompt roles (for example `storefront-bff`, `checkout-svc`, or
`card-gateway`). Minimal trace and log checks are:

```sql
SELECT ServiceName, SpanName, StatusCode, Duration
FROM retail_otel.otel_traces
WHERE ServiceName = 'card-gateway'
ORDER BY Timestamp DESC LIMIT 20;

SELECT Timestamp, ServiceName, SeverityText, Body
FROM retail_otel.otel_logs
WHERE ServiceName IN ('storefront-bff', 'card-gateway')
ORDER BY Timestamp DESC LIMIT 20;
```

To toggle the card outage and apply it without rebuilding, set
`CARD_GATEWAY_DOWN` or `CARD_GATEWAY_TIMEOUT_MS`, then run exactly:

```bash
docker compose up -d card-gateway
```

---

## ClickHouse schema overview

### `retail_analytics.products_search`

`ReplacingMergeTree(updated_at)` mirror of the PostgreSQL product catalogue. `tokenbf_v1` full-text indexes on `name`, `description`, `brand`. Always query with `FINAL` to get deduplicated results.

### `retail_analytics.product_embeddings`

512-dimensional CLIP vectors per product.

```sql
INDEX idx_embedding embedding
    TYPE vector_similarity('hnsw', 'cosineDistance', 512)
    GRANULARITY 1
```

### `retail_analytics.snowplow_events`

```sql
ENGINE = MergeTree
PARTITION BY toYYYYMM(collector_tstamp)
ORDER BY (event_name, toDate(collector_tstamp), event_id)
TTL toDateTime(collector_tstamp) + INTERVAL 2 YEAR
```

Includes `user_id` (migration 007) — the identity join the fraud-detection
feature builds on. See the next section.

### Fraud detection (`user_profiles`, `fraud_session_scores`, `fraud_alerts`, ...)

Added by migration 008 and, for the scoring materialized view itself, by
`ml/deploy/deploy.sh` (it calls `web_analytics_behavioral_fraud_score()`, which does not exist until
a model is deployed). Full schema and the design behind it:
[docs/fraud-detection/PLAN.md §4.5](docs/fraud-detection/PLAN.md).

---

## Tech stack

- **[ClickHouse](https://clickhouse.com/)** — analytics, full-text search, vector similarity search, Snowplow events, OTel traces/metrics/logs
- **[PostgreSQL 16](https://www.postgresql.org/)** — products, stock, customers, orders
- **[Next.js 14](https://nextjs.org/)** — frontend (App Router, server components, API routes)
- **[Snowplow Micro](https://github.com/snowplow-incubator/snowplow-micro)** — lightweight Snowplow event collector
- **[CLIP (openai/clip-vit-base-patch32)](https://huggingface.co/openai/clip-vit-base-patch32)** — vision-language model for image and text embeddings
- **[ClickStack OTel Collector](https://clickhouse.com/docs/use-cases/observability/clickstack/ingesting-data/otel-collector)** — OpenTelemetry collector pre-configured for ClickHouse
- **[Caddy](https://caddyserver.com/)** — reverse proxy with automatic HTTPS (Let's Encrypt)
- **[HyperDX](https://www.hyperdx.io/)** — open-source APM and observability UI *(local mode)*
