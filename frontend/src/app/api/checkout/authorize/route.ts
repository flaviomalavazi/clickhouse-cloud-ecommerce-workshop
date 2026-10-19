import { NextRequest, NextResponse } from 'next/server';
import { postStorefrontJourney } from '@/lib/storefront-bff';

/** Proxy card authorization so the real card-gateway container owns failures. */
export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const response = await postStorefrontJourney('/v1/journeys/checkout/card', body);

  if (!response) {
    console.error('POST /api/checkout/authorize storefront-bff unavailable');
    return NextResponse.json(
      { error: 'storefront_bff_unavailable', retryable: true },
      { status: 502, headers: { 'Retry-After': '5' } },
    );
  }

  if (response.status >= 400) {
    console.error('POST /api/checkout/authorize upstream failure:', response.status);
  }

  const headers = new Headers();
  if (response.contentType) headers.set('Content-Type', response.contentType);
  if (response.retryAfter) headers.set('Retry-After', response.retryAfter);
  return new NextResponse(response.body, { status: response.status, headers });
}
