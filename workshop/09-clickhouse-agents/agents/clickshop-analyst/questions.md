<!-- TODO(owner): co-author. This file is a list of candidates, not the final questions. -->

# TODO(owner): co-author the questions for `clickshop-analyst`

> **Candidates, not final wording.** The questions the workshop uses are chosen and phrased together with the workshop's owner. Each candidate below says where its answer lives, how to **check** it (SQL that was run against a live workshop, so a participant can compare), and what a **wrong** answer tends to look like. Numbers in the checks depend on your data. The facts behind them are in [`docs/data-dictionary.md`](../../../../docs/data-dictionary.md).

| # | Theme | Candidate wording | Lives in | Check with | A wrong answer usually |
|---|---|---|---|---|---|
| 1 | Revenue | "What was our revenue by payment method over the last 30 days, and which method has the highest average order value?" | `retail_oltp.orders` | SQL 1 | forgets `FINAL`, counts cancelled or pending orders, or assumes BRL (it is USD) |
| 2 | Funnel | "Over the last 7 days, where do shoppers drop out between viewing a page and paying?" | `snowplow_events` | `06_real_time_analytics.sql` N=2 | counts events instead of sessions, or ignores the order of the steps |
| 3 | Search gaps | "Which searches returned no results in the last 7 days, most frequent first?" | `snowplow_events` | `06_real_time_analytics.sql` N=3 | looks for a "zero results" column (there is none: it is `se_value = 0` on `search_text_search`) |
| 4 | Inventory | "Which active products have fewer than 10 units left, and how many of each did we sell in the last 24 hours?" | `retail_oltp.stock`, `order_items`, `orders`, `products` | SQL 2 | forgets `FINAL` on one of the four tables, or includes inactive products |
| 5 | CDC freshness | "How far behind Postgres is the data you are reading right now?" | `retail_oltp.*` (`_peerdb_synced_at`) | `07_simulated_shoppers.sql` N=4 | reads a long gap since the last sync as lag when there were simply no writes |
| 6 | Card anomalies | "How many card transactions look corrupted, and of which kind?" | `credit_card_transactions` | `06_real_time_analytics.sql` N=5 | counts every negative amount (chargebacks are negative by design), or sums across currencies |
| 7 | Catalogue | "Which categories have the most discounted active products, and what is the average discount?" | `products_search` | SQL 3 | treats `original_price = 0` as a price, or adds `FINAL` to `products_search` |
| 8 | Two systems | "For the orders placed on the storefront, what was each shopper's first page and traffic source?" | `retail_oltp.orders` and `snowplow_events` | SQL 4 | joins on the wrong key; most orders have no `domain_userid` (only the real ones do) |
| 9 | Orders and traces | "Were any orders cancelled, and what happened in the services when they were?" | `retail_oltp.orders` and `retail_otel.otel_traces` | SQL 5 | needs module 08's gateway exercise first (until then nothing is cancelled); joins on a made-up key |
| 10 | Performance | "Which services are slowest at the 95th percentile?" | `retail_otel.otel_traces` | SQL 6 | reads `Duration` as milliseconds (it is nanoseconds), or mixes span kinds |

Ordered roughly from easy to hard: 1 to 4 need one table or one database, 5 and 6 need a rule, 7 to 10 cross databases or need domain knowledge. Questions 3, 5 and 6 are where an agent without the data dictionary in its instructions most often fails, which is the point of module 09, step 6.

## The checks

Run with `make ch-query Q='...'`, or paste in the SQL console. Examples are `FILE=sql/clickhouse/examples/<file> N=<number>`.

**SQL 1, revenue by payment method** (revenue here is every order that is not `pending` or `cancelled`: to decide with the owner)

```sql
SELECT payment_method, count() AS orders, round(sum(total_amount), 2) AS revenue_usd, round(avg(total_amount), 2) AS avg_order_usd
FROM retail_oltp.orders FINAL
WHERE _peerdb_is_deleted = 0 AND status NOT IN ('cancelled', 'pending') AND created_at >= now() - INTERVAL 30 DAY
GROUP BY payment_method ORDER BY revenue_usd DESC
```

**SQL 2, low stock and what sold**

```sql
SELECT p.id, p.name, s.quantity, coalesce(sold.units_24h, 0) AS units_sold_24h
FROM retail_oltp.stock AS s FINAL
INNER JOIN retail_oltp.products AS p FINAL ON p.id = s.product_id
LEFT JOIN
(
    SELECT oi.product_id AS product_id, sum(oi.quantity) AS units_24h
    FROM retail_oltp.order_items AS oi FINAL
    INNER JOIN retail_oltp.orders AS o FINAL ON o.id = oi.order_id
    WHERE o.created_at >= now() - INTERVAL 24 HOUR AND o.status != 'cancelled'
      AND o._peerdb_is_deleted = 0 AND oi._peerdb_is_deleted = 0
    GROUP BY oi.product_id
) AS sold ON sold.product_id = p.id
WHERE s._peerdb_is_deleted = 0 AND p._peerdb_is_deleted = 0 AND p.is_active AND s.quantity < 10
ORDER BY s.quantity, p.id
LIMIT 10
```

**SQL 3, discounts by category**

```sql
SELECT category_slug, countIf(original_price > price) AS discounted,
       round(avg(if(original_price > price, 100 * (original_price - price) / original_price, NULL)), 1) AS avg_discount_pct
FROM retail_analytics.products_search
WHERE is_active = 1
GROUP BY category_slug ORDER BY discounted DESC
```

**SQL 4, first page of the storefront's orders** (`utm_*` parameters are in the URL: `extractURLParameter(page_url, 'utm_source')`)

```sql
SELECT o.id AS order_id, o.payment_method, argMin(e.page_url, e.collector_tstamp) AS first_page
FROM retail_oltp.orders AS o FINAL
INNER JOIN retail_analytics.snowplow_events AS e ON e.domain_userid = o.domain_userid
WHERE o.domain_userid != '' AND o._peerdb_is_deleted = 0
GROUP BY o.id, o.payment_method ORDER BY o.id DESC LIMIT 10
```

**SQL 5, orders by status, and the same checkouts as the services saw them**

```sql
SELECT payment_method, status, count() AS orders
FROM retail_oltp.orders FINAL
WHERE _peerdb_is_deleted = 0 AND created_at >= now() - INTERVAL 1 DAY
GROUP BY payment_method, status ORDER BY payment_method, status;

SELECT SpanAttributes['clickshop.payment_method'] AS payment_method,
       SpanAttributes['clickshop.order_status'] AS status, count() AS checkouts
FROM retail_otel.otel_traces
WHERE SpanName = 'checkout.place_order' AND Timestamp > now() - INTERVAL 1 DAY
GROUP BY payment_method, status ORDER BY payment_method, status
```

**SQL 6, slowest services**

```sql
SELECT ServiceName, count() AS spans, round(quantile(0.95)(Duration) / 1e6, 1) AS p95_ms
FROM retail_otel.otel_traces
WHERE SpanKind = 'Server' AND Timestamp > now() - INTERVAL 1 DAY
GROUP BY ServiceName ORDER BY p95_ms DESC LIMIT 10
```

## To decide together

- How many questions the workshop uses, and in what order (the table above is easy to hard).
- Which ones are a **demo** (the facilitator asks, the room watches) and which are for the participant to run.
- What counts as "revenue", which decides the answer to question 1.
- Whether question 9 stays (it only works after module 08's exercise) or becomes part of that module's debrief.
