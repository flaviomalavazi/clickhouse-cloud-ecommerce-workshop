'use client';
import Link from 'next/link';
import { CATEGORIES } from '@/lib/constants';
import { ArrowRightIcon, SearchIcon } from '@/components/ui/Icon';
import { useI18n } from '@/i18n/LocaleProvider';

/**
 * Both the product and the category route call notFound() for a genuinely
 * absent row. Without this file those visitors got Next's built-in 404 — an
 * unstyled page with no header, no footer and no way back into the catalogue.
 */
export default function NotFound() {
  const { t, categoryName } = useI18n();

  return (
    <div className="mx-auto max-w-3xl px-4 py-24 text-center">
      <p className="numeric text-display-lg leading-none text-paper-200" aria-hidden="true">404</p>
      <h1 className="mt-6 text-display-sm text-ink-900">{t('notFound.title')}</h1>
      <p className="mx-auto mt-4 max-w-measure text-ink-600">{t('notFound.body')}</p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <Link href="/" className="btn-primary btn-lg">
          {t('notFound.backToShop')}
          <ArrowRightIcon className="h-[18px] w-[18px]" />
        </Link>
        <Link href="/search" className="btn-secondary btn-lg">
          <SearchIcon className="h-[18px] w-[18px]" />
          {t('notFound.searchProducts')}
        </Link>
      </div>

      <div className="mt-16 border-t border-line pt-8">
        <h2 className="mb-5 text-xs font-bold uppercase tracking-[0.14em] text-ink-500">
          {t('notFound.browseCategories')}
        </h2>
        <ul className="flex flex-wrap justify-center gap-2">
          {CATEGORIES.map(cat => (
            <li key={cat.slug}>
              <Link
                href={`/category/${cat.slug}`}
                className="block rounded-lg border border-line-strong bg-paper px-3.5 py-2
                           text-sm font-medium text-ink-700 transition-colors
                           hover:border-ink-900 hover:text-ink-900"
              >
                {categoryName(cat.slug, cat.name)}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
