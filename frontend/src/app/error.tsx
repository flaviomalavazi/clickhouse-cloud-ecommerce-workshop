'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ArrowLeftIcon } from '@/components/ui/Icon';
import { useI18n } from '@/i18n/LocaleProvider';

/**
 * Error boundary for the storefront.
 *
 * This exists so that pages can let database failures propagate instead of
 * catching them and calling notFound(). A 404 tells the visitor (and the crawler,
 * and the traffic simulator) that the product or category does not exist, which
 * was wrong and unrecoverable-looking; this says "try again", which is true.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { t } = useI18n();

  useEffect(() => {
    console.error('Storefront render error:', error);
  }, [error]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center">
      <span
        className="mx-auto mb-7 flex h-14 w-14 items-center justify-center rounded-xl bg-brand-400"
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#111110" strokeWidth={2} strokeLinecap="round" className="h-7 w-7">
          <path d="M12 8.5v5M12 16.8h.01" />
          <path d="M10.3 3.9 2.6 17.4A1.9 1.9 0 0 0 4.3 20.3h15.4a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" />
        </svg>
      </span>

      <h1 className="text-display-sm text-ink-900">{t('error.title')}</h1>
      <p className="mx-auto mt-4 max-w-measure leading-relaxed text-ink-600">{t('error.body')}</p>

      <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
        <button onClick={reset} className="btn-primary btn-lg">
          {t('error.retry')}
        </button>
        <Link href="/" className="btn-secondary btn-lg">
          <ArrowLeftIcon className="h-[18px] w-[18px]" />
          {t('error.backToShop')}
        </Link>
      </div>

      {error.digest && (
        <p className="mt-12 text-xs text-ink-400">
          {t('error.reference')} <span className="numeric text-ink-600">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
