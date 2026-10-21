-- Product search on ClickHouse full-text search. Applied by `make ch-search`
-- (module 04), AFTER the Postgres CDC ClickPipe has created and filled
-- retail_oltp.products, categories and stock. Idempotent.
--
-- products_search is a plain MergeTree that a refreshable materialized view
-- rebuilds from the replicated Postgres tables every 5 minutes. Postgres stays
-- the single source of truth for the catalogue, and stock levels show up in
-- search. Freshness budget: ClickPipe sync interval + up to 5 minutes. To skip
-- the wait: SYSTEM REFRESH VIEW retail_analytics.products_search_refresh; (it only starts the refresh: SYSTEM WAIT VIEW retail_analytics.products_search_refresh; waits for it)
--
-- Because it is not a ReplacingMergeTree, FINAL on this table is an error.
--
-- Full-text search needs the `text` index, GA in ClickHouse 26.2+. The index
-- applies its `preprocessor` to the search term as well as to the data, so
-- queries need no lower() and no accent handling: the preprocessor lower-cases
-- and strips accents (NFD-decompose, then drop the combining marks), so "tenis"
-- finds "tênis" and "CAMARA" finds "cámara". Query it with hasAllTokens /
-- hasAnyTokens, which tokenize the needle with the index's own tokenizer:
--
--   WHERE hasAllTokens(search_en, 'running shoes')
CREATE TABLE IF NOT EXISTS retail_analytics.products_search
(
    product_id      UInt32,
    category_slug   LowCardinality(String),
    sku             String,
    name            String,
    name_pt         String,
    name_es         String,
    description     String,
    description_pt  String,
    description_es  String,
    brand           LowCardinality(String),
    price           Float32,
    original_price  Float32,             -- 0 = no discount
    image_url       String,
    stock_quantity  Int32,
    is_active       UInt8,
    updated_at      DateTime64(3, 'UTC'),

    -- One searchable string per locale. The English columns are the fallback
    -- when a translation is empty, and brand is identical in every locale.
    search_en String MATERIALIZED concat(name, ' ', brand, ' ', description),
    search_pt String MATERIALIZED concat(if(name_pt != '', name_pt, name), ' ', brand, ' ', if(description_pt != '', description_pt, description)),
    search_es String MATERIALIZED concat(if(name_es != '', name_es, name), ' ', brand, ' ', if(description_es != '', description_es, description)),

    INDEX idx_search_en search_en TYPE text(tokenizer = splitByNonAlpha, preprocessor = lower(replaceRegexpAll(normalizeUTF8NFD(search_en), '\\p{M}', ''))),
    INDEX idx_search_pt search_pt TYPE text(tokenizer = splitByNonAlpha, preprocessor = lower(replaceRegexpAll(normalizeUTF8NFD(search_pt), '\\p{M}', ''))),
    INDEX idx_search_es search_es TYPE text(tokenizer = splitByNonAlpha, preprocessor = lower(replaceRegexpAll(normalizeUTF8NFD(search_es), '\\p{M}', '')))
)
ENGINE = MergeTree
ORDER BY (category_slug, product_id);

-- Rebuilds products_search from the CDC tables every 5 minutes. Each refresh
-- replaces the whole table atomically, so readers never see a half-built one.
--
-- The CDC tables are ReplacingMergeTree: FINAL collapses each row to its latest
-- version, and `_peerdb_is_deleted` hides rows deleted in Postgres. The casts
-- make the output types independent of how the ClickPipe maps Postgres types.
CREATE MATERIALIZED VIEW IF NOT EXISTS retail_analytics.products_search_refresh
REFRESH EVERY 5 MINUTE
TO retail_analytics.products_search
AS
SELECT
    toUInt32(p.id)                                  AS product_id,
    c.slug                                          AS category_slug,
    p.sku                                           AS sku,
    p.name                                          AS name,
    p.name_pt                                       AS name_pt,
    p.name_es                                       AS name_es,
    p.description                                   AS description,
    p.description_pt                                AS description_pt,
    p.description_es                                AS description_es,
    p.brand                                         AS brand,
    toFloat32(p.price)                              AS price,
    toFloat32(p.original_price)                     AS original_price,
    p.image_url                                     AS image_url,
    toInt32(coalesce(s.quantity, 0))                AS stock_quantity,
    toUInt8(p.is_active)                            AS is_active,
    toDateTime64(p.updated_at, 3, 'UTC')            AS updated_at
FROM retail_oltp.products AS p FINAL
INNER JOIN retail_oltp.categories AS c FINAL ON c.id = p.category_id
LEFT JOIN
(
    SELECT product_id, quantity
    FROM retail_oltp.stock FINAL
    WHERE _peerdb_is_deleted = 0
) AS s ON s.product_id = p.id
WHERE p._peerdb_is_deleted = 0
  AND c._peerdb_is_deleted = 0;

-- CREATE ... IF NOT EXISTS leaves a view that was created with another schedule as it
-- was (an earlier version of this file refreshed every minute), so say the schedule once more.
ALTER TABLE retail_analytics.products_search_refresh MODIFY REFRESH EVERY 5 MINUTE;
