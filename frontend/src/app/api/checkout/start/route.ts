import { NextRequest, NextResponse } from 'next/server';
import { postStorefrontJourney } from '@/lib/storefront-bff';

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  await postStorefrontJourney('/v1/journeys/checkout/start', body);
  return new NextResponse(null, { status: 204 });
}
