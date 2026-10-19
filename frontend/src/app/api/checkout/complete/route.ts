import { NextRequest, NextResponse } from 'next/server';
import { OrderError, parseOrderRequest, placeOrder } from '@/lib/orders';

/**
 * Places the order: writes it to Postgres, runs the payment journey, and settles
 * it. Answers `{ order_id, status }` on success.
 *
 *   400 invalid_request          the body is malformed
 *   409 out_of_stock             a unit was taken since the shopper added it
 *   409 product_unavailable      a product is gone or inactive
 *   502 storefront_bff_unavailable / the payment journey's own failure
 *                                the order is cancelled and its stock restored
 */
export async function POST(request: NextRequest) {
  try {
    const req = parseOrderRequest(await request.json().catch(() => null));
    const placed = await placeOrder(req);

    if (placed.ok) {
      return NextResponse.json({ order_id: placed.orderId, status: placed.status });
    }

    const { upstream } = placed;
    if (!upstream) {
      return NextResponse.json(
        { error: 'storefront_bff_unavailable', retryable: true, order_id: placed.orderId },
        { status: 502, headers: { 'Retry-After': '5' } },
      );
    }
    const headers = new Headers();
    if (upstream.contentType) headers.set('Content-Type', upstream.contentType);
    if (upstream.retryAfter) headers.set('Retry-After', upstream.retryAfter);
    return new NextResponse(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    if (err instanceof OrderError) {
      return NextResponse.json({ error: err.code, ...err.detail }, { status: err.status });
    }
    console.error('POST /api/checkout/complete error:', err);
    return NextResponse.json({ error: 'order_failed' }, { status: 500 });
  }
}
