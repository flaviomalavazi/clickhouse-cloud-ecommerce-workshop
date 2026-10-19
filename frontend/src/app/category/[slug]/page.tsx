import { notFound } from 'next/navigation';
import { CategoryHero } from '@/components/category/CategoryHero';
import { BestDeals } from '@/components/category/BestDeals';
import { ProductGrid } from '@/components/category/ProductGrid';
import { PAGE_SIZE } from '@/lib/constants';
import { getPool } from '@/lib/postgres';

// DB credentials are only available at runtime, not during `next build`.
// Force dynamic rendering so this page is always server-rendered on request
// rather than statically generated (and baked as a 404) at build time.
export const dynamic = 'force-dynamic';

interface PageProps { params: { slug: string }; }

/**
 * Returns null only when no category has this slug. Database failures throw.
 *
 * This used to catch every error and return null, which the caller turned into
 * notFound() - so a connection timeout or an exhausted pool rendered as "this
 * category does not exist". Given the page fires several queries at once and the
 * pool is shared with the traffic simulator, that was reachable under load, and
 * it is the most likely source of the intermittent 404s on live categories.
 */
async function getCategoryData(slug: string) {
  const pool = getPool();
  const [catRes, dealsRes, productsRes] = await Promise.all([
    pool.query('SELECT id, slug, name, description, banner_url FROM categories WHERE slug = $1', [slug]),
    pool.query(
      `SELECT p.*, c.slug AS category_slug, s.quantity AS stock_quantity,
              ROUND((1 - p.price / p.original_price) * 100)::int AS discount_pct
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN stock s ON s.product_id = p.id
       WHERE c.slug = $1 AND p.is_active = TRUE AND p.original_price IS NOT NULL
             AND (s.quantity IS NULL OR s.quantity > 0)
       ORDER BY (1 - p.price / p.original_price) DESC
       LIMIT 4`,
      [slug]
    ),
    // COUNT(*) OVER () carries the unpaginated total on each row, which folds
    // what used to be a separate COUNT query into this one. Three round trips
    // per render instead of four, on a pool every other request shares.
    pool.query(
      `SELECT p.*, c.slug AS category_slug, s.quantity AS stock_quantity,
              CASE WHEN p.original_price IS NOT NULL
                   THEN ROUND((1 - p.price / p.original_price) * 100)::int
              END AS discount_pct,
              COUNT(*) OVER () AS total_count
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN stock s ON s.product_id = p.id
       WHERE c.slug = $1 AND p.is_active = TRUE
       ORDER BY p.price ASC
       LIMIT $2 OFFSET 0`,
      [slug, PAGE_SIZE]
    ),
  ]);

  const category = catRes.rows[0];
  if (!category) return null;

  return {
    category,
    deals: dealsRes.rows,
    products: productsRes.rows,
    // No rows means an empty category, not a missing one - total is 0.
    total: productsRes.rows.length ? parseInt(productsRes.rows[0].total_count) : 0,
  };
}

export default async function CategoryPage({ params }: PageProps) {
  // Not wrapped in try/catch on purpose - see getCategoryData. A DB failure goes
  // to the error boundary as a 500 and only a truly unknown slug 404s.
  const data = await getCategoryData(params.slug);
  if (!data) notFound();
  const { category, deals, products, total } = data;

  return (
    <>
      <CategoryHero category={category} />
      <BestDeals products={deals} />
      <ProductGrid
        initialProducts={products}
        total={total}
        categorySlug={params.slug}
        pageSize={PAGE_SIZE}
      />
    </>
  );
}
