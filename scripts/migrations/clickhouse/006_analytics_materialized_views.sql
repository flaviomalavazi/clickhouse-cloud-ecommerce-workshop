-- Migration 006: Pre-aggregate the /demo/analytics dashboard with incremental MVs
--
-- Problem: every dashboard tile aggregated snowplow_events directly, and the
-- page polled all 8 endpoints every 5 seconds. snowplow_events is ordered by
-- (event_name, toDate(collector_tstamp), event_id) with event_id being a random
-- UUID, so within an (event_name, day) group the rows are in random order:
--   * nothing can prune below one-day granularity, so the two "last 10 seconds"
--     widgets read every row of today, twice, every 5 seconds
--   * the four tiles that do not filter event_name skip the sort key prefix
--     entirely and scan the whole partition
--
-- Fix: five narrow target tables fed by incremental materialized views. Each
-- dashboard tile now reads thousands of pre-aggregated rows instead of the raw
-- partition. Counts and uniques are kept as aggregate states so any time bucket
-- can be rolled up on read (minute -> hour -> day) without losing accuracy.
--
-- uniq (HyperLogLog, ~0.5% error) replaces the dashboard's previous uniqExact.
-- At demo volumes the difference is invisible and the state is a fixed few KB
-- instead of a hash set proportional to the number of distinct users.
--
-- IDEMPOTENCE: this file is re-applied on every deploy (both by the ClickHouse
-- container's docker-entrypoint-initdb.d and by scripts/seed/seed_clickhouse.py,
-- neither of which keeps a ledger of applied migrations). Every statement below
-- is therefore safe to re-run:
--   * all DDL is IF NOT EXISTS
--   * the backfills insert only time buckets that are not in the target yet,
--     so they fill gaps without ever double counting
--
-- The raw table's own sort key is a separate, one-shot fix that cannot be made
-- re-run safe under the no-ledger runner. It ships unwired in
-- scripts/migrations/clickhouse/manual/ - see the README there.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Per-minute event rollup
--    Serves: KPI "today" block, "Page Views - Last 24 Hours",
--            "Event Types - Today", "Sessions - Last 7 Days"
--
--    Minute granularity is the finest any tile needs, and rolling minutes up to
--    hours or days on read is exact because the uniq states merge.
--
--    ORDER BY leads with the (higher cardinality) time bucket rather than
--    event_name: every query here is a time-range scan, and at ~15k rows/day
--    the usual low-to-high cardinality guidance is not what decides performance.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retail_analytics.analytics_events_1m
(
    minute        DateTime('UTC'),
    event_name    LowCardinality(String),
    events        AggregateFunction(count),
    uniq_users    AggregateFunction(uniq, String),
    uniq_sessions AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(minute)
ORDER BY (minute, event_name)
TTL minute + INTERVAL 1 YEAR;

CREATE MATERIALIZED VIEW IF NOT EXISTS retail_analytics.analytics_events_1m_mv
TO retail_analytics.analytics_events_1m AS
SELECT
    toStartOfMinute(collector_tstamp)                     AS minute,
    event_name,
    countState()                                          AS events,
    uniqStateIf(domain_userid, domain_userid != '')        AS uniq_users,
    uniqStateIf(domain_sessionid, domain_sessionid != '')  AS uniq_sessions
FROM retail_analytics.snowplow_events
GROUP BY minute, event_name;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Per-hour page rollup (page_view events only)
--    Serves: "Top Pages - Today"
--
--    page_urlpath = '' is kept so the total is a faithful page_view count. The
--    dashboard filters it out on read.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retail_analytics.analytics_pages_1h
(
    hour         DateTime('UTC'),
    page_urlpath String,
    views        AggregateFunction(count),
    uniq_users   AggregateFunction(uniq, String)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (hour, page_urlpath)
TTL hour + INTERVAL 1 YEAR;

CREATE MATERIALIZED VIEW IF NOT EXISTS retail_analytics.analytics_pages_1h_mv
TO retail_analytics.analytics_pages_1h AS
SELECT
    toStartOfHour(collector_tstamp)                 AS hour,
    page_urlpath,
    countState()                                    AS views,
    uniqStateIf(domain_userid, domain_userid != '')  AS uniq_users
FROM retail_analytics.snowplow_events
WHERE event_name = 'page_view'
GROUP BY hour, page_urlpath;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Per-hour category interest rollup
--    Serves: "Category Interest - Today"
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retail_analytics.analytics_categories_1h
(
    hour          DateTime('UTC'),
    category_slug LowCardinality(String),
    views         AggregateFunction(count)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (hour, category_slug)
TTL hour + INTERVAL 1 YEAR;

CREATE MATERIALIZED VIEW IF NOT EXISTS retail_analytics.analytics_categories_1h_mv
TO retail_analytics.analytics_categories_1h AS
SELECT
    toStartOfHour(collector_tstamp) AS hour,
    ctx_category_slug               AS category_slug,
    countState()                    AS views
FROM retail_analytics.snowplow_events
WHERE ctx_category_slug != ''
GROUP BY hour, category_slug;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Per-hour search rollup
--    Serves: "Top Searches - Last 7 Days"
--
--    ctx_search_query was never indexed on the raw table, so this tile used to
--    scan 7 days of every event type to find the rows with a non-empty query.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retail_analytics.analytics_searches_1h
(
    hour        DateTime('UTC'),
    search_type LowCardinality(String),
    query       String,
    searches    AggregateFunction(count)
)
ENGINE = AggregatingMergeTree
PARTITION BY toYYYYMM(hour)
ORDER BY (hour, search_type, query)
TTL hour + INTERVAL 1 YEAR;

CREATE MATERIALIZED VIEW IF NOT EXISTS retail_analytics.analytics_searches_1h_mv
TO retail_analytics.analytics_searches_1h AS
SELECT
    toStartOfHour(collector_tstamp) AS hour,
    ctx_search_type                 AS search_type,
    ctx_search_query                AS query,
    countState()                    AS searches
FROM retail_analytics.snowplow_events
WHERE ctx_search_query != ''
GROUP BY hour, search_type, query;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Rolling 10-minute live event window
--    Serves: KPI "Active Now", "Current Visitors"
--
--    This is the one part of the dashboard a rollup cannot serve: both widgets
--    ask for the last 10 seconds, so they need raw rows. Rather than rebuild the
--    2-year raw table's sort key, mirror just the four columns those widgets
--    read into a table that is ordered by time and TTL'd to 10 minutes. It stays
--    a few thousand rows, and ORDER BY collector_tstamp makes the 10-second
--    window a couple of granules instead of a full scan of today.
--
--    merge_with_ttl_timeout keeps the TTL merge cadence at one per minute. Even
--    if expiry lags, the time-ordered key means the window read is unaffected.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS retail_analytics.analytics_live_events
(
    collector_tstamp DateTime64(3, 'UTC'),
    domain_userid    String,
    page_urlpath     String,
    page_title       String
)
ENGINE = MergeTree
ORDER BY collector_tstamp
TTL toDateTime(collector_tstamp) + INTERVAL 10 MINUTE
SETTINGS merge_with_ttl_timeout = 60;

CREATE MATERIALIZED VIEW IF NOT EXISTS retail_analytics.analytics_live_events_mv
TO retail_analytics.analytics_live_events AS
SELECT
    collector_tstamp,
    domain_userid,
    page_urlpath,
    page_title
FROM retail_analytics.snowplow_events
WHERE domain_userid != '';

-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill
--
-- Materialized views only see rows inserted after they are created, so without
-- this the 7-day tiles would start empty and slowly fill in.
--
-- Each backfill inserts only the time buckets that are absent from the target,
-- which makes it both re-run safe and self-healing: if the Snowplow bridge is
-- down for a while, the next deploy fills the gap it left.
--
-- The in-progress bucket is deliberately NOT excluded. Aggregate states merge,
-- so the backfill covering the first half of a bucket and the live MV covering
-- the rest is exactly right - excluding it instead threw away everything from
-- the top of the current hour, which is how the "Top Pages" and "Category
-- Interest" tiles came up short against the raw table in testing.
--
-- Bounded to 35 days. The production table holds ~1 billion rows of mostly
-- historical events, and the dashboard's widest window is 30 days, so folding the
-- entire history into per-minute buckets would be a very expensive one-off scan
-- producing rows nothing ever reads. 35 gives the 30-day view some headroom.
-- Raise it if you want deeper history in the rollups, but note the cost is a full
-- scan of everything inside the bound.
--
-- analytics_live_events is deliberately not backfilled: it only ever holds the
-- last 10 minutes, and the live MV populates it within one bridge poll.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO retail_analytics.analytics_events_1m
SELECT
    toStartOfMinute(collector_tstamp)                     AS minute,
    event_name,
    countState()                                          AS events,
    uniqStateIf(domain_userid, domain_userid != '')        AS uniq_users,
    uniqStateIf(domain_sessionid, domain_sessionid != '')  AS uniq_sessions
FROM retail_analytics.snowplow_events
WHERE collector_tstamp >= now() - INTERVAL 35 DAY
  AND toStartOfMinute(collector_tstamp) NOT IN (
      SELECT minute FROM retail_analytics.analytics_events_1m
  )
GROUP BY minute, event_name;

INSERT INTO retail_analytics.analytics_pages_1h
SELECT
    toStartOfHour(collector_tstamp)                 AS hour,
    page_urlpath,
    countState()                                    AS views,
    uniqStateIf(domain_userid, domain_userid != '')  AS uniq_users
FROM retail_analytics.snowplow_events
WHERE event_name = 'page_view'
  AND collector_tstamp >= now() - INTERVAL 35 DAY
  AND toStartOfHour(collector_tstamp) NOT IN (
      SELECT hour FROM retail_analytics.analytics_pages_1h
  )
GROUP BY hour, page_urlpath;

INSERT INTO retail_analytics.analytics_categories_1h
SELECT
    toStartOfHour(collector_tstamp) AS hour,
    ctx_category_slug               AS category_slug,
    countState()                    AS views
FROM retail_analytics.snowplow_events
WHERE ctx_category_slug != ''
  AND collector_tstamp >= now() - INTERVAL 35 DAY
  AND toStartOfHour(collector_tstamp) NOT IN (
      SELECT hour FROM retail_analytics.analytics_categories_1h
  )
GROUP BY hour, category_slug;

INSERT INTO retail_analytics.analytics_searches_1h
SELECT
    toStartOfHour(collector_tstamp) AS hour,
    ctx_search_type                 AS search_type,
    ctx_search_query                AS query,
    countState()                    AS searches
FROM retail_analytics.snowplow_events
WHERE ctx_search_query != ''
  AND collector_tstamp >= now() - INTERVAL 35 DAY
  AND toStartOfHour(collector_tstamp) NOT IN (
      SELECT hour FROM retail_analytics.analytics_searches_1h
  )
GROUP BY hour, search_type, query;
