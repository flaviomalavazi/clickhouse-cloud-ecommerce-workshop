# Module 07: Simulated shoppers

**Goal:** let headless-browser "shoppers" use the storefront for real, placing orders that change Postgres and flow into ClickHouse, then join the orders to the clickstream.

**Time:** about 30 minutes, 10 of them waiting for the shoppers. `make sim-start` takes 16 s.

**You'll learn:**
- how a transactional write (an order and its stock change) reaches an analytical database, and how to measure the lag;
- how to join two systems' data in ClickHouse: orders from Postgres and events from the browser;
- how a shopping funnel looks from the order side.

## Before you start

`make check-06` passes (module 06). Leave the generators running or stop them: the simulator does not need them (`make generators-stop`).

## Steps

### 1. Start the shoppers

If you ran `make setup` they are already running (four browsers): go to step 2. (`make traffic-start` starts them together with module 06's generators.)

```bash
make sim-start
make logs S=simulator
```

A pod starts four Chromium browsers (about 300 MB of memory each; `SIM_USERS` in `.env` changes how many). Shoppers arrive at about **six a minute**, and each one behaves like a person on the real storefront: opens a landing page, browses categories, searches, opens products, sometimes adds to the cart, and checks out with card, Pix or Boleto. They browse in English, Portuguese or Spanish and search in that language. About one session in six ends in an order. Every click goes through the real page, so the real Snowplow tracker emits the events, the real API writes the order, and the real OpenTelemetry instrumentation records the traces.

The log prints a line every 30 seconds:

```text
[sim] t+ 240s  active=3  x1.00 ( 6.0/min)  sessions=29  views=111  searches=5  carts=10  orders=8  failed=0  soldout=0
```

`sessions` is how many shoppers have arrived, `orders` how many placed one, `failed` how many orders were refused (the card gateway failing, in module 08), and `soldout` how many found a product gone.

### 2. Watch the orders arrive

In `make psql` (Postgres):

```sql
SELECT id, status, payment_method, total_amount, created_at FROM orders ORDER BY id DESC LIMIT 5;
```

New rows appear every minute or so, with the ids following 2,000 (the seeded history). In ClickHouse (SQL console, or `make ch-query Q="..."`), the same orders show up after the ClickPipe's next sync:

```sql
SELECT id, status, payment_method, total_amount, created_at
FROM retail_oltp.orders FINAL WHERE _peerdb_is_deleted = 0
ORDER BY created_at DESC LIMIT 5;
```

### 3. Measure the lag

Run query 4 of `sql/clickhouse/examples/07_simulated_shoppers.sql`:

```sql
SELECT max(created_at) AS newest_order_replicated,
       dateDiff('second', max(created_at), now()) AS seconds_since_newest_order,
       dateDiff('second', max(_peerdb_synced_at), now()) AS seconds_since_last_sync
FROM retail_oltp.orders;
```

Compare `newest_order_replicated` with `SELECT max(created_at) FROM orders` in Postgres: the gap is the CDC lag, up to the sync interval plus a few seconds. `seconds_since_last_sync` shows when the pipe last brought something in.

### 4. Watch the stock move

Query 3 of the same file lists the products that sold the most in the last hour against the stock they have left. Thirty products started with only 3 to 15 units, so within the run some sell out, and the shoppers who find them gone count under `soldout`. Postgres refused the second sale atomically, as you saw in module 02.

### 5. Join the orders to the clickstream

The orders are in `retail_oltp` (from Postgres), and the browsing is in `retail_analytics.snowplow_events` (from Snowplow, through the bridge). Two keys connect them:

- the **order id**: the `checkout_payment_confirmed` event carries it in `se_property`;
- the **visitor**: `orders.domain_userid` is the browser id.

Query 1:

```sql
SELECT o.id AS order_id, o.status, o.payment_method, o.total_amount,
       e.domain_userid, e.domain_sessionid, e.collector_tstamp
FROM retail_oltp.orders AS o FINAL
INNER JOIN retail_analytics.snowplow_events AS e ON toString(o.id) = e.se_property
WHERE e.event_name = 'checkout_payment_confirmed' AND o._peerdb_is_deleted = 0
ORDER BY e.collector_tstamp DESC LIMIT 10;
```

Take an `order_id` from the result and put it in query 2, which lists **everything that shopper did**, before and after the order. (Orders and events from the generators have no matching order, so the join returns only the real ones.)

This is the point of the workshop in one query: a row that was written by a transaction in Postgres, and a row that was written by a browser, joined in ClickHouse a few seconds later.

### 6. Revenue by payment method

Query 5 sums confirmed orders by `credit_card`, `pix` and `boleto`. After ten minutes you should see all three.

**Leave the shoppers running**: module 08 needs the traffic. When you are done with the whole workshop: `make sim-stop` (or `make traffic-stop` to stop the generators too).

## Checkpoint

After about ten minutes of shoppers:

```bash
make check-07
```

There are confirmed orders with all three payment methods since the seed, and the orders join to their checkout events. (When we ran it for ten minutes: 12 orders, card 5, Pix 5, Boleto 2, 12 distinct customers, all 12 joined.)

## Troubleshooting

| Symptom | Fix |
|---|---|
| `make sim-start` takes a while the first time | It loads the 1.5 GB browser image into the node (11 s on our machine). |
| The simulator pod is `Pending` | Not enough memory: lower `SIM_USERS` in `.env`, or give Docker more. |
| `failed` keeps rising | Orders are being refused. `make logs S=frontend`; if you ran `make break-card-gateway` in module 08, run `make fix-card-gateway`. |
| No orders after several minutes | `make logs S=simulator` for errors; `make doctor` for the databases. |
| The join returns nothing | The ClickPipe has not caught up yet, or the bridge is behind: `make status`. |
| `check-07` wants an order of every method | Keep the shoppers running a little longer: about one in six sessions orders, and card is half of the orders. With two browsers (Docker under 8 GB), give it about 20 minutes. |

## Going further

- `make sim-start USERS=8` doubles the browsers (and the memory) for one run; `SIM_USERS=8` in `.env` keeps it. The arrival rate and how short their pauses are come from `.env`: `SIM_ARRIVALS_PER_MINUTE` and `SIM_DWELL_SCALE`.
- Run module 06's funnel query again for the last hour and compare the conversion with what the generators produce.
- `data-generators/README.md` describes how the shoppers decide what to do.

**Next:** [module 08, Observability with ClickStack](../08-observability-clickstack/README.md).
