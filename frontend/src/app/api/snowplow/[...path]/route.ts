/**
 * Snowplow collector proxy.
 *
 * Forwards browser tracker requests to the internal Snowplow Micro instance so
 * that the browser never needs a direct connection to it. This avoids mixed-
 * content blocks when the frontend is served over HTTPS (e.g. via a dev tunnel)
 * while the collector is plain HTTP on the internal network.
 *
 * The Snowplow JS tracker is configured with `window.location.origin + '/api/snowplow'`
 * as the collector URL; it appends paths like /com.snowplowanalytics.snowplow/tp2.
 */
import { type NextRequest, NextResponse } from 'next/server';

const SNOWPLOW_MICRO = (process.env.SNOWPLOW_MICRO_URL ?? 'http://snowplow-micro:9090').replace(/\/$/, '');

async function proxy(req: NextRequest, path: string[]): Promise<NextResponse> {
  const target = `${SNOWPLOW_MICRO}/${path.join('/')}${req.nextUrl.search}`;

  const headers: Record<string, string> = {};
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  // Forward User-Agent so Snowplow Micro can run UA enrichments (os_family,
  // br_family, dvce_type). Without this the proxy strips it and those fields
  // are always null.
  const ua = req.headers.get('user-agent');
  if (ua) headers['user-agent'] = ua;
  // Forward the real client IP so Snowplow Micro records user_ipaddress
  // correctly instead of the Next.js pod's internal cluster IP.
  // The ingress (Traefik on k3d) sets X-Forwarded-For with the real client IP.
  const xff = req.headers.get('x-forwarded-for') ?? req.ip;
  if (xff) headers['x-forwarded-for'] = xff;

  const upstream = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req.body,
    // @ts-expect-error – Node fetch supports duplex for streaming
    duplex: 'half',
  });

  return new NextResponse(null, { status: upstream.status });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
