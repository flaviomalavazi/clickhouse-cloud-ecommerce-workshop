'use client';

import NumberFlow from '@number-flow/react';
import { useAnalyticsStrings } from '../strings';
import type { ZeroSearchRow } from './types';

export function ZeroSearches({ rows }: { rows: ZeroSearchRow[] }) {
  const { a, numberLocale } = useAnalyticsStrings();
  if (!rows.length) return <p className="py-8 text-center text-sm text-gray-500">{a('zeroSearches.empty')}</p>;
  const total = Number(rows[0].total_searches);
  const zero = Number(rows[0].zero_total);
  const pct = new Intl.NumberFormat(numberLocale, { style: 'percent', maximumFractionDigits: 1 });

  return (
    <div>
      <p className="tabular-nums text-4xl font-extrabold text-orange-300">{pct.format(total ? zero / total : 0)}</p>
      <p className="mb-4 mt-1 text-sm text-gray-400">
        {a('zeroSearches.rate', { pct: pct.format(total ? zero / total : 0), n: total })}
      </p>
      <ul className="flex flex-wrap gap-2">
        {rows.map(r => (
          <li key={r.query} className="flex items-center gap-2 rounded-full border border-orange-400/30 bg-orange-400/5 px-3 py-1 text-sm">
            <span className="text-gray-200">“{r.query}”</span>
            <span className="tabular-nums text-xs font-semibold text-orange-300"><NumberFlow animated={false} value={Number(r.searches)} locales={numberLocale} /></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
