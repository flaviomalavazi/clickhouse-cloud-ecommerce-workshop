'use client';

/**
 * Money, in one place.
 *
 * Prices used to be written inline as `text-brand-600` — ClickHouse yellow at
 * about 1.7:1 against white, which is not a legible text colour on a light
 * ground under any standard. Yellow stays a surface in this palette; the price
 * itself is ink, set in tabular mono figures so a column of them lines up.
 *
 * Amounts arrive in USD and are converted for the active locale by
 * `formatMoney` (see i18n/config.ts). Currency follows language, so switching to
 * Português shows R$ and to Español shows MXN — while the stored data stays USD,
 * which keeps the storefront's totals comparable with `se_value` in
 * snowplow_events.
 */
import { useLocale } from '@/i18n/LocaleProvider';
import { formatMoney } from '@/i18n/config';

const sizes = {
  sm: { now: 'text-[0.9375rem]', was: 'text-xs' },
  md: { now: 'text-xl',          was: 'text-sm' },
  lg: { now: 'text-4xl',         was: 'text-lg' },
} as const;

/**
 * Formatter bound to the active locale.
 *
 * A hook rather than the old plain `formatPrice(value)` because the currency now
 * depends on context, and a module-level function has no way to read it. Call
 * sites outside a component can use `formatMoney(value, locale)` directly.
 */
export function useFormatPrice(): (value: number | string) => string {
  const { locale } = useLocale();
  return (value: number | string) => formatMoney(value, locale);
}
interface Props {
  price: number | string;
  originalPrice?: number | string | null;
  size?: keyof typeof sizes;
  className?: string;
}

export function Price({ price, originalPrice, size = 'sm', className = '' }: Props) {
  const s = sizes[size];
  const fmt = useFormatPrice();
  // Compared in USD, before conversion: a single positive rate cannot change
  // which of two amounts is larger, so there is no reason to convert first.
  const was = originalPrice != null && Number(originalPrice) > Number(price);

  return (
    <span className={`flex items-baseline gap-2 ${className}`}>
      <span className={`numeric font-bold text-ink-900 ${s.now}`}>{fmt(price)}</span>
      {was && (
        <span className={`numeric text-ink-400 line-through decoration-ink-300 ${s.was}`}>
          {fmt(originalPrice!)}
        </span>
      )}
    </span>
  );
}
