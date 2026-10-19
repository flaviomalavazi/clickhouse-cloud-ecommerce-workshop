/**
 * Locale configuration.
 *
 * Deliberately not route-based. Putting the locale in the path (`/pt/...`)
 * would split every storefront URL into three, and the analytics dashboard
 * aggregates Snowplow's `page_urlpath` — "Top Pages" would fragment per
 * language and stop matching the rows already collected. The demo is
 * `robots: noindex`, so there is no SEO argument on the other side.
 */
export const LOCALES = ['en', 'pt', 'es'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Shown in the switcher. `label` is each language's own name, never translated. */
export const LOCALE_META: Record<Locale, { code: string; label: string; htmlLang: string }> = {
  en: { code: 'EN', label: 'English',   htmlLang: 'en' },
  pt: { code: 'PT', label: 'Português', htmlLang: 'pt-BR' },
  es: { code: 'ES', label: 'Español',   htmlLang: 'es' },
};

export const LOCALE_STORAGE_KEY = 'clickshop_locale';

/**
 * Money per locale.
 *
 * Prices are stored in USD and every other layer keeps them that way: the
 * Snowplow `se_value` on a purchase, `credit_card_transactions.bill_value`, the
 * Postgres `products.price`. Only the display converts, so switching language
 * never rewrites data and the analytics tables stay comparable across a run.
 *
 * `rate` is a FIXED demo rate, not a live quote. Nothing here fetches FX — a
 * storefront that changed its prices between page loads because a rate moved
 * would be a worse demo than one whose numbers are stable and merely
 * approximate. Expect them to drift from the real market; update when they look
 * silly.
 *
 * Formatting comes from `Intl.NumberFormat`, so separators and symbol placement
 * follow the locale rather than being hand-assembled: 1.234,56 for pt-BR and
 * es-MX, 1,234.56 for en-US.
 */
export const LOCALE_CURRENCY: Record<
  Locale,
  { currency: string; rate: number; numberLocale: string; display: 'symbol' | 'code' }
> = {
  en: { currency: 'USD', rate: 1,    numberLocale: 'en-US', display: 'symbol' },
  pt: { currency: 'BRL', rate: 5.4,  numberLocale: 'pt-BR', display: 'symbol' },
  // `code`, giving "MXN 4,553.28", where the other two get a symbol. In es-MX the
  // peso's symbol is a bare "$" and Mexican separators match American ones, so
  // "symbol" renders $4,553.28 — indistinguishable at a glance from the $252.96
  // English shows for the same product. On a real Mexican storefront that is
  // fine, because nobody is comparing. Here switching language IS the thing being
  // demonstrated, so the currency has to be legible in the switch itself.
  es: { currency: 'MXN', rate: 18.0, numberLocale: 'es-MX', display: 'code' },
};

/** A USD amount, converted and formatted for `locale`. */
export function formatMoney(usd: number | string, locale: Locale): string {
  const { currency, rate, numberLocale, display } = LOCALE_CURRENCY[locale];
  return new Intl.NumberFormat(numberLocale, {
    style: 'currency',
    currency,
    currencyDisplay: display,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(usd) * rate);
}
export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * First visit only: take the best match from the browser's preferences.
 * Matches on the primary subtag, so `pt-BR`, `pt-PT` and `pt` all land on `pt`.
 */
export function detectLocale(preferred: readonly string[]): Locale {
  for (const tag of preferred) {
    const primary = tag.toLowerCase().split('-')[0];
    if (isLocale(primary)) return primary;
  }
  return DEFAULT_LOCALE;
}
