# ClickShop: from zero to a real-time application on ClickHouse Cloud

A hands-on workshop. You start with an empty ClickHouse Cloud account and finish with an online shop whose orders, searches, clicks and traces all live in ClickHouse, and with a running idea of what each part is for.

You will:

1. create a **ClickHouse Cloud** service and a **ClickHouse Managed Postgres** instance;
2. load the ClickShop catalogue into Postgres (the transactional store) and **replicate it to ClickHouse** with a Postgres CDC ClickPipe;
3. build product search on ClickHouse **full-text search**;
4. run the storefront, its microservices, Snowplow and an OpenTelemetry collector on a **local Kubernetes cluster**;
5. stream synthetic **clickstream and card transactions** straight into ClickHouse and watch a real-time analytics dashboard;
6. let **browser-driven shoppers** place real orders that change Postgres and flow into ClickHouse;
7. observe the whole system in **ClickStack**: traces and the service map, logs with full-text search, session replays and Kubernetes infrastructure;
8. explore the data with **ClickHouse Agents**.

## What you will build

```text
 Your laptop (Docker Desktop / OrbStack / Colima)
 └── k3d cluster "clickshop"  (1 server + 2 agents)
     ├── namespace clickshop
     │   ├── frontend (Next.js) ── Postgres   (orders, catalogue, stock)             ┐
     │   │      │  ├─ ClickHouse   (search, the analytics dashboard)                 │
     │   │      │  ├─ /api/snowplow → snowplow-micro ← snowplow-bridge → ClickHouse  │
     │   │      │  ├─ /api/otlp (browser telemetry and replays) → otel-gateway       │
     │   │      │  └─ storefront-bff → catalog-svc, checkout-svc → pricing, inventory,
     │   │      │       payment-card-svc → card-gateway, payment-pix-svc → pix-psp-gateway,
     │   │      │       payment-boleto-svc → boleto-gateway, order-svc → ledger, email
     │   ├── web-events producer, card producer ──(batched INSERT)──→ ClickHouse
     │   ├── browser simulator (Playwright) ──HTTP──→ frontend
     │   └── otel-gateway (the ClickStack collector) ──→ ClickHouse (retail_otel)
     └── namespace observability
         ├── otel-node    (DaemonSet: kubelet metrics, container logs, host metrics)  → otel-gateway
         └── otel-cluster (Deployment: cluster metrics, Kubernetes events)            → otel-gateway

 ClickHouse Cloud
 ├── ClickHouse service   retail_analytics (clickstream, card transactions, rollups, products_search)
 │                        retail_oltp      (where the ClickPipe writes)
 │                        retail_otel      (ClickStack's tables)
 ├── Managed Postgres     database clickshop
 ├── ClickPipe            Postgres CDC  clickshop.public.*  →  retail_oltp.*
 ├── ClickStack           the UI over retail_otel
 └── ClickHouse Agents    over the service
```

The story the workshop tells:

- **High-volume clickstream** goes straight into ClickHouse, from the generators (large batched inserts) and from Snowplow through a small bridge.
- **Transactions** live in Postgres. The CDC ClickPipe brings them into ClickHouse within seconds.
- ClickHouse **joins both** for analytics, and powers **search** from the replicated catalogue.
- **ClickStack** observes the whole system on the same engine.

## The modules

Do them in order: each ends with a check (`make check-NN`) and leaves the system working. Times are for a first run, including the waiting.

| | Module | You learn | Time |
|---|---|---|---|
| 00 | [Prerequisites](workshop/00-prerequisites/README.md) | What the workshop needs; download everything **before the day** | 15 min + download |
| 01 | [Cloud services](workshop/01-cloud-services/README.md) | Create the ClickHouse and Postgres services; the single `.env` | 20 min |
| 02 | [Postgres OLTP](workshop/02-postgres-oltp/README.md) | Load and tour the transactional data; why it lives in Postgres | 15 min |
| 03 | [CDC ClickPipe](workshop/03-cdc-clickpipe/README.md) | Replicate Postgres into ClickHouse; `ReplacingMergeTree` and `FINAL` | 25 min |
| 04 | [Full-text search](workshop/04-full-text-search/README.md) | The `text` index, refreshable materialized views | 20 min |
| 05 | [Run the app](workshop/05-run-the-app/README.md) | The storefront on k3d; follow an order into ClickHouse | 25 min |
| 06 | [Real-time analytics](workshop/06-real-time-analytics/README.md) | Incremental materialized views; why large batches | 30 min |
| 07 | [Simulated shoppers](workshop/07-simulated-shoppers/README.md) | Orders from browsers; join Postgres and the clickstream | 30 min |
| 08 | [Observability with ClickStack](workshop/08-observability-clickstack/README.md) | Traces, logs, replays, infrastructure; break and fix | 40 min |
| 09 | [ClickHouse Agents](workshop/09-clickhouse-agents/README.md) | Ask the data questions in plain language *(not written yet)* | |
| 10 | [Cleanup](workshop/10-cleanup/README.md) | Remove everything, in the right order | 10 min |

About three and a half hours in all. If you are running this for a group, ask everyone to finish module 00 beforehand.

## What you need

- A laptop with **Docker** (Docker Desktop, OrbStack or Colima) given **8 GB of memory and 4 CPUs**, about **10 GB of free disk**, and `make` and `git`. Nothing else is installed: `k3d`, `kubectl` and `helm` run from containers.
- A **ClickHouse Cloud** account where you can create a service and a Managed Postgres instance.
- An internet connection.

Tested on macOS (Apple silicon) with OrbStack.

## Commands

Run `make help` for the full list. The ones you will use:

| | |
|---|---|
| `make prefetch` | download and build everything (module 00) |
| `make doctor` | check Docker, `.env` (shown masked) and both databases |
| `make ch-bootstrap`, `make pg-setup`, `make ch-search`, `make ch-mvs` | create the databases and tables, seed Postgres, build search, create the rollups |
| `make psql`, `make ch-client` | a SQL prompt on Postgres, on ClickHouse |
| `make cluster images secrets app` | start the local cluster and the application (module 05) |
| `make backfill`, `make generators-start`, `make sim-start USERS=4` | fill ClickHouse; start the live generators; start the browser shoppers |
| `make generators-stop`, `make sim-stop`, `make traffic-stop` | stop the generators, the shoppers, or both |
| `make break-card-gateway`, `make fix-card-gateway` | the module 08 exercise |
| `make status`, `make logs S=<service>` | the pods and the freshness of every table; follow a service's logs |
| `make check-NN` | check the end of module NN |
| `make apply-env` | after changing `.env`: update the cluster |
| `make nuke-data` | put orders and inventory back to the seed (events and telemetry are kept) |
| `make down` | delete the local cluster |

## One configuration file

Everything is configured in **`.env`** at the root of the repo. You create it from `.env.example` in module 01 and never edit another file to configure the workshop. It is ignored by git. `make doctor` checks it and shows every value masked.

## Where things are

```text
workshop/                 the modules (this is what you follow)
Makefile                  every command
.env.example              the one configuration template
sql/                      Postgres schema, ClickHouse tables, and example queries for the modules
frontend/                 the storefront (Next.js)
services/demo-service/    the 14 microservices of the checkout path (one image, one role each)
snowplow-bridge/          Snowplow Micro to ClickHouse
otel-collector/           the ClickStack collector image
data-generators/          the generators and the simulator (see its README)
deploy/                   the k3d cluster, the Helm charts, the tool wrappers
tools/                    the database tasks (seed, SQL runner, checks)
scripts/                  doctor, and the module checks in scripts/checks/
docs/decisions.md         why things are the way they are
```

## Troubleshooting

Each module has its own table. The usual suspects:

- `make doctor` fails: it says in words what to fix in `.env` or which service it cannot reach.
- Pods are `Pending` or evicted, or builds fail with "no space left": Docker's disk is full. Keep 10 GB free (`docker system df`).
- Something answers very slowly or times out: the Cloud services are reached over the internet; `make doctor` shows whether they answer.
- You changed `.env` and nothing happened: `make apply-env`.

`docs/decisions.md` records every decision and what was measured while building the workshop.
