import { NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse';
import {
  ACTIVE_USERS_QUERY,
  ANALYTICS_QUERY_SETTINGS,
  CACHED_QUERY_SETTINGS,
  DATASET_ROWS_QUERY,
  KPI_TODAY_QUERY,
  LIVE_WINDOW_SECONDS,
  boundsFor,
} from '@/lib/analytics-queries';
import { combineStats, queryWithStats } from '@/lib/analytics-stats';

interface TodayStats {
  page_views: number;
  sessions: number;
  total_events: number;
  unique_users: number;
}

const EMPTY_TODAY: TodayStats = { page_views: 0, sessions: 0, total_events: 0, unique_users: 0 };

export async function GET() {
  const ch = getClickHouseClient();
  const { dayStart } = boundsFor('24h');

  try {
    const [activeUsers, todayStats, dataset] = await Promise.all([
      // Reads analytics_live_events, which holds a rolling 10 minutes ordered by
      // timestamp. Not cached - a 5s tile served from a 30s cache would lie.
      queryWithStats<{ active_users: number }>(ch, {
        query: ACTIVE_USERS_QUERY,
        query_params: { window: LIVE_WINDOW_SECONDS },
        clickhouse_settings: ANALYTICS_QUERY_SETTINGS,
      }),

      queryWithStats<TodayStats>(ch, {
        query: KPI_TODAY_QUERY,
        query_params: { dayStart },
        clickhouse_settings: CACHED_QUERY_SETTINGS,
      }),

      // Cosmetic: a missing grant on system.tables must not blank the KPIs.
      queryWithStats<{ rows: string }>(ch, {
        query: DATASET_ROWS_QUERY,
        clickhouse_settings: ANALYTICS_QUERY_SETTINGS,
      }).catch(() => null),
    ]);

    return NextResponse.json({
      active_users: activeUsers.rows[0]?.active_users ?? 0,
      today: todayStats.rows[0] ?? EMPTY_TODAY,
      dataset_rows: dataset ? Number(dataset.rows[0]?.rows ?? 0) : null,
      stats: combineStats(activeUsers.stats, todayStats.stats),
    }, {
      headers: { 'Cache-Control': 's-maxage=5, stale-while-revalidate=10' },
    });
  } catch (err) {
    console.error('Analytics KPIs error:', err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
