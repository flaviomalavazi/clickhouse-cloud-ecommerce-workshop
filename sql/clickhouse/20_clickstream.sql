-- High-volume event tables that bypass Postgres and are written straight to
-- ClickHouse: browser events (via the Snowplow bridge) and synthetic traffic
-- (via the producers), plus card transactions. Idempotent.

-- ── Snowplow events ─────────────────────────────────────────────────────────
-- One row per browser or generated event. The bridge and the web producer
-- write the same shape, so the two populations are indistinguishable.
--
-- `user_id` stays as an always-empty column: the workshop has no sign-in, but
-- the bridge and the producer both insert it.
CREATE TABLE IF NOT EXISTS retail_analytics.snowplow_events
(
    event_id            UUID                          DEFAULT generateUUIDv4(),
    collector_tstamp    DateTime64(3, 'UTC'),
    dvce_created_tstamp DateTime64(3, 'UTC'),
    app_id              LowCardinality(String)        DEFAULT '',
    platform            LowCardinality(String)        DEFAULT '',

    domain_userid       String                        DEFAULT '',
    domain_sessionid    String                        DEFAULT '',
    user_id             String                        DEFAULT '',
    user_ipaddress      String                        DEFAULT '',

    event               LowCardinality(String)        DEFAULT '',
    event_name          LowCardinality(String)        DEFAULT '',

    page_url            String                        DEFAULT '',
    page_urlpath        String                        DEFAULT '',
    page_title          String                        DEFAULT '',
    refr_urlpath        String                        DEFAULT '',

    se_category         LowCardinality(String)        DEFAULT '',
    se_action           LowCardinality(String)        DEFAULT '',
    se_label            String                        DEFAULT '',
    se_property         String                        DEFAULT '',
    se_value            Float64                       DEFAULT 0,

    unstruct_event      String                        DEFAULT '',

    useragent           String                        DEFAULT '',
    br_family           LowCardinality(String)        DEFAULT '',
    os_family           LowCardinality(String)        DEFAULT '',
    dvce_type           LowCardinality(String)        DEFAULT '',

    geo_country         LowCardinality(String)        DEFAULT '',
    geo_city            String                        DEFAULT '',

    ctx_product_id      UInt32                        DEFAULT 0,
    ctx_category_slug   LowCardinality(String)        DEFAULT '',
    ctx_search_query    String                        DEFAULT '',
    ctx_search_type     LowCardinality(String)        DEFAULT '',

    INDEX idx_domain_userid   domain_userid   TYPE bloom_filter(0.01) GRANULARITY 4,
    INDEX idx_event_name      event_name      TYPE set(100)            GRANULARITY 4,
    INDEX idx_page_urlpath    page_urlpath    TYPE tokenbf_v1(8192, 3, 0) GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(collector_tstamp)
ORDER BY (event_name, toDate(collector_tstamp), event_id)
TTL toDateTime(collector_tstamp) + INTERVAL 2 YEAR
SETTINGS index_granularity = 8192;

-- ── Credit-card transactions ────────────────────────────────────────────────
-- Background card traffic, plus a card transaction for each purchase the web
-- producer generates. For those, `transaction_id` is the purchase's order id,
-- so `toUUID(se_property) = transaction_id` joins them. Orders placed through
-- the storefront carry a Postgres order id instead (see sql/clickhouse/examples).
CREATE TABLE IF NOT EXISTS retail_analytics.credit_card_transactions
(
    transaction_id        UUID                          DEFAULT generateUUIDv4(),
    timestamp             DateTime64(3, 'UTC'),

    -- Nullable on purpose: NULL is the faulty-transaction (anomaly) signal.
    merchant_name         Nullable(String),
    card_holder           Nullable(String),

    merchant_type         LowCardinality(String)        DEFAULT '',
    bill_value            Decimal(12, 2)                DEFAULT 0,   -- signed: chargebacks/faulty < 0
    installments          UInt8                         DEFAULT 1,
    card_network          LowCardinality(String)        DEFAULT '',  -- incl. invalid "UCB" for faulty rows
    card_bin              UInt32                        DEFAULT 0,
    card_expiration_date  LowCardinality(String)        DEFAULT '',
    currency              LowCardinality(String)        DEFAULT '',
    type                  LowCardinality(String)        DEFAULT 'expense',

    INDEX idx_card_network card_network TYPE set(16)          GRANULARITY 4,
    INDEX idx_type         type         TYPE set(8)           GRANULARITY 4
)
ENGINE = MergeTree
PARTITION BY toYYYYMM(timestamp)
ORDER BY (merchant_type, card_network, toDate(timestamp), transaction_id)
TTL toDateTime(timestamp) + INTERVAL 2 YEAR
SETTINGS index_granularity = 8192;
