'use client';

import NumberFlow from '@number-flow/react';
import { useMemo, type ReactNode } from 'react';
import { LOCALE_CURRENCY } from '@/i18n/config';
import { TrendChart, CHART_COLORS, makeNumberFormats, type Datum, type SeriesSpec } from '@/components/analytics';
import { useAnalyticsStrings } from '../strings';
import type { RevenueRow } from './types';

interface RevenueProps {
  rows: RevenueRow[];
  bucketLabel: (bucket: string) => string;
  labelHeader: string;
  fallback: ReactNode;
}

/** GMV, orders and average ticket from confirmed payments, in the locale's currency. */
export function Revenue({ rows, bucketLabel, labelHeader, fallback }: RevenueProps) {
  const { a, numberLocale, locale } = useAnalyticsStrings();
  const { currency, rate, display } = LOCALE_CURRENCY[locale];

  const gmv = rows.reduce((s, r) => s + Number(r.gmv), 0) * rate;
  const orders = rows.reduce((s, r) => s + Number(r.orders), 0);
  const aov = orders ? gmv / orders : 0;

  const money = (digits: number) => ({
    style: 'currency' as const, currency, currencyDisplay: display,
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });

  const data = useMemo<Datum[]>(() => rows.map(r => ({
    key: r.bucket,
    label: bucketLabel(r.bucket),
    values: [Math.round(Number(r.gmv) * rate)],
  })), [rows, bucketLabel, rate]);

  const series = useMemo<SeriesSpec[]>(() => [{ name: a('series.gmv'), color: CHART_COLORS.primary }], [a]);
  const formats = useMemo(() => makeNumberFormats(numberLocale), [numberLocale]);

  if (!orders) return <p className="py-8 text-center text-sm text-gray-500">{a('revenue.empty')}</p>;

  return (
    <div>
      <p className="text-xs uppercase tracking-wider text-gray-500">{a('revenue.gmv')}</p>
      {/* Solid colour, not a clipped gradient: NumberFlow draws its digits in a
          shadow root, where background-clip: text from out here cannot reach. */}
      <p className="tabular-nums mt-1 text-4xl font-extrabold text-brand-400 [text-shadow:0_0_32px_rgba(250,255,105,0.35)] sm:text-5xl">
        <NumberFlow animated={false} value={gmv} locales={numberLocale} format={money(0)} />
      </p>
      <div className="mt-3 flex gap-6 text-sm">
        <div>
          <p className="text-xs text-gray-500">{a('revenue.orders')}</p>
          <p className="tabular-nums text-lg font-semibold text-white"><NumberFlow animated={false} value={orders} locales={numberLocale} /></p>
        </div>
        <div>
          <p className="text-xs text-gray-500">{a('revenue.aov')}</p>
          <p className="tabular-nums text-lg font-semibold text-white"><NumberFlow animated={false} value={aov} locales={numberLocale} format={money(2)} /></p>
        </div>
      </div>
      <div className="mt-4">
        <TrendChart
          data={data}
          series={series}
          height={130}
          labelHeader={labelHeader}
          summary={a('a11y.summary', { title: a('series.gmv'), n: data.length, series: a('series.gmv') })}
          tableCaption={a('a11y.tableCaption', { title: a('series.gmv') })}
          formats={formats}
          fallback={fallback}
        />
      </div>
    </div>
  );
}
