'use client';

import NumberFlow from '@number-flow/react';
import { motion } from 'motion/react';
import { useAnalyticsStrings } from '../strings';
import type { SourceRow } from './types';

export function Sources({ rows }: { rows: SourceRow[] }) {
  const { a, numberLocale } = useAnalyticsStrings();
  if (!rows.length) return <p className="py-8 text-center text-sm text-gray-500">{a('sources.empty')}</p>;
  // Top six: enough to tell the story, and the tile stays level with its neighbour.
  rows = rows.slice(0, 6);
  const max = Math.max(...rows.map(r => Number(r.sessions)));
  const pct = new Intl.NumberFormat(numberLocale, { style: 'percent', maximumFractionDigits: 1 });
  const label = (s: string) => (s === 'direct' ? a('source.direct') : s);

  return (
    <ol className="space-y-2">
      {rows.map(r => {
        const sessions = Number(r.sessions), orders = Number(r.orders);
        return (
          <motion.li
            key={r.source}
            className="relative overflow-hidden rounded-lg bg-ch-900/60 px-3 py-2"
          >
            <motion.span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-brand-400/10"
              initial={{ width: 0 }}
              animate={{ width: `${(sessions / max) * 100}%` }}
              transition={{ type: 'spring', stiffness: 90, damping: 18 }}
            />
            <span className="relative flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0">
                <span className="block truncate text-gray-200">{label(r.source)}</span>
                <span className="block text-[11px] text-gray-500">
                  {a('sources.orders', { n: orders, pct: pct.format(sessions ? orders / sessions : 0) })}
                </span>
              </span>
              <span className="tabular-nums shrink-0 text-right">
                <span className="block font-semibold text-white"><NumberFlow animated={false} value={sessions} locales={numberLocale} /></span>
                <span className="block text-[10px] text-gray-500">{a('sources.sessions')}</span>
              </span>
            </span>
          </motion.li>
        );
      })}
    </ol>
  );
}
