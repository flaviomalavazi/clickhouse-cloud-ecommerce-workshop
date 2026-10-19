'use client';
import Image from 'next/image';
import Link from 'next/link';
import { CATEGORY_HERO_IMAGES, proxyImageUrl } from '@/lib/constants';
import { useI18n } from '@/i18n/LocaleProvider';
import type { Category } from '@/types/product';

interface Props { category: Category; }

export function CategoryHero({ category }: Props) {
  const { t, categoryName, categoryDescription } = useI18n();

  // CATEGORY_HERO_IMAGES has been defined in lib/constants since the start and
  // was never rendered anywhere, so all five categories showed the same black
  // band. proxyImageUrl reduces an absolute image URL to the /images path
  // served from public/images, which also keeps next/image off remote-domain
  // checks.
  const hero = CATEGORY_HERO_IMAGES[category.slug];

  // Postgres holds these five names and blurbs in English only. The dictionary
  // wins so the rail, the tiles and this heading cannot disagree, and the
  // database value is the fallback for a slug the dictionary does not know.
  const name = categoryName(category.slug, category.name);
  const description = categoryDescription(category.slug, category.description);

  return (
    <section className="on-dark relative isolate overflow-hidden bg-ch-900 text-white">
      <div className="h-[3px] w-full bg-brand-400" />

      {hero ? (
        <>
          <Image
            src={proxyImageUrl(hero)}
            alt=""
            fill
            unoptimized
            priority
            aria-hidden="true"
            className="object-cover object-center opacity-60"
            sizes="100vw"
          />
          {/* One horizontal scrim, weighted to the type side. Anything heavier
              and the photograph stops being a photograph. */}
          <div
            className="absolute inset-0 bg-gradient-to-r from-ch-900 via-ch-900/80 to-ch-900/25"
            aria-hidden="true"
          />
          <div
            className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-ch-900 to-transparent"
            aria-hidden="true"
          />
        </>
      ) : (
        <div
          className="pointer-events-none absolute -right-20 top-1/2 h-[18rem] w-[18rem] -translate-y-1/2
                     rounded-full bg-brand-400/[0.12] blur-[100px]"
          aria-hidden="true"
        />
      )}

      <div className="relative mx-auto max-w-7xl px-4 py-16 md:py-24">
        <nav className="mb-7 flex items-center gap-2 text-sm text-ch-300" aria-label={t('a11y.breadcrumb')}>
          <Link href="/" className="rounded transition-colors hover:text-brand-400">
            {t('product.home')}
          </Link>
          <span aria-hidden="true" className="text-ch-500">/</span>
          <span className="text-white">{name}</span>
        </nav>

        <h1 className="text-display">{name}</h1>
        {description && (
          <p className="mt-5 max-w-measure text-base leading-relaxed text-ch-200 md:text-lg">
            {description}
          </p>
        )}
      </div>
    </section>
  );
}
