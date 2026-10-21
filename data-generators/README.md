# ClickShop data generators

Three generators that produce a **coherent** e-commerce dataset in ClickHouse: web analytics events and card transactions that reference each other, with a realistic funnel and a realistic time-of-day shape. They run as pods in the workshop's cluster and write **straight to ClickHouse**; there is no broker anywhere.

```text
  simulator ──HTTP──▶ storefront ──▶ Snowplow Micro ──▶ bridge ──▶ ┌─────────────────────────────┐
   (headless browsers,          └──▶ Postgres (real orders)        │ retail_analytics            │
    real orders)                                                    │   snowplow_events           │
                                                                    │   credit_card_transactions  │
  web producer ───────────────(batched INSERTs, 100,000 rows)─────▶ │                             │
   (synthetic sessions)                                             │                             │
  card producer ──────────────(batched INSERTs)───────────────────▶ └─────────────────────────────┘
   (background transactions)
```

Everything is configured in the **root `.env`** and started with `make`. The workshop's [module 06](../workshop/06-real-time-analytics/README.md) and [module 07](../workshop/07-simulated-shoppers/README.md) use these; this page is the reference.

| You want to | Run |
|---|---|
| load 30 days of history (5 million events, about 1½ minutes; skipped if it is already there, `FORCE=1` loads it again) | `make backfill` |
| start the live generators | `make generators-start` |
| start browser shoppers (4 by default) | `make sim-start USERS=4` |
| start both at once | `make traffic-start` (`USERS=4` sets the shoppers) |
| stop one, or everything | `make generators-stop`, `make sim-stop`, `make traffic-stop` |
| watch one | `make logs S=producer-web`, `S=producer-cc`, `S=simulator` |
| change a rate | edit `.env`, then `make apply-env` |

---

## The three generators

| Generator | Pod | Produces | Where it lands |
|---|---|---|---|
| **Web-events producer** (`producers/web_events.py`) | `producer-web` | Complete synthetic browsing sessions, **plus** the card transaction for every card order it closes | `snowplow_events`, `credit_card_transactions` |
| **Card producer** (`producers/credit_card.py`) | `producer-cc` | Background transactions that are not the storefront's (restaurants, retail chains, pharmacies, cinemas) | `credit_card_transactions` |
| **Simulator** (`simulator/simulate.py`) | `simulator` | Real headless-browser sessions against the live storefront, which place **real orders** in Postgres | everything the real app writes: Postgres, Snowplow, telemetry |

**Producer or simulator?** The producer is for volume and for history: it has no storefront to be limited by. The simulator is for fidelity: it drives the real app, so its events pass through Snowplow exactly as a real visitor's, its orders are real rows in Postgres that decrement real stock and travel through the ClickPipe, and its traces, logs and session replays appear in ClickStack. The producer's events cannot create orders in Postgres, by design: **only the simulator makes orders.**

Both halves plan a session with the same function, `plan_session()` in [`shared/traffic_profile.py`](shared/traffic_profile.py), the single file that holds the funnel rates, the hour-of-day curve, the run modes and the transaction builder. Both Docker images copy that file in, so the two cannot drift apart.

---

## Generation modes

`EVENT_MODE` decides where events land on the timeline. Every generator reads it.

**`live`** (the default for `make generators-start`): every event is stamped at about now, and the hour-of-day curve shapes the **rate** (you cannot backdate a live stream). A session is anchored so its *last* event lands on now, as a session that just finished does.

**`mixed`**: `BACKFILL_RATIO` of the sessions (default `0.5`) are dated at a random point inside the last `BACKFILL_DAYS` (default `180`), with the hour of day drawn from the weight curve; the rest are live. Backfilled sessions stop `BACKFILL_GAP_DAYS` (default `1`) short of now, so "today" stays purely live: `WHERE collector_tstamp >= today()` selects exactly the live traffic.

`make backfill` is a Kubernetes Job that runs the web producer with `EVENT_MODE=mixed BACKFILL_RATIO=1.0 BACKFILL_DAYS=30 PRODUCE_MAX_EVENTS=5000000 PRODUCE_WORKER_MODE=process PRODUCE_WORKERS=2 PRODUCE_TARGET_EPS=0`: history only, as fast as ClickHouse takes it. It is not part of the Helm release, so upgrading the chart never runs it again, and `make backfill` itself first checks for events older than two days in `snowplow_events` and skips the load when they are there (`make backfill FORCE=1` loads it anyway), so `make setup` can be repeated without doubling the history.

### The hour-of-day curve

One weight table in UTC-03 (the storefront is Brazilian) drives both the backfilled timestamps and the live rate:

| UTC-03 | Behaviour | Rate vs. daily average |
|---|---|---|
| 00–06 h | Low, most users asleep | 0.10× to 0.69× |
| 07–11 h | Moderate | 0.52× to 0.86× |
| 12–13 h | Lunch | about 1.1× |
| 14–17 h | Post-lunch dip, then build | 0.69× to 1.1× |
| 18–22 h | **Peak**, apex at 20 h | 1.9× to **2.94×** |
| 23 h | Declining | about 1.1× |

The rate is interpolated between hours. `PRODUCE_TARGET_EPS` and `CC_TARGET_TPS` are **daily averages**: at the default 200 events a second the evening peak is about 590. Edit `HOURLY_WEIGHTS` in `shared/traffic_profile.py` to reshape it.

---

## How the data lines up

### The funnel

`plan_session()` rolls a whole session at once (bounce or not, which categories, how deep, whether it converts). The **producers** use the realistic funnel:

| | |
|---|---|
| Bounce rate | 42 % |
| Search rate | 27 % |
| Product page to cart | 4 % |
| Cart to checkout | 72 % |
| Checkout to purchase | 68 % |

Measured over the workshop's 30-day backfill: 844,200 sessions of 5.92 events each, 20,901 orders (**2.5 %** of sessions) and 10,409 card transactions.

The **simulator** converts more, on purpose: at 2.5 % a run at six shoppers a minute would place an order every seven minutes. Its shoppers bounce 20 % of the time, search 40 %, add to cart 20 %, and go through checkout 95 % of the time, so about **one session in six ends in an order**. `SIM_REALISTIC_FUNNEL=true` gives the simulator the realistic rates.

### Payment methods

Every purchase has a payment method: **card 50 %, Pix 30 %, Boleto 20 %**. Only card payments leave a card transaction.

### Purchases and card transactions

For a **generated** purchase, `checkout_payment_confirmed.se_property` is an order id (a UUID), and for card payments that value **is** the transaction's `transaction_id`:

```sql
SELECT e.domain_sessionid, e.se_value AS order_total, t.bill_value, t.card_network, t.installments, t.type
FROM       retail_analytics.snowplow_events          AS e
INNER JOIN retail_analytics.credit_card_transactions AS t ON t.transaction_id = toUUIDOrNull(e.se_property)
WHERE e.event_name = 'checkout_payment_confirmed' AND t.merchant_name = 'ClickShop';
```

Use `toUUIDOrNull`, not `toUUID`: `se_property` holds a category slug or a count on other events, and ClickHouse may evaluate the conversion before the `WHERE`, which fails with `CANNOT_PARSE_UUID`. `merchant_name = 'ClickShop'` is reserved for storefront orders; every other merchant is background traffic from the card producer. A Pix or Boleto purchase has no transaction row, deliberately.

For a **real** (simulated-browser) order, `se_property` is the **Postgres order id**, which is what joins it to `retail_oltp.orders` (module 07):

```sql
... FROM retail_oltp.orders AS o FINAL
    INNER JOIN retail_analytics.snowplow_events AS e ON toString(o.id) = e.se_property
```

### The anomaly signal

A small share of card transactions is corrupted in exactly **one field**: a null `merchant_name` or `card_holder`, a negative `bill_value`, `installments = 0`, an invalid `card_network` (`UCB`), a `card_bin` that contradicts the network, or a **timestamp in the future** (1 to 5 hours ahead; this is why the newest card transaction can look "ahead of now"). The storefront's transactions are 3 % chargebacks (`STOREFRONT_CHARGEBACK_RATE`) and 1 % faulty (`STOREFRONT_FAULTY_RATE`); the card producer's background traffic is deliberately noisier, about 29 % chargebacks and 14 % faulty, so anomaly queries have something to find. `transaction_id` is never corrupted, so a bad storefront transaction can always be traced to the web session that produced it.

### Event payload contract

The payloads match `frontend/src/lib/snowplow.ts` field for field, and the `ctx_*` columns are derived as the Snowplow bridge derives them, so generated rows and real browser rows look the same in ClickHouse:

| `event_name` | `se_label` | `se_property` | `se_value` |
|---|---|---|---|
| `page_view` | | | |
| `product_click` | product id | category slug | grid position |
| `cart_add_to_cart` | product id | category slug | unit price |
| `search_text_search` | query | `text` | result count |
| `engagement_scroll` | `{pct}%` | | pct |
| `checkout_start` | | item count | order total |
| `checkout_payment_initiated` | payment method | | order total |
| `checkout_payment_confirmed` | payment method | **order id** | order total |

---

## The ClickHouse sink

Both producers write through [`shared/clickhouse_sink.py`](shared/clickhouse_sink.py), built for **large batches**:

- **One writer per table per process.** Threads in a process share it; each worker process has its own.
- A batch is sent when it reaches **`CH_BATCH_ROWS`** (100,000) rows **or** **`CH_FLUSH_INTERVAL_S`** (5) seconds, whichever comes first, and **at most one insert is in flight per table**. At the default live rate that is about 0.2 inserts a second per table.
- Rows go as compressed `JSONEachRow` (`zstd`, `CH_COMPRESSION`), about 14 times smaller on the wire.
- Inserts are **synchronous** by default. `CH_ASYNC_INSERT=true` opts in to ClickHouse's async inserts, and `CH_WAIT_FOR_ASYNC` to waiting for them.
- Failed inserts are retried (`CH_MAX_RETRIES`, 5), and the first connection is retried `CH_CONNECT_ATTEMPTS` (8) times.

Every flush logs one line:

```text
[flush] snowplow_events rows=100,000 bytes=98,142,336 wire=7,164,196 ms=2,673 server_written_rows=100000
```

`server_written_rows` is what ClickHouse reports having written; it should equal `rows`.

Why this matters: each insert creates a part, and every insert into `snowplow_events` also runs the five materialized views behind the dashboard ([module 06](../workshop/06-real-time-analytics/README.md)). Fewer, bigger inserts mean fewer parts and less merge work.

---

## Tuning throughput

**Producers.** A producer runs **`PRODUCE_WORKERS`** (default 2) workers, as threads (`PRODUCE_WORKER_MODE=thread`, right for live traffic) or as processes (`process`, for a backfill, where one Python process cannot generate fast enough). The same for the card producer with `CC_WORKERS` and `CC_WORKER_MODE`. Set the worker counts explicitly in a pod: a container sees the **node's** CPU count, not its limit. `PRODUCE_TARGET_EPS=0` or `CC_TARGET_TPS=0` removes the rate limit ("flat out"). In our backfill, two processes wrote about 48,000 to 77,000 events a second.

**Simulator.** Each browser is about 300 MB. How many you need follows Little's law: browsers = arrivals per second × session length, and a session lasts about 35 seconds at the default dwell scale. The simulator prints its own estimate at startup and warns if `SIM_SESSIONS` is too low (arrivals it cannot serve are dropped). At the defaults (6 a minute, dwell scale 0.1) that is about 3.6 browsers, hence 4. A flat arrival rate is the default; `SIM_DIURNAL=true` applies the hour-of-day curve, whose evening peak needs about three times as many browsers.

---

## The simulator

The simulator walks `plan_session()`'s plan through the real storefront in headless Chromium (Playwright): it follows the plan's searches, product views, cart adds and payment method instead of rolling its own.

- **Shoppers.** 5,000 deterministic shoppers (name and email, the email carries the pool index), so the `customers` table grows like a shop's: mostly new people at first, more repeat customers as the run goes on.
- **Language.** Sessions browse in `en-US`, `pt-BR` or `es-MX` (40 / 40 / 20 %), and search for the same planned term in that language: the storefront picks its UI language, and which text index a search uses, from the browser.
- **Depth.** A category page shows 12 products, so shoppers also page deeper (about 45 % of product picks come from page 2 or beyond), and orders reach the whole catalogue over a run, not only the cheapest dozen.
- **Image.** Chromium only, on `python:3.12-slim-bookworm` with Playwright 1.44.0 (1.5 GB).
- **Sold out** is detected by the absence of the add-to-cart button, and a 409 from checkout is read from the API response.

---

## Parameter reference

Variables with a ✎ are in `.env.example` (change them there). The rest have defaults in the code, and the chart sets the few that need it; set one for a single pod with `kubectl set env` or in the chart's values.

### Generation mode (every generator)

| Variable | Default | |
|---|---|---|
| `EVENT_MODE` | `live` | `live` or `mixed` |
| `BACKFILL_DAYS` | `180` | History window for `mixed` |
| `BACKFILL_RATIO` | `0.5` | Share of sessions backdated in `mixed` |
| `BACKFILL_GAP_DAYS` | `1` | Backfill stops this far short of now |

### Web-events producer

| Variable | Default | |
|---|---|---|
| `PRODUCE_TARGET_EPS` ✎ | `200` | Daily-average events a second; `0` = flat out |
| `PRODUCE_WORKERS` | `2` | Workers |
| `PRODUCE_WORKER_MODE` | `thread` | `thread` or `process` |
| `PRODUCE_MAX_EVENTS` | `0` | Stop after this many; `0` = run forever |
| `PRODUCE_DWELL_SCALE` | `1` | Scales the pauses in a session; `0` collapses a session to one instant |
| `PRODUCE_PURCHASE_CC` | `true` | Emit the card transaction of a card purchase |
| `PRODUCE_SITE_URL` | `http://localhost:3000` | The `page_url` the events carry |
| `PRODUCE_APP_ID` | `clickshop` | The `app_id` |
| `PRODUCE_USER_POOL`, `PRODUCE_NAME_POOL` | 200,000 / 20,000 | Generated visitors and cardholder names |
| `PRODUCE_CATALOG_LIMIT` | 20,000 | Products read from `products_search` (the catalogue the sessions browse) |
| `PRODUCE_RANDOM_SEED` | `42` | |
| `PRODUCE_STATS_INTERVAL_S`, `PRODUCE_INTERVAL_MS` | 5, 0 | Progress line period; a legacy per-event sleep |
| `CH_EVENTS_TABLE`, `CH_CC_TABLE` | `snowplow_events`, `credit_card_transactions` | Destination tables |

The producer needs `products_search` to have rows (module 04): it takes its catalogue from there and stops with a clear message if it is empty.

### Card producer

| Variable | Default | |
|---|---|---|
| `CC_TARGET_TPS` ✎ | `20` | Daily-average transactions a second; `0` = flat out |
| `CC_WORKERS`, `CC_WORKER_MODE` | `2`, `thread` | As for the web producer |
| `CC_MAX_TRANSACTIONS` | `0` | Stop after this many; `0` = forever |
| `CC_POOL_SIZE` | `100000` | Cards drawn at startup |
| `CC_RANDOM_SEED` | `42` | |
| `CC_CH_TABLE` | `credit_card_transactions` | |
| `STOREFRONT_CHARGEBACK_RATE`, `STOREFRONT_FAULTY_RATE` | `0.03`, `0.01` | Anomaly rates of the storefront's own transactions |

### The ClickHouse sink

| Variable | Default | |
|---|---|---|
| `CH_BATCH_ROWS` | `100000` | Rows per insert |
| `CH_FLUSH_INTERVAL_S` | `5` | Seconds per insert |
| `CH_ASYNC_INSERT`, `CH_WAIT_FOR_ASYNC` | `false`, `false` | Async inserts |
| `CH_COMPRESSION` | `zstd` | |
| `CH_MAX_RETRIES`, `CH_CONNECT_ATTEMPTS` | `5`, `8` | |
| `CH_MAX_DATA_SIZE`, `CH_BUSY_TIMEOUT_MS` | 10 MiB, 1000 | Async insert limits |

The connection itself comes from `CLICKHOUSE_HOST`, `CLICKHOUSE_PORT` (8443), `CLICKHOUSE_USER`, `CLICKHOUSE_PASSWORD` and `CLICKHOUSE_DATABASE` (default `retail_analytics`); TLS is on unless the host is `localhost`.

### Simulator

| Variable | Default | |
|---|---|---|
| `SIM_URL` | `http://frontend:3000` in the cluster | The storefront to drive |
| `SIM_SESSIONS` | `4` | Concurrent browsers. `make sim-start USERS=n` sets it |
| `SIM_ARRIVALS_PER_MINUTE` ✎ | `6` | New shoppers a minute |
| `SIM_DWELL_SCALE` ✎ | `0.1` | Multiplier on every pause (1 = realistic, minutes a visit) |
| `SIM_DURATION` | `0` | Seconds; `0` = until stopped |
| `SIM_DIURNAL` | `false` | Apply the hour-of-day curve to arrivals |
| `SIM_MAX_BACKLOG` | `4` | Queued sessions allowed, as a multiple of `SIM_SESSIONS` |
| `SIM_HEARTBEAT`, `SIM_DRAIN` | `30`, `10` | Seconds between progress lines; shutdown grace |
| `SIM_SEED` | unset | Seed for reproducible sessions |
| `SIM_REALISTIC_FUNNEL` | `false` | Use the producers' funnel |

---

## Verifying the output

```sql
-- how much, over how long
SELECT count() AS events, uniqExact(domain_sessionid) AS sessions, min(collector_tstamp), max(collector_tstamp)
FROM retail_analytics.snowplow_events;

-- the shape of the day: events per hour (UTC) over the last week
SELECT toHour(collector_tstamp) AS hour, count() FROM retail_analytics.snowplow_events
WHERE collector_tstamp > now() - INTERVAL 7 DAY GROUP BY hour ORDER BY hour;

-- card payments reconcile to purchases (generated ones)
SELECT count() FROM retail_analytics.snowplow_events AS e
INNER JOIN retail_analytics.credit_card_transactions AS t ON t.transaction_id = toUUIDOrNull(e.se_property)
WHERE e.event_name = 'checkout_payment_confirmed';

-- the inserts are large (rows per active part)
SELECT table, count() AS parts, round(sum(rows) / count()) AS avg_rows_per_part
FROM system.parts WHERE database = 'retail_analytics' AND active GROUP BY table;
```

`make status` prints the row count and the age of the newest row of every table, and `make check-06` and `make check-07` assert the numbers the modules promise.

---

## Layout

```text
data-generators/
  shared/      traffic_profile.py   the funnel, curve, run modes, session plan, transaction builder
               event_render.py      one Snowplow-shaped row per planned step
               clickhouse_sink.py   the batched writer
               clickhouse_env.py    connection settings, read from the environment
  producers/   web_events.py, credit_card.py, Dockerfile (one image, two commands)
  simulator/   simulate.py (the loop and the report), session_browser.py (one browser session),
               identity.py (shoppers, languages, search terms), config.py, entrypoint.sh, Dockerfile
  tests/       unit tests, run by `make test`
```

The images are built by `make images`; the pods are defined in `deploy/helm/clickshop/templates/` (`producers.yaml`, `backfill.yaml`, `simulator.yaml`).

### Without the cluster

For development you can run a generator on your own machine, with `.env` loaded as written (it is never sourced):

```bash
pip install -r data-generators/producers/requirements.txt
scripts/with-env.sh python data-generators/producers/web_events.py       # live web events
EVENT_MODE=mixed BACKFILL_RATIO=1.0 PRODUCE_MAX_EVENTS=100000 scripts/with-env.sh python data-generators/producers/web_events.py
scripts/with-env.sh python data-generators/producers/credit_card.py --max 10000

pip install -r data-generators/simulator/requirements.txt && playwright install chromium
scripts/with-env.sh python data-generators/simulator/simulate.py --url http://localhost:3000 --sessions 2 --duration 120
```

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| The web producer stops with "products_search is empty" | Module 04: `make ch-search`, then `SYSTEM REFRESH VIEW retail_analytics.products_search_refresh` and `SYSTEM WAIT VIEW retail_analytics.products_search_refresh`. |
| `[ERROR] CLICKHOUSE_HOST is not set` | The pod has no credentials: `make secrets`, then `make apply-env`. |
| Inserts are slow or time out | The network to ClickHouse Cloud, or `CH_BATCH_ROWS` too high for it. The flush line shows `ms`. |
| The simulator warns `SIM_SESSIONS is short` | Arrivals it cannot serve are dropped: raise `USERS`, lower `SIM_ARRIVALS_PER_MINUTE`, or lower `SIM_DWELL_SCALE`. |
| The simulator reports `failed` orders | The card gateway is broken (`make fix-card-gateway`), or the storefront cannot reach Postgres. |
| Newest card transactions are dated in the future | That is the anomaly signal (see above), not a clock problem. |
| A producer pod is `OOMKilled` | Lower `PRODUCE_WORKERS`, or raise the pod's memory limit in `values.yaml`. |
