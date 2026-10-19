'use client';
import Link from 'next/link';
import { useEffect, useRef } from 'react';
import { useCart } from '@/context/CartContext';
import { CartIconMark } from '@/components/ui/Icon';
import { Tally } from '@/components/ui/Tally';
import { useI18n } from '@/i18n/LocaleProvider';
import { LANDED_EVENT } from './FlightLayer';

export function CartIcon() {
  const { totalItems } = useCart();
  const { t, tn } = useI18n();
  const markRef = useRef<HTMLSpanElement>(null);

  // The receipt for the flight: the cart takes the impact. Driven by the
  // landed event rather than by the count changing, so the squash lands on the
  // same frame the clone disappears instead of ~600ms earlier.
  useEffect(() => {
    function onLanded() {
      const mark = markRef.current;
      if (!mark || typeof mark.animate !== 'function') return;
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

      mark.animate(
        [
          { transform: 'scale(1)' },
          { transform: 'scale(0.82) translateY(2px)', offset: 0.28 },
          { transform: 'scale(1.16)', offset: 0.6 },
          { transform: 'scale(1)' },
        ],
        { duration: 520, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      );
    }
    window.addEventListener(LANDED_EVENT, onLanded);
    return () => window.removeEventListener(LANDED_EVENT, onLanded);
  }, []);

  return (
    <Link
      href="/cart"
      data-cart-target
      className="group relative flex h-11 w-11 items-center justify-center rounded-lg text-ch-200 transition-colors hover:bg-ch-800 hover:text-brand-400"
      aria-label={totalItems > 0 ? tn('a11y.cartItems', totalItems) : t('a11y.cartEmpty')}
    >
      <span ref={markRef} className="flex">
        <CartIconMark className="h-[22px] w-[22px]" />
      </span>
      {totalItems > 0 && (
        <span
          className="numeric absolute right-0.5 top-0.5 flex h-[19px] min-w-[19px] items-center justify-center
                     rounded-full bg-brand-400 px-1 text-[0.6875rem] font-bold leading-none text-ink-900
                     ring-2 ring-ch-900"
        >
          {totalItems > 99 ? '99+' : <Tally value={totalItems} />}
        </span>
      )}
    </Link>
  );
}
