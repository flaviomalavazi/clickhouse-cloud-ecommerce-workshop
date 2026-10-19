/**
 * Picking a product's name and description for the active locale.
 *
 * The storefront chrome is translated through i18n/, but product copy is data:
 * it lives in Postgres and in ClickHouse products_search, in `name`/`description`
 * plus a `_pt` and `_es` column each. This is the one place that decides which
 * of those a component reads, so components never spell out the fallback and
 * cannot each get it subtly different.
 *
 * English is the fallback, not a fourth case. It is the source the translations
 * were made from, so a null `_pt` means "not translated yet" and reading through
 * to English is the correct answer rather than a degraded one — a catalogue in
 * mid-translation shows English for the products that are still pending instead
 * of blanks.
 */
import type { Locale } from '@/i18n/config';
import type { Product } from '@/types/product';

type Localizable = Pick<
  Product,
  'name' | 'description' | 'name_pt' | 'name_es' | 'description_pt' | 'description_es'
>;

/** The product's name in `locale`, falling back to English. */
export function productName(p: Pick<Localizable, 'name' | 'name_pt' | 'name_es'>, locale: Locale): string {
  if (locale === 'pt') return p.name_pt || p.name;
  if (locale === 'es') return p.name_es || p.name;
  return p.name;
}
/** The product's description in `locale`, falling back to English. */
export function productDescription(
  p: Pick<Localizable, 'description' | 'description_pt' | 'description_es'>,
  locale: Locale,
): string {
  if (locale === 'pt') return p.description_pt || p.description;
  if (locale === 'es') return p.description_es || p.description;
  return p.description;
}
