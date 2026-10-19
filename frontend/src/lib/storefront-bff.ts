/**
 * Server-only bridge for the observability journeys owned by storefront-bff.
 *
 * The storefront remains the source of its visible catalog and checkout
 * behavior. These requests run beside those reads and interactions so the
 * distributed journey appears in tracing without making the browser dependent
 * on a separate runtime during local development.
 */
const bffBaseUrl = () => (process.env.STOREFRONT_BFF_URL ?? '').trim().replace(/\/$/, '');

export interface StorefrontBffResponse {
  status: number;
  body: string;
  contentType: string | null;
  retryAfter: string | null;
}

export async function postStorefrontJourney(
  path: string,
  payload: unknown,
  source: 'storefront' | 'loadgen' = 'storefront',
): Promise<StorefrontBffResponse | null> {
  const baseUrl = bffBaseUrl();
  if (!baseUrl) return null;

  const journeyPayload = typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? { ...payload, source }
    : { source, payload };

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(journeyPayload),
    });

    return {
      status: response.status,
      body: await response.text(),
      contentType: response.headers.get('content-type'),
      retryAfter: response.headers.get('retry-after'),
    };
  } catch {
    // Journey telemetry must not change the storefront's established fallback
    // behavior when the optional BFF is unavailable.
    return null;
  }
}
