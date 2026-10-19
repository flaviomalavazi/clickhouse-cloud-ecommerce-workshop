import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse';
import {
  CACHED_QUERY_SETTINGS,
  boundsFor,
  bucketFor,
  chartQuery,
  effectiveRange,
  parseRange,
  type ChartName,
} from '@/lib/analytics-queries';
import { displaySql, queryWithStats } from '@/lib/analytics-stats';

export async function GET(
  req: NextRequest,
  { params }: { params: { name: string } },
) {
  const name = params.name as ChartName;
  const requested = parseRange(req.nextUrl.searchParams.get('range'));
  // Multi-day tiles floor their window so a 24h selection does not blank them.
  const range = effectiveRange(name, requested);

  const query = chartQuery(name, range);
  if (!query) {
    return NextResponse.json({ error: 'Unknown chart' }, { status: 404 });
  }

  const { from, to, dayStart } = boundsFor(range);

  try {
    const ch = getClickHouseClient();
    const { rows, stats } = await queryWithStats(ch, {
      query,
      query_params: { from, to, dayStart },
      clickhouse_settings: CACHED_QUERY_SETTINGS,
    });

    return NextResponse.json(
      {
        data: rows,
        range,
        // The trend tiles switch from hourly to daily buckets on wide windows;
        // the client needs to know which to format the axis.
        bucket: name === 'hourly_views' || name === 'revenue' ? bucketFor(range) : undefined,
        // The tile's receipt: what ClickHouse read to answer, and the SQL itself.
        stats,
        sql: displaySql(query),
      },
      { headers: { 'Cache-Control': 's-maxage=10, stale-while-revalidate=20' } },
    );
  } catch (err) {
    console.error(`Analytics chart [${name}] error:`, err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
