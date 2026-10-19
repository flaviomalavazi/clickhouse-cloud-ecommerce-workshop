'use client';
import Link from 'next/link';
import { ArrowRightIcon, CheckIcon } from '@/components/ui/Icon';
import { useI18n } from '@/i18n/LocaleProvider';

export default function ConfirmationPage() {
  const { t } = useI18n();

  return (
    <div className="mx-auto max-w-2xl px-4 py-20 text-center md:py-24">
      <span
        className="mx-auto mb-8 flex h-20 w-20 items-center justify-center rounded-2xl bg-brand-400 shadow-lift"
        aria-hidden="true"
      >
        <CheckIcon className="h-10 w-10 text-ink-900" strokeWidth={2.5} />
      </span>

      <h1 className="text-display-sm text-ink-900">{t('confirm.title')}</h1>
      <p className="mx-auto mt-4 max-w-measure leading-relaxed text-ink-600">{t('confirm.body')}</p>

      {/* The ClickHouse call to action. The old version hung a 4px yellow bar
          down the left edge of this panel; the rule now sits along the top,
          where the rest of the storefront puts it. */}
      <div className="on-dark mt-12 overflow-hidden rounded-2xl bg-ch-900 text-left shadow-panel">
        <div className="h-[3px] w-full bg-brand-400" />
        <div className="px-7 py-8 md:px-9">
          <p className="text-lg font-semibold leading-snug text-white md:text-xl">
            {t('confirm.pitch')}
          </p>
          <a
            href="https://clickhouse.com/cloud"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-primary group mt-6"
          >
            {t('confirm.tryCloud')}
            <ArrowRightIcon className="h-[18px] w-[18px] transition-transform duration-300 ease-expo group-hover:translate-x-1" />
          </a>
        </div>
      </div>

      <div className="mt-10 flex flex-col justify-center gap-3 sm:flex-row">
        <Link href="/" className="btn-secondary btn-lg">{t('confirm.continueShopping')}</Link>
        <Link href="/demo/analytics" className="btn-dark btn-lg">
          {t('confirm.seeEvents')}
          <ArrowRightIcon className="h-[18px] w-[18px]" />
        </Link>
      </div>
    </div>
  );
}
