import type { getClickHouseClient } from '@/lib/clickhouse';

/**
 * What ClickHouse did to answer one query, as the dashboard shows it under a
 * tile: rows and bytes read, and server-side time.
 *
 * ClickHouse reports this in the `X-ClickHouse-Summary` response header of every
 * HTTP query, so it costs nothing to collect — no second query against
 * system.query_log, which would also lag the answer by the log flush interval.
 * A result served from the query cache reads only the cached result itself,
 * which is worth showing in its own right: `cached` marks it.
 */
export interface QueryStats {
  rows: number;
  bytes: number;
  ms: number;
  cached: boolean;
}

type Client = ReturnType<typeof getClickHouseClient>;
type QueryParams = Parameters<Client['query']>[0];

const EMPTY: QueryStats = { rows: 0, bytes: 0, ms: 0, cached: false };

function statsFrom(
  headers: Record<string, string | string[] | undefined>,
  mayBeCached: boolean,
  resultRows: number,
): QueryStats {
  const raw = headers['x-clickhouse-summary'];
  const text = Array.isArray(raw) ? raw[0] : raw;
  if (!text) return EMPTY;
  try {
    const s = JSON.parse(text) as Record<string, string>;
    const rows = Number(s.read_rows ?? 0);
    return {
      rows,
      bytes: Number(s.read_bytes ?? 0),
      ms: Number(s.elapsed_ns ?? 0) / 1e6,
      // A cache hit reports reading just the stored result, so a query that
      // read no more rows than it returned was not computed from the table.
      // Only meaningful when the query was allowed to use the cache at all: a
      // live query over an empty window also reads nothing.
      cached: mayBeCached && rows <= resultRows,
    };
  } catch {
    return EMPTY;
  }
}

/** Runs a JSONEachRow query and returns its rows with what it cost. */
export async function queryWithStats<T>(
  ch: Client,
  params: Omit<QueryParams, 'format'>,
): Promise<{ rows: T[]; stats: QueryStats }> {
  const result = await ch.query({ ...params, format: 'JSONEachRow' });
  const rows = await result.json<T>();
  const settings = params.clickhouse_settings as { use_query_cache?: unknown } | undefined;
  return { rows, stats: statsFrom(result.response_headers, Boolean(settings?.use_query_cache), rows.length) };
}

/**
 * Totals for a response that ran several queries side by side. Time is the
 * slowest one, because they ran concurrently; it is only "cached" if all were.
 */
export function combineStats(...all: QueryStats[]): QueryStats {
  return all.reduce<QueryStats>(
    (acc, s) => ({
      rows: acc.rows + s.rows,
      bytes: acc.bytes + s.bytes,
      ms: Math.max(acc.ms, s.ms),
      cached: acc.cached && s.cached,
    }),
    { ...EMPTY, cached: true },
  );
}

/** Collapses indentation so the SQL reads cleanly in the "view SQL" panel. */
export function displaySql(sql: string): string {
  const lines = sql.replace(/^\n+|\s+$/g, '').split('\n');
  const indent = Math.min(
    ...lines.filter(l => l.trim()).map(l => l.match(/^ */)![0].length),
  );
  return lines.map(l => l.slice(indent)).join('\n');
}
