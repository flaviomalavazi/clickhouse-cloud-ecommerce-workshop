'use client';
import Link from 'next/link';
import { ArrowRightIcon } from '@/components/ui/Icon';
import { LatentField } from './LatentField';
import { useI18n } from '@/i18n/LocaleProvider';
import type { TranslationKey } from '@/i18n';

/** Accurate to what the demo actually runs — see the capability table in README. */
const CAPABILITIES: TranslationKey[] = [
  'home.capFullText',
  'home.capAnalytics',
];

export function HeroBanner() {
  const { t } = useI18n();

  return (
    <section className="on-dark relative isolate overflow-hidden bg-ch-900 text-white">
      <div className="h-[3px] w-full bg-brand-400" />

      {/* One warm field of light, sitting under the points so the cluster it
          forms has something to bloom against. */}
      <div
        className="pointer-events-none absolute -right-24 top-1/2 h-[22rem] w-[22rem] -translate-y-1/2
                   rounded-full bg-brand-400/[0.16] blur-[110px]"
        aria-hidden="true"
      />

      {/* Point field. Replaces the concentric arcs that were here: a point
          field and a set of arcs are two decorative systems competing in one
          viewport, and the field is the one that means something. Renders
          nothing at all where WebGL is unavailable. */}
      <LatentField />

      {/* Keeps the type legible over the densest part of the field without
          dimming the field itself. */}
      <div
        className="pointer-events-none absolute inset-y-0 left-0 w-full bg-gradient-to-r
                   from-ch-900 via-ch-900/80 to-transparent sm:w-2/3 lg:w-1/2"
        aria-hidden="true"
      />

      <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-20 md:pb-20 md:pt-28">
        <h1 className="animate-rise text-display-lg max-w-4xl">
          {t('home.heroLine1')}
          <br />
          <span className="relative inline-block">
            {t('home.heroLine2')}
            {/* The slab sits below the baseline, so nothing is ever set on top
                of the yellow. */}
            <span
              className="absolute -bottom-1.5 left-0 h-[0.15em] w-full origin-left animate-swipe bg-brand-400 md:-bottom-3"
              aria-hidden="true"
            />
          </span>
        </h1>

        <p
          className="mt-8 max-w-measure animate-rise text-lg leading-relaxed text-ch-200 md:text-xl"
          style={{ animationDelay: '90ms' }}
        >
          {t('home.heroSub')}
        </p>

        {/* Full-width and stacked on the phone; two natural widths from sm up.
            Ragged edges on a stack read as a mistake. */}
        <div
          className="mt-10 flex animate-rise flex-col gap-3 sm:flex-row sm:items-center"
          style={{ animationDelay: '170ms' }}
        >
          <Link href="/search" className="btn-primary btn-lg group w-full sm:w-auto">
            {t('home.ctaSearch')}
            <ArrowRightIcon className="h-[18px] w-[18px] transition-transform duration-300 ease-expo group-hover:translate-x-1" />
          </Link>
        </div>

        <ul className="mt-14 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-line-inverse pt-6">
          {CAPABILITIES.map(key => (
            <li key={key} className="flex items-center gap-2.5 text-sm text-ch-300">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand-400" aria-hidden="true" />
              {t(key)}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
