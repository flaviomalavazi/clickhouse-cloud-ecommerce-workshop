'use client';
import { useEffect, useRef, useState } from 'react';
import { useCart } from '@/context/CartContext';
import { trackAddToCart } from '@/lib/snowplow';
import type { Product } from '@/types/product';
import { CartIconMark, CheckIcon } from '@/components/ui/Icon';
import { flyToCart } from './FlightLayer';
import { useI18n } from '@/i18n/LocaleProvider';
import { productName } from '@/lib/i18n-product';

interface Props {
  product: Product;
  className?: string;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * The product image this button belongs to.
 *
 * Walks up to the card or page section and takes the first <img> inside it,
 * rather than threading a ref down from every call site. If there is no image
 * — a layout that has not shipped yet — the flight is simply skipped and the
 * button still confirms the way it always did.
 */
function findProductImage(button: HTMLElement): HTMLImageElement | null {
  const scope = button.closest('article, [data-product-scope]');
  return scope?.querySelector('img') ?? null;
}

const SIZES = {
  // 44px, not 36. `sm` is the card variant, which means this is the primary
  // action on the most repeated component in the storefront — twelve of them on
  // a category page — and at h-9 every one of them was under the minimum touch
  // target. Nothing else on the card needed to move: the card already had the
  // vertical room.
  sm: 'h-11 px-3 text-xs   gap-1.5 rounded-lg',
  md: 'h-11 px-4 text-sm   gap-2   rounded-lg',
  lg: 'h-14 px-7 text-base gap-2.5 rounded-xl',
} as const;

const ICON_SIZES = { sm: 'h-4 w-4', md: 'h-[18px] w-[18px]', lg: 'h-5 w-5' } as const;

export function AddToCartButton({ product, className = '', size = 'md' }: Props) {
  const { addItem } = useCart();
  const { t, locale } = useI18n();
  const [added, setAdded] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The old version left a dangling setTimeout behind on unmount, so a card
  // scrolled out of a re-rendering grid could still try to set state.
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const isOutOfStock = product.stock_quantity === 0;

  function handleAdd(e: React.MouseEvent) {
    e.stopPropagation();
    if (isOutOfStock) return;

    const image = findProductImage(e.currentTarget as HTMLElement);
    if (image?.currentSrc || image?.src) {
      const rect = image.getBoundingClientRect();
      flyToCart({
        from: { top: rect.top, left: rect.left, width: rect.width, height: rect.height },
        src: image.currentSrc || image.src,
        alt: product.name,
      });
    }

    addItem(product);
    trackAddToCart(product.id, product.category_slug ?? '', Number(product.price));
    setAdded(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setAdded(false), 1600);
  }

  const base = `inline-flex items-center justify-center whitespace-nowrap font-semibold leading-none
                transition-all duration-200 ease-expo ${SIZES[size]}`;

  if (isOutOfStock) {
    return (
      <button type="button" disabled className={`${base} cursor-not-allowed bg-paper-100 text-ink-400 ${className}`}>
        {t('product.outOfStock')}
      </button>
    );
  }

  return (
    // ── Automation contract ──────────────────────────────────────────────────
    // `add-to-cart` and the matching data-testid are the traffic simulator's
    // handles on this button (data-generators/simulator/session_browser.py).
    // It tries `button:has-text('Add to Cart')` first, which used to be what
    // matched — but the simulator opens its context with locale="pt-BR", so
    // once this label became translatable that selector stopped matching and
    // the funnel silently reported zero conversions. A timeout there raises
    // nothing; it just returns False.
    //
    // Keep both hooks, and keep them out of the localised text. An automation
    // handle must never depend on a string a translator can change.
    <button
      type="button"
      data-testid="add-to-cart"
      onClick={handleAdd}
      aria-label={t('a11y.addNamed', { name: productName(product, locale) })}
      className={`add-to-cart ${base} active:scale-[0.97] ${
        added
          ? 'bg-ink-900 text-paper'
          : 'bg-brand-400 text-ink-900 hover:bg-brand-300 hover:shadow-brand'
      } ${className}`}
    >
      {added ? (
        <>
          <CheckIcon className={ICON_SIZES[size]} strokeWidth={2.5} />
          {t('product.added')}
        </>
      ) : (
        <>
          <CartIconMark className={ICON_SIZES[size]} />
          {t('product.addToCart')}
        </>
      )}
      {/* Announced once, off-screen, so the swap is not silent. */}
      <span className="sr-only" role="status" aria-live="polite">
        {added ? t('a11y.addedNamed', { name: productName(product, locale) }) : ''}
      </span>
    </button>
  );
}
