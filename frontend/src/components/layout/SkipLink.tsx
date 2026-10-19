'use client';

import { useI18n } from '@/i18n/LocaleProvider';

/** Split out of the root layout because the layout is a server component and
 *  the locale lives in a client context. */
export function SkipLink() {
  const { t } = useI18n();
  return (
    <a
      href="#main"
      className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[100]
                 focus:rounded-lg focus:bg-brand-400 focus:px-4 focus:py-2
                 focus:text-sm focus:font-bold focus:text-ink-900"
    >
      {t('a11y.skipToContent')}
    </a>
  );
}
