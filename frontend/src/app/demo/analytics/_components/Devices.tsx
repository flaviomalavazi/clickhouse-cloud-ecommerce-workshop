'use client';

import NumberFlow from '@number-flow/react';
import { motion } from 'motion/react';
import { CATEGORICAL } from '@/components/analytics';
import { useAnalyticsStrings, type AnalyticsKey } from '../strings';
import type { DeviceRow } from './types';

const KNOWN = new Set(['Mobile', 'Computer', 'Tablet', 'Unknown']);

/** A single 100% bar split by device, with the shares large underneath. */
export function Devices({ rows }: { rows: DeviceRow[] }) {
  const { a, numberLocale } = useAnalyticsStrings();
  const total = rows.reduce((s, r) => s + Number(r.sessions), 0);
  if (!total) return <p className="py-8 text-center text-sm text-gray-500">{a('empty.trend')}</p>;
  const label = (d: string) => (KNOWN.has(d) ? a(`device.${d}` as AnalyticsKey) : d);

  return (
    <div>
      <div className="flex h-4 w-full gap-1 overflow-hidden rounded-full">
        {rows.map((r, i) => (
          <motion.span
            key={r.device}
            className="h-full rounded-full"
            style={{ background: CATEGORICAL[i % CATEGORICAL.length] }}
            initial={{ flexGrow: 0 }}
            animate={{ flexGrow: Number(r.sessions) / total }}
            transition={{ type: 'spring', stiffness: 80, damping: 18 }}
          />
        ))}
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-3">
        {rows.map((r, i) => (
          <div key={r.device}>
            <dt className="flex items-center gap-2 text-xs text-gray-400">
              <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: CATEGORICAL[i % CATEGORICAL.length] }} />
              {label(r.device)}
            </dt>
            <dd className="tabular-nums mt-1 text-2xl font-extrabold text-white">
              <NumberFlow animated={false} value={Number(r.sessions) / total} locales={numberLocale} format={{ style: 'percent', maximumFractionDigits: 1 }} />
            </dd>
            <dd className="numeric text-[11px] text-gray-500">
              <NumberFlow animated={false} value={Number(r.sessions)} locales={numberLocale} /> {a('series.sessions').toLowerCase()}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
