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
8. explore the data with **ClickHouse Agents**, and, if you want, watch what the agent does with **Langfuse Cloud** (an optional final step, [in module 09](workshop/09-clickhouse-agents/langfuse.md)).

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

The full picture (the four data paths, the checkout, how fresh each thing is) is in [docs/architecture.md](docs/architecture.md).

## Two ways to follow it

**The one-hour way.** Create the two Cloud services and an API key, fill in `.env` ([module 01](workshop/01-cloud-services/README.md)), and run **`make setup`**. It builds everything modules 01 to 08 build by hand (the ClickPipe and the ClickStack sources through the Cloud API, search, the real-time rollups, the local cluster and application, 30 days of history, the live generators and the browser shoppers) in about ten minutes (once `make prefetch` from module 00 has built the images), so the hour goes on reading the modules, looking at what was built and exploring it in ClickHouse Cloud.

**The slow way.** Follow the modules in order. Each one describes the same steps by hand, ends with a check (`make check-NN`; module 09 lives in the console, so it has none) and leaves the system working. Module 02 is optional.

You can also mix them: `make setup` is safe to run at any point, it skips what is done, and every piece has its own command (`make clickpipes`, `make ch-search`, `make ch-mvs`, `make clickstack-setup`, ...).

After `make setup` everything already runs, so each module becomes a tour: its check passes from the start and the steps that create things change nothing. Note that `make setup` leaves the generators and the shoppers running: they write about 200 events and 20 card transactions a second into your ClickHouse service until you run `make traffic-stop`.

## Human mode and agent mode

You can read the modules yourself (**human mode**: this README and `workshop/`), or have a coding agent guide you (**agent mode**): Claude Code, Codex, Cursor, Copilot or another that reads `AGENTS.md`. Open the repository (its root folder) in your agent and say *"start the workshop"* (in Claude Code, `/workshop`). It reads [`AGENTS.md`](AGENTS.md) and the playbooks in [`agent-mode/`](agent-mode/README.md), starts on the one-hour way (say so if you would rather go step by step), runs the commands, explains each one, and stops where only you can act: the Cloud console and the browser. You do not write code, and you never paste a secret into the chat: you edit `.env` yourself.

The two modes are separate texts that share the same commands (the `make` targets and `make check-NN`), so both end in the same place.

## The modules

Times are for a first run by hand, including the waiting.

| | Module | You learn | Time |
|---|---|---|---|
| 00 | [Prerequisites](workshop/00-prerequisites/README.md) | What the workshop needs; download everything **before the day** | 15 min + download |
| 01 | [Cloud services](workshop/01-cloud-services/README.md) | Create the ClickHouse and Postgres services; the single `.env`; load Postgres | 20 min |
| 02 | [Postgres OLTP](workshop/02-postgres-oltp/README.md) *(optional)* | Tour the transactional data; why it lives in Postgres | 10 min |
| 03 | [CDC ClickPipe](workshop/03-cdc-clickpipe/README.md) | Replicate Postgres into ClickHouse; `ReplacingMergeTree` and `FINAL` | 25 min |
| 04 | [Full-text search](workshop/04-full-text-search/README.md) | The `text` index, refreshable materialized views | 20 min |
| 05 | [Run the app](workshop/05-run-the-app/README.md) | The storefront on k3d; follow an order into ClickHouse | 25 min |
| 06 | [Real-time analytics](workshop/06-real-time-analytics/README.md) | Incremental materialized views; why large batches | 30 min |
| 07 | [Simulated shoppers](workshop/07-simulated-shoppers/README.md) | Orders from browsers; join Postgres and the clickstream | 30 min |
| 08 | [Observability with ClickStack](workshop/08-observability-clickstack/README.md) | Traces, logs, replays, infrastructure; break and fix | 40 min |
| 09 | [ClickHouse Agents](workshop/09-clickhouse-agents/README.md) | Build an agent, ask the data questions in plain language, check its answers *(draft: being verified in the console)* | 25 min |
| 10 | [Cleanup](workshop/10-cleanup/README.md) | Remove everything, in the right order | 10 min |

About four hours by hand, and about one hour with `make setup`. If you are running this for a group, ask everyone to finish module 00 beforehand, and read the [facilitator guide](workshop/FACILITATOR.md).

## Words you will meet

| Word | What it is here |
|---|---|
| **ClickHouse Cloud service** | The managed ClickHouse database you create in module 01. |
| **Managed Postgres** | ClickHouse Cloud's managed PostgreSQL. The shop's orders and catalogue live there. |
| **ClickPipe** | A managed ingestion job. Here it copies every change in Postgres into ClickHouse. |
| **CDC** (change data capture) | Reading the database's write-ahead log to copy each change as it happens, with no triggers and no application code. |
| **ReplacingMergeTree, `FINAL`** | A table that stores every version of a row and removes the old ones later. `FINAL` reads only the latest version. |
| **Text index** | ClickHouse's full-text index; `hasAllTokens` and `hasAnyTokens` search with it. |
| **Materialized view** | A query that runs on every insert and stores its result in another table. A *refreshable* one reruns on a schedule instead. |
| **Snowplow** | The open-source behaviour tracker the storefront uses. Snowplow Micro is its small collector, and Iglu is where it fetches its event schemas. |
| **OpenTelemetry** | The standard for traces, logs and metrics. A collector sends them to ClickHouse. |
| **ClickStack** | ClickHouse's observability product: the screens over those traces, logs, metrics and session replays. |
| **k3d** | Kubernetes running inside Docker containers, so your laptop needs nothing else installed. |
| **ClickHouse Agents** | ClickHouse Cloud's conversational agents (Beta) that answer questions about your data. |

## What you need

- A laptop with **Docker** (Docker Desktop, OrbStack or Colima) given **8 GB of memory and 4 CPUs**, about **10 GB of free disk**, and `make` and `git`. Nothing else is installed: `k3d`, `kubectl` and `helm` run from containers.
- A **ClickHouse Cloud** account where you can create a service and a Managed Postgres instance, and, for `make setup`, an **API key** with the Admin role.
- An internet connection.

Tested on macOS (Apple silicon) with OrbStack.

## Commands

Run `make help` for the full list. The ones you will use:

| | |
|---|---|
| `make prefetch` | download and build everything (module 00) |
| `make doctor` | check Docker, `.env` (shown masked) and both databases |
| `make setup` | **everything at once** (needs the API key): ClickPipe, search, rollups, cluster, ClickStack sources, history and load |
| `make ch-bootstrap`, `make pg-setup`, `make ch-search`, `make ch-mvs` | create the databases and tables, set up Postgres (`pg-migrate` then `pg-seed`), build search, create the rollups |
| `make clickpipes`, `make clickpipes-status`, `make clickstack-setup`, `make notebook` | the ClickPipe and the ClickStack sources through the Cloud API; the notebook that shows the ClickPipe request |
| `make psql`, `make ch-client` | a SQL prompt on Postgres, on ClickHouse |
| `make ch-query Q="SELECT 1"`, `make pg-query Q="SELECT 1"` | run SQL without a prompt (what an agent uses); `FILE=sql/clickhouse/examples/06_real_time_analytics.sql N=2` runs one numbered example query |
| `make up` | start the local cluster and the application in one go (module 05; it runs `make cluster images secrets app`) |
| `make traffic-start` | start the live generators and the browser shoppers together (`USERS=4` sets how many) |
| `make start` | all of the above: `make up`, then `make traffic-start` |
| `make backfill`, `make generators-start`, `make sim-start USERS=4` | fill ClickHouse; start the live generators; start the browser shoppers, each on its own |
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
workshop/                 the modules (human mode: this is what you follow)
AGENTS.md, agent-mode/    agent mode: the rulebook and one playbook per module
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
docs/architecture.md      the deeper dive: data paths, the checkout, observability, the local platform
docs/data-dictionary.md   every table and column, the join keys and the rules for querying them
docs/decisions.md         why things are the way they are
```

## Troubleshooting

Each module has its own table. The usual suspects:

- `make doctor` fails: it says in words what to fix in `.env` or which service it cannot reach.
- Pods are `Pending` or evicted, or builds fail with "no space left": Docker's disk is full. Keep 10 GB free (`docker system df`).
- Something answers very slowly or times out: the Cloud services are reached over the internet; `make doctor` shows whether they answer.
- You changed `.env` and nothing happened: `make apply-env`.

`docs/decisions.md` records every decision and what was measured while building the workshop.
