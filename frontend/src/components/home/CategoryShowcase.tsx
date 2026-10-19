'use client';
import Image from 'next/image';
import Link from 'next/link';
import { CATEGORIES, CATEGORY_HERO_IMAGES, proxyImageUrl } from '@/lib/constants';
import { ArrowRightIcon } from '@/components/ui/Icon';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { useI18n } from '@/i18n/LocaleProvider';

/**
 * Navigational tiles for the five categories.
 *
 * The home page was a hero followed by one recommendation grid, and that grid
 * comes from ClickHouse — so whenever the query returned nothing the whole page
 * below the fold was empty. This runs off lib/constants, needs no query, and
 * gives the fold something to land on either way.
 *
 * The first tile takes a 2×2 cell so the row is not five identical rectangles.
 */
export function CategoryShowcase() {
  const { t, categoryName } = useI18n();

  return (
    <section className="mx-auto max-w-7xl px-4 pt-16 md:pt-20">
      <SectionHeading
        title={t('home.shopByCategory')}
        aside={
          <Link href="/search" className="rounded font-medium transition-colors hover:text-ink-900">
            {t('home.orSearch')}
          </Link>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:auto-rows-[13.5rem] lg:grid-cols-4">
        {CATEGORIES.map((cat, i) => {
          const hero = CATEGORY_HERO_IMAGES[cat.slug];
          const lead = i === 0;
          return (
            <Link
              key={cat.slug}
              href={`/category/${cat.slug}`}
              className={`group relative isolate flex items-end overflow-hidden rounded-xl bg-ch-900
                          ${lead ? 'col-span-2 aspect-[16/11] lg:col-span-2 lg:row-span-2 lg:aspect-auto' : 'aspect-[4/5] sm:aspect-[5/4] lg:aspect-auto'}`}
            >
              {hero && (
                <Image
                  src={proxyImageUrl(hero)}
                  alt=""
                  fill
                  unoptimized
                  aria-hidden="true"
                  className="object-cover transition-transform duration-[800ms] ease-expo group-hover:scale-105"
                  sizes={lead ? '(max-width: 1024px) 100vw, 50vw' : '(max-width: 1024px) 50vw, 25vw'}
                />
              )}
              <div
                className="absolute inset-0 bg-gradient-to-t from-ch-900 via-ch-900/45 to-transparent
                           transition-opacity duration-500 group-hover:from-ch-900 group-hover:via-ch-900/60"
                aria-hidden="true"
              />

              <div className="relative w-full p-4 sm:p-5">
                <div className="flex items-center justify-between gap-2">
                  <h3
                    className={`font-extrabold tracking-[-0.03em] text-white ${
                      lead ? 'text-2xl sm:text-3xl' : 'text-base sm:text-lg'
                    }`}
                  >
                    {categoryName(cat.slug, cat.name)}
                  </h3>
                  <ArrowRightIcon
                    className="h-5 w-5 shrink-0 -translate-x-1 text-brand-400 opacity-0 transition-all
                               duration-300 ease-expo group-hover:translate-x-0 group-hover:opacity-100"
                    aria-hidden="true"
                  />
                </div>
                <span
                  className="mt-3 block h-[3px] w-9 origin-left scale-x-0 bg-brand-400 transition-transform
                             duration-500 ease-expo group-hover:scale-x-100"
                  aria-hidden="true"
                />
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
