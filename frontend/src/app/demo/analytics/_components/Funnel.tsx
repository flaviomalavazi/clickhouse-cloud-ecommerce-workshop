'use client';

import NumberFlow from '@number-flow/react';
import { motion } from 'motion/react';
import { useMemo } from 'react';
import { FUNNEL_STEPS } from '@/lib/analytics-queries';
import styles from '@/components/analytics/fx/fx.module.css';
import { useAnalyticsStrings, type AnalyticsKey } from '../strings';
import type { FunnelRow } from './types';

/**
 * windowFunnel gives "furthest step reached" per session; a session that got to
 * step 4 also passed 1–3, so "reached step k" is the sum over levels >= k.
 * Bars are linear in sessions — the drop-off is the story, so it is not
 * flattered with a log scale; the numbers beside each bar carry the detail.
 */
export function Funnel({ rows }: { rows: FunnelRow[] }) {
  const { a, numberLocale } = useAnalyticsStrings();

  const reached = useMemo(() => {
    const byLevel = new Map(rows.map(r => [Number(r.level), Number(r.sessions)]));
    return FUNNEL_STEPS.map((_, i) => {
      let sum = 0;
      for (let l = i + 1; l <= FUNNEL_STEPS.length; l++) sum += byLevel.get(l) ?? 0;
      return sum;
    });
  }, [rows]);

  const start = reached[0];
  const pct = useMemo(
    () => new Intl.NumberFormat(numberLocale, { style: 'percent', maximumFractionDigits: 1 }),
    [numberLocale],
  );

  if (!start) return <p className="py-8 text-center text-sm text-gray-500">{a('funnel.empty')}</p>;

  return (
    <div>
      <ol className="space-y-2.5">
        {FUNNEL_STEPS.map((step, i) => {
          const n = reached[i];
          const share = n / start;
          const fromPrev = i === 0 ? 1 : reached[i - 1] ? n / reached[i - 1] : 0;
          return (
            <li key={step} className="grid grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm sm:grid-cols-[10rem_minmax(0,1fr)_auto]">
              <span className="truncate text-gray-300">{a(`funnel.${step}` as AnalyticsKey)}</span>
              <span className="relative h-7 overflow-hidden rounded-md bg-ch-900 ring-1 ring-ch-700">
                <motion.span
                  className="absolute inset-y-0 left-0 overflow-hidden rounded-md"
                  style={{ background: 'linear-gradient(90deg, #EEED00, #FAFF69)' }}
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.max(1.2, share * 100)}%` }}
                  transition={{ type: 'spring', stiffness: 90, damping: 18, delay: i * 0.06 }}
                >
                  <span aria-hidden className={`absolute inset-y-0 w-1/3 bg-gradient-to-r from-transparent via-white/50 to-transparent ${styles.shimmer}`} style={{ animationDelay: `${i * 0.25}s` }} />
                </motion.span>
                {/* A pill, not bare text: the label sits over the bar's yellow
                    when the step is near 100% and over the dark track when
                    it is not, and must read on both. On a phone the track is
                    too narrow for "of visits", so only the percent shows. */}
                <span className="absolute inset-y-0 right-1.5 flex items-center">
                  <span className="whitespace-nowrap tabular-nums rounded bg-ch-900/85 px-1.5 py-0.5 text-[11px] font-semibold text-gray-100">
                    <span className="sm:hidden">{pct.format(share)}</span>
                    <span className="hidden sm:inline">{a('funnel.ofStart', { pct: pct.format(share) })}</span>
                  </span>
                </span>
              </span>
              <span className="flex flex-col items-end leading-tight sm:min-w-[6.5rem]">
                <span className="numeric font-semibold text-white">
                  <NumberFlow animated={false} value={n} locales={numberLocale} />
                </span>
                {i > 0 && (
                  <span className={`numeric text-[11px] ${fromPrev < 0.2 ? 'text-orange-300' : 'text-gray-500'}`}>
                    ↓ {pct.format(fromPrev)}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[11px] text-gray-500">{a('funnel.caption')}</p>
    </div>
  );
}
