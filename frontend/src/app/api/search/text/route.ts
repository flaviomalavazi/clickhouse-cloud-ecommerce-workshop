import { NextRequest, NextResponse } from 'next/server';
import { SpanKind, SpanStatusCode, trace } from '@opentelemetry/api';
import { getClickHouseClient } from '@/lib/clickhouse';
import { queryWithStats } from '@/lib/analytics-stats';

/**
 * Full-text product search on ClickHouse's `text` index.
 *
 * products_search has one searchable string per locale (`search_en`, `search_pt`,
 * `search_es`: name, brand and description, falling back to English where a
 * translation is missing), each with a text index whose preprocessor lower-cases
 * and strips accents. `hasAllTokens` / `hasAnyTokens` tokenize the term with the
 * index's own tokenizer and apply the same preprocessor to it, so the route
 * passes the raw query: "USB-C", "TÊNIS" and "tenis" all behave.
 *
 * `display` is the name shown in the result, with the English name as the
 * fallback so a product whose translation has not landed appears in English
 * instead of blank.
 */
const LOCALES = {
  en: { index: 'idx_search_en', search: 'search_en', nameCol: 'name',    display: 'name' },
  pt: { index: 'idx_search_pt', search: 'search_pt', nameCol: 'name_pt', display: "if(name_pt != '', name_pt, name)" },
  es: { index: 'idx_search_es', search: 'search_es', nameCol: 'name_es', display: "if(name_es != '', name_es, name)" },
} as const;

type SearchLocale = keyof typeof LOCALES;

function asLocale(value: string | null): SearchLocale {
  return value === 'pt' || value === 'es' ? value : 'en';
}

/** The index preprocessor, written out so a name can be compared the same way. */
const normalize = (expr: string) =>
  String.raw`lower(replaceRegexpAll(normalizeUTF8NFD(${expr}), '\\p{M}', ''))`;

const PAGE_SIZE = 20;

interface SearchRow {
  product_id: number;
  name: string;
  brand: string;
  price: number;
  original_price: number;
  image_url: string;
  category_slug: string;
  stock_quantity: number;
}

export async function GET(request: NextRequest) {
  const q        = (request.nextUrl.searchParams.get('q')?.trim() ?? '').slice(0, 200);
  const category = request.nextUrl.searchParams.get('category') ?? '';
  const page     = Math.max(1, parseInt(request.nextUrl.searchParams.get('page') ?? '1') || 1);
  const locale   = asLocale(request.nextUrl.searchParams.get('locale'));
  const offset   = (page - 1) * PAGE_SIZE;

  if (!q) return NextResponse.json({ results: [], total: 0, query: q, partial: false });

  const cfg = LOCALES[locale];

  // Wraps the whole search so a trace has a node that explains the work, and so
  // the clickhouse.query spans below nest under it. Zero results are a normal,
  // successful search: they are findable by `search.results = 0`.
  return trace.getTracer('clickshop-frontend').startActiveSpan(
    'search.products',
    {
      kind: SpanKind.INTERNAL,
      attributes: {
        'search.query':    q,
        'search.locale':   locale,
        'search.category': category,
        'search.page':     page,
        'search.index':    cfg.index,
      },
    },
    async span => {
      try {
        const ch = getClickHouseClient();
        const categoryFilter = category ? 'AND category_slug = {category:String}' : '';
        const params: Record<string, string> = { q };
        if (category) params.category = category;

        const run = async (fn: 'hasAllTokens' | 'hasAnyTokens') => {
          const where = `is_active = 1 AND ${fn}(${cfg.search}, {q:String}) ${categoryFilter}`;
          const [page_, count] = await Promise.all([
            queryWithStats<SearchRow>(ch, {
              query: `
                SELECT
                    product_id,
                    ${cfg.display} AS name,
                    brand,
                    price,
                    original_price,
                    image_url,
                    category_slug,
                    stock_quantity
                FROM products_search
                WHERE ${where}
                ORDER BY
                    hasAllTokens(${normalize(cfg.nameCol)}, ${normalize('{q:String}')}) DESC,
                    stock_quantity > 0 DESC,
                    price ASC,
                    product_id ASC
                LIMIT {limit:UInt32}
                OFFSET {offset:UInt32}
              `,
              query_params: { ...params, limit: PAGE_SIZE, offset },
            }),
            queryWithStats<{ total: string }>(ch, {
              query: `SELECT count() AS total FROM products_search WHERE ${where}`,
              query_params: params,
            }),
          ]);
          return { ...page_, total: Number(count.rows[0]?.total ?? 0) };
        };

        let mode: 'all' | 'any' = 'all';
        let found = await run('hasAllTokens');
        // Nothing contains every word: fall back to products containing any of
        // them, and say so, so the page can tell the visitor.
        if (found.total === 0) {
          mode = 'any';
          found = await run('hasAnyTokens');
        }
        const partial = mode === 'any' && found.total > 0;

        span.setAttributes({
          'search.match_mode':  mode,
          'search.partial':     partial,
          'search.results':     found.rows.length,
          'search.total':       found.total,
          'search.read_rows':   found.stats.rows,
          'search.elapsed_ms':  Math.round(found.stats.ms * 100) / 100,
        });

        return NextResponse.json({
          results: found.rows, total: found.total, query: q, page, page_size: PAGE_SIZE, partial,
        });
      } catch (err) {
        span.setStatus({ code: SpanStatusCode.ERROR, message: String(err) });
        span.recordException(err as Error);
        console.error('GET /api/search/text error:', err);
        return NextResponse.json({ error: 'Search failed' }, { status: 500 });
      } finally {
        span.end();
      }
    },
  );
}
