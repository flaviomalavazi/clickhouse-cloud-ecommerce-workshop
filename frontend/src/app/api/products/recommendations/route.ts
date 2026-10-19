import { NextResponse } from 'next/server';
import { getPool } from '@/lib/postgres';

export async function GET() {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      `SELECT p.*, c.slug AS category_slug, s.quantity AS stock_quantity,
              CASE WHEN p.original_price IS NOT NULL
                   THEN ROUND((1 - p.price / p.original_price) * 100)::int
              END AS discount_pct
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN stock s ON s.product_id = p.id
       LEFT JOIN (
           SELECT product_id, COUNT(*) AS order_count
           FROM order_items GROUP BY product_id
       ) oi ON oi.product_id = p.id
       WHERE p.is_active = TRUE AND (s.quantity IS NULL OR s.quantity > 0)
       ORDER BY COALESCE(oi.order_count, 0) DESC,
                CASE WHEN p.original_price IS NOT NULL
                     THEN (1 - p.price / p.original_price) END DESC NULLS LAST
       LIMIT 12`
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('GET /api/products/recommendations error:', err);
    return NextResponse.json({ error: 'Failed to fetch recommendations' }, { status: 500 });
  }
}
