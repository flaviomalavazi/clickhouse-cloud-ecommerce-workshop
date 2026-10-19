import { NextRequest, NextResponse } from 'next/server';
import { getProductById } from '@/lib/products';

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (isNaN(id)) return NextResponse.json({ error: 'Invalid product id' }, { status: 400 });

  try {
    const product = await getProductById(id);
    // 404 only when the product genuinely is not there. A database failure falls
    // through to the catch below and answers 503, so a caller (or the traffic
    // simulator) can distinguish "gone" from "try again".
    if (!product) return NextResponse.json({ error: 'Product not found' }, { status: 404 });
    return NextResponse.json(product);
  } catch (err) {
    console.error(`GET /api/products/${id} error:`, err);
    return NextResponse.json(
      { error: 'Product lookup failed' },
      { status: 503, headers: { 'Retry-After': '1' } },
    );
  }
}
