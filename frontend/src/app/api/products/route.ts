import { NextRequest, NextResponse } from 'next/server';
import { getPool } from '@/lib/postgres';
import { PAGE_SIZE } from '@/lib/constants';

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const page      = Math.max(1, parseInt(searchParams.get('page') ?? '1') || 1);
  const pageSize  = PAGE_SIZE;
  const category  = searchParams.get('category');
  const brand     = searchParams.get('brand');
  const minPrice  = searchParams.get('min_price');
  const maxPrice  = searchParams.get('max_price');

  const conditions: string[] = ['p.is_active = TRUE'];
  const params: unknown[]    = [];
  let idx = 1;

  if (category) { conditions.push(`c.slug = $${idx++}`); params.push(category); }
  if (brand)    { conditions.push(`p.brand ILIKE $${idx++}`); params.push(brand); }
  if (minPrice) { const n = parseFloat(minPrice); if (!isNaN(n) && n >= 0) { conditions.push(`p.price >= $${idx++}`); params.push(n); } }
  if (maxPrice) { const n = parseFloat(maxPrice); if (!isNaN(n) && n >= 0) { conditions.push(`p.price <= $${idx++}`); params.push(n); } }

  const where = conditions.join(' AND ');

  try {
    const pool = getPool();
    const countRes = await pool.query(
      `SELECT COUNT(*) FROM products p JOIN categories c ON c.id = p.category_id WHERE ${where}`,
      params
    );
    const total = parseInt(countRes.rows[0].count);

    const offset = (page - 1) * pageSize;
    const { rows } = await pool.query(
      `SELECT p.*, c.slug AS category_slug, s.quantity AS stock_quantity,
              CASE WHEN p.original_price IS NOT NULL
                   THEN ROUND((1 - p.price / p.original_price) * 100)::int
              END AS discount_pct
       FROM products p
       JOIN categories c ON c.id = p.category_id
       LEFT JOIN stock s ON s.product_id = p.id
       WHERE ${where}
       ORDER BY p.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, pageSize, offset]
    );

    return NextResponse.json({ products: rows, total, page, page_size: pageSize });
  } catch (err) {
    console.error('GET /api/products error:', err);
    return NextResponse.json({ error: 'Failed to fetch products' }, { status: 500 });
  }
}
