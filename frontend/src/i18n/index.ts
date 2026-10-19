import { en, type Dictionary, type TranslationKey } from './en';
import { pt } from './pt';
import { es } from './es';
import type { Locale } from './config';

export const DICTIONARIES: Record<Locale, Dictionary> = { en, pt, es };

export type { Dictionary, TranslationKey };

/** Keys that come in a `.one` / `.other` pair. */
export type PluralKey =
  | 'a11y.cartItems'
  | 'cart.items'
  | 'search.results'
  | 'search.resultsLabel';

export type Vars = Record<string, string | number>;

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole
  );
}
export interface Translator {
  /** Look up one key and fill in any `{placeholders}`. */
  t: (key: TranslationKey, vars?: Vars) => string;
  /**
   * Plural form for `count`. English, Portuguese and Spanish share the same
   * one/other split, so this needs no CLDR table.
   */
  tn: (key: PluralKey, count: number, vars?: Vars) => string;
  /**
   * Category name for a slug. The five categories also live in Postgres in
   * English; the dictionary wins so the nav, the tiles and the page heading
   * cannot disagree. An unknown slug falls back to whatever the database said.
   */
  categoryName: (slug: string, fallback?: string) => string;
  categoryDescription: (slug: string, fallback?: string) => string;
}

export function makeTranslator(locale: Locale): Translator {
  const dict = DICTIONARIES[locale];

  const t: Translator['t'] = (key, vars) => interpolate(dict[key] ?? en[key] ?? key, vars);

  const tn: Translator['tn'] = (key, count, vars) =>
    t(`${key}.${count === 1 ? 'one' : 'other'}` as TranslationKey, { n: count, ...vars });

  const lookup = (prefix: string, slug: string, fallback?: string) => {
    const key = `${prefix}.${slug}` as TranslationKey;
    return key in dict ? dict[key] : (fallback ?? slug);
  };

  return {
    t,
    tn,
    categoryName: (slug, fallback) => lookup('categories', slug, fallback),
    categoryDescription: (slug, fallback) => lookup('categoryDesc', slug, fallback),
  };
}
