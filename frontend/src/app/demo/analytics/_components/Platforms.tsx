'use client';

import NumberFlow from '@number-flow/react';
import { motion } from 'motion/react';
import { useMemo } from 'react';
import { CATEGORICAL } from '@/components/analytics';
import { useAnalyticsStrings, type AnalyticsKey } from '../strings';
import type { PlatformRow } from './types';

const DEVICE_KEYS = new Set(['Mobile', 'Desktop', 'Tablet', 'Unknown']);

/** OS and device class, both parsed from the raw user agent in SQL. */
export function Platforms({ rows }: { rows: PlatformRow[] }) {
  const { a, numberLocale } = useAnalyticsStrings();

  const { devices, systems, total } = useMemo(() => {
    const d = new Map<string, number>(), o = new Map<string, number>();
    let t = 0;
    for (const r of rows) {
      const n = Number(r.sessions);
      t += n;
      d.set(r.device, (d.get(r.device) ?? 0) + n);
      o.set(r.os, (o.get(r.os) ?? 0) + n);
    }
    const sort = (m: Map<string, number>) => Array.from(m.entries()).sort((x, y) => y[1] - x[1]);
    return { devices: sort(d), systems: sort(o), total: t };
  }, [rows]);

  if (!total) return <p className="py-8 text-center text-sm text-gray-500">{a('empty.trend')}</p>;
  const deviceLabel = (d: string) =>
    DEVICE_KEYS.has(d) ? a(`device.${d === 'Desktop' ? 'Computer' : d}` as AnalyticsKey) : d;
  const max = systems[0]?.[1] ?? 1;

  return (
    <div>
      <div className="flex h-3 w-full gap-1 overflow-hidden rounded-full">
        {devices.map(([d, n], i) => (
          <motion.span
            key={d}
            className="h-full rounded-full"
            style={{ background: CATEGORICAL[i % CATEGORICAL.length] }}
            initial={{ flexGrow: 0 }}
            animate={{ flexGrow: n / total }}
            transition={{ type: 'spring', stiffness: 80, damping: 18 }}
          />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-400">
        {devices.map(([d, n], i) => (
          <span key={d} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2 w-2 rounded-sm" style={{ background: CATEGORICAL[i % CATEGORICAL.length] }} />
            {deviceLabel(d)}
            <span className="tabular-nums font-semibold text-white">
              <NumberFlow animated={false} value={n / total} locales={numberLocale} format={{ style: 'percent', maximumFractionDigits: 0 }} />
            </span>
          </span>
        ))}
      </div>
      <ol className="mt-4 space-y-1.5">
        {systems.map(([os, n]) => (
          <li key={os} className="grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-center gap-3 text-sm">
            <span className="truncate text-gray-300">{os}</span>
            <span className="h-2 overflow-hidden rounded-full bg-ch-900">
              <motion.span
                className="block h-full rounded-full bg-gradient-to-r from-brand-500 to-brand-400"
                initial={{ width: 0 }}
                animate={{ width: `${(n / max) * 100}%` }}
                transition={{ type: 'spring', stiffness: 90, damping: 18 }}
              />
            </span>
            <span className="tabular-nums text-xs font-semibold text-white"><NumberFlow animated={false} value={n} locales={numberLocale} /></span>
          </li>
        ))}
      </ol>
      <p className="mt-3 font-mono text-[11px] text-gray-500">{a('platforms.caption')}</p>
    </div>
  );
}
