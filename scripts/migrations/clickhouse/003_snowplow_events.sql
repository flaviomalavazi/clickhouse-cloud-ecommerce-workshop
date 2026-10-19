CREATE TABLE IF NOT EXISTS retail_analytics.snowplow_events
(
    event_id            UUID                          DEFAULT generateUUIDv4(),
    collector_tstamp    DateTime64(3, 'UTC'),
    dvce_created_tstamp DateTime64(3, 'UTC'),
    app_id              LowCardinality(String)        DEFAULT '',
    platform            LowCardinality(String)        DEFAULT '',

    domain_userid       String                        DEFAULT '',
    domain_sessionid    String                        DEFAULT '',
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
