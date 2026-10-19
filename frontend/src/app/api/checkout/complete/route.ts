import { NextRequest, NextResponse } from 'next/server';
import { postStorefrontJourney } from '@/lib/storefront-bff';

const JOURNEY_BY_METHOD = {
  pix: '/v1/journeys/checkout/pix',
  boleto: '/v1/journeys/checkout/boleto',
  credit_card: '/v1/journeys/order',
} as const;

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => ({}));
  const rawMethod = typeof body === 'object' && body !== null
    ? (body as { method?: unknown }).method
    : undefined;
  const method: keyof typeof JOURNEY_BY_METHOD | null =
    rawMethod === 'pix' || rawMethod === 'boleto' || rawMethod === 'credit_card'
      ? rawMethod
      : null;
  if (!method) {
    return NextResponse.json({ error: 'Unsupported payment method' }, { status: 400 });
  }

  const response = await postStorefrontJourney(JOURNEY_BY_METHOD[method], body);
  if (!response) {
    return NextResponse.json(
      { error: 'storefront_bff_unavailable', retryable: true },
      { status: 502, headers: { 'Retry-After': '5' } },
    );
  }

  if (response.status >= 400) {
    const headers = new Headers();
    if (response.contentType) headers.set('Content-Type', response.contentType);
    if (response.retryAfter) headers.set('Retry-After', response.retryAfter);
    return new NextResponse(response.body, { status: response.status, headers });
  }

  return new NextResponse(null, { status: 204 });
}
