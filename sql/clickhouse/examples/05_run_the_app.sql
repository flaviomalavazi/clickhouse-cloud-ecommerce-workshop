-- Module 05: follow an order from the storefront into ClickHouse.

-- 1. The newest orders as the CDC pipe delivered them (pending, then confirmed).
SELECT id, status, payment_method, total_amount, created_at, updated_at
FROM retail_oltp.orders FINAL
WHERE _peerdb_is_deleted = 0
ORDER BY created_at DESC
LIMIT 10;

-- 2. What was in those orders.
SELECT oi.order_id, p.name, oi.quantity, oi.unit_price, oi.quantity * oi.unit_price AS line_total
FROM retail_oltp.order_items AS oi FINAL
INNER JOIN retail_oltp.products AS p FINAL ON p.id = oi.product_id
WHERE oi.order_id IN
(
    SELECT id FROM retail_oltp.orders FINAL WHERE _peerdb_is_deleted = 0 ORDER BY created_at DESC LIMIT 3
)
  AND oi._peerdb_is_deleted = 0
ORDER BY oi.order_id, line_total DESC;

-- 3. Stock in Postgres' replica vs. what search shows. The two differ until the
--    refreshable view runs (up to a minute), unless you force it:
--      SYSTEM REFRESH VIEW retail_analytics.products_search_refresh;
SELECT
    s.product_id,
    s.quantity AS stock_in_replica,
    ps.stock_quantity AS stock_in_search,
    s.quantity != ps.stock_quantity AS stale
FROM retail_oltp.stock AS s FINAL
INNER JOIN retail_analytics.products_search AS ps ON ps.product_id = s.product_id
WHERE s._peerdb_is_deleted = 0
ORDER BY stale DESC, s.product_id
LIMIT 10;
