'use client';

import Link from 'next/link';
import { CATEGORIES } from '@/lib/constants';
import { ArrowRightIcon } from '@/components/ui/Icon';
import { useI18n } from '@/i18n/LocaleProvider';

/** Product names, not translated. */
const STACK = ['ClickHouse Cloud', 'PostgreSQL', 'Snowplow', 'OpenTelemetry', 'Next.js 14'];

export function Footer() {
  const { t, categoryName } = useI18n();

  return (
    <footer className="on-dark relative mt-auto bg-ch-900 text-ch-300">
      <div className="h-[3px] w-full bg-brand-400" />

      <div className="mx-auto max-w-7xl px-4 py-16">
        {/* The lead column takes more room than the link lists — four equal
            columns gave the wordmark the same weight as a list of five links. */}
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.6fr_1fr_1fr_1fr] lg:gap-12">
          <div>
            <span className="flex items-baseline text-2xl font-black tracking-[-0.04em]">
              <span className="text-brand-400">Click</span>
              <span className="text-white">Shop</span>
            </span>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-ch-300">
              {t('footer.blurb')}
            </p>
            <a
              href="https://clickhouse.com/cloud"
              target="_blank"
              rel="noopener noreferrer"
              className="group mt-6 inline-flex items-center gap-2 text-sm font-semibold text-brand-400
                         transition-colors hover:text-brand-300"
            >
              {t('footer.tryCloud')}
              <ArrowRightIcon className="h-4 w-4 transition-transform duration-300 ease-expo group-hover:translate-x-1" />
            </a>
          </div>

          <FooterColumn title={t('footer.categories')}>
            {CATEGORIES.map(cat => (
              <li key={cat.slug}>
                <FooterLink href={`/category/${cat.slug}`}>
                  {categoryName(cat.slug, cat.name)}
                </FooterLink>
              </li>
            ))}
          </FooterColumn>

          <FooterColumn title={t('footer.explore')}>
            <li><FooterLink href="/search">{t('footer.textSearch')}</FooterLink></li>
            <li><FooterLink href="/demo/analytics">{t('footer.liveAnalytics')}</FooterLink></li>
            <li><FooterLink href="/cart">{t('footer.yourCart')}</FooterLink></li>
          </FooterColumn>

          <FooterColumn title={t('footer.builtWith')}>
            {STACK.map(item => (
              <li key={item} className="flex items-center gap-2">
                <span className="inline-block h-1 w-1 shrink-0 rounded-full bg-brand-400" aria-hidden="true" />
                {item}
              </li>
            ))}
          </FooterColumn>
        </div>

        <div className="mt-14 flex flex-col gap-3 border-t border-line-inverse pt-7 text-xs text-ch-400 sm:flex-row sm:items-center sm:justify-between">
          <p>{t('footer.legal')}</p>
          <p className="flex items-center gap-2">
            <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-brand-400" aria-hidden="true" />
            {t('footer.streaming')}
          </p>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.12em] text-white">{title}</h2>
      <ul className="space-y-2.5 text-sm">{children}</ul>
    </div>
  );
}

function FooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded transition-colors hover:text-brand-400">
      {children}
    </Link>
  );
}
