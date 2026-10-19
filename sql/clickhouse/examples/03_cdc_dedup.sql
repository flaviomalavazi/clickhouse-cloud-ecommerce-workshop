-- Module 03: what a Postgres CDC ClickPipe leaves in ClickHouse.
--
-- The pipe writes every change as a new row of a ReplacingMergeTree, versioned by
-- `_peerdb_version`, and marks rows deleted in Postgres with `_peerdb_is_deleted`.
-- Old versions are only removed when background merges happen, so a plain query can
-- see several versions of one order. (Column names are what the pipe creates:
-- confirm with `SHOW CREATE TABLE retail_oltp.orders`.)

-- 1. Physical rows vs. real orders. After an order moves pending -> confirmed
--    there are two rows for it until a merge collapses them.
SELECT count() AS physical_rows, uniqExact(id) AS distinct_orders
FROM retail_oltp.orders;

-- 2. FINAL collapses each order to its latest version at read time.
SELECT count() AS orders_with_final
FROM retail_oltp.orders FINAL
WHERE _peerdb_is_deleted = 0;

-- 3. Orders that currently have more than one stored version.
SELECT id, count() AS versions, max(_peerdb_version) AS latest_version
FROM retail_oltp.orders
GROUP BY id
HAVING versions > 1
ORDER BY latest_version DESC
LIMIT 10;

-- 4. Status counts: WITHOUT FINAL an order that changed status is counted twice.
SELECT status, count() AS wrong_without_final
FROM retail_oltp.orders
GROUP BY status
ORDER BY wrong_without_final DESC;

SELECT status, count() AS right_with_final
FROM retail_oltp.orders FINAL
WHERE _peerdb_is_deleted = 0
GROUP BY status
ORDER BY right_with_final DESC;

-- 5. The same answer without FINAL: keep the row with the highest version.
SELECT status, count() AS orders
FROM
(
    SELECT id, argMax(status, _peerdb_version) AS status, argMax(_peerdb_is_deleted, _peerdb_version) AS deleted
    FROM retail_oltp.orders
    GROUP BY id
)
WHERE deleted = 0
GROUP BY status
ORDER BY orders DESC;
