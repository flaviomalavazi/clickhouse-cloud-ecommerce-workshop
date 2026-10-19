/**
 * OTLP collector proxy.
 *
 * Forwards browser-side OpenTelemetry (HyperDX SDK) requests to the internal
 * OTel collector so that the browser never needs a direct connection to port
 * 4318. This avoids mixed-content blocks when the frontend is served over
 * HTTPS (e.g. via a dev tunnel) while the collector is plain HTTP internally.
 *
 * The HyperDX browser SDK is configured with `window.location.origin + '/api/otlp'`
 * as the OTLP endpoint; it appends /v1/traces, /v1/logs, /v1/metrics.
 */
import { type NextRequest, NextResponse } from 'next/server';

const OTLP_ENDPOINT = (process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? 'http://otel-collector:4318').replace(/\/$/, '');

export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  const target = `${OTLP_ENDPOINT}/${params.path.join('/')}`;

  const headers: Record<string, string> = {};
  const ct = req.headers.get('content-type');
  if (ct) headers['content-type'] = ct;
  const ce = req.headers.get('content-encoding');
  if (ce) headers['content-encoding'] = ce;

  // Buffer the body fully before forwarding — avoids ReadableStream duplex
  // issues where the stream is exhausted or closed before the upstream fetch
  // can read it (observed as "TypeError: fetch failed" for /v1/logs payloads).
  const body = await req.arrayBuffer();

  const upstream = await fetch(target, {
    method: 'POST',
    headers,
    body,
  });

  return new NextResponse(null, { status: upstream.status });
}
