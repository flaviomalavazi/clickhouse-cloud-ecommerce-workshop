import { NextRequest, NextResponse } from 'next/server';
import { getClickHouseClient } from '@/lib/clickhouse';
import { postStorefrontJourney } from '@/lib/storefront-bff';

/**
 * Which columns a locale searches, and which it displays.
 *
 * Each locale searches its own name and description *and* the English ones. A
 * Brazilian typing "tênis" needs the Portuguese columns, but the same person
 * typing a brand or a model number ("Cushstep", "574", "USB-C") needs the
 * English row to still match, and those tokens only live there. Searching both
 * costs nothing extra: every one of these columns carries its own tokenbf_v1
 * index, so ClickHouse prunes granules on each in turn.
 *
 * `display` is the column shown in the result, with the English name as the
 * fallback so a product whose translation has not landed yet appears with its
 * English name instead of blank.
 */
const LOCALE_COLUMNS = {
  en: { search: ['name', 'description'],                                          display: 'name' },
  pt: { search: ['name', 'description', 'name_pt', 'description_pt'],             display: 'if(name_pt != \'\', name_pt, name)' },
  es: { search: ['name', 'description', 'name_es', 'description_es'],             display: 'if(name_es != \'\', name_es, name)' },
} as const;

type SearchLocale = keyof typeof LOCALE_COLUMNS;

function asLocale(value: string | null): SearchLocale {
  return value === 'pt' || value === 'es' ? value : 'en';
}

export async function GET(request: NextRequest) {
  const q        = (request.nextUrl.searchParams.get('q')?.trim() ?? '').slice(0, 200);
  const category = request.nextUrl.searchParams.get('category') ?? '';
  const page     = Math.max(1, parseInt(request.nextUrl.searchParams.get('page') ?? '1') || 1);
  const locale   = asLocale(request.nextUrl.searchParams.get('locale'));
  const pageSize = 20;
  const offset   = (page - 1) * pageSize;

  if (!q) return NextResponse.json({ results: [], total: 0, query: q });

  // Split query into tokens for multi-token bloom filter search
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6);

  // brand is always searched: it holds invented names that are identical in
  // every locale, so there is nothing to translate and no per-locale column.
  const { search: searchCols, display: displayName } = LOCALE_COLUMNS[locale];
  const tokenConditions = tokens
    .map((_, i) =>
      '(' + [...searchCols, 'brand']
        .map(col => `hasToken(lower(${col}), {t${i}:String})`)
        .join(' OR ') + ')')
    .join(' OR ');

  const categoryFilter = category ? `AND category_slug = {category:String}` : '';

  const queryParams: Record<string, string> = { ...Object.fromEntries(tokens.map((t, i) => [`t${i}`, t])) };
  if (category) queryParams.category = category;

  try {
    const ch = getClickHouseClient();

    const [resultSet] = await Promise.all([
      ch.query({
      query: `
        SELECT
            product_id,
            ${displayName} AS name,
            brand,
            price,
            original_price,
            image_url,
            category_slug
        FROM products_search
        WHERE is_active = 1
          AND (${tokenConditions})
          ${categoryFilter}
        ORDER BY price ASC
        LIMIT {limit:UInt32}
        OFFSET {offset:UInt32}
      `,
      query_params: { ...queryParams, limit: pageSize, offset },
      format: 'JSONEachRow',
      }),
      postStorefrontJourney('/v1/journeys/search', { q, category, locale, page }),
    ]);

    const results = await resultSet.json<any[]>();
    return NextResponse.json({ results, query: q, page, page_size: pageSize });
  } catch (err) {
    console.error('GET /api/search/text error:', err);
    return NextResponse.json({ error: 'Search failed' }, { status: 500 });
  }
}
