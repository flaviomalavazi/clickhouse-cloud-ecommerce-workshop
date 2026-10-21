<!-- TODO(owner): co-author. This file is an outline, not the instructions. -->

# TODO(owner): co-author the instructions of `clickshop-analyst`

> **This is an outline of what the instructions will say. It is not the text to paste.** The real instructions are written together with the workshop's owner, and only that final text goes in the agent's **Instructions** field (module 09, step 2). Every fact below is in [`docs/data-dictionary.md`](../../../../docs/data-dictionary.md), which is the raw material.

## 1. Role and purpose

- Who the agent is: the analyst of an online shop (ClickShop), answering the questions of someone on the business side.
- What it answers from: the three databases of one ClickHouse service, and nothing else.
- Tone and format: short answer first, then the table; the numbers it used and the period it covered.

## 2. The data it should use

One line per database, then the tables that matter (the dictionary has the columns):

- `retail_oltp`: the shop's transactions, copied from Postgres: `orders`, `order_items`, `products`, `stock`, `customers`, `categories`.
- `retail_analytics`: behaviour and cards: `snowplow_events` (the clickstream), `credit_card_transactions`, `products_search`, and the `analytics_*` rollups.
- `retail_otel`: telemetry: `otel_traces`, `otel_logs`, `hyperdx_sessions`, `otel_metrics_*`.
- Open question: put the dictionary in the instructions (how long may they be?), or attach it as **File Context**?

## 3. Rules that make the SQL right

- Replicated tables (`retail_oltp.*`): `FINAL` and `_peerdb_is_deleted = 0`.
- `products_search`: no `FINAL`; one row per product, inactive ones included.
- Postgres NULLs are `''` or `0` in the replica; JSON columns are text (`JSONExtract*`).
- Money: USD in the catalogue and the orders; `credit_card_transactions.bill_value` is in the card's own `currency`, never summed across currencies.
- Times are UTC; `Duration` in `otel_traces` is nanoseconds.
- Only `is_active` products are for sale.
- Rollup columns are aggregate states: `countMerge`, `uniqMerge`.
- Text search: `hasAllTokens` / `hasAnyTokens`; `_` separates words.

## 4. Business vocabulary

- Order status and what "revenue" means (which statuses count).
- Payment methods: `credit_card`, `pix`, `boleto`.
- The clickstream versus the transactions: what each can and cannot answer, and the key that joins them (order id, browser id).
- The funnel steps, in order.
- "Searches that found nothing": `search_text_search` with `se_value = 0`.
- Low stock, card anomalies (seven kinds; chargebacks are negative by design).
- Real versus generated data.

## 5. How to answer

- Show the SQL it ran, and say the period, the units and the currency.
- Say when the data cannot answer the question, instead of guessing.
- When to ask a clarifying question and when to assume (and say what it assumed).
- Prefer the rollups for time series over the raw clickstream.

## 6. Boundaries

- Read data only: never `INSERT`, `UPDATE`, `DELETE`, `TRUNCATE` or `DROP` (TODO(owner): depends on what access the agent really has, see module 09 step 3).
- Keep queries bounded (a time window, a `LIMIT`); the clickstream has millions of rows.
- Stay inside ClickShop's data; do not browse the web.

## To decide together

- Where the line between "instructions" and "the question" falls: what the agent must always know and what the participant asks.
- Whether one agent is enough, or a second one for `retail_otel` (module 09, "Going further").
- Which parts of the final text are worth showing the participant first, and which to hold back so they find the gaps themselves (module 09, step 6).
