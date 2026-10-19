'use client';

import Image from 'next/image';
import Link from 'next/link';
import { AddToCartButton } from '@/components/cart/AddToCartButton';
import { Price } from '@/components/ui/Price';
import { ChevronRightIcon } from '@/components/ui/Icon';
import { proxyImageUrl } from '@/lib/constants';
import { productName, productDescription } from '@/lib/i18n-product';
import { attributeLabel, attributeValue } from '@/lib/i18n-attributes';
import { useI18n } from '@/i18n/LocaleProvider';
import type { Product } from '@/types/product';

/**
 * The whole product page body.
 *
 * Split out of the route because the page is an async server component — it has
 * to be, it reads Postgres — and the locale lives in a client context. The page
 * fetches; this renders.
 *
 * The product's name and description are read per locale from the _pt/_es
 * columns, falling back to English. Brand and attribute values are not
 * translated: brands are invented proper nouns identical in every locale. The
 * attribute table goes through lib/i18n-attributes, which translates the keys
 * outright and the values word by word from a lexicon, leaving technical tokens
 * and author names alone.
 */
export function ProductDetail({ product }: { product: Product }) {
  const { t, categoryName, locale } = useI18n();

  const stock = product.stock_quantity ?? 0;
  const inStock = stock > 0;
  // Catalog copy is data, not chrome: it comes from the _pt/_es columns and
  // falls back to English when a translation has not landed.
  const title = productName(product, locale);
  const body  = productDescription(product, locale);
  const attributes = Object.entries(product.attributes ?? {});
  const slug = product.category_slug ?? '';

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:py-12" data-product-scope>
      <nav className="mb-8 flex items-center gap-1.5 text-sm text-ink-500" aria-label={t('a11y.breadcrumb')}>
        <Link href="/" className="rounded transition-colors hover:text-ink-900">
          {t('product.home')}
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5 text-ink-300" aria-hidden="true" />
        <Link href={`/category/${slug}`} className="rounded transition-colors hover:text-ink-900">
          {categoryName(slug, slug.replace(/-/g, ' '))}
        </Link>
        <ChevronRightIcon className="h-3.5 w-3.5 text-ink-300" aria-hidden="true" />
        <span className="truncate text-ink-900">{title}</span>
      </nav>

      <div className="grid gap-8 lg:grid-cols-2 lg:gap-14">
        {/* The image column stays put while the long description scrolls. */}
        <div className="lg:sticky lg:top-32 lg:self-start">
          {/* `product-hero` and `product-title` below are the receiving half of
              the cross-document morph. ProductCard stamps the same two names on
              the card that was clicked, so the browser tweens the card's
              photograph into this one and its caption into the h1 instead of
              repainting the page. Unconditional here — this page only ever has
              one of each — and harmless in a browser without the API. */}
          <div
            style={{ viewTransitionName: 'product-hero' } as React.CSSProperties}
            className="relative aspect-square overflow-hidden rounded-2xl border border-line bg-paper-100 shadow-tile"
          >
            <Image
              src={proxyImageUrl(product.image_url)}
              alt={title}
              fill
              unoptimized
              className={`enter-media object-cover ${inStock ? '' : 'opacity-60 saturate-[0.35]'}`}
              sizes="(max-width: 1024px) 100vw, 50vw"
              priority
            />
            {product.discount_pct != null && product.discount_pct > 0 && (
              <span className="badge-discount absolute left-4 top-4 px-2.5 py-1 text-sm">
                −{t('product.off', { n: product.discount_pct })}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col">
          {product.brand && (
            <p className="mb-2 text-xs font-bold uppercase tracking-[0.14em] text-ink-500">
              {product.brand}
            </p>
          )}
          <h1
            style={{ viewTransitionName: 'product-title' } as React.CSSProperties}
            className="text-display-sm text-ink-900"
          >
            {title}
          </h1>

          <div className="mt-6 flex flex-wrap items-baseline gap-x-4 gap-y-2">
            <Price price={product.price} originalPrice={product.original_price} size="lg" />
            {product.discount_pct != null && product.discount_pct > 0 && (
              <span className="badge-quiet">{t('product.save', { n: product.discount_pct })}</span>
            )}
          </div>

          {/* Only when in stock: the pill carries the count, and out of stock is
              already the disabled button's whole message a few lines down. */}
          {inStock && (
            <p className="mt-5">
              {/* Set in the system neutrals. The palette has brand, ch, ink,
                  paper and line and no green at all, so the emerald pill this
                  replaced was borrowing a hue from Tailwind's defaults and read
                  as a foreign element on a yellow-and-warm-grey page. Brand
                  yellow was no better: at 1.7:1 on white the dot barely
                  registered, and yellow in this palette is a surface, not an
                  accent on one.
                  It is also the wrong emphasis. In stock is the expected state
                  and needs no colour to announce it, while out of stock is the
                  exception, and that one is already carried by the disabled
                  button below. */}
              <span className="inline-flex items-center gap-2 rounded-full border border-line bg-paper-50 px-3 py-1.5 text-sm font-medium text-ink-700">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-ink-400" aria-hidden="true" />
                {t('product.inStock', { n: stock })}
              </span>
            </p>
          )}

          {body && (
            <p className="mt-7 max-w-measure leading-relaxed text-ink-700">{body}</p>
          )}

          <div className="mt-8 flex flex-wrap items-center gap-4">
            <AddToCartButton product={product} size="lg" className="w-full sm:w-auto" />
            {product.sku && (
              <p className="text-xs text-ink-400">
                {t('product.sku')} <span className="numeric text-ink-600">{product.sku}</span>
              </p>
            )}
          </div>

          {attributes.length > 0 && (
            <div className="mt-12">
              <h2 className="mb-4 text-xs font-bold uppercase tracking-[0.14em] text-ink-500">
                {t('product.details')}
              </h2>
              <dl className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
                {attributes.map(([key, value]) => (
                  <div key={key} className="flex items-baseline gap-4 px-4 py-3 text-sm">
                    {/* `capitalize` is gone from both: the labels are now real
                        localised strings rather than humanised column names, and
                        the values are normalised in attributeValue — leaving the
                        CSS class on would re-capitalise every word of "com fio". */}
                    <dt className="w-1/3 shrink-0 text-ink-500">
                      {attributeLabel(key, locale)}
                    </dt>
                    <dd className="font-medium text-ink-900">{attributeValue(key, value, locale)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
