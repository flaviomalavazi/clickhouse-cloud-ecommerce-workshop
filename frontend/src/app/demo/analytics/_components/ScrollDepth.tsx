'use client';

import { motion } from 'motion/react';
import { useAnalyticsStrings, type AnalyticsKey } from '../strings';
import type { ScrollRow } from './types';

const MARKS = ['d25', 'd50', 'd75'] as const;

export function ScrollDepth({ rows }: { rows: ScrollRow[] }) {
  const { a, numberLocale } = useAnalyticsStrings();
  if (!rows.length) return <p className="py-8 text-center text-sm text-gray-500">{a('scroll.empty')}</p>;
  const pct = new Intl.NumberFormat(numberLocale, { style: 'percent', maximumFractionDigits: 0 });

  return (
    <div>
      <div className="mb-2 grid grid-cols-[6rem_repeat(3,minmax(0,1fr))] gap-2 text-[11px] text-gray-500">
        <span />
        {MARKS.map(m => <span key={m} className="text-center">{m.slice(1)}%</span>)}
      </div>
      <ul className="flex flex-1 flex-col gap-2">
        {rows.map(r => {
          const views = Number(r.views);
          return (
            <li key={r.zone} className="grid min-h-[2.25rem] flex-1 grid-cols-[6rem_repeat(3,minmax(0,1fr))] items-stretch gap-2 text-sm">
              <span className="flex items-center truncate text-gray-300">{a(`zone.${r.zone}` as AnalyticsKey)}</span>
              {MARKS.map((m, i) => {
                const share = views ? Math.min(1, Number(r[m]) / views) : 0;
                return (
                  <span key={m} className="relative flex items-center justify-center overflow-hidden rounded-md bg-ch-900 ring-1 ring-ch-700">
                    <motion.span
                      aria-hidden
                      className="absolute inset-0 origin-left bg-brand-400"
                      initial={{ scaleX: 0 }}
                      animate={{ scaleX: 1, opacity: 0.12 + share * 0.75 }}
                      transition={{ duration: 0.6, delay: i * 0.08 }}
                    />
                    <span className={`tabular-nums relative text-base font-bold ${share > 0.5 ? 'text-ch-900' : 'text-white'}`}>
                      {pct.format(share)}
                    </span>
                  </span>
                );
              })}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-[11px] text-gray-500">{a('scroll.caption')}</p>
    </div>
  );
}
