'use client';

import { useEffect, useRef } from 'react';
import { useI18n } from '@/i18n/LocaleProvider';

export interface LatencySample {
  /** Full request duration from the browser's performance timeline, ms. */
  total: number;
  /** Time the server spent before the first byte came back, ms. */
  server: number;
}
const PALETTE = {
  line: '#FAFF69',
  fillTop: 'rgba(250, 255, 105, 0.28)',
  fillBottom: 'rgba(250, 255, 105, 0)',
  grid: 'rgba(255, 255, 255, 0.08)',
  p99: 'rgba(255, 255, 255, 0.35)',
};

/** The y-axis never compresses below this, so a fast trace reads as a fast trace. */
const SCALE_FLOOR_MS = 50;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

/**
 * A live sparkline of search latency, drawn on a canvas.
 *
 * Every number here is measured by the browser itself, not timed with a
 * stopwatch around `fetch`: each sample comes from the PerformanceResourceTiming
 * entry for that request, so `server` is `responseStart - requestStart` — the
 * wait before the first byte, which is the query — and `total` is the whole
 * round trip including connection reuse and response read.
 *
 * The API route returns no timing of its own, so this is the honest ceiling on
 * what the client can know, and it is labelled as such rather than presented as
 * a bare "query time".
 */
export function LatencyMeter({ samples }: { samples: LatencySample[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const { t } = useI18n();

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Redraws only when the sample list changes — there is no animation loop to
    // leave running, so an idle meter costs nothing.
    const dpr = window.devicePixelRatio || 1;
    const { width: cssW, height: cssH } = canvas.getBoundingClientRect();
    if (!cssW || !cssH) return;

    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    if (samples.length < 2) return;

    const values = samples.map(s => s.total);
    const sorted = [...values].sort((a, b) => a - b);
    const p99 = percentile(sorted, 99);
    // A fixed 50ms floor on the scale, not a self-normalising one. Auto-scaling
    // to the observed range would stretch 11-14ms across the full height and
    // draw a dramatic mountain out of nothing — the trace has to sit near the
    // bottom for "pinned low" to be the thing you read. A genuine spike still
    // pushes the ceiling up and visibly climbs.
    const ceiling = Math.max(SCALE_FLOOR_MS, Math.max(...values) * 1.25);

    const pad = 3;
    const w = cssW - pad * 2;
    const h = cssH - pad * 2;
    const x = (i: number) => pad + (i / (samples.length - 1)) * w;
    const y = (v: number) => pad + h - Math.min(1, v / ceiling) * h;

    // Baseline.
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(pad, cssH - pad);
    ctx.lineTo(cssW - pad, cssH - pad);
    ctx.stroke();

    // p99 marker.
    ctx.strokeStyle = PALETTE.p99;
    ctx.setLineDash([2, 3]);
    ctx.beginPath();
    ctx.moveTo(pad, y(p99));
    ctx.lineTo(cssW - pad, y(p99));
    ctx.stroke();
    ctx.setLineDash([]);

    // Filled area under the trace.
    const gradient = ctx.createLinearGradient(0, pad, 0, cssH - pad);
    gradient.addColorStop(0, PALETTE.fillTop);
    gradient.addColorStop(1, PALETTE.fillBottom);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(x(0), cssH - pad);
    values.forEach((v, i) => ctx.lineTo(x(i), y(v)));
    ctx.lineTo(x(values.length - 1), cssH - pad);
    ctx.closePath();
    ctx.fill();

    // The trace.
    ctx.strokeStyle = PALETTE.line;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    values.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(i), y(v))));
    ctx.stroke();

    // Latest reading.
    const lastX = x(values.length - 1);
    const lastY = y(values[values.length - 1]);
    ctx.fillStyle = PALETTE.line;
    ctx.beginPath();
    ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
    ctx.fill();
  }, [samples]);

  if (samples.length < 2) return null;

  const sorted = samples.map(s => s.total).sort((a, b) => a - b);

  return (
    <figure
      className="on-dark flex items-center gap-3 rounded-lg border border-line-inverse bg-ch-900 px-3 py-2"
      aria-label={t('search.meterLabel', { n: samples.length })}
    >
      <canvas
        ref={canvasRef}
        className="h-8 w-[104px] shrink-0"
        // Decorative: every figure it draws is also printed as text beside it.
        role="presentation"
      />
      <figcaption className="flex gap-3 text-[0.6875rem] leading-tight">
        <span className="flex flex-col">
          <span className="text-ch-400">p50</span>
          <span className="numeric font-semibold text-white">{Math.round(percentile(sorted, 50))}ms</span>
        </span>
        <span className="flex flex-col">
          <span className="text-ch-400">p99</span>
          <span className="numeric font-semibold text-white">{Math.round(percentile(sorted, 99))}ms</span>
        </span>
        <span className="flex flex-col">
          <span className="text-ch-400">n</span>
          <span className="numeric font-semibold text-white">{samples.length}</span>
        </span>
      </figcaption>
    </figure>
  );
}
