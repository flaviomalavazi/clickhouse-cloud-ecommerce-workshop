/**
 * SQL for the /demo/analytics dashboard.
 *
 * Every tile reads a materialized view from migration 006 rather than
 * aggregating snowplow_events directly. See that migration's header for why.
 *
 * Two conventions matter here:
 *
 * 1. Time bounds are passed as Unix-second query parameters, never inlined as
 *    now() / today(). That makes each query deterministic, so ClickHouse's query
 *    cache will store it - with now() in the text it refuses to, because the
 *    result is not reproducible. Several people watching the dashboard then
 *    share one cache entry instead of each triggering their own scan.
 *
 * 2. All bucket columns are DateTime('UTC'), so toDate()/toStartOfHour() on them
 *    are UTC. Bounds are therefore computed in UTC too. The previous queries
 *    mixed the two - `toDate(collector_tstamp) = today()` compares a UTC column
 *    date against a server-local today(), which silently dropped the first hours
 *    of the day whenever the container was not on UTC.
 */

export type ChartName =
  | 'hourly_views'
  | 'top_pages'
  | 'event_breakdown'
  | 'top_searches'
  | 'category_views'
  | 'daily_sessions'
  | 'funnel'
  | 'revenue'
  | 'devices'
  | 'payments'
  | 'platforms'
  | 'sources'
  | 'flows'
  | 'scroll_depth'
  | 'zero_searches';

export const CHART_NAMES: ChartName[] = [
  'hourly_views', 'top_pages', 'event_breakdown',
  'top_searches', 'category_views', 'daily_sessions',
  'funnel', 'revenue', 'devices', 'payments', 'platforms', 'sources', 'flows',
  'scroll_depth', 'zero_searches',
];

export type RangeToken = '24h' | '7d' | '30d';

export const RANGE_TOKENS: RangeToken[] = ['24h', '7d', '30d'];

export function parseRange(raw: string | null | undefined): RangeToken {
  return RANGE_TOKENS.includes(raw as RangeToken) ? (raw as RangeToken) : '24h';
}

const RANGE_HOURS: Record<RangeToken, number> = { '24h': 24, '7d': 24 * 7, '30d': 24 * 30 };

/** Bucket the trend chart by hour for short windows, by day beyond two days. */
export function bucketFor(range: RangeToken): 'hour' | 'day' {
  return RANGE_HOURS[range] <= 48 ? 'hour' : 'day';
}

export interface Bounds {
  /** window start, Unix seconds */
  from: number;
  /** window end, Unix seconds */
  to: number;
  /** 00:00 UTC today, Unix seconds */
  dayStart: number;
}

/**
 * Bounds are snapped to the minute so that repeated polls within the same minute
 * hit the query cache instead of producing a distinct query each time. The live
 * tiles do not use these - they need second precision and are not cached.
 */
export function boundsFor(range: RangeToken, now: Date = new Date()): Bounds {
  const nowSec = Math.floor(now.getTime() / 1000);
  const to = nowSec - (nowSec % 60) + 60;               // top of the next minute
  const from = to - RANGE_HOURS[range] * 3600;
  const dayStart = Math.floor(Date.UTC(
    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(),
  ) / 1000);
  return { from, to, dayStart };
}

/** Seconds of the live window shared by the two realtime widgets. */
export const LIVE_WINDOW_SECONDS = 10;

/**
 * Per-query ceiling. A tile that cannot answer in this long should fail and let
 * the next poll retry, rather than queue up behind the previous one.
 */
export const ANALYTICS_QUERY_SETTINGS = {
  max_execution_time: 10,
} as const;

/** Deterministic tiles: safe and worthwhile to serve from the query cache. */
export const CACHED_QUERY_SETTINGS = {
  ...ANALYTICS_QUERY_SETTINGS,
  use_query_cache: 1,
  query_cache_ttl: 30,
} as const;

// ── Chart SQL ────────────────────────────────────────────────────────────────

const HOURLY_VIEWS = (bucket: 'hour' | 'day') => `
  SELECT
      ${bucket === 'hour' ? 'toStartOfHour(minute)' : 'toStartOfDay(minute)'} AS hour,
      countMergeIf(events, event_name = 'page_view')                          AS page_views,
      uniqMerge(uniq_users)                                                   AS users
  FROM analytics_events_1m
  WHERE minute >= toDateTime({from:UInt32})
    AND minute <  toDateTime({to:UInt32})
  GROUP BY hour
  ORDER BY hour ASC
`;

const TOP_PAGES = `
  SELECT
      page_urlpath,
      countMerge(views)     AS views,
      uniqMerge(uniq_users) AS unique_users
  FROM analytics_pages_1h
  WHERE hour >= toDateTime({dayStart:UInt32})
    AND page_urlpath != ''
  GROUP BY page_urlpath
  ORDER BY views DESC
  LIMIT 10
`;

const EVENT_BREAKDOWN = `
  SELECT
      event_name,
      countMerge(events) AS cnt
  FROM analytics_events_1m
  WHERE minute >= toDateTime({dayStart:UInt32})
    AND event_name != ''
  GROUP BY event_name
  ORDER BY cnt DESC
  LIMIT 10
`;

const TOP_SEARCHES = `
  SELECT
      query,
      countMerge(searches) AS searches,
      search_type          AS type
  FROM analytics_searches_1h
  WHERE hour >= toDateTime({from:UInt32})
    AND hour <  toDateTime({to:UInt32})
  GROUP BY query, search_type
  ORDER BY searches DESC
  LIMIT 10
`;

const CATEGORY_VIEWS = `
  SELECT
      category_slug     AS category,
      countMerge(views) AS views
  FROM analytics_categories_1h
  WHERE hour >= toDateTime({dayStart:UInt32})
  GROUP BY category
  ORDER BY views DESC
`;

const DAILY_SESSIONS = `
  SELECT
      toDate(minute)           AS day,
      uniqMerge(uniq_sessions) AS sessions,
      uniqMerge(uniq_users)    AS users,
      countMerge(events)       AS events
  FROM analytics_events_1m
  WHERE minute >= toDateTime({from:UInt32})
    AND minute <  toDateTime({to:UInt32})
  GROUP BY day
  ORDER BY day ASC
`;

// ── Raw-table tiles ──────────────────────────────────────────────────────────
// No materialized view covers these, and this page adds no schema, so they read
// snowplow_events directly. Each one leads with an event_name predicate and a
// time bound: the table is ORDER BY (event_name, toDate(collector_tstamp), ...),
// so that pair prunes to the granules of one event type over the window instead
// of the whole table. They go through the query cache like the tiles above.
//
// Two kinds of tile below. Most read columns a real browser fills on its way
// through Snowplow Micro and the bridge — page paths, the referrer, the user
// agent, structured-event labels and values, the page URL. DEVICES reads
// dvce_type, which Micro leaves empty (YAUAA is not mapped by the bridge):
// only the generator's synthetic traffic fills it.

/**
 * Areas of the store, from a URL path. The live store map places visitors by
 * this in the browser, and the navigation-flow tile groups by the same rules
 * in SQL, so both read the store the same way.
 */
export const STORE_ZONES = ['home', 'search', 'category', 'product', 'cart', 'checkout', 'paid'] as const;
export type StoreZone = (typeof STORE_ZONES)[number];

export function zoneOf(path: string): StoreZone | null {
  if (path === '' || path === '/') return 'home';
  if (path.startsWith('/search')) return 'search';
  if (path.startsWith('/category')) return 'category';
  if (path.startsWith('/product')) return 'product';
  if (path.startsWith('/cart')) return 'cart';
  if (/^\/checkout\/(success|confirmation)/.test(path)) return 'paid';
  if (path.startsWith('/checkout')) return 'checkout';
  return null;
}

const zoneSql = (col: string) => `multiIf(
      ${col} IN ('', '/'),                                'home',
      startsWith(${col}, '/search'),                      'search',
      startsWith(${col}, '/category'),                    'category',
      startsWith(${col}, '/product'),                     'product',
      startsWith(${col}, '/cart'),                        'cart',
      match(${col}, '^/checkout/(success|confirmation)'), 'paid',
      startsWith(${col}, '/checkout'),                    'checkout',
      '')`;

/** The six storefront steps the funnel walks, in order. */
export const FUNNEL_STEPS = [
  'page_view',
  'product_click',
  'cart_add_to_cart',
  'checkout_start',
  'checkout_payment_initiated',
  'checkout_payment_confirmed',
] as const;

const FUNNEL_STEP_LIST = FUNNEL_STEPS.map(s => `'${s}'`).join(', ');

// windowFunnel returns, per session, how many steps it completed in order
// within an hour. The client folds the per-level counts into "reached step N".
const FUNNEL = `
  SELECT level, count() AS sessions
  FROM (
      SELECT
          domain_sessionid,
          windowFunnel(3600)(
              toDateTime(collector_tstamp),
              ${FUNNEL_STEPS.map(s => `event_name = '${s}'`).join(',\n              ')}
          ) AS level
      FROM snowplow_events
      WHERE event_name IN (${FUNNEL_STEP_LIST})
        AND collector_tstamp >= toDateTime({from:UInt32})
        AND collector_tstamp <  toDateTime({to:UInt32})
        AND domain_sessionid != ''
      GROUP BY domain_sessionid
  )
  WHERE level > 0
  GROUP BY level
  ORDER BY level ASC
`;

// se_value on a confirmed payment is the order total, in USD like every price
// in the catalog; the client converts it with the locale's currency config.
// WITH FILL emits the empty buckets too, so a window with orders only in its
// last hour still draws a line from zero rather than a lone, invisible point.
const REVENUE = (bucket: 'hour' | 'day') => {
  const expr = bucket === 'hour' ? 'toStartOfHour(toDateTime(collector_tstamp))' : 'toDate(collector_tstamp)';
  const fill = bucket === 'hour'
    ? 'FROM toStartOfHour(toDateTime({from:UInt32})) TO toDateTime({to:UInt32}) STEP INTERVAL 1 HOUR'
    : 'FROM toDate(toDateTime({from:UInt32})) TO toDate(toDateTime({to:UInt32})) + 1 STEP INTERVAL 1 DAY';
  return `
  SELECT
      ${expr}       AS bucket,
      sum(se_value) AS gmv,
      count()       AS orders
  FROM snowplow_events
  WHERE event_name = 'checkout_payment_confirmed'
    AND collector_tstamp >= toDateTime({from:UInt32})
    AND collector_tstamp <  toDateTime({to:UInt32})
  GROUP BY bucket
  ORDER BY bucket ASC WITH FILL ${fill}
`;
};

const DEVICES = `
  SELECT
      if(dvce_type = '', 'Unknown', dvce_type) AS device,
      uniq(domain_sessionid)                   AS sessions
  FROM snowplow_events
  WHERE event_name = 'page_view'
    AND collector_tstamp >= toDateTime({from:UInt32})
    AND collector_tstamp <  toDateTime({to:UInt32})
  GROUP BY device
  ORDER BY sessions DESC
`;

// Initiated vs confirmed per payment method. The scripted card-gateway outage
// (CARD_GATEWAY_DOWN) shows up here as card attempts that never confirm.
const PAYMENTS = `
  SELECT
      se_label                                                   AS method,
      countIf(event_name = 'checkout_payment_initiated')         AS initiated,
      countIf(event_name = 'checkout_payment_confirmed')         AS confirmed,
      sumIf(se_value, event_name = 'checkout_payment_confirmed') AS revenue
  FROM snowplow_events
  WHERE event_name IN ('checkout_payment_initiated', 'checkout_payment_confirmed')
    AND collector_tstamp >= toDateTime({from:UInt32})
    AND collector_tstamp <  toDateTime({to:UInt32})
    AND se_label != ''
  GROUP BY method
  ORDER BY initiated DESC
`;

// Parsed from the raw user agent at query time. iOS is tested before macOS
// and Android before Linux: an iPhone UA says "like Mac OS X", and Android's
// says "Linux".
const PLATFORMS = `
  SELECT
      multiIf(
          match(useragent, 'iPhone|iPad|iPod'), 'iOS',
          match(useragent, 'Android'),          'Android',
          match(useragent, 'Windows'),          'Windows',
          match(useragent, 'Macintosh'),        'macOS',
          match(useragent, 'CrOS'),             'ChromeOS',
          match(useragent, 'Linux'),            'Linux',
          useragent = '',                       'Unknown',
                                                'Other')   AS os,
      multiIf(
          match(useragent, 'iPad|Tablet'),          'Tablet',
          match(useragent, 'Mobi|iPhone|Android'),  'Mobile',
          useragent = '',                           'Unknown',
                                                    'Desktop') AS device,
      uniq(domain_sessionid) AS sessions
  FROM snowplow_events
  WHERE event_name = 'page_view'
    AND collector_tstamp >= toDateTime({from:UInt32})
    AND collector_tstamp <  toDateTime({to:UInt32})
  GROUP BY os, device
  ORDER BY sessions DESC
`;

// First-touch attribution: the utm_source on a session's first page view,
// and whether that session went on to pay.
const SOURCES = `
  SELECT
      if(source = '', 'direct', source) AS source,
      count()                           AS sessions,
      sum(converted)                    AS orders
  FROM (
      SELECT
          domain_sessionid,
          argMinIf(extractURLParameter(page_url, 'utm_source'), collector_tstamp, event_name = 'page_view') AS source,
          max(event_name = 'checkout_payment_confirmed')                                                AS converted
      FROM snowplow_events
      WHERE event_name IN ('page_view', 'checkout_payment_confirmed')
        AND collector_tstamp >= toDateTime({from:UInt32})
        AND collector_tstamp <  toDateTime({to:UInt32})
        AND domain_sessionid != ''
      GROUP BY domain_sessionid
      HAVING countIf(event_name = 'page_view') > 0
  )
  GROUP BY source
  ORDER BY sessions DESC
  LIMIT 8
`;

// Page-to-page moves between store areas, from the referrer path the tracker
// records on every page view. An empty referrer is an arrival from outside.
const FLOWS = `
  SELECT
      if(refr_urlpath = '', 'entry', ${zoneSql('refr_urlpath')}) AS source,
      ${zoneSql('page_urlpath')}                                 AS target,
      count()                                                    AS moves
  FROM snowplow_events
  WHERE event_name = 'page_view'
    AND collector_tstamp >= toDateTime({from:UInt32})
    AND collector_tstamp <  toDateTime({to:UInt32})
  GROUP BY source, target
  HAVING source != '' AND target != '' AND source != target
  ORDER BY moves DESC
  LIMIT 24
`;

// How far down each area's pages people scroll. The tracker fires one
// engagement_scroll per threshold crossed — '25%', '50%', '75%' — and only on
// pages long enough to scroll, so areas that never emit one are left out.
const SCROLL_DEPTH = `
  SELECT
      ${zoneSql('page_urlpath')}                                    AS zone,
      countIf(event_name = 'page_view')                             AS views,
      countIf(event_name = 'engagement_scroll' AND se_label = '25%')  AS d25,
      countIf(event_name = 'engagement_scroll' AND se_label = '50%')  AS d50,
      countIf(event_name = 'engagement_scroll' AND se_label = '75%')  AS d75
  FROM snowplow_events
  WHERE event_name IN ('page_view', 'engagement_scroll')
    AND collector_tstamp >= toDateTime({from:UInt32})
    AND collector_tstamp <  toDateTime({to:UInt32})
  GROUP BY zone
  HAVING zone != '' AND views > 0 AND d25 > 0
  ORDER BY views DESC
`;

// se_value on a text search is the number of results it returned.
const ZERO_SEARCHES = `
  WITH (
      SELECT count()
      FROM snowplow_events
      WHERE event_name = 'search_text_search'
        AND collector_tstamp >= toDateTime({from:UInt32})
        AND collector_tstamp <  toDateTime({to:UInt32})
  ) AS total
  SELECT
      lower(ctx_search_query) AS query,
      count()                 AS searches,
      sum(count()) OVER ()    AS zero_total,
      any(total)              AS total_searches
  FROM snowplow_events
  WHERE event_name = 'search_text_search'
    AND collector_tstamp >= toDateTime({from:UInt32})
    AND collector_tstamp <  toDateTime({to:UInt32})
    AND se_value = 0
    AND ctx_search_query != ''
  GROUP BY query
  ORDER BY searches DESC
  LIMIT 8
`;

/**
 * `daily_sessions` and `top_searches` are inherently multi-day, so a 24h
 * selection would leave them nearly empty. They floor at 7 days.
 */
const MULTI_DAY_MINIMUM: Partial<Record<ChartName, RangeToken>> = {
  daily_sessions: '7d',
  top_searches:   '7d',
};

export function effectiveRange(name: ChartName, range: RangeToken): RangeToken {
  const floor = MULTI_DAY_MINIMUM[name];
  if (!floor) return range;
  return RANGE_HOURS[range] < RANGE_HOURS[floor] ? floor : range;
}

export function chartQuery(name: ChartName, range: RangeToken): string | null {
  switch (name) {
    case 'hourly_views':    return HOURLY_VIEWS(bucketFor(range));
    case 'top_pages':       return TOP_PAGES;
    case 'event_breakdown': return EVENT_BREAKDOWN;
    case 'top_searches':    return TOP_SEARCHES;
    case 'category_views':  return CATEGORY_VIEWS;
    case 'daily_sessions':  return DAILY_SESSIONS;
    case 'funnel':          return FUNNEL;
    case 'revenue':         return REVENUE(bucketFor(range));
    case 'devices':         return DEVICES;
    case 'payments':        return PAYMENTS;
    case 'platforms':       return PLATFORMS;
    case 'sources':         return SOURCES;
    case 'flows':           return FLOWS;
    case 'scroll_depth':    return SCROLL_DEPTH;
    case 'zero_searches':   return ZERO_SEARCHES;
    default:                return null;
  }
}

// ── KPI + live SQL ───────────────────────────────────────────────────────────

export const KPI_TODAY_QUERY = `
  SELECT
      countMergeIf(events, event_name = 'page_view') AS page_views,
      uniqMerge(uniq_sessions)                       AS sessions,
      countMerge(events)                             AS total_events,
      uniqMerge(uniq_users)                          AS unique_users
  FROM analytics_events_1m
  WHERE minute >= toDateTime({dayStart:UInt32})
`;

export const ACTIVE_USERS_QUERY = `
  SELECT uniq(domain_userid) AS active_users
  FROM analytics_live_events
  WHERE collector_tstamp >= now() - INTERVAL {window:UInt32} SECOND
`;

export const LIVE_VISITORS_QUERY = `
  SELECT
      domain_userid,
      argMax(page_urlpath, collector_tstamp) AS current_page,
      argMax(page_title,   collector_tstamp) AS page_title,
      max(collector_tstamp)                  AS last_seen,
      count()                                AS events_in_window
  FROM analytics_live_events
  WHERE collector_tstamp >= now() - INTERVAL {window:UInt32} SECOND
  GROUP BY domain_userid
  ORDER BY last_seen DESC
  LIMIT 100
`;

/**
 * Rows in the raw event table, for the "you are looking at N events" line.
 * system.tables keeps the count, so this costs nothing to read.
 */
export const DATASET_ROWS_QUERY = `
  SELECT sum(total_rows) AS rows
  FROM system.tables
  WHERE database = currentDatabase()
    AND name = 'snowplow_events'
`;

// ── Live feed + globe ────────────────────────────────────────────────────────

/** How far back the feed looks. */
export const FEED_WINDOW_SECONDS = 120;

/** The events worth narrating. Page views and scrolls would drown them out. */
export const FEED_EVENTS = [
  'product_click',
  'cart_add_to_cart',
  'checkout_start',
  'checkout_payment_confirmed',
  'search_text_search',
] as const;

// products_search is the catalog's ClickHouse mirror (~1k rows), so the join
// side is tiny. ctx_product_id is 0 on events that carry no product.
export const LIVE_FEED_QUERY = `
  SELECT
      toString(e.event_id)                  AS id,
      e.collector_tstamp                    AS ts,
      e.event_name                          AS event_name,
      e.domain_userid                       AS domain_userid,
      e.se_value                            AS value,
      e.se_label                            AS label,
      e.ctx_search_query                    AS search_query,
      e.ctx_category_slug                   AS category,
      if(e.ctx_product_id = 0, '', p.name)  AS product
  FROM snowplow_events AS e
  LEFT JOIN (
      SELECT product_id, any(name) AS name
      FROM products_search
      GROUP BY product_id
  ) AS p ON p.product_id = e.ctx_product_id
  WHERE e.event_name IN (${FEED_EVENTS.map(s => `'${s}'`).join(', ')})
    AND e.collector_tstamp >= now() - INTERVAL {window:UInt32} SECOND
  ORDER BY e.collector_tstamp DESC
  LIMIT 30
`;

/**
 * Browser-to-collector delay (dvce_created_tstamp is the device clock at the
 * click, collector_tstamp is when Snowplow received it) and how long ago the
 * newest event landed. Bounded to plausible delays so a phone with a wrong
 * clock cannot skew the percentiles.
 */
export const FRESHNESS_QUERY = `
  SELECT
      quantilesIf(0.5, 0.95)(
          dateDiff('millisecond', dvce_created_tstamp, collector_tstamp),
          dvce_created_tstamp <= collector_tstamp
            AND dateDiff('millisecond', dvce_created_tstamp, collector_tstamp) < 60000
      )                                                   AS latency_ms,
      dateDiff('millisecond', max(collector_tstamp), now64(3)) AS since_last_ms
  FROM snowplow_events
  WHERE event_name = 'page_view'
    AND collector_tstamp >= now() - INTERVAL 300 SECOND
`;

/** Wider window for the store map, so a visitor reading a page stays on it. */
export const STORE_MAP_WINDOW_SECONDS = 60;

