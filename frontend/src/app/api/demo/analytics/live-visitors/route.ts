import { NextResponse, type NextRequest } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse';
import {
  ANALYTICS_QUERY_SETTINGS,
  LIVE_VISITORS_QUERY,
  LIVE_WINDOW_SECONDS,
} from '@/lib/analytics-queries';
import { queryWithStats } from '@/lib/analytics-stats';

// analytics_live_events is TTL'd to 10 minutes, so that is the widest window
// worth asking for; the store map uses a minute, the table its 10 seconds.
const MAX_WINDOW_SECONDS = 600;

export async function GET(req: NextRequest) {
  const ch = getClickHouseClient();
  const asked = Number(req.nextUrl.searchParams.get('window'));
  const window = Number.isFinite(asked) && asked > 0
    ? Math.min(MAX_WINDOW_SECONDS, Math.floor(asked))
    : LIVE_WINDOW_SECONDS;
  try {
    // analytics_live_events mirrors the four columns this widget reads from
    // snowplow_events into a table ordered by collector_tstamp and TTL'd to 10
    // minutes. The 10-second window is a couple of granules there; against the
    // raw table it was a full scan of the day, every 5 seconds.
    const { rows, stats } = await queryWithStats<{
      domain_userid: string;
      current_page: string;
      page_title: string;
      last_seen: string;
      events_in_window: number;
    }>(ch, {
      query: LIVE_VISITORS_QUERY,
      query_params: { window },
      clickhouse_settings: ANALYTICS_QUERY_SETTINGS,
    });
    return NextResponse.json({ visitors: rows, generated_at: new Date().toISOString(), stats });
  } catch (err) {
    console.error('Live visitors error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
