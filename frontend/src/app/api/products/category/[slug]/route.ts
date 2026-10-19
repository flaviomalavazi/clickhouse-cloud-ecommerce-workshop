import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/postgres';
import { PAGE_SIZE } from '@/lib/constants';

export async function GET(req: NextRequest, { params }: { params: { slug: string } }) {
  const { slug } = params;
  const page = Math.max(1, parseInt(req.nextUrl.searchParams.get('page') ?? '1') || 1);
  const pageSize = PAGE_SIZE;
  const offset = (page - 1) * pageSize;

  try {
    const pool = getPool();

    // Best deals: top discounted products in this category
    const dealsRes = await pool.query(
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
    );

    // Full paginated listing
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM products p
       JOIN categories c ON c.id = p.category_id
       WHERE c.slug = $1 AND p.is_active = TRUE`,
      [slug]
    );
    const total = parseInt(countRes.rows[0].count);

    const productsRes = await pool.query(
      `SELECT p.*, c.slug AS category_slug, s.quantity AS stock_quantity,
              CASE WHEN p.original_price IS NOT NULL
                   THEN ROUND((1 - p.price / p.original_price) * 100)::int
              END AS discount_pct
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN stock s ON s.product_id = p.id
       WHERE c.slug = $1 AND p.is_active = TRUE
       ORDER BY p.price ASC
       LIMIT $2 OFFSET $3`,
      [slug, pageSize, offset]
    );

    return NextResponse.json({
      deals:    dealsRes.rows,
      products: productsRes.rows,
      total,
      page,
      page_size: pageSize,
    });
  } catch (err) {
    console.error(`GET /api/products/category/${slug} error:`, err);
    return NextResponse.json({ error: 'Failed to fetch category products' }, { status: 500 });
  }
}
