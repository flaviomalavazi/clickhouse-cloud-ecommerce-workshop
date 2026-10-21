-- Module 06: real-time analytics on the clickstream and card transactions.

-- 1. Events per minute for the last hour, read from the pre-aggregated rollup.
--    The aggregate states merge, so a coarser bucket is exact.
SELECT minute, countMerge(events) AS events, uniqMerge(uniq_sessions) AS sessions
FROM retail_analytics.analytics_events_1m
WHERE minute >= now() - INTERVAL 1 HOUR
GROUP BY minute
ORDER BY minute DESC
LIMIT 10;

-- 2. The purchase funnel: how far did each session get, in order, within an hour?
SELECT level, count() AS sessions
FROM
(
    SELECT
        domain_sessionid,
        windowFunnel(3600)(
            toDateTime(collector_tstamp),
            event_name = 'page_view',
            event_name = 'product_click',
            event_name = 'cart_add_to_cart',
            event_name = 'checkout_start',
            event_name = 'checkout_payment_initiated',
            event_name = 'checkout_payment_confirmed'
        ) AS level
    FROM retail_analytics.snowplow_events
    WHERE collector_tstamp >= now() - INTERVAL 7 DAY AND domain_sessionid != ''
    GROUP BY domain_sessionid
)
WHERE level > 0
GROUP BY level
ORDER BY level;

-- 3. Searches that returned nothing: products customers want and the catalogue lacks.
SELECT lower(ctx_search_query) AS query, count() AS searches
FROM retail_analytics.snowplow_events
WHERE event_name = 'search_text_search' AND se_value = 0 AND ctx_search_query != ''
GROUP BY query
ORDER BY searches DESC
LIMIT 10;

-- 4. Why large batches matter: rows per part. Many small inserts make many small
--    parts that background merges have to clean up.
SELECT table, count() AS active_parts, sum(rows) AS total_rows, round(sum(rows) / count()) AS avg_rows_per_part
FROM system.parts
WHERE database = 'retail_analytics' AND active AND table IN ('snowplow_events', 'credit_card_transactions')
GROUP BY table;

-- 5. Card transaction anomalies. A small share of transactions are corrupted in
--    exactly one field; each check below finds one kind. Negative amounts are counted
--    on expenses only: chargebacks are negative by design. (The background traffic
--    also has some negative expenses that were not injected, so that column reads a
--    little high; the shop's own `merchant_name = 'ClickShop'` rows are exact.)
SELECT
    countIf(merchant_name IS NULL)                                AS missing_merchant,
    countIf(card_holder IS NULL)                                  AS missing_card_holder,
    countIf(bill_value < 0 AND type = 'expense')                  AS negative_amount,
    countIf(installments = 0)                                     AS zero_installments,
    countIf(card_network NOT IN ('Visa', 'Mastercard', 'Elo', 'Amex')) AS unknown_network,
    countIf(timestamp > now())                                    AS dated_in_the_future,
    count()                                                       AS transactions
FROM retail_analytics.credit_card_transactions;

-- 6. The anomalous rows themselves.
SELECT transaction_id, timestamp, merchant_name, bill_value, installments, card_network
FROM retail_analytics.credit_card_transactions
WHERE merchant_name IS NULL OR card_holder IS NULL OR (bill_value < 0 AND type = 'expense') OR installments = 0
   OR card_network NOT IN ('Visa', 'Mastercard', 'Elo', 'Amex') OR timestamp > now()
ORDER BY timestamp DESC
LIMIT 10;
