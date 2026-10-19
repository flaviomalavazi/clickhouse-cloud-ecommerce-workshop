import { NextResponse } from 'next/server';

/**
 * Live counters from the OpenTelemetry Collector that feeds ClickStack.
 *
 * The collector publishes its own Prometheus metrics on :8888 — how many
 * spans, log records and metric points its receivers accepted, how many its
 * exporters wrote to ClickHouse. Reading them here costs no query and needs no
 * grant on the `otel` database, which the app user does not hold. The client
 * turns two consecutive samples into per-second rates.
 *
 * Counters are cumulative since the collector started; a restart resets them,
 * which the client treats as a fresh baseline rather than a negative rate.
 */
const METRICS_URL = process.env.OTEL_COLLECTOR_METRICS_URL ?? 'http://otel-collector:8888/metrics';

export interface TelemetrySample {
  at: number;
  received: { spans: number; logs: number; metrics: number };
  refused: number;
  exported: { spans: number; logs: number; metrics: number; replays: number };
  failed: number;
}

// `otelcol_receiver_accepted_spans{...} 123` — newer collectors append _total.
const LINE = /^otelcol_(receiver_accepted|receiver_refused|exporter_sent|exporter_send_failed)_(spans|log_records|metric_points)(?:_total)?(\{[^}]*\})?\s+([0-9.eE+-]+)$/;

function parse(text: string): Omit<TelemetrySample, 'at'> {
  const out = {
    received: { spans: 0, logs: 0, metrics: 0 },
    refused: 0,
    exported: { spans: 0, logs: 0, metrics: 0, replays: 0 },
    failed: 0,
  };
  for (const line of text.split('\n')) {
    const m = line.match(LINE);
    if (!m) continue;
    const [, kind, signal, labels = '', raw] = m;
    const v = Number(raw);
    if (!Number.isFinite(v)) continue;
    const key = signal === 'spans' ? 'spans' : signal === 'log_records' ? 'logs' : 'metrics';
    if (kind === 'receiver_accepted') out.received[key] += v;
    else if (kind === 'receiver_refused') out.refused += v;
    else if (kind === 'exporter_send_failed') out.failed += v;
    else {
      // ClickStack's collector writes session replays (rrweb) through their
      // own log exporter; count them apart, they are the replay story.
      if (key === 'logs' && labels.includes('rrweb')) out.exported.replays += v;
      else out.exported[key] += v;
    }
  }
  return out;
}

export async function GET() {
  try {
    const res = await fetch(METRICS_URL, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (!res.ok) throw new Error(`collector metrics: HTTP ${res.status}`);
    const sample: TelemetrySample = { at: Date.now(), ...parse(await res.text()) };
    return NextResponse.json(sample, { headers: { 'Cache-Control': 'no-store' } });
  } catch (err) {
    // The pipeline still renders without numbers; nothing else depends on this.
    return NextResponse.json({ error: String(err) }, { status: 503 });
  }
}
