-- Module 04: full-text search on products_search.
--
-- Every search column has a `text` index whose preprocessor lower-cases and strips
-- accents, and hasAllTokens / hasAnyTokens apply the same preprocessor to the term.

-- 1. All of the words must appear.
SELECT product_id, name, brand, price, stock_quantity
FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAllTokens(search_en, 'running shoes')
ORDER BY stock_quantity > 0 DESC, price
LIMIT 10;

-- 2. Any of the words: the fallback when "all" finds nothing.
SELECT count() AS products
FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAnyTokens(search_en, 'running keyboard');

-- 3. Hyphenated and mixed-case terms need no special handling.
SELECT product_id, name
FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAllTokens(search_en, 'USB-C')
LIMIT 5;

-- 4. Other locales, with and without the accent.
SELECT count() AS with_accent
FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAllTokens(search_pt, 'tênis');

SELECT count() AS without_accent
FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAllTokens(search_pt, 'tenis');

SELECT product_id, if(name_es != '', name_es, name) AS nombre
FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAllTokens(search_es, 'zapatillas')
LIMIT 5;

-- 5. Is the text index used? Look for `Skip` -> `Name: idx_search_en` and the
--    granules read vs. total.
EXPLAIN indexes = 1
SELECT product_id
FROM retail_analytics.products_search
WHERE is_active = 1 AND hasAllTokens(search_en, 'running shoes');

-- 6. The refresh that keeps the table current, and how to force it.
SELECT view, status, last_success_time, last_success_duration_ms, next_refresh_time, written_rows, exception
FROM system.view_refreshes
WHERE database = 'retail_analytics';

-- Run this, then re-run query 1 of examples/05_run_the_app.sql to see a change at once:
-- SYSTEM REFRESH VIEW retail_analytics.products_search_refresh;
