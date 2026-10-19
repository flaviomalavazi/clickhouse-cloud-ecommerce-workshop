import { NextResponse } from 'next/server';
import { getPool } from '@/lib/postgres';

export async function GET() {
  try {
    const pool = getPool();
    const { rows } = await pool.query(
      'SELECT id, slug, name, description, banner_url FROM categories ORDER BY name'
    );
    return NextResponse.json(rows);
  } catch (err) {
    console.error('GET /api/categories error:', err);
    return NextResponse.json({ error: 'Failed to fetch categories' }, { status: 500 });
  }
}
