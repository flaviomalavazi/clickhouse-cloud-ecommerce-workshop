import { NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse';
import {
  ANALYTICS_QUERY_SETTINGS,
  FEED_WINDOW_SECONDS,
  FRESHNESS_QUERY,
  LIVE_FEED_QUERY,
} from '@/lib/analytics-queries';
import { combineStats, queryWithStats } from '@/lib/analytics-stats';

export interface FeedEvent {
  id: string;
  ts: string;
  event_name: string;
  domain_userid: string;
  value: number;
  label: string;
  search_query: string;
  category: string;
  product: string;
}

interface Freshness {
  latency_ms: [number, number];
  since_last_ms: number | string;
}

// Both read snowplow_events with an event_name predicate and a now()-relative
// bound, so they touch the newest granules of a handful of event types. Not
// cached: the point of this endpoint is that it is seconds-fresh.
export async function GET() {
  const ch = getClickHouseClient();
  try {
    const [feed, fresh] = await Promise.all([
      queryWithStats<FeedEvent>(ch, {
        query: LIVE_FEED_QUERY,
        query_params: { window: FEED_WINDOW_SECONDS },
        clickhouse_settings: ANALYTICS_QUERY_SETTINGS,
      }),
      queryWithStats<Freshness>(ch, {
        query: FRESHNESS_QUERY,
        clickhouse_settings: ANALYTICS_QUERY_SETTINGS,
      }),
    ]);
    return NextResponse.json({
      events: feed.rows,
      freshness: fresh.rows[0] ?? null,
      stats: combineStats(feed.stats, fresh.stats),
    });
  } catch (err) {
    console.error('Live feed error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
