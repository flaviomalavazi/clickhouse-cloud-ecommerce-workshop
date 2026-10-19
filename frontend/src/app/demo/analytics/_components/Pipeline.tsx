'use client';

import NumberFlow from '@number-flow/react';
import { useRef, type ReactNode, type RefObject } from 'react';
import { AnimatedBeam } from '@/components/analytics/fx/AnimatedBeam';
import { BorderBeam } from '@/components/analytics/fx/BorderBeam';
import { useAnalyticsStrings } from '../strings';
import { fillTemplate } from './template';

/** Per-second rates derived from two collector samples. */
export interface TelemetryRates {
  spans: number;
  logs: number;
  metrics: number;
  replays: number;
  exported: number;
  refused: number;
}

interface PipelineProps {
  /** One id per poll that saw telemetry flowing; each sends a pulse down the pipe. */
  pulses: number[];
  rates: TelemetryRates | null;
  unavailable: boolean;
}

function Node({ nodeRef, icon, title, sub, glow }: {
  nodeRef: RefObject<HTMLDivElement>;
  icon: ReactNode;
  title: string;
  sub: ReactNode;
  glow?: boolean;
}) {
  return (
    <div
      ref={nodeRef}
      className="relative z-10 flex w-full items-center gap-3 rounded-2xl border border-ch-700 bg-ch-900/90 px-4 py-3 shadow-[0_0_40px_-12px_rgba(250,255,105,0.25)] backdrop-blur md:w-auto md:min-w-[180px] md:flex-col md:items-start md:gap-2"
    >
      {glow && <BorderBeam size={60} duration={5} />}
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ch-800 ring-1 ring-ch-600">{icon}</span>
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-white">{title}</span>
        <span className="block truncate text-xs text-gray-500">{sub}</span>
      </span>
    </div>
  );
}

const ICON = 'h-5 w-5 fill-none stroke-current text-brand-400';

/**
 * The shop's own telemetry path: instrumented app → OTel Collector →
 * ClickHouse Cloud → ClickStack. Every number comes from the collector's
 * internal counters, and a beam fires each poll that saw signals flowing.
 */
export function Pipeline({ pulses, rates, unavailable }: PipelineProps) {
  const { a, numberLocale } = useAnalyticsStrings();
  const container = useRef<HTMLDivElement>(null);
  const shop = useRef<HTMLDivElement>(null);
  const otel = useRef<HTMLDivElement>(null);
  const ch = useRef<HTMLDivElement>(null);
  const stack = useRef<HTMLDivElement>(null);

  const rate = (n: number | undefined) =>
    n == null ? '-' : <NumberFlow animated={false} value={n} locales={numberLocale} format={{ maximumFractionDigits: n < 10 ? 1 : 0 }} />;
  const received = rates ? rates.spans + rates.logs + rates.metrics : undefined;

  return (
    <div>
      <div ref={container} className="relative flex flex-col items-stretch gap-6 md:flex-row md:items-center md:justify-between md:gap-4">
        <Node nodeRef={shop} title={a('pipe.shop')} sub={a('pipe.shopSub')} icon={
          <svg viewBox="0 0 24 24" className={ICON} strokeWidth={1.8}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></svg>
        } />
        <Node nodeRef={otel} title={a('pipe.collector')} sub={fillTemplate(a('pipe.collectorSub'), { n: rate(received) })} icon={
          <svg viewBox="0 0 24 24" className={ICON} strokeWidth={1.8}><circle cx="12" cy="12" r="3" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4M4.9 4.9l2.8 2.8M16.3 16.3l2.8 2.8M4.9 19.1l2.8-2.8M16.3 7.7l2.8-2.8" /></svg>
        } />
        <Node nodeRef={ch} glow title={a('pipe.clickhouse')} sub={fillTemplate(a('pipe.clickhouseSub'), { n: rate(rates?.exported) })} icon={
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-brand-400"><rect x="3" y="3" width="2.6" height="18" rx=".4" /><rect x="7.6" y="3" width="2.6" height="18" rx=".4" /><rect x="12.2" y="3" width="2.6" height="18" rx=".4" /><rect x="16.8" y="3" width="2.6" height="18" rx=".4" /><rect x="21" y="10" width="1.8" height="4" rx=".3" /></svg>
        } />
        <Node nodeRef={stack} title={a('pipe.clickstack')} sub={a('pipe.clickstackSub')} icon={
          <svg viewBox="0 0 24 24" className={ICON} strokeWidth={1.8}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" opacity=".7" /><path d="m3 17.5 9 5 9-5" opacity=".4" /></svg>
        } />

        <AnimatedBeam containerRef={container} fromRef={shop} toRef={otel} pulses={pulses} delay={0} />
        <AnimatedBeam containerRef={container} fromRef={otel} toRef={ch} pulses={pulses} delay={0.45} />
        <AnimatedBeam containerRef={container} fromRef={ch} toRef={stack} pulses={pulses} delay={0.9} />
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {([
          ['pipe.spans', rates?.spans],
          ['pipe.logs', rates?.logs],
          ['pipe.metrics', rates?.metrics],
          ['pipe.replays', rates?.replays],
        ] as const).map(([key, v]) => (
          <div key={key} className="rounded-xl bg-ch-900/70 px-3 py-2 ring-1 ring-ch-700">
            <dt className="text-[11px] uppercase tracking-wider text-gray-500">{a(key)}</dt>
            <dd className="tabular-nums text-xl font-bold text-white">{rate(v)}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-gray-500">
        {unavailable ? (
          <span className="text-orange-300">{a('pipe.unavailable')}</span>
        ) : (
          <>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${rates && rates.refused > 0 ? 'bg-orange-400' : 'bg-green-400'}`} />
              {a('pipe.refused', { n: rates ? Math.round(rates.refused) : 0 })}
            </span>
            <span>· {a('pipe.source')}</span>
          </>
        )}
      </p>
    </div>
  );
}
