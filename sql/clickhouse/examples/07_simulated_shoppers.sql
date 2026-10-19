-- Module 07: simulated shoppers write orders to Postgres; their browsing goes straight
-- to ClickHouse. These queries put the two back together.

-- 1. Orders joined to the clickstream by order id: the `checkout_payment_confirmed`
--    event carries the Postgres order id in se_property.
SELECT
    o.id AS order_id, o.status, o.payment_method, o.total_amount,
    e.domain_userid, e.domain_sessionid, e.collector_tstamp
FROM retail_oltp.orders AS o FINAL
INNER JOIN retail_analytics.snowplow_events AS e ON toString(o.id) = e.se_property
WHERE e.event_name = 'checkout_payment_confirmed' AND o._peerdb_is_deleted = 0
ORDER BY e.collector_tstamp DESC
LIMIT 10;

-- 2. Everything one shopper did before and after an order, joined by visitor id.
--    Replace 12345 with an order id from query 1.
SELECT e.collector_tstamp, e.event_name, e.page_urlpath, e.se_label, e.se_property
FROM retail_analytics.snowplow_events AS e
WHERE e.domain_userid =
(
    SELECT domain_userid FROM retail_oltp.orders FINAL WHERE id = 12345 AND _peerdb_is_deleted = 0
)
ORDER BY e.collector_tstamp
LIMIT 50;

-- 3. Inventory movement: units ordered in the last hour against the stock that is left.
SELECT
    p.id AS product_id, p.name, sum(oi.quantity) AS units_ordered_last_hour, any(s.quantity) AS stock_now
FROM retail_oltp.order_items AS oi FINAL
INNER JOIN retail_oltp.orders AS o FINAL ON o.id = oi.order_id
INNER JOIN retail_oltp.products AS p FINAL ON p.id = oi.product_id
INNER JOIN retail_oltp.stock AS s FINAL ON s.product_id = oi.product_id
WHERE o.created_at >= now() - INTERVAL 1 HOUR
  AND o.status != 'cancelled'
  AND o._peerdb_is_deleted = 0 AND oi._peerdb_is_deleted = 0 AND s._peerdb_is_deleted = 0
GROUP BY p.id, p.name
ORDER BY units_ordered_last_hour DESC
LIMIT 10;

-- 4. CDC lag: how far behind Postgres is ClickHouse? Compare with
--    `SELECT max(created_at) FROM orders` run in Postgres (make psql).
SELECT
    max(created_at) AS newest_order_replicated,
    dateDiff('second', max(created_at), now()) AS seconds_since_newest_order,
    dateDiff('second', max(_peerdb_synced_at), now()) AS seconds_since_last_sync
FROM retail_oltp.orders;

-- 5. Revenue by payment method for confirmed orders.
SELECT payment_method, count() AS orders, round(sum(total_amount), 2) AS revenue
FROM retail_oltp.orders FINAL
WHERE status = 'confirmed' AND _peerdb_is_deleted = 0
GROUP BY payment_method
ORDER BY revenue DESC;
