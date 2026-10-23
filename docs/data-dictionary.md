# ClickShop data dictionary

What every table of the workshop holds, in the words the shop uses, and the rules a query has to follow to get a right answer. It is the reference for anyone writing a question, and the raw material for the **ClickHouse Agents** instructions in [module 09](../workshop/en/09-clickhouse-agents/README.md).

Checked against a running workshop on 2026-10-21. Row counts are from that run and are only there to give a sense of size: yours will differ, and the live tables grow while the generators and shoppers run.

## 1. The map

Three databases in one ClickHouse service.

| Database | Where its data comes from | What it holds | How fresh |
|---|---|---|---|
| `retail_oltp` | **Postgres**, copied by the CDC ClickPipe. Postgres is the source of truth; nothing else writes here. | The shop's transactional data: catalogue, stock, customers, orders. | The pipe's sync interval (60 s) plus a few seconds. |
| `retail_analytics` | Written **straight to ClickHouse**: browser events through the Snowplow bridge, generated sessions and card transactions by the producers. Plus tables derived from them. | The clickstream, card transactions, the product search table and the dashboard rollups. | Seconds (batches of at most 5 s from the generators; the bridge polls every 2 s). `products_search` is the exception: the sync interval plus up to 5 minutes. |
| `retail_otel` | The OpenTelemetry collector, read by ClickStack. | Traces, logs, metrics and session replays of every part of the system. | Seconds. |

The story in one line: **transactions** live in Postgres and reach `retail_oltp`; **behaviour** goes straight to `retail_analytics`; **telemetry** goes to `retail_otel`. All three can be joined, because they are in the same service.

## 2. Rules every query must follow

1. **Replicated tables need `FINAL` and a delete filter.** Everything in `retail_oltp` is a `ReplacingMergeTree`: a change in Postgres is a new row with a higher `_peerdb_version`, and old versions linger until a merge removes them. Read with `FROM retail_oltp.<table> FINAL WHERE _peerdb_is_deleted = 0` (or take `argMax(col, _peerdb_version)` per id). Without it, an order that changed status is counted once per version.
2. **`products_search` is a plain table.** `FINAL` on it is an error. It already holds one row per product.
3. **NULLs did not survive replication.** The pipe was created with "Preserve NULL values" off, so a Postgres NULL is the type's default: `''` for text, `0` for numbers. `products.original_price = 0` means "no discount", and `name_pt = ''` means "not translated".
4. **JSON columns arrive as text.** `products.attributes`, `customers.address` and `orders.shipping_addr` are `JSONB` in Postgres and `String` in ClickHouse: use `JSONExtractString(col, 'key')` and its relatives.
5. **Money is in USD** in the catalogue and the orders (`price`, `unit_price`, `total_amount`) and in the checkout events' `se_value`. The storefront only *displays* a converted amount (`pt` as BRL at 5.4, `es` as MXN at 18). **Card transactions are different:** `credit_card_transactions.bill_value` is in the card's own `currency` and is never converted, so never sum it across currencies. (The shop's own card rows are labelled `BRL` but carry the order total in USD: see `credit_card_transactions`.)
6. **All timestamps are UTC.**
7. **Only active products are for sale.** `products.is_active` / `products_search.is_active` is `1` for 691 of 978 products. The other 287 are hidden from the storefront (a soft delete); filter them out unless the question is about them.
8. **Real and generated data look the same.** Most of the clickstream, and every card transaction, comes from generators (the card rows of the shop's own purchases are written for the *generated* purchases only). The orders in Postgres are seeded history plus the real ones. See section 8 for how to tell them apart, and for which rows join to what.
9. **Text search uses the full-text index.** `hasAllTokens(col, 'two words')` and `hasAnyTokens`; words split at anything that is not a letter, so `_` and `-` separate words. `hasToken` takes one word only.
10. **`se_property` means something different for each event**: a category slug, a count, a payment method's order id, a UUID. Never convert it unguarded: `toUUID` on it can throw `CANNOT_PARSE_UUID` even behind a filter on `event_name`, so use `toUUIDOrNull`, and compare an order id as `toString(orders.id) = se_property`.
11. **The rollups hold aggregate states.** Read them with `countMerge(...)` / `uniqMerge(...)`, never `count()` or `sum()` on the state columns. `uniq` is an estimate (about 0.5 % error).

## 3. The shop's vocabulary

- **Order status.** The storefront inserts an order as `pending` and, about two seconds later, moves it to `confirmed` (payment accepted) or `cancelled` (payment refused, and the stock put back). One thing to know: a **card** payment is authorized in a separate step *before* the order is written, so while the card gateway is down a card checkout stops there and leaves **no order at all**: that outage shows in the telemetry (`retail_otel`), not in `orders`. A refused Pix or Boleto payment happens after the order was written, so it does leave a `cancelled` order. `shipped` and `delivered` exist only in the seeded history: nothing in the workshop moves an order further. The pipe often delivers both changes in one batch, so ClickHouse usually never sees `pending`.
- **Payment methods:** `credit_card`, `pix`, `boleto`. About half of the orders pay by card.
- **Categories:** `it-accessories`, `books`, `shoes`, `clothing`, `electronics`.
- **The funnel**, in order: `page_view`, `product_click`, `cart_add_to_cart`, `checkout_start`, `checkout_payment_initiated`, `checkout_payment_confirmed`. A session's depth is how many of those it reached in order within an hour (`windowFunnel(3600)`, see `sql/clickhouse/examples/06_real_time_analytics.sql`). About one session in six ends in an order.
- **A search that found nothing** is a `search_text_search` event with `se_value = 0`: the number of results is in `se_value`. They show what customers want and the catalogue lacks (for example "summer dress").
- **Low stock** means `stock.quantity <= 15`: 30 active products start there, so they sell out while the shoppers run.
- **A card anomaly** is a transaction with exactly one corrupted field. There are seven kinds: a missing `merchant_name`; a missing `card_holder`; a negative `bill_value` on an `expense`; `installments = 0`; a `card_network` that is not Visa, Mastercard, Elo or Amex (the invalid one is `UCB`); a `card_bin` that contradicts the network (the leading digits are `4` for Visa, `51` to `55` for Mastercard, `34` or `37` for Amex, and a fixed list for Elo); and a `timestamp` a few hours in the future. The last stops being detectable once its time has passed, so a count of future-dated rows is only meaningful right after they are written. About 14 % of the background traffic is anomalous; of the shop's own purchases, 1 %.

## 4. `retail_oltp`: the transactional data (from Postgres)

Every table has `id` (single-column primary key) and the three pipe columns:

| Column | Meaning |
|---|---|
| `_peerdb_version` | Grows with every change to the row; the highest is the current row. |
| `_peerdb_is_deleted` | `1` when the row was deleted in Postgres (the delete is the newest version, and carries only the key). |
| `_peerdb_synced_at` | When the pipe wrote this version (UTC). |

(There is also a table named `_peerdb_raw_mirror_…`: the pipe's own staging area. Never query it.)

### `orders` (2,086 rows: two years of seeded history, then the real ones)

| Column | Type | Meaning |
|---|---|---|
| `id` | Int32 | Order number. The `se_property` of its `checkout_payment_confirmed` event, and the `clickshop.order_id` attribute of its trace. |
| `customer_id` | Int32 | → `customers.id`. |
| `status` | String | `pending`, `confirmed`, `shipped`, `delivered`, `cancelled` (section 3). |
| `payment_method` | String | `credit_card`, `pix`, `boleto`. |
| `domain_userid` | String | The shopper's browser id (the same `domain_userid` as in `snowplow_events`). **Empty for the seeded history**: only orders placed on the storefront have it (85 in our run). |
| `total_amount` | Decimal(12,2) | Order total, USD. |
| `shipping_addr` | String (JSON) | The seeded orders have a partial address such as `{"city": "…"}`; orders placed on the storefront have none (empty). |
| `notes` | String | Unused (always empty). |
| `created_at`, `updated_at` | DateTime64(6) | When the order was inserted, and when its status last changed (UTC). |

### `order_items` (6,088 rows)

| Column | Type | Meaning |
|---|---|---|
| `id` | Int32 | |
| `order_id` | Int32 | → `orders.id`. |
| `product_id` | Int32 | → `products.id`. |
| `quantity` | Int32 | Units. |
| `unit_price` | Decimal(10,2) | Price per unit **at the time of the order**, USD. |

There is no line total or subtotal column (logical replication does not carry generated columns): use `quantity * unit_price`.

### `products` (978 rows, 691 active)

| Column | Type | Meaning |
|---|---|---|
| `id` | Int32 | Product id (`product_id` everywhere else). |
| `category_id` | Int32 | → `categories.id`. |
| `sku` | String | Unique stock-keeping unit. |
| `name`, `description` | String | **English**: the source the translations were made from and their fallback. |
| `name_pt`, `name_es`, `description_pt`, `description_es` | String | Portuguese and Spanish. `''` = not translated. |
| `brand` | String | |
| `price` | Decimal(10,2) | Current price, USD. |
| `original_price` | Decimal(10,2) | Price before a discount, USD. `0` = no discount; `> price` = discounted (391 products). |
| `image_url` | String | |
| `is_active` | Bool | For sale (section 2, rule 7). |
| `attributes` | String (JSON) | Free-form properties; the keys depend on the category (books have `author`, `format`, `language`, `pages`). |
| `created_at`, `updated_at` | DateTime64(6) | |

### `stock` (one row per product)

| Column | Type | Meaning |
|---|---|---|
| `product_id` | Int32 | → `products.id`, unique. |
| `quantity` | Int32 | Units available now (the checkout decrements it atomically, and it never goes below 0). |
| `reserved` | Int32 | Unused (always 0). |
| `updated_at` | DateTime64(6) | |

### `customers` (586 rows: 500 seeded, the rest created at checkout)

`email` (unique), `first_name`, `last_name`, `phone`, `address` (String, JSON: `street`, `city`, `state`, `zip`, `country`), `created_at`.

### `categories` (5 rows)

`slug` (unique, section 3), `name` (for example "IT Accessories"), `description`, `banner_url`, `created_at`.

## 5. `retail_analytics`: behaviour, cards, search and rollups

### `snowplow_events` (about 7 million rows, 30 days; one row per event)

Every browser event arrives through Snowplow Micro and the bridge; generated sessions are written directly. Both have the same shape.

| Columns | Meaning |
|---|---|
| `event_id` | Unique id. |
| `collector_tstamp` | When the event was collected (UTC): the column to filter and group on. `dvce_created_tstamp` is when the browser created it. |
| `app_id`, `platform` | Always `clickshop` and `web`: they do not tell generated from real. |
| `domain_userid` | Anonymous browser id (a cookie). `domain_sessionid` is the session. `user_id` is **always empty** (the workshop has no sign-in). |
| `user_ipaddress` | The client IP address. `geo_country` and `geo_city` come from it (mostly `BR`, then `AR` and others). |
| `event` | `page_view` or `struct`. `event_name` is the one to use (below). `unstruct_event` is unused (always empty). |
| `page_url`, `page_urlpath`, `page_title`, `refr_urlpath` | The page the event happened on (with UTM parameters in `page_url`) and the referring path. |
| `se_category`, `se_action`, `se_label`, `se_property`, `se_value` | The structured-event fields (below). Empty for `page_view`. |
| `ctx_product_id`, `ctx_category_slug`, `ctx_search_query`, `ctx_search_type` | E-commerce context, copied by the bridge out of `se_label` / `se_property` so queries do not have to parse them. |
| `useragent`, `br_family`, `os_family`, `dvce_type` | The browser, the operating system and the device class (`Mobile`, `Computer`). |

**The event catalogue.** `event_name` is `page_view` for page views and `<se_category>_<se_action>` for the rest:

| `event_name` | `se_label` | `se_property` | `se_value` | `ctx_*` filled |
|---|---|---|---|---|
| `page_view` | | | | none (the page is in `page_*`) |
| `engagement_scroll` | scroll depth, like `50%` | | the depth as a number (25 to 90) | none |
| `product_click` | product id (text) | category slug | position of the product in the list (0 to 12) | `ctx_product_id`, `ctx_category_slug` |
| `search_text_search` | the search text | `text` (empty on searches typed in a real browser) | **number of results** (0 = found nothing) | `ctx_search_query`, `ctx_search_type` |
| `cart_add_to_cart` | product id (text) | category slug | unit price, USD | `ctx_product_id`, `ctx_category_slug` |
| `checkout_start` | | number of items in the cart (text) | cart total, USD | none |
| `checkout_payment_initiated` | payment method | | cart total, USD | none |
| `checkout_payment_confirmed` | payment method | **the order id** (section 8) | order total, USD | none |

### `credit_card_transactions` (about 230,000 rows)

| Column | Type | Meaning |
|---|---|---|
| `transaction_id` | UUID | Unique. For card payments of *generated* purchases it equals the purchase's order id (section 8). |
| `timestamp` | DateTime64(3) | When it happened (UTC). Rows dated in the future are anomalies. |
| `merchant_name` | Nullable(String) | `ClickShop` for the shop's own purchases. **NULL is an anomaly signal**, as is a NULL `card_holder`. |
| `card_holder` | Nullable(String) | |
| `merchant_type` | String | `retail`, `movies`, `drugstore_and_aesthetics`, `restaurants`. |
| `bill_value` | Decimal(12,2) | Amount **in `currency`**. Negative on 97 % of the chargebacks, **by design**. A negative `expense` is an injected anomaly, but the background traffic also has a few negative expenses that were not injected (about 2.6 % of its legitimate rows), so count negative amounts on `merchant_name = 'ClickShop'` for an exact figure. |
| `installments` | UInt8 | 1 to 6 (3 for some currencies). `0` is an anomaly. |
| `card_network` | String | `Visa`, `Mastercard`, `Elo`, `Amex`; `UCB` is the invalid one (an anomaly). |
| `card_bin`, `card_expiration_date` | UInt32, String | Leading digits of the card, and `MM/YY`. |
| `currency` | String | `BRL` for most; also `USD`, `EUR`, `ARS`, `CLP`, `COP`, `MXN`, `UYU`, `PYG`, `GBP`, `CAD`, `JPY`, `CHF`. **The shop's own rows (`merchant_name = 'ClickShop'`) are labelled `BRL` but carry the order total, which is in USD** (`bill_value` equals the purchase's `se_value` for about 96 % of them): do not convert it. |
| `type` | String | `expense`, or `chargeback` (a refund or dispute; about 29 % of the background traffic). |

The volume depends on whether the live generators have been running: the history is a trickle (the card payments of the generated purchases), the live producer writes about 10 transactions a second at the load in `.env.example` (`CC_TARGET_TPS`).

### `products_search` (978 rows; refreshed every 5 minutes)

Built from `retail_oltp.products`, `categories` and `stock` by the refreshable view `products_search_refresh`. One row per product, **inactive ones included**.

`product_id` (= `products.id`), `category_slug`, `sku`, `name`, `name_pt`, `name_es`, `description`, `description_pt`, `description_es`, `brand`, `price` (USD), `original_price` (`0` = no discount), `image_url`, `stock_quantity` (a copy of `stock.quantity` as of the last refresh, so it can lag the replica by up to the refresh interval), `is_active` (UInt8), `updated_at`. Three computed columns, `search_en`, `search_pt`, `search_es` (name, brand and description in that language, falling back to English), carry the full-text indexes and are not returned by `SELECT *`.

### The dashboard rollups

Small tables, fed on every insert into `snowplow_events` by materialized views, so a dashboard reads thousands of rows and not millions. They cover the last 35 days.

| Table | Grain | Columns (`*` = aggregate state) | Read it with | Answers |
|---|---|---|---|---|
| `analytics_events_1m` | minute × `event_name` | `minute`, `event_name`, `events`*, `uniq_users`*, `uniq_sessions`* | `countMerge(events)`, `uniqMerge(uniq_users)`, `uniqMerge(uniq_sessions)` | Events, visitors and sessions over time, by event type. |
| `analytics_pages_1h` | hour × `page_urlpath` (page views only) | `hour`, `page_urlpath`, `views`*, `uniq_users`* | `countMerge(views)`, `uniqMerge(uniq_users)` | Top pages. |
| `analytics_categories_1h` | hour × `category_slug` | `hour`, `category_slug`, `views`* | `countMerge(views)` | Which categories attract interest (product clicks and cart adds). |
| `analytics_searches_1h` | hour × `search_type` × `query` | `hour`, `search_type`, `query`, `searches`* | `countMerge(searches)` | Top searches. |
| `analytics_live_events` | raw rows of the **last 10 minutes** only | `collector_tstamp`, `domain_userid`, `page_urlpath`, `page_title` | plain columns | Who is on the site right now. Empty when there is no live traffic.

## 6. `retail_otel`: telemetry

Traces, logs, metrics and session replays of the storefront, its services, the bridge and the Kubernetes cluster. ClickStack reads these tables.

### `otel_traces` (a row per span)

`Timestamp` (UTC, nanoseconds), `TraceId`, `SpanId`, `ParentSpanId`, `SpanName`, `SpanKind` (`Internal`, `Server`, `Client`), `ServiceName`, `Duration` (**nanoseconds**: divide by 1e6 for milliseconds), `StatusCode` (`Unset`, `Ok`, `Error`), `StatusMessage`, `SpanAttributes` and `ResourceAttributes` (maps), and `Events.*` / `Links.*` arrays. `__hdx_materialized_rum.sessionId` is the browser session, which links a span to its replay.

**Services:** `retail-demo-frontend` (the storefront), `snowplow-bridge`, and the 14 checkout-path services `demo-storefront-bff`, `demo-catalog-svc`, `demo-checkout-svc`, `demo-order-svc`, `demo-pricing-svc`, `demo-inventory-svc`, `demo-ledger-svc`, `demo-email-gateway`, `demo-payment-card-svc`, `demo-payment-pix-svc`, `demo-payment-boleto-svc`, `demo-card-gateway`, `demo-pix-psp-gateway`, `demo-boleto-gateway`.

**The spans that carry business meaning:**

| `SpanName` | Attributes |
|---|---|
| `checkout.place_order` | `clickshop.order_id` (= `orders.id`), `clickshop.order_status`, `clickshop.payment_method`, `clickshop.item_count` |
| `search.products` | `search.query`, `search.locale`, `search.results` (0 = found nothing), `search.total`, `search.match_mode`, `search.read_rows`, `search.elapsed_ms`, `search.page`, `search.category`, `search.index` |
| `pg.query:<VERB> clickshop` (`SELECT`, `INSERT`, `UPDATE`, `BEGIN`, `COMMIT`) | `db.statement` (the SQL), `db.name`, `db.system` |
| `clickhouse.query` | `db.statement`, `db.name`, `db.system` |
| `snowplow.bridge.flush` | `snowplow.events.fetched`, `snowplow.events.inserted` |

A card gateway outage shows as error spans (`StatusCode = 'Error'`) in `demo-card-gateway` and in every service that calls it down the card path (`demo-payment-card-svc`, `demo-checkout-svc`, `demo-storefront-bff`, `retail-demo-frontend`); the one the failure starts in is the deepest of them.

Every span's `ResourceAttributes` has `service.name` and, for the workshop's pods, `k8s.namespace.name`, `k8s.deployment.name`, `k8s.pod.name`, `k8s.pod.uid` and `k8s.node.name`.

### `otel_logs` (a row per log line)

`Timestamp`, `TraceId` and `SpanId` (join to the trace), `SeverityText` (`info`, `warn`, `error`, `trace`), `ServiceName`, `Body` (the message), `LogAttributes`, `ResourceAttributes`, and materialized `__hdx_materialized_k8s.*` columns for the pod, node and namespace. **`Body` has a full-text index:** `hasAllTokens(Body, 'card gateway unavailable')` finds `card_gateway_unavailable`.

### `hyperdx_sessions` (browser session replays)

One row per recorded browser event: `Timestamp`, `TimestampTime`, `ServiceName`, `Body` (the recording event, as JSON), and `ResourceAttributes['rum.sessionId']`, which equals `__hdx_materialized_rum.sessionId` on `otel_traces`.

### Metrics

`otel_metrics_gauge`, `otel_metrics_sum` and `otel_metrics_histogram` (`otel_metrics_summary` and `otel_metrics_exponential_histogram` are empty). Common columns: `MetricName`, `MetricUnit`, `ServiceName`, `Attributes`, `ResourceAttributes`, `TimeUnix`; gauges and sums have `Value`, histograms have `Count`, `Sum`, `Min`, `Max`, `BucketCounts`, `ExplicitBounds`. Most are Kubernetes and host metrics, for example `k8s.container.restarts`, `k8s.pod.phase`, `k8s.deployment.available`, `container.cpu.utilization`, `k8s.pod.network.io`, `system.cpu.time`.

`otel_logs_kv_rollup_15m` and `otel_traces_kv_rollup_15m` (and their `_mv` views) are ClickStack's own helper tables for attribute suggestions: ignore them.

## 7. Where the numbers come from (and how they change)

| What | Moves when |
|---|---|
| `retail_oltp.*` | Something changes in Postgres: the seed, a shopper's order (the simulator or a person), `make nuke-data`. |
| `snowplow_events` | A browser event reaches the bridge, or a generator flushes a batch (at most every 5 s). History: 30 days, loaded once. |
| `credit_card_transactions` | The card producer flushes a batch, and the web producer writes one for each purchase it generates. |
| `products_search` | Every 5 minutes, and on `SYSTEM REFRESH VIEW retail_analytics.products_search_refresh` (asynchronous: follow it with `SYSTEM WAIT VIEW retail_analytics.products_search_refresh` to wait for the result). |
| Rollups | In the same insert as the events they summarise. |
| `retail_otel.*` | Continuously, while the cluster runs. |

## 8. Join keys, and real versus generated data

| From | To | Key | Notes |
|---|---|---|---|
| `orders` | `snowplow_events` | `toString(orders.id) = se_property`, with `event_name = 'checkout_payment_confirmed'` | **Real orders only** (85 in our run). Generated sessions carry a UUID in `se_property`, not an order id. |
| `orders` | `snowplow_events` | `orders.domain_userid = snowplow_events.domain_userid` | Only orders placed on the storefront have a `domain_userid`. Gives everything that shopper did. |
| `orders` | `otel_traces` | `toString(orders.id) = SpanAttributes['clickshop.order_id']`, `SpanName = 'checkout.place_order'` | Gives the trace of the checkout, its SQL and its failures. |
| `order_items` → `orders`, `products` | | `order_id`, `product_id` | |
| `products` → `categories` | | `category_id` | `snowplow_events.ctx_category_slug` and `products_search.category_slug` match `categories.slug`. |
| `stock`, `products_search` → `products` | | `product_id` | |
| `snowplow_events` → `products` | | `ctx_product_id = products.id` | On `product_click` and `cart_add_to_cart` only. |
| `credit_card_transactions` | `snowplow_events` | `toUUIDOrNull(se_property) = transaction_id`, with `event_name = 'checkout_payment_confirmed'` | **Generated purchases only** (about 15,000 in our run). A storefront order does not write a card transaction. |
| `otel_logs` ↔ `otel_traces` | | `TraceId`, `SpanId` | |
| `otel_traces` ↔ `hyperdx_sessions` | | `__hdx_materialized_rum.sessionId = ResourceAttributes['rum.sessionId']` | Browser spans and their replay. |

**Telling real from generated.** In `checkout_payment_confirmed`, a numeric `se_property` is a real order and a 36-character UUID is a generated purchase. Real browser searches have an empty `se_property`; generated ones have `text`. Beyond that the two are the same on purpose, so analytics over `snowplow_events` mixes them. Orders in Postgres are the seeded history plus the real ones: the generators never write an order.
