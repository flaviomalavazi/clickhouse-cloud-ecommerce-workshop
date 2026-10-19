'use client';
import Link from 'next/link';
import Image from 'next/image';
import { trackEvent } from '@/hooks/useSnowplow';
import type { Product } from '@/types/product';
import { AddToCartButton } from '@/components/cart/AddToCartButton';
import { Price } from '@/components/ui/Price';
import { proxyImageUrl } from '@/lib/constants';
import { productName } from '@/lib/i18n-product';
import { stampProductMorph } from '@/components/ui/stampMorph';
import { useRef } from 'react';
import { useI18n } from '@/i18n/LocaleProvider';

interface Props {
  product: Product;
  position?: number;
  /**
   * Give this card a `view-transition-name` so it animates between result sets
   * instead of being repainted. Only ever set on ONE grid per document: the
   * names have to be unique, and a duplicate silently kills the transition.
   */
  morph?: boolean;
}

export function ProductCard({ product, position, morph = false }: Props) {
  const { t, locale } = useI18n();
  const title = productName(product, locale);

  const cardRef = useRef<HTMLElement>(null);

  const handleClick = () => {
    // Names the image and title as the shared elements for the navigation this
    // click is about to start. Must happen synchronously: the browser snapshots
    // the outgoing page in this same task.
    stampProductMorph(cardRef.current);
    trackEvent({
      category: 'product',
      action: 'click',
      label: String(product.id),
      property: product.category_slug,
      value: position,
    });
  };

  const outOfStock = product.stock_quantity === 0;

  // The card used to be a single <Link> wrapping everything, which put the
  // add-to-cart <button> inside an <a>: invalid markup, two competing
  // activation targets, and a control that keyboard users reached only by
  // tabbing "into" the link. The link now covers the card face via
  // .stretched-link and the button sits above it on its own layer.
  return (
    <article
      ref={cardRef}
      className="card group relative flex flex-col transition-all duration-300 ease-expo
                 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-lift"
      style={morph ? ({ viewTransitionName: `p${product.id}` } as React.CSSProperties) : undefined}
    >
      <div data-morph="hero" className="relative aspect-square overflow-hidden bg-paper-100">
        <Image
          src={proxyImageUrl(product.image_url)}
          alt={title}
          fill
          unoptimized
          className={`object-cover transition-transform duration-[600ms] ease-expo group-hover:scale-[1.06] ${
            outOfStock ? 'opacity-55 saturate-[0.35]' : ''
          }`}
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
        />

        {product.discount_pct != null && product.discount_pct > 0 && (
          <span className="badge-discount absolute left-2.5 top-2.5">
            −{product.discount_pct}%
          </span>
        )}
        {outOfStock && (
          <span className="badge-outofstock absolute right-2.5 top-2.5">
            {t('product.outOfStock')}
          </span>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3.5">
        {product.brand && (
          <p className="mb-1 truncate text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-400">
            {product.brand}
          </p>
        )}

        <h3 className="mb-2.5 text-sm font-medium leading-snug text-ink-800">
          <Link
            href={`/product/${product.id}`}
            onClick={handleClick}
            data-testid="product-card-link"
            data-morph="title"
            className="stretched-link line-clamp-2 rounded transition-colors group-hover:text-ink-900"
          >
            {title}
          </Link>
        </h3>

        <Price
          price={product.price}
          originalPrice={product.original_price}
          className="mb-3 mt-auto"
        />

        {/* z-20 keeps this above .stretched-link's overlay. */}
        <AddToCartButton product={product} size="sm" className="relative z-20 w-full" />
      </div>
    </article>
  );
}
