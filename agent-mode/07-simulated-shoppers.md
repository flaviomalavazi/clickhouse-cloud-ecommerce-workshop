# Module 07: Simulated shoppers (agent playbook)

**Objective:** headless-browser shoppers use the storefront for real, placing orders that change Postgres and flow into ClickHouse, and the participant joins those orders to the clickstream, measures the replication lag, and watches the stock move.

**Step ids:** `start-shoppers`, `watch-orders`, `measure-lag`, `stock-moves`, `join-orders-clickstream`, `revenue`, `check`.

**Time:** guided about 30 minutes, 10 of them waiting for the shoppers; fast-track tour about 7.

## Preconditions

```bash
make check-06
```

It must pass. The generators may keep running; the simulator does not need them.

## Steps

### 1. `start-shoppers` [AGENT RUNS] Start the shoppers

(`make traffic-start` starts them together with module 06's generators.)

Skip if they are running already (the fast track's `make setup` starts them; check with `deploy/bin/kubectl -n clickshop get deploy simulator`: `READY 1/1` means running, `NotFound` means not).

```bash
make sim-start
deploy/bin/kubectl -n clickshop logs deploy/simulator --tail=10
```

It starts the browsers `SIM_USERS` in `.env` asks for (4 when it is not set; `make doctor` shows it). With 2, everything below that needs ten minutes of shoppers needs about twenty.

A pod starts four Chromium browsers (about 300 MB of memory each). Shoppers arrive at about **six a minute**, and each behaves like a person on the real storefront: opens a landing page, browses categories, searches, opens products, sometimes adds to the cart, and checks out with card, Pix or Boleto, in English, Portuguese or Spanish. About one session in six ends in an order. Every click goes through the real page, so the real Snowplow tracker emits the events, the real API writes the order and the real OpenTelemetry instrumentation records the traces. Explain the log line that prints every 30 seconds: `sessions` (shoppers arrived), `orders`, `failed` (orders refused: the card gateway failing in module 08) and `soldout` (found a product gone).

The first time, loading the browser image takes a little longer (1.5 GB). If the pod stays `Pending`, memory is short: they lower `SIM_USERS` in `.env`.

### 2. `watch-orders` [AGENT RUNS] Watch the orders arrive

```bash
make pg-query Q="SELECT id, status, payment_method, total_amount, created_at FROM orders ORDER BY id DESC LIMIT 5"
make ch-query Q="SELECT id, status, payment_method, total_amount, created_at FROM retail_oltp.orders FINAL WHERE _peerdb_is_deleted = 0 ORDER BY created_at DESC LIMIT 5"
```

New rows appear every minute or so in Postgres, with ids following the seeded history; the same orders show up in ClickHouse after the ClickPipe's next sync. Put the two outputs side by side: what is in one and not yet in the other is the replication lag.

### 3. `measure-lag` [AGENT RUNS] Measure the lag

```bash
make ch-query FILE=sql/clickhouse/examples/07_simulated_shoppers.sql N=4
make pg-query Q="SELECT max(created_at) FROM orders"
```

The gap between `newest_order_replicated` and Postgres' newest order is the CDC lag: up to the sync interval plus a few seconds. `seconds_since_last_sync` shows when the pipe last brought something in.

### 4. `stock-moves` [AGENT RUNS] Watch the stock move

```bash
make ch-query FILE=sql/clickhouse/examples/07_simulated_shoppers.sql N=3
```

The products that sold the most in the last hour against the stock they have left. Thirty products started with only 3 to 15 units, so within the run some sell out, and the shoppers who find them gone count under `soldout`. Postgres refused the second sale atomically, as in module 02.

### 5. `join-orders-clickstream` [AGENT RUNS] Join the orders to the clickstream

```bash
make ch-query FILE=sql/clickhouse/examples/07_simulated_shoppers.sql N=1
```

Explain the two keys: the **order id** (the `checkout_payment_confirmed` event carries it in `se_property`) and the **visitor** (`orders.domain_userid` is the browser id). Orders and events from the generators have no matching order, so the join returns only the real ones. Take an `order_id` from the result and run query 2 with that id in place of `12345` (read the statement in the file and run it with `make ch-query Q=...`): it lists **everything that shopper did**, before and after the order.

Say: "This is the point of the workshop in one query: a row written by a transaction in Postgres and a row written by a browser, joined in ClickHouse a few seconds later."

### 6. `revenue` [AGENT RUNS] Revenue by payment method

```bash
make ch-query FILE=sql/clickhouse/examples/07_simulated_shoppers.sql N=5
```

After about ten minutes of shoppers all three of `credit_card`, `pix` and `boleto` appear. Leave the shoppers **running**: module 08 needs the traffic. (They stop with `make sim-stop`, or `make traffic-stop` for the generators too.)

### 7. `check` [AGENT RUNS] The checkpoint

```bash
make check-07
```

Needs about ten minutes of shoppers: if it says an order of a payment method is missing, wait a little and run it again.

## Talking points

- **How a transaction reaches an analytical database:** the shopper's click is a Postgres transaction (order, items, stock); the ClickPipe carries it to ClickHouse in about a sync interval. Measure it, do not guess it.
- **Joining two systems' data:** orders (from Postgres, `retail_oltp`) and events (from the browser, `retail_analytics`) share keys (the order id, the browser id). ClickHouse joins them in one query because both are in it.
- **Real traffic, not random rows:** the shoppers click the real page, so the events, the orders and the traces are all genuine. That is also why module 08 has something to show.
- **A funnel from the order side:** about one session in six ends in an order, card is about half of them.

## Checkpoint

`make check-07` shows confirmed orders with all three payment methods since the seed, and the orders joining to their checkout events. (A ten-minute run of ours: 12 orders, card 5, Pix 5, Boleto 2, 12 customers, all 12 joined.) It ends `All checks passed`.

## Failure playbook

| Symptom | Diagnose | Fix |
|---|---|---|
| The simulator pod is `Pending` | `deploy/bin/kubectl -n clickshop describe pods -l deployment=simulator` (the Events at the end) | Not enough memory: they set `SIM_USERS=2` in `.env` and you run `make sim-start`, or they give Docker more. |
| No orders after several minutes | `deploy/bin/kubectl -n clickshop logs deploy/simulator --tail=30`; `make doctor` | Read the simulator's errors; the databases are the usual cause. |
| `failed` keeps rising | `deploy/bin/kubectl -n clickshop logs deploy/frontend --tail=40` | Orders are refused. If `make break-card-gateway` was run (module 08), `make fix-card-gateway`. |
| The join returns nothing | `make status` | The ClickPipe has not caught up, or the bridge is behind: wait a sync interval. |
| `check-07` wants an order of every method | `make ch-query FILE=sql/clickhouse/examples/07_simulated_shoppers.sql N=5` | Keep the shoppers running longer: about one in six sessions orders, and card is half of the orders (about twenty minutes with `SIM_USERS=2`). |

## Fast track

`make setup` started the shoppers, so by now there are orders. Tour steps 2, 3, 5 and 6 (about 7 minutes), and run `make check-07` when they have been running for ten minutes.

## Exit criteria

`make check-07` passes (or the participant chooses to move on; say so in `notes`). The shoppers keep running. Update the progress file: module `07` `done`; `current` module `08`.
