'use client';

import NumberFlow from '@number-flow/react';
import { motion } from 'motion/react';
import { useI18n } from '@/i18n/LocaleProvider';
import { formatMoney } from '@/i18n/config';
import { useAnalyticsStrings, type AnalyticsKey } from '../strings';
import type { PaymentRow } from './types';

const KNOWN = new Set(['pix', 'credit_card', 'boleto']);

// One column per method actually seen, so two methods do not leave a gap.
const COLS: Record<number, string> = { 1: 'sm:grid-cols-1', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-3' };

/** Below this, a method is called out as failing — the card-outage beat. */
const FAILING = 0.5;

export function Payments({ rows }: { rows: PaymentRow[] }) {
  const { a, numberLocale } = useAnalyticsStrings();
  const { locale } = useI18n();
  if (!rows.length) return <p className="py-8 text-center text-sm text-gray-500">{a('payments.empty')}</p>;

  return (
    <ul className={`grid flex-1 auto-rows-fr gap-3 ${COLS[Math.min(rows.length, 3)]}`}>
      {rows.map(r => {
        const initiated = Number(r.initiated);
        const confirmed = Number(r.confirmed);
        // A retry can confirm an attempt counted in an earlier window, so cap at 1.
        const rate = initiated ? Math.min(1, confirmed / initiated) : confirmed ? 1 : 0;
        const failing = initiated >= 3 && rate < FAILING;
        const label = KNOWN.has(r.method) ? a(`method.${r.method}` as AnalyticsKey) : r.method;
        return (
          <li
            key={r.method}
            className={`relative flex flex-col justify-between gap-4 overflow-hidden rounded-xl p-4 ring-1 ${failing ? 'bg-red-950/40 ring-red-500/60' : 'bg-ch-900/70 ring-ch-700'}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold text-gray-200">{label}</span>
              {failing && (
                <span className="flex items-center gap-1 rounded-full bg-red-500/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-300">
                  <span aria-hidden className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-400" />
                  {a('payments.failing')}
                </span>
              )}
            </div>
            {/* Spread top / middle / bottom so a tall card reads as designed, not empty. */}
            <p className={`tabular-nums text-5xl font-extrabold ${failing ? 'text-red-300' : 'text-white'}`}>
              <NumberFlow animated={false} value={rate} locales={numberLocale} format={{ style: 'percent', maximumFractionDigits: 0 }} />
              <span className="ml-2 text-sm font-medium text-gray-500">{a('payments.success')}</span>
            </p>
            <div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ch-700">
              <motion.div
                className={`h-full rounded-full ${failing ? 'bg-red-400' : 'bg-brand-400'}`}
                initial={{ width: 0 }}
                animate={{ width: `${rate * 100}%` }}
                transition={{ type: 'spring', stiffness: 90, damping: 18 }}
              />
            </div>
            <p className="mt-2 text-[11px] text-gray-500">
              {a('payments.initiated', { n: initiated })} · {a('payments.confirmed', { n: confirmed })}
            </p>
            {confirmed > 0 && <p className="mt-0.5 text-[11px] text-brand-400">{formatMoney(r.revenue, locale)}</p>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
