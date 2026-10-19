'use client';
import Link from 'next/link';
import Image from 'next/image';
import { useCart } from '@/context/CartContext';
import { proxyImageUrl } from '@/lib/constants';
import { useFormatPrice } from '@/components/ui/Price';
import {
  ArrowLeftIcon, ArrowRightIcon, CartIconMark, MinusIcon, PlusIcon, TrashIcon,
} from '@/components/ui/Icon';
import { useI18n } from '@/i18n/LocaleProvider';
import { productName } from '@/lib/i18n-product';
import { withViewTransition } from '@/components/ui/viewTransition';

export default function CartPage() {
  const { items, removeItem, setQuantity, totalPrice, clearCart } = useCart();
  const { t, tn, locale } = useI18n();
  // Bound to the active locale, so the currency follows the language.
  const formatPrice = useFormatPrice();

  // Every mutation is a transition. Removing a row collapses the ones below
  // into its place and the totals slide to their new figures, instead of the
  // whole panel jumping between two static states.
  const changeQuantity = (id: number, next: number) =>
    withViewTransition(() => setQuantity(id, next));
  const remove = (id: number) => withViewTransition(() => removeItem(id));
  const clear = () => withViewTransition(clearCart);

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-24 text-center">
        <span
          className="mx-auto mb-7 flex h-20 w-20 items-center justify-center rounded-2xl border border-line bg-paper text-ink-300 shadow-tile"
          aria-hidden="true"
        >
          <CartIconMark className="h-9 w-9" strokeWidth={1.4} />
        </span>
        <h1 className="text-display-sm text-ink-900">{t('cart.emptyTitle')}</h1>
        <p className="mx-auto mt-4 max-w-measure text-ink-600">{t('cart.emptyHint')}</p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link href="/" className="btn-primary btn-lg">
            {t('cart.startShopping')}
            <ArrowRightIcon className="h-[18px] w-[18px]" />
          </Link>
          <Link href="/search" className="btn-secondary btn-lg">{t('cart.searchProducts')}</Link>
        </div>
      </div>
    );
  }

  const itemCount = items.reduce((n, i) => n + i.quantity, 0);

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:py-14">
      <span className="section-rule" aria-hidden="true" />
      <div className="mb-9 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-display-sm text-ink-900">{t('cart.title')}</h1>
        <p className="text-sm text-ink-500">{tn('cart.items', itemCount)}</p>
      </div>

      <div className="grid gap-8 lg:grid-cols-3 lg:gap-10">
        <div className="lg:col-span-2">
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper shadow-tile">
            {items.map(({ product, quantity }) => (
              <li
                key={product.id}
                className="flex gap-4 p-4 transition-colors hover:bg-paper-50 sm:gap-5 sm:p-5"
                style={{ viewTransitionName: `ci${product.id}` } as React.CSSProperties}
              >
                <Link
                  href={`/product/${product.id}`}
                  className="relative h-24 w-24 shrink-0 overflow-hidden rounded-lg border border-line bg-paper-100 sm:h-28 sm:w-28"
                >
                  <Image
                    src={proxyImageUrl(product.image_url)}
                    alt={productName(product, locale)}
                    fill
                    unoptimized
                    className="object-cover transition-transform duration-500 ease-expo hover:scale-105"
                    sizes="112px"
                  />
                </Link>

                <div className="flex min-w-0 flex-1 flex-col">
                  {product.brand && (
                    <p className="mb-0.5 truncate text-[0.6875rem] font-semibold uppercase tracking-wider text-ink-400">
                      {product.brand}
                    </p>
                  )}
                  <h2 className="text-sm font-semibold leading-snug text-ink-900">
                    <Link href={`/product/${product.id}`} className="rounded line-clamp-2 hover:underline">
                      {productName(product, locale)}
                    </Link>
                  </h2>
                  <p className="mt-1 text-sm text-ink-500">
                    {t('cart.each', { price: formatPrice(product.price) })}
                  </p>

                  <div className="mt-auto flex items-center gap-3 pt-3">
                    <div className="flex items-center overflow-hidden rounded-lg border border-line-strong">
                      <button
                        onClick={() => changeQuantity(product.id, quantity - 1)}
                        aria-label={t(quantity === 1 ? 'a11y.removeNamed' : 'a11y.decreaseNamed', { name: productName(product, locale) })}
                        className="flex h-9 w-9 items-center justify-center text-ink-600 transition-colors hover:bg-paper-100 hover:text-ink-900"
                      >
                        <MinusIcon className="h-4 w-4" />
                      </button>
                      <span className="numeric w-9 text-center text-sm font-semibold text-ink-900" aria-live="polite">
                        {quantity}
                      </span>
                      <button
                        onClick={() => changeQuantity(product.id, quantity + 1)}
                        aria-label={t('a11y.increaseNamed', { name: productName(product, locale) })}
                        className="flex h-9 w-9 items-center justify-center text-ink-600 transition-colors hover:bg-paper-100 hover:text-ink-900"
                      >
                        <PlusIcon className="h-4 w-4" />
                      </button>
                    </div>

                    <button
                      onClick={() => remove(product.id)}
                      aria-label={t('a11y.removeNamed', { name: productName(product, locale) })}
                      className="flex items-center gap-1.5 rounded text-xs font-medium text-ink-400 transition-colors hover:text-red-600"
                    >
                      <TrashIcon className="h-4 w-4" />
                      <span className="hidden sm:inline">{t('cart.remove')}</span>
                    </button>
                  </div>
                </div>

                <p className="numeric shrink-0 self-start text-base font-bold text-ink-900">
                  {formatPrice(Number(product.price) * quantity)}
                </p>
              </li>
            ))}
          </ul>

          <div className="mt-5 flex items-center justify-between">
            <button
              onClick={clear}
              className="rounded text-sm text-ink-400 transition-colors hover:text-red-600"
            >
              {t('cart.clear')}
            </button>
            <Link
              href="/"
              className="group flex items-center gap-2 rounded text-sm font-medium text-ink-600 transition-colors hover:text-ink-900"
            >
              <ArrowLeftIcon className="h-4 w-4 transition-transform duration-300 ease-expo group-hover:-translate-x-1" />
              {t('cart.continue')}
            </Link>
          </div>
        </div>

        {/* The summary follows down the page on long carts. */}
        <div className="panel h-fit p-6 lg:sticky lg:top-32">
          <h2 className="mb-5 text-xs font-bold uppercase tracking-[0.14em] text-ink-500">
            {t('cart.summary')}
          </h2>

          <ul className="mb-5 space-y-2.5 text-sm">
            {items.map(({ product, quantity }) => (
              <li key={product.id} className="flex justify-between gap-3 text-ink-600">
                <span className="truncate">
                  {productName(product, locale)} <span className="numeric text-ink-400">×{quantity}</span>
                </span>
                <span className="numeric shrink-0 text-ink-800">
                  {formatPrice(Number(product.price) * quantity)}
                </span>
              </li>
            ))}
          </ul>

          <div className="space-y-2 border-t border-line pt-5 text-sm">
            <div className="flex justify-between text-ink-600">
              <span>{t('cart.subtotal')}</span>
              <span className="numeric text-ink-800">{formatPrice(totalPrice)}</span>
            </div>
            <div className="flex justify-between text-ink-600">
              <span>{t('cart.shipping')}</span>
              <span className="font-semibold text-ink-900">{t('cart.free')}</span>
            </div>
          </div>

          <div className="mt-4 flex items-baseline justify-between border-t border-line pt-4">
            <span className="font-bold text-ink-900">{t('cart.total')}</span>
            <span className="numeric text-2xl font-bold text-ink-900">{formatPrice(totalPrice)}</span>
          </div>

          <Link href="/checkout" data-testid="checkout-link" className="btn-primary btn-lg mt-6 w-full">
            {t('cart.checkout')}
            <ArrowRightIcon className="h-[18px] w-[18px]" />
          </Link>
        </div>
      </div>
    </div>
  );
}
