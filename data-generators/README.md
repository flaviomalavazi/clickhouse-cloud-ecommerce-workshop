# ClickShop synthetic data generators

Three generators that produce a **coherent** e-commerce dataset for ClickHouse:
web analytics events and credit-card transactions that reference each other, with
a realistic funnel and a realistic time-of-day shape.

```
                                             ┌──────────────────────────┐
  simulator ──HTTP──▶ Snowplow ──▶ bridge ──▶│ snowplow_events          │
   (real sessions)      Micro                │                          │
                                             │ credit_card_transactions │
  web producer ────────┐                     └──────────────────────────┘
   (synthetic sessions) ├──▶ Kafka ──▶ Kafka Connect ──▶ ClickHouse
  cc producer ─────────┤
   (background txns)   ├──▶ direct INSERT, async_insert ──▶ ClickHouse
                       └──▶ NDJSON ──▶ file / S3   (cc producer only)
```

Everything is configured by **one file**, [`.env`](.env.example), and started by
**one script**, [`run.sh`](run.sh). ClickHouse credentials come from the repo
root's `../.env.local`/`../.env.cloud` — the same file the rest of the demo
uses — so there's nothing ClickHouse-specific to set here unless you want to
override it for this directory only.

```bash
cd data-generators
cp .env.example .env      # then edit: GENERATORS, EVENT_MODE, rates
./run.sh config           # print the resolved plan, start nothing
./run.sh                  # start it
./run.sh logs             # watch throughput
./run.sh down             # stop and clean up
```

---

## Contents

| | |
|---|---|
| [The three generators](#the-three-generators) | what each one is for |
| [Generation modes](#generation-modes) | `live` vs `mixed` |
| [How the data lines up](#how-the-data-lines-up) | the join between purchases and transactions |
| [Running](#running) | recipes for the common cases |
| [Sinks](#sinks) | Kafka vs. direct ClickHouse vs. file/S3 |
| [Tuning throughput](#tuning-throughput) | the knobs that actually move the needle |
| [Parameter reference](#parameter-reference) | every variable, grouped |
| [Verifying the output](#verifying-the-output) | queries that prove it worked |
| [Layout](#layout) | where things live |
| [Troubleshooting](#troubleshooting) | |

---

## The three generators

| Generator | `GENERATORS=` | Produces | Needs |
|---|---|---|---|
| **Web-events producer** | `web` | Complete synthetic sessions, **plus** the card transaction for every order it closes → Kafka topics **or direct to ClickHouse** | Kafka only when `PRODUCE_SINK=kafka` |
| **Credit-card producer** | `credit-card` | Background non-storefront transactions (restaurants, retail chains, pharmacies, cinemas) → Kafka topic, **direct to ClickHouse**, NDJSON files, or S3 | Kafka *only* when `CC_SINK=kafka` |
| **Simulator** | `simulator` | Real HTTP or headless-browser sessions against a live storefront → Snowplow collector | A running storefront |
| **Fraud generator** | `fraud` | A population of users with persistent behaviour profiles, normal sessions, and three account-takeover attack playbooks — direct to ClickHouse only. See [`fraud/README.md`](fraud/README.md) and [docs/fraud-detection/PLAN.md](../docs/fraud-detection/PLAN.md) | ClickHouse only (no Kafka path) |

Pick any combination — `GENERATORS=web,credit-card,simulator`. `run.sh` starts
only the infrastructure the selection actually needs, so `GENERATORS=simulator`
brings up no broker at all. Point both sinks away from Kafka
(`PRODUCE_SINK=clickhouse`, `CC_SINK=clickhouse`) and *nothing* Kafka-related is
started — no broker, no topics, no Connect, no connectors.

**Producer or simulator?** The producer is for volume and for history — it has no
storefront to be limited by and generates ~460,000 events/s into a local broker.
The simulator is for fidelity — it exercises the real app, so its events pass
through Snowplow enrichment exactly as a real visitor's would, and browser mode
even renders the pages. They emit the same funnel, so you can run either, or both.

### Why the producer generates sessions

It used to sample random rows from `snowplow_events` and re-emit them with fresh
ids, choosing each event's type independently from a weighted bucket. That
reproduced the right *marginal* distribution but destroyed every relationship in
the data: a row's `domain_sessionid` came from whichever source row was drawn, so
a "session" held events from unrelated users in no particular order, a purchase
had no cart before it, and nothing connected an order to a payment. It also could
not produce anything ClickHouse had not already seen.

It now runs the same `plan_session()` the simulator runs, from
[`shared/traffic_profile.py`](shared/traffic_profile.py) — the single file that
holds the funnel rates, the hour-of-day curve, the run modes, and the transaction
builder. Both Docker images copy that one file in, so the two halves cannot drift
apart, and either half still runs standalone on its own machine.

---

## Generation modes

`EVENT_MODE` decides where events land on the timeline. Every generator reads it,
so they always share one timeline.

### `EVENT_MODE=live` — everything is now

Every event is stamped at ~now. Nothing is backdated, so the entire run lands in
today's partition.

Use it when you want **maximum ingest today**, or a dashboard that shows live
traffic. A live session is anchored so its *last* event lands on ~now, which is
how a session that just finished actually looks; set `PRODUCE_DWELL_SCALE=0` to
collapse each session to a single instant instead.

In this mode the hour-of-day curve shapes the **emission rate** rather than the
timestamps — you cannot backdate a live stream.

### `EVENT_MODE=mixed` — history plus a live tail

`BACKFILL_RATIO` (default `0.5`) of sessions are dated at a random point inside
the last `BACKFILL_DAYS` (default `180`), with the hour of day drawn from the
weight curve; the remainder are live.

Use it to **build history and a live tail in one run** — the usual choice for a
fresh demo environment that needs trend charts as well as a live view.

Backfilled sessions stop `BACKFILL_GAP_DAYS` (default `1`) short of now, so
"today" stays purely live and the two populations never overlap. That means
`WHERE collector_tstamp >= today()` selects exactly the live traffic.

```bash
# One-shot: 6 months of history, then switch to live and leave it running
EVENT_MODE=mixed BACKFILL_RATIO=1.0 PRODUCE_MAX_EVENTS=50000000 ./run.sh
# ...then edit .env back to EVENT_MODE=live and PRODUCE_MAX_EVENTS=0
./run.sh
```

### The hour-of-day curve

One weight table in UTC-03 (the storefront is Brazilian) drives both backfilled
timestamps and live emission rate:

| UTC-03 | Behaviour | Rate vs. daily average |
|---|---|---|
| 00–06 h | Low — most users asleep | 0.10× – 0.69× |
| 07–11 h | Moderate — commute, then desk browsing | 0.52× – 0.86× |
| 12–13 h | Lunch spike | ~1.1× |
| 14–17 h | Post-lunch dip, then build | 0.69× – 1.1× |
| 18–22 h | **Peak** — evening shopping, apex at 20 h | 1.9× – **2.94×** |
| 23 h | Declining | ~1.1× |

The rate is interpolated between adjacent hours, so it never steps
discontinuously at the top of the hour. Edit `HOURLY_WEIGHTS` in
[`shared/traffic_profile.py`](shared/traffic_profile.py) to reshape it.

---

## How the data lines up

### The funnel

`plan_session()` rolls a whole session at once — bounce or not, which categories,
how deep, whether it converts — and both the simulator and the producer execute
that same plan. Measured over 40k sessions:

| | |
|---|---|
| Bounce rate | 41.6 % |
| Site conversion | 2.5 % |
| Events per session | 5.9 |
| Session duration | ~186 s (before `*_DWELL_SCALE`) |
| Per session | 3.00 page views · 1.37 scrolls · 1.28 product clicks · 0.16 searches · 0.05 add-to-carts · 0.025 purchases |

### Purchases ↔ card transactions

A purchase event carries the **order id** in `se_property`, and for card payments
that value *is* the transaction's `transaction_id`. No extra column, no lookup
table:

```sql
SELECT e.domain_sessionid,
       e.se_value      AS order_total,
       t.bill_value,
       t.card_network,
       t.installments,
       t.type
FROM       retail_analytics.snowplow_events           AS e
INNER JOIN retail_analytics.credit_card_transactions  AS t
        ON t.transaction_id = toUUID(e.se_property)
WHERE e.event_name  = 'checkout_payment_confirmed'
  AND t.merchant_name = 'ClickShop'
```

`merchant_name = 'ClickShop'` is reserved for storefront orders, so it isolates
exactly the reconcilable population — every other merchant is background traffic.

The transaction is stamped with the purchase event's own timestamp, so the order
and its payment agree to the millisecond.

**Two ways a purchase has no transaction**, both deliberate:

- `PURCHASE_PIX_SHARE > 0` — a pix transfer has no card behind it. At the default
  `0`, every purchase has exactly one matching transaction. Raise it to ~0.35 for
  Brazilian realism and a population of unmatched orders.
- **Browser mode.** Its payloads come from the frontend's JS tracker, which has
  no order id to put in `se_property`. Order-level reconciliation is a
  backend-mode and producer capability.

### The anomaly signal

A small share of transactions are corrupted in exactly one field —
null `merchant_name`/`card_holder`, negative `bill_value`, `installments=0`,
invalid `card_network` (`"UCB"`), a `card_bin` contradicting the network, or a
timestamp in the future. Storefront rates are `STOREFRONT_CHARGEBACK_RATE` (3 %)
and `STOREFRONT_FAULTY_RATE` (1 %); background traffic is deliberately noisier
(~29 % chargeback, ~14 % faulty) so fraud queries have something to chew on.

`transaction_id` is **never** corrupted, so a bad storefront transaction can
always be traced back to the web session that produced it — which is the demo.

### Event payload contract

Payloads match `frontend/src/lib/snowplow.ts` field for field, and the `ctx_*`
columns are derived exactly as `snowplow-bridge` derives them, so producer rows
and real browser rows are indistinguishable in ClickHouse:

| `event_name` | `se_label` | `se_property` | `se_value` |
|---|---|---|---|
| `page_view` | — | — | — |
| `product_click` | product id | category slug | grid position |
| `cart_add_to_cart` | product id | category slug | unit price |
| `search_text_search` | query | `text` | result count |
| `engagement_scroll` | `{pct}%` | — | pct |
| `checkout_start` | — | item count | order total |
| `checkout_payment_initiated` | payment method | — | order total |
| `checkout_payment_confirmed` | payment method | **order id** | order total |

The order id in `checkout_payment_confirmed.se_property` is the one extension
over the real tracker, which leaves it empty because it has no payment backend.

---

## Running

### Prerequisites

- Docker + Docker Compose v2
- A ClickHouse instance, with these migrations applied from the project root:
  `scripts/migrations/clickhouse/003_snowplow_events.sql` and
  `005_credit_card_transactions.sql`. The tables do **not** need to contain data
  first.
- For `GENERATORS=simulator`: a reachable ClickShop storefront.

### Recipes

```bash
cd data-generators
cp .env.example .env       # CLICKHOUSE_* come from ../.env.local/../.env.cloud
```

**Fill ClickHouse as fast as possible, all of it dated today, no Kafka.**
```ini
GENERATORS=web,credit-card
EVENT_MODE=live
PRODUCE_SINK=clickhouse     # both producers INSERT directly…
CC_SINK=clickhouse          # …so no broker, topics, or connectors are started
PRODUCE_TARGET_EPS=0        # 0 = flat out
CC_TARGET_TPS=0
PRODUCE_WORKERS=8
CC_WORKERS=8
```
Leave both sinks at `kafka` instead if the demo is about the streaming pipeline.

**Build six months of history, then leave a realistic live stream running.**
```ini
GENERATORS=web,credit-card
EVENT_MODE=mixed
BACKFILL_DAYS=180
BACKFILL_RATIO=0.5
PRODUCE_TARGET_EPS=20000    # daily average; peaks at ~59k/s around 20:00
CC_TARGET_TPS=10000
```

**Drive the real storefront with realistic traffic, indefinitely.**
```ini
GENERATORS=simulator
SIM_MODE=backend
SIM_URL=https://shop.example.com
SIM_SNOWPLOW_URL=https://shop.example.com:9040
SIM_DURATION=0              # run until stopped
SIM_ARRIVALS_PER_MINUTE=120 # daily average
SIM_SESSIONS=400
SIM_DIURNAL=true
```
```bash
./run.sh --remote           # remote target: joins no local networks
```

**Everything at once, on one machine.**
```ini
GENERATORS=web,credit-card,simulator
SIM_URL=http://host.docker.internal:3000
SIM_SNOWPLOW_URL=http://host.docker.internal:9090
```

**Card transactions to files or S3, no Kafka at all.**
```ini
GENERATORS=credit-card
CC_SINK=file                # or s3, with CC_S3_BUCKET
CC_OUTPUT_DIR_HOST=./output
```

### Commands

| | |
|---|---|
| `./run.sh` | start what `.env` asks for |
| `./run.sh config` | print the resolved plan, start nothing |
| `./run.sh up --logs` | start, then tail the generator logs |
| `./run.sh logs` | tail the generator logs |
| `./run.sh status` | show what is running |
| `./run.sh down` | stop and remove everything |
| `./run.sh --remote` | simulator targets a remote storefront |
| `./run.sh --env-file other.env` | use a different config file |
| `./run.sh --root-env-file ../other.env` | use a different root credentials file (default: auto-detect `../.env.local`/`../.env.cloud`) |

Kafka UI is on <http://localhost:8080> whenever a broker is running.

### Without Docker

Each generator is a plain Python program.

```bash
# Credit-card transactions to local files
cd data-generators/kafka/producer
pip install -r requirements.txt
CC_SINK=file EVENT_MODE=mixed python credit-card-transactions/credit_card_producer.py \
  --target-tps 5000 --max 1000000

# …or straight into ClickHouse, no broker involved
CLICKHOUSE_HOST=localhost CLICKHOUSE_PORT=8123 CLICKHOUSE_SSL=false \
CLICKHOUSE_USERNAME=default CLICKHOUSE_PASSWORD= CH_COMPRESSION= \
  python credit-card-transactions/credit_card_producer.py --sink clickhouse --max 1000000

# Web events to a broker
KAFKA_BOOTSTRAP_SERVERS=localhost:9092 EVENT_MODE=live \
  python web-events/producer.py

# …or web events straight into ClickHouse, no broker involved
PRODUCE_SINK=clickhouse CH_COMPRESSION= EVENT_MODE=live \
CLICKHOUSE_HOST=localhost CLICKHOUSE_PORT=8123 CLICKHOUSE_SSL=false \
CLICKHOUSE_USERNAME=default CLICKHOUSE_PASSWORD= \
  python web-events/producer.py

# Simulator
cd data-generators/simulator
pip install -r requirements.txt
playwright install chromium        # browser mode only
python simulate.py --url http://localhost:3000 --snowplow-url http://localhost:9090 \
  --duration 0 --sessions 400 --arrivals-per-minute 120
```

`shared/traffic_profile.py` is found automatically in a checkout — no
`PYTHONPATH` needed. `python simulate.py --help` and
`python credit_card_producer.py --help` list the CLI flags, which override the
environment.

---

## Sinks

Each producer chooses independently where its rows go.

**Web-events producer — `PRODUCE_SINK`**

| Value | Path | Needs |
|---|---|---|
| `kafka` (default) | JSON → `retail_events` + `credit_card_transactions` topics → Kafka Connect → ClickHouse | Broker + Connect + both connectors registered |
| `clickhouse` | JSONEachRow → HTTP `INSERT` with `async_insert`, into `snowplow_events` **and** `credit_card_transactions` | Nothing but ClickHouse |

**Credit-card producer — `CC_SINK`**

| Value | Path | Needs |
|---|---|---|
| `kafka` (default) | JSON → `credit_card_transactions` topic → Kafka Connect → ClickHouse | Broker + Connect + connector |
| `clickhouse` | JSONEachRow → HTTP `INSERT` with `async_insert` | Nothing but ClickHouse |
| `file` | NDJSON files in `CC_OUTPUT_DIR_HOST` | Nothing |
| `s3` | NDJSON files, then uploaded via boto3 | AWS credentials |

**Pick `kafka`** when the demo is *about* the streaming pipeline, or when
something else also consumes the topics.
**Pick `clickhouse`** when you just want rows in the tables — fewer moving parts,
no broker RAM to size, no connector to register, and no Kafka retention window to
out-run. It is both simpler and faster.
**Pick `file`/`s3`** when the demo is about object-storage ingestion (the `s3`
table function, ClickPipes) or you want a reusable dataset on disk.

`run.sh` starts only the infrastructure the chosen sinks require, so setting both
to `clickhouse` means no Kafka services at all:

```ini
GENERATORS=web,credit-card
PRODUCE_SINK=clickhouse
CC_SINK=clickhouse
```

### The ClickHouse sink

Both producers share one implementation
([`kafka/producer/clickhouse_sink.py`](kafka/producer/clickhouse_sink.py)), so
they batch, compress, retry, and insert identically — one set of `CH_*` settings
covers both.

Rows are buffered, serialised as JSONEachRow — the same JSON the Kafka path
produces, so the column mapping is identical and there is no Python→native type
conversion on the hot path — and POSTed with `async_insert=1`. ClickHouse
coalesces batches from every worker into its own buffer and writes a few large
parts instead of one part per request. Measured: 300,000 events across 4 workers
became 32 server-side flushes; 203,000 credit-card rows became a **single
203,000-row part**.

The web producer writes a session's events and its card transactions into two
tables through one client and one connection, transactions last — so a
transaction can never be visible before the purchase that produced it.

Batching is by size *and* age (`CH_BATCH_ROWS`, `CH_FLUSH_INTERVAL_S`). The age
bound is what makes a paced producer usable: at 50 rows/s a 10,000-row batch
would take three minutes to fill.

**Durability, and the one setting that goes with it.**
`CH_WAIT_FOR_ASYNC=false` (the default) returns as soon as the server has
buffered the batch — fastest, but a server crash loses whatever had not been
flushed. Set it `true` and ClickHouse acknowledges only once the data is durably
written.

With `true`, the client's request blocks until the server flushes its async
buffer, and the server does that when `CH_BUSY_TIMEOUT_MS` fires. That timer
therefore becomes a hard cap on inserts-per-second-per-worker. Measured on the
web producer at a 17,580 ev/s target:

| `CH_BUSY_TIMEOUT_MS` | Achieved | |
|---|---|---|
| `1000` | ~2,000 ev/s | 11 % of target — the client spends most of its time blocked |
| `200` | 17,729 ev/s | on target |
| `100` | 16,509 ev/s | on target — **the default when `CH_WAIT_FOR_ASYNC=true`** |

Which is why `CH_BUSY_TIMEOUT_MS` is left unset in `.env.example`: the producers
pick `100` ms with durable writes and `1000` ms without. Only pin it if you
specifically want to trade part size against latency. **If you set
`CH_WAIT_FOR_ASYNC=true` and also pin `CH_BUSY_TIMEOUT_MS=1000`, throughput will
collapse** — that combination is the one to avoid.

The web producer feels this roughly twice as hard as the credit-card producer,
because it writes two tables and so pays the blocking wait once per table.

**Compression** (`CH_COMPRESSION`) compresses the request body. Measured on a
realistic 10,000-row batch (3.4 MB of JSON, ~338 B/row) against the ~34 ms of CPU
it takes to generate that batch:

| Codec | Size | CPU cost | |
|---|---|---|---|
| `zstd` | 7.0× smaller | +11 % | **default** — best ratio per cycle |
| `lz4` | 4.0× smaller | +8 % | cheapest |
| `gzip` | 6.5× smaller | +70 % | rarely worth it here |
| *(empty)* | — | — | right when ClickHouse is on the same host |

If a batch cannot be inserted after `CH_MAX_RETRIES` attempts it is dropped with a
loud error rather than wedging the producer — losing synthetic rows is acceptable,
stalling generation is not.

---

## Tuning throughput

### The producers

Rates are **daily averages**, scaled by the hour-of-day curve. `PRODUCE_TARGET_EPS=20000`
means ~20,000 events/s averaged over 24 h — about 2,080/s at the 04:00 trough and
~59,000/s at the 20:00 peak. **Set a rate to `0` to disable pacing and run flat
out**, which is what you want for peak-ingest testing.

| Knob | Effect |
|---|---|
| `PRODUCE_TARGET_EPS` / `CC_TARGET_TPS` | Daily-average rate; `0` = unthrottled |
| `PRODUCE_WORKERS` / `CC_WORKERS` | Parallelism. Generation is CPU-bound, so scale to your cores |
| `PRODUCE_WORKER_MODE` / `CC_WORKER_MODE` | `process` scales past the GIL; `thread` caps near one core |
| `PRODUCE_INTERVAL_MS` / `CC_INTERVAL_MS` | **Legacy.** A `sleep()` per row caps a worker at ~1,000 rows/s and ignores the curve. Leave at `0` |

Measured on a laptop:

| | |
|---|---|
| Web events, generation only | ~184,000 events/s per core |
| Web events, sustained into a local broker (4 workers) | **~460,000 events/s**, ~78,000 sessions/s |
| Web events, sustained into ClickHouse directly (4 workers) | ~200,000 events/s |
| Bytes per row | event **977 B** vs transaction **337 B** (2.9×) |
| Card transactions, generation only | ~296,000 txn/s per core |
| Card transactions, sustained into ClickHouse directly (4 workers) | **~378,000 rows/s** |
| Card transactions, sustained to a file sink (4 workers) | ~170,000 txn/s |

Both will bury a small broker, which is why `.env.example` ships with targets set
rather than flat out. If the broker is the bottleneck, raise
`KAFKA_MEMORY_SIZE` and shorten `KAFKA_TOPIC_RETENTION_MS`.

### The simulator

The simulator is bounded by something different: **a session holds a concurrency
slot for its entire duration.** By Little's law,

```
SIM_SESSIONS  ≈  arrivals/second  ×  session duration  ×  peak multiplier
```

At `SIM_DWELL_SCALE=1` a session lasts ~186 s, so 120 arrivals/min (2/s) with the
diurnal peak needs ~1,100 slots. The simulator measures this at startup, prints
the concurrency it needs, and warns when `SIM_SESSIONS` is short — naming the
three ways to fix it. Excess arrivals are capped by `SIM_MAX_BACKLOG` and
reported as dropped rather than growing memory without bound.

`SIM_DWELL_SCALE` is the lever:

| `SIM_DWELL_SCALE` | Session duration | Effect |
|---|---|---|
| `1` | ~186 s | Realistic. Best when the demo shows session duration or dwell time |
| `0.05` | ~9 s | ~20× the sessions per slot |
| `0` | instant | Whole session coalesced into **one** HTTP request — the cheapest way to fill a dashboard |

For raw throughput: `SIM_DWELL_SCALE=0`, `SIM_DIURNAL=false`, and a large
`SIM_SESSIONS`. Note that `SIM_MODE=browser` is orders of magnitude slower than
`backend` — it runs a real Chromium per session.

---

## Parameter reference

### What runs

| Variable | Default | |
|---|---|---|
| `GENERATORS` | `web,credit-card` | Comma-separated: `web`, `credit-card`, `simulator` |
| `PRODUCE_SINK` | `kafka` | `kafka` \| `clickhouse` — web-events producer, see [Sinks](#sinks) |
| `CC_SINK` | `kafka` | `kafka` \| `clickhouse` \| `file` \| `s3` — credit-card producer |
| `PRODUCE_PURCHASE_CC` | `true` | Emit the card transaction for each order |

### Generation mode — read by every generator

| Variable | Default | |
|---|---|---|
| `EVENT_MODE` | `live` | `live` (all now) \| `mixed` (backfill + live) |
| `BACKFILL_DAYS` | `180` | History window for `mixed` |
| `BACKFILL_RATIO` | `0.5` | Share of sessions backdated in `mixed` |
| `BACKFILL_GAP_DAYS` | `1` | Backfill stops this far short of now |
| `PURCHASE_PIX_SHARE` | `0` | Share of orders with no card transaction |
| `STOREFRONT_CHARGEBACK_RATE` | `0.03` | Storefront chargebacks |
| `STOREFRONT_FAULTY_RATE` | `0.01` | Storefront anomalies |

### Web-events producer

| Variable | Default | |
|---|---|---|
| `PRODUCE_TARGET_EPS` | `0` | Daily-average events/s; `0` = flat out |
| `PRODUCE_WORKERS` | CPU count | Parallel workers |
| `PRODUCE_WORKER_MODE` | `process` | `process` \| `thread` |
| `PRODUCE_MAX_EVENTS` | `0` | Stop after N events; `0` = forever |
| `PRODUCE_STATS_INTERVAL_S` | `5` | Throughput reporting interval |
| `PRODUCE_RANDOM_SEED` | `42` | Per-worker seed; process-mode choices and IDs repeat with the same worker count |
| `PRODUCE_SITE_URL` | `https://clickhouse-demos.app.br` | Host used to build `page_url` |
| `PRODUCE_APP_ID` | `clickshop` | `app_id` column |
| `PRODUCE_DWELL_SCALE` | `1` | Intra-session gaps; `0` = one instant per session |
| `PRODUCE_USER_POOL` | `200000` | Distinct visitors, so returning-visitor analytics work |
| `PRODUCE_CATALOG_LIMIT` | `20000` | Products read from `products_search` at startup |
| `PRODUCE_INTERVAL_MS` | `0` | Legacy per-event sleep |

### Credit-card producer

| Variable | Default | |
|---|---|---|
| `CC_TARGET_TPS` | `0` | Daily-average txn/s; `0` = flat out |
| `CC_WORKERS` | CPU count | Parallel workers |
| `CC_WORKER_MODE` | `process` | `process` \| `thread` |
| `CC_MAX_TRANSACTIONS` | `0` | Stop after N; `0` = forever |
| `CC_POOL_SIZE` | `100000` | Pre-generated cardholder-name pool |
| `CC_STATS_INTERVAL_S` | `5` | Throughput reporting interval |
| `CC_RANDOM_SEED` | `42` | Per-worker seed; process-mode choices and IDs repeat with the same worker count |
| `CC_INTERVAL_MS` | `0` | Legacy per-txn sleep |
| `CC_FILE_ROWS` | `50000` | Rows per output file (`file`/`s3`) |
| `CC_OUTPUT_DIR_HOST` | `./output` | Host dir mounted for file output |
| `CC_S3_BUCKET` / `CC_S3_PREFIX` / `CC_S3_REGION` / `CC_S3_KEEP_LOCAL` | — | S3 sink |

### The ClickHouse sink — shared by both producers

Applies whenever `PRODUCE_SINK=clickhouse` and/or `CC_SINK=clickhouse`.

| Variable | Default | |
|---|---|---|
| `CH_EVENTS_TABLE` | `snowplow_events` | Web producer's event table |
| `CH_CC_TABLE` | `credit_card_transactions` | Web producer's storefront-transaction table |
| `CC_CH_TABLE` | `credit_card_transactions` | Credit-card producer's table |
| `CH_BATCH_ROWS` | `10000` | Rows per HTTP insert |
| `CH_FLUSH_INTERVAL_S` | `1` | Flush a partial batch after this long |
| `CH_WAIT_FOR_ASYNC` | `false` | `true` = wait for a durable write (~2.4× slower) |
| `CH_BUSY_TIMEOUT_MS` | `1000`, or `100` when `CH_WAIT_FOR_ASYNC=true` | Server-side `async_insert` flush timer. Caps inserts/s per worker under durable writes — leave unset |
| `CH_MAX_DATA_SIZE` | `10485760` | Server-side `async_insert` buffer size |
| `CH_COMPRESSION` | `zstd` | `zstd` \| `lz4` \| `gzip` \| `deflate`, or empty |
| `CH_MAX_RETRIES` | `5` | Attempts per batch before dropping it |
| `CH_CONNECT_ATTEMPTS` | `8` | Startup connection attempts |

### Simulator

| Variable | Default | CLI flag |
|---|---|---|
| `SIM_URL` | `http://host.docker.internal:3000` | `--url` |
| `SIM_SNOWPLOW_URL` | `http://host.docker.internal:9090` | `--snowplow-url` |
| `SIM_STOREFRONT_BFF_URL` | `SIM_URL` | Direct BFF base; local Compose uses `http://storefront-bff:8000` |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `${SIM_URL}/api/otlp` | Loadgen span destination |
| `SIM_MODE` | `backend` | `--mode` — `backend` \| `browser` \| `both` |
| `SIM_SESSIONS` | `5` | `--sessions` |
| `SIM_DURATION` | `120` | `--duration`; `0` = until stopped |
| `SIM_ARRIVALS_PER_MINUTE` | `10` | `--arrivals-per-minute` (daily average) |
| `SIM_DIURNAL` | `true` | `--diurnal` / `--no-diurnal` |
| `SIM_DWELL_SCALE` | `1` | `--dwell-scale` |
| `SIM_MAX_BACKLOG` | `4` | `--max-backlog` |
| `SIM_HEARTBEAT` | `30` | `--heartbeat` |
| `SIM_DRAIN` | `10` | `--drain` |
| `SIM_SEED` | *(unset)* | `--seed` |
| `SIM_INSECURE` | `false` | `--insecure` |
| `SIM_CC_BOOTSTRAP_SERVERS` | *(unset)* | Emit card transactions (backend mode; needs broker access) |
| `SIM_CC_TOPIC` | `credit_card_transactions` | |

### ClickHouse and Kafka

| Variable | Default | |
|---|---|---|
| `CLICKHOUSE_HOST` | — | Comes from `../.env.local`/`../.env.cloud` (derived from `CLICKHOUSE_URL`) unless set here; unset ⇒ web producer uses a synthetic catalog; **required** when either sink is `clickhouse` |
| `CLICKHOUSE_PORT` / `_DATABASE` / `_USERNAME` / `_PASSWORD` / `_SSL` | `8443` / `retail_analytics` / `default` / — / `true` | Also derived from the root file's `CLICKHOUSE_URL`/`CLICKHOUSE_USER` |
| `KAFKA_BOOTSTRAP_SERVERS` | `kafka:29092` | |
| `KAFKA_TOPIC` / `CC_TOPIC` | `retail_events` / `credit_card_transactions` | |
| `KAFKA_MEMORY_SIZE` | `2048m` | Broker's RAM-backed log dir. **This is RAM** — see [Troubleshooting](#troubleshooting) |
| `KAFKA_TOPIC_RETENTION_MS` | `10000` | Keep short; the log lives in RAM |
| `KAFKA_SEGMENT_BYTES` / `KAFKA_SEGMENT_MS` / `KAFKA_LOG_RETENTION_CHECK_INTERVAL_MS` | | Reclaim frequency |
| `CONNECT_REST_PORT` / `CONNECT_GROUP_ID` | `8083` / `connect-cluster` | |
| `CONFLUENT_*` | — | Confluent Cloud, see [kafka/README.md](kafka/README.md) |

---

## Verifying the output

```sql
-- 1. Event mix per session — compare against the funnel table above
SELECT event_name,
       count()                                        AS events,
       round(count() / uniq(domain_sessionid), 3)     AS per_session
FROM retail_analytics.snowplow_events
WHERE collector_tstamp >= now() - INTERVAL 1 HOUR
GROUP BY event_name ORDER BY events DESC;

-- 2. Sessions are coherent: one user, one device, one city each
SELECT countIf(users > 1 OR devices > 1) AS incoherent_sessions
FROM (
    SELECT domain_sessionid,
           uniq(domain_userid) AS users,
           uniq(useragent)     AS devices
    FROM retail_analytics.snowplow_events
    WHERE collector_tstamp >= now() - INTERVAL 1 HOUR
    GROUP BY domain_sessionid
);

-- 3. Every card purchase reconciles to exactly one transaction
SELECT count()                             AS purchases,
       countIf(t.transaction_id != toUUID('00000000-0000-0000-0000-000000000000')) AS matched,
       round(sum(abs(t.bill_value) - e.se_value), 2)                               AS total_amount_drift
FROM       retail_analytics.snowplow_events           AS e
LEFT JOIN  retail_analytics.credit_card_transactions  AS t
        ON t.transaction_id = toUUID(e.se_property)
WHERE e.event_name = 'checkout_payment_confirmed'
  AND e.se_label   = 'credit_card';

-- 4. The hour-of-day shape (run after a `mixed` backfill)
SELECT toHour(collector_tstamp - INTERVAL 3 HOUR) AS hour_utc3,
       count()                                    AS events,
       bar(count(), 0, max(count()) OVER (), 40)   AS shape
FROM retail_analytics.snowplow_events
WHERE collector_tstamp < today()
GROUP BY hour_utc3 ORDER BY hour_utc3;

-- 5. Fraud/anomaly signal, traced back to the web session that caused it
SELECT t.transaction_id, t.card_network, t.installments, t.bill_value,
       e.domain_sessionid, e.domain_userid, e.collector_tstamp
FROM       retail_analytics.credit_card_transactions  AS t
INNER JOIN retail_analytics.snowplow_events           AS e
        ON toUUID(e.se_property) = t.transaction_id
WHERE t.merchant_name = 'ClickShop'
  AND (t.card_network = 'UCB' OR t.installments = 0 OR t.card_holder IS NULL
       OR (t.type = 'expense' AND t.bill_value < 0))
LIMIT 20;
```

The generators also report their own numbers: the producers print events/s,
sessions/s, events-per-session and orders-vs-transactions every
`*_STATS_INTERVAL_S`, and the simulator prints a full funnel summary on exit.

---

## Layout

```text
data-generators/
├── README.md                          # this file
├── .env.example                       # the single config template
├── .env                               # your config (gitignored)
├── run.sh                             # the single launcher
├── docker-compose.kafka.yml           # broker + Connect + both producers
├── docker-compose.simulator.yml       # simulator, joins the local app network
├── docker-compose.simulator-remote.yml# simulator against a remote storefront
├── shared/
│   └── traffic_profile.py             # THE shared model: funnel rates, hour-of-day
│                                      #   curve, run modes, transaction builder.
│                                      #   Both images copy this one file in.
├── kafka/
│   ├── README.md                      # Kafka Connect & Confluent Cloud reference
│   ├── producer/
│   │   ├── Dockerfile                 # context is data-generators/
│   │   ├── requirements.txt
│   │   ├── web-events/producer.py
│   │   └── credit-card-transactions/credit_card_producer.py
│   ├── connector/                     # ClickHouse sink connector configs
│   ├── kafka-connect/Dockerfile       # cp-kafka-connect + the ClickHouse JAR
│   ├── scripts/                       # status.sh, watchdog, manual registration
│   └── running-in-confluent-cloud/    # managed-Kafka variant
└── simulator/
    ├── Dockerfile                     # context is data-generators/
    ├── requirements.txt
    ├── entrypoint.sh                  # env vars → CLI flags
    ├── simulate.py                    # arrival loop, CLI, stats
    ├── session_backend.py             # plan → Snowplow HTTP payloads
    ├── session_browser.py             # plan → Playwright browser actions
    ├── cc_sink.py                     # optional card-transaction emitter
    └── config.py                      # import shim over shared/traffic_profile.py
```

To change the *shape* of the data — funnel rates, traffic channels, device and geo
mix, search terms, the hour-of-day curve, cardholder names, merchant lists — edit
[`shared/traffic_profile.py`](shared/traffic_profile.py). To change *how much* or
*when*, edit `.env`.

---

## Troubleshooting

**`KAFKA_MEMORY_SIZE` is RAM, not disk.** The broker's log directory is a
RAM-backed tmpfs so a teardown leaves nothing behind. If it can grow larger than
the Docker VM's memory, filling it OOMs the **entire VM** — every container dies
within seconds, not just the broker. `run.sh` refuses to start if
`KAFKA_MEMORY_SIZE` is ≥ 60 % of the VM's memory.

**The producers out-run a small broker.** Flat out they generate hundreds of
thousands of rows per second, which can fill the in-RAM log faster than Kafka
reclaims it. Set `PRODUCE_TARGET_EPS` / `CC_TARGET_TPS`, or raise
`KAFKA_MEMORY_SIZE` and lower `KAFKA_TOPIC_RETENTION_MS`. The `producer-watchdog`
container stops the producers if the broker or Connect dies, so they cannot keep
generating into a dead pipeline.

**Throughput pinned near 1,000 rows/s per worker.** `PRODUCE_INTERVAL_MS` or
`CC_INTERVAL_MS` is non-zero. Each is a `sleep()` per row, so `1` caps a worker
at ~1,000/s regardless of everything else. Set both to `0`.

**The simulator drops arrivals.** `SIM_SESSIONS` is below what the arrival rate
needs. Read the warning it prints at startup: raise `SIM_SESSIONS`, lower
`SIM_ARRIVALS_PER_MINUTE`, or shorten sessions with `SIM_DWELL_SCALE`.

**The simulator emits no card transactions.** It needs all three of:
`SIM_CC_BOOTSTRAP_SERVERS` set, `SIM_MODE=backend`, and network access to the
broker *by the name the broker advertises*. The local broker advertises
`kafka:29092` internally, so the host-published port will not work from another
container — uncomment the `kafka` network in
[`docker-compose.simulator.yml`](docker-compose.simulator.yml) and use
`SIM_CC_BOOTSTRAP_SERVERS=kafka:29092`. `run.sh` warns when this is misconfigured.

**Rows reach Kafka but not ClickHouse.** Check the sink connectors:
`kafka/scripts/status.sh`, or Kafka UI at <http://localhost:8080>. Note that the
web producer writes to *both* topics, so the credit-card connector must be
registered even when `cc-producer` is not running — `run.sh` handles that, but
`docker compose up` by hand does not.

**Events/s is far below `PRODUCE_TARGET_EPS` (and below the credit-card rate).**
Almost always `CH_WAIT_FOR_ASYNC=true` combined with a pinned
`CH_BUSY_TIMEOUT_MS=1000` — see
[the durability note](#the-clickhouse-sink). Unset `CH_BUSY_TIMEOUT_MS` and the
producers pick a sane value. Each producer prints its live rate next to its
target, so `4,267 ev/s | … | target 17,973/s` tells you immediately that the sink,
not the generator, is the limit. Bear in mind an event row is 2.9× the bytes of a
transaction row and `snowplow_events` carries three skip indexes to
`credit_card_transactions`' two, so equal *row* rates are never equal work.

**A `clickhouse` sink drops batches.** The producer prints
`ClickHouse insert failed after N attempts, dropping batch` with the server's
error. Common causes: the table does not exist (apply migrations `003` and `005`),
the user lacks `INSERT` rights, or `CH_COMPRESSION` names a codec the server
rejects. Rows can also appear to be missing simply because `async_insert` has not
flushed yet — wait `CH_BUSY_TIMEOUT_MS` (1 s by default) before counting, or check
`system.asynchronous_insert_log`:

```sql
SELECT table, status, count() AS inserts, sum(rows) AS rows
FROM system.asynchronous_insert_log
WHERE table IN ('snowplow_events', 'credit_card_transactions')
GROUP BY table, status;
```

**Card transactions have odd values** — negative amounts, `installments=0`,
`card_network='UCB'`, null names, future timestamps. That is the anomaly signal,
not a bug. Set `STOREFRONT_CHARGEBACK_RATE=0` and `STOREFRONT_FAULTY_RATE=0` for
clean storefront data; background traffic is noisy by design.
