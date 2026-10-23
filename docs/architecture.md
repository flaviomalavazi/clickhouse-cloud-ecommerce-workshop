# ClickShop architecture

The deeper dive behind the [README](../README.md)'s diagram: what runs where, how data gets from a click or an order into ClickHouse, how long that takes, and how the repository turns all of it into a few `make` commands. It describes what is built. [`data-dictionary.md`](data-dictionary.md) says what every table holds.

## 1. The shape

Three places, and one rule: **the application runs on the participant's laptop, and every piece of data lives in ClickHouse Cloud.**

```text
 Participant's laptop (Docker Desktop, OrbStack or Colima)
 └── k3d cluster "clickshop": 1 server + 2 agents (Kubernetes inside Docker)       http://localhost:3000
     ├── namespace clickshop
     │   ├── frontend (Next.js) ── Postgres            orders, catalogue, stock         (pg, TLS verify-full)
     │   │      ├─────────────── ClickHouse            search, the analytics dashboard  (HTTPS, port 8443)
     │   │      ├─ /api/snowplow ─→ snowplow-micro ←─ snowplow-bridge ─→ ClickHouse      behaviour events
     │   │      ├─ /api/otlp ─────→ otel-gateway                                         browser traces and replays
     │   │      └─ storefront-bff ─→ 13 small services (the checkout path, section 3)
     │   ├── producer-web, producer-cc ────── batched INSERTs ─────────→ ClickHouse      generated traffic
     │   ├── backfill (a Job) ─────────────── 30 days of history ──────→ ClickHouse
     │   ├── simulator (Playwright, Chromium) ── HTTP ──→ frontend                       real shoppers, real orders
     │   └── otel-gateway (the ClickStack collector) ───────────────────→ ClickHouse      retail_otel
     └── namespace observability
         ├── otel-node     (DaemonSet: container logs, host and kubelet metrics) ──→ otel-gateway
         └── otel-cluster  (Deployment: cluster metrics, Kubernetes events) ──────→ otel-gateway

 ClickHouse Cloud
 ├── ClickHouse service     retail_analytics   clickstream, card transactions, rollups, products_search
 │                          retail_oltp        where the ClickPipe writes (a copy of Postgres)
 │                          retail_otel        traces, logs, metrics, session replays (ClickStack reads it)
 ├── Managed Postgres       database clickshop, schema public (the source of truth for the shop)
 ├── ClickPipe              Postgres CDC: clickshop.public.* → retail_oltp.*
 ├── ClickStack             the UI over retail_otel
 └── ClickHouse Agents      conversations over the service
```

Nothing on the laptop stores data. `make down` deletes the whole cluster and loses nothing.

## 2. The four data paths

| Path | From | Through | To | How it arrives |
|---|---|---|---|---|
| **Transactions** | The storefront (a real order) | Postgres, then the CDC ClickPipe | `retail_oltp` | A new row version, one sync interval later (60 s). |
| **Behaviour** | The browser's Snowplow tracker, or a generator | `/api/snowplow`, Snowplow Micro and the bridge (browser); direct (generators) | `retail_analytics.snowplow_events` | Batches: the bridge polls Micro every 2 s; a generator flushes at 100,000 rows or 5 s. |
| **Card payments** | `producer-cc` (background traffic) and `producer-web` (the card payment of each purchase it generates) | Direct INSERT | `retail_analytics.credit_card_transactions` | Batches, as above. |
| **Telemetry** | Every service and the browser (OpenTelemetry), and the two Kubernetes collectors | The `otel-gateway` | `retail_otel` | Seconds. |

Three things worth knowing:

- **Postgres is the only source of truth for the shop.** The ClickPipe copies it; nothing else writes to `retail_oltp`. The ClickPipe reads Postgres' write-ahead log (logical replication, so it needs the *direct* endpoint, not the pooler), creates the tables as `ReplacingMergeTree`, and adds `_peerdb_version`, `_peerdb_is_deleted` and `_peerdb_synced_at`. That is why every read of `retail_oltp` uses `FINAL`.
- **The clickstream bypasses Postgres on purpose.** It is high-volume and append-only, so it goes straight into ClickHouse in large batches. Every insert into `snowplow_events` also runs five materialized views that keep the dashboard's rollups current.
- **Derived tables are built inside ClickHouse.** `products_search` is rebuilt every five minutes from the replicated catalogue and stock by a refreshable materialized view, so search inherits the CDC lag plus up to five minutes. The `analytics_*` rollups are updated on every insert.

## 3. The checkout path

The storefront's checkout calls a small graph of services so that a trace has something to show. They hold no data.

```text
 frontend ──→ storefront-bff ──→ catalog-svc
                    └─────────→ checkout-svc ──→ pricing-svc
                                       │    └──→ inventory-svc
                                       ├──→ payment-card-svc ──→ card-gateway
                                       ├──→ payment-pix-svc ───→ pix-psp-gateway
                                       ├──→ payment-boleto-svc → boleto-gateway
                                       └──→ order-svc ──→ ledger-svc
                                                     └──→ email-gateway
```

The frontend writes the order itself, in Postgres. The order of events differs by payment method, and it matters when something fails:

- **Card:** the payment is *authorized first* (`/api/checkout/authorize`, through the BFF to the card gateway), and only then is the order placed (`/api/checkout/complete`). If the card gateway is down, the shopper never reaches an order: **no row is written, not even a cancelled one**. The outage shows in the telemetry.
- **Pix and Boleto:** the order is written first (`pending`, with its items, and the stock decremented in the same transaction), then the payment journey runs, then the order is settled as `confirmed` or, if the payment was refused, `cancelled` with the stock put back. A failure leaves a `cancelled` order.

The card gateway can be made to fail for the ClickStack exercise: `make break-card-gateway` sets a Helm value, and `CARD_GATEWAY_DOWN=true` in `.env` does the same on a new cluster (the Helm value wins when it is set).

## 4. Observability

Every service sends OTLP to the `otel-gateway` (a ClickStack collector, ports 4317 and 4318). The browser cannot reach the cluster directly, so its traces and its session replays go through the storefront's `/api/otlp` route. Two collectors from the OpenTelemetry Helm chart add what the application cannot see about itself:

- **`otel-node`** (a DaemonSet, one per node): the containers' logs, host metrics and the kubelet's pod and node metrics.
- **`otel-cluster`** (one Deployment): cluster-level metrics and Kubernetes events.

The gateway writes to `retail_otel`: `otel_traces`, `otel_logs`, `otel_metrics_*` and `hyperdx_sessions`. ClickStack is only the screens over those tables, and a SQL query reads the same data. Every pod adds its Kubernetes identity (`k8s.pod.uid`, `k8s.node.name`, `k8s.deployment.name`) to its telemetry, which is what links a log line to its pod's CPU and memory in ClickStack.

## 5. The local platform

- **k3d** runs one server and two agents as Docker containers, so ClickStack's Kubernetes views show several nodes. Port 3000 on the laptop maps to the cluster's load balancer, and k3s's Traefik routes every host name to the frontend. The kubelets' disk-pressure thresholds are relaxed, because all three nodes see Docker's whole disk, including the participant's other projects.
- **Two Helm charts:** `deploy/helm/clickshop` (the application: frontend, the 14 services, Snowplow Micro and the bridge, the gateway, and, behind switches, the producers, the backfill Job and the simulator) and the OpenTelemetry collector chart with `deploy/helm/otel-k8s` values.
- **Images are built locally and loaded by hand.** `deploy/images.sh` builds the six workshop images, saves each for this machine's platform and imports it into every node (the simulator, 1.5 GB, into one node only), because `k3d image import` silently imported nothing on current Docker.
- **The cluster is cheap and disposable:** about 3.3 GiB with the generators and the shoppers running, and about two minutes to rebuild with `make up`.

## 6. Configuration

One file, `.env`, at the repository root, read exactly as written: by `docker run --env-file` for the one-off tasks, and by `make secrets` for the cluster, which turns it into the Secret `clickshop-secrets` (and the Postgres certificate into `clickshop-pg-ca`). Pods read what they need from that Secret. `make check-env-contract` fails if any code reads an environment variable that `.env.example` does not define. The Cloud API key, when there is one, is in the same file and is used only by the tools on the laptop, never by a pod.

## 7. Tooling

- **`make`** is the interface for both human and agent mode. The commands are small and idempotent, so `make setup` can be repeated.
- **The `clickshop-tools` image** (Python and `psql`) runs every database task: the schema and seed, SQL files, `make ch-query`, the Cloud API clients (the ClickPipe and the ClickStack sources) and the module checks. It runs before any cluster exists.
- **`deploy/bin/`** wraps `k3d`, `kubectl` and `helm` as pinned container images, so the only things installed on the laptop are Docker, `make` and `git`.
- **`scripts/checks/check-NN.sh`** states what must be true at the end of each module. Humans and agents read the same checks.

## 8. How fresh each thing is

| What | Delay |
|---|---|
| A browser event in `snowplow_events` | Seconds (the bridge polls every 2 s) |
| A generated event or card transaction | Up to 5 s |
| A rollup | The same insert |
| A change in Postgres, in `retail_oltp` | The sync interval (60 s) plus a few seconds |
| A change in Postgres, in `products_search` | The sync interval plus up to 5 minutes |
| A trace, log or metric in `retail_otel` | Seconds |

## 9. What is deliberately not here

No production hardening, no multi-user authentication, no Docker Compose and no local ClickHouse or Postgres containers: those are the plan's non-goals. There is no Kafka (the generators write straight to ClickHouse), no ML or fraud detection, and no image or semantic search: search is ClickHouse's full-text index only.
