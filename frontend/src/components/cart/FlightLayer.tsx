'use client';

import { useEffect, useRef } from 'react';

export const FLY_EVENT = 'clickshop:fly-to-cart';
export const LANDED_EVENT = 'clickshop:cart-landed';

export interface FlyDetail {
  /** Viewport rect of the image the visitor acted on. */
  from: { top: number; left: number; width: number; height: number };
  src: string;
  alt: string;
}
/** Fired by any add-to-cart control that can see its product image. */
export function flyToCart(detail: FlyDetail) {
  window.dispatchEvent(new CustomEvent<FlyDetail>(FLY_EVENT, { detail }));
}

/**
 * Sends the product image on an arc into the cart.
 *
 * Mounted once, in the layout. Controls dispatch an event with the rect of the
 * image they are next to; this clones it into a fixed-position layer and
 * animates it, then tells the cart icon to react. Doing it here rather than in
 * the button keeps the clone out of any overflow-hidden card and out of every
 * stacking context on the page.
 *
 * The arc is three keyframes, not two: a straight tween between two rects
 * reads as a slide, and the lift over the midpoint is what makes it read as
 * thrown. Position uses the spring easing; scale and fade use a plain ease-out,
 * because a spring on scale makes the clone visibly wobble at the end.
 */
export function FlightLayer() {
  const layerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!layerRef.current) return;

    function target(): DOMRect | null {
      // Two cart icons render — one for the desktop nav, one for the mobile
      // bar — and only one of them is laid out. offsetParent tells them apart.
      const candidates = Array.from(document.querySelectorAll<HTMLElement>('[data-cart-target]'));
      const visible = candidates.find(el => el.offsetParent !== null) ?? candidates[0];
      return visible?.getBoundingClientRect() ?? null;
    }

    function onFly(event: Event) {
      const layer = layerRef.current;
      if (!layer) return;
      const { detail } = event as CustomEvent<FlyDetail>;
      const to = target();
      const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

      // Nothing to fly toward, or the visitor asked for less motion: skip
      // straight to the acknowledgement so the action is still confirmed.
      if (!to || reduced || typeof document.body.animate !== 'function') {
        window.dispatchEvent(new Event(LANDED_EVENT));
        return;
      }

      const { from, src, alt } = detail;

      const clone = document.createElement('img');
      clone.src = src;
      clone.alt = '';
      clone.setAttribute('aria-hidden', 'true');
      clone.decoding = 'sync';
      clone.className = 'pointer-events-none fixed z-[80] rounded-lg object-cover shadow-lift';
      clone.style.top = `${from.top}px`;
      clone.style.left = `${from.left}px`;
      clone.style.width = `${from.width}px`;
      clone.style.height = `${from.height}px`;
      clone.style.willChange = 'transform, opacity';
      layer.appendChild(clone);

      const dx = to.left + to.width / 2 - (from.left + from.width / 2);
      const dy = to.top + to.height / 2 - (from.top + from.height / 2);
      // Lift proportional to the distance travelled, capped so a nearby cart
      // does not produce a comically tall loop.
      const lift = Math.min(160, Math.abs(dy) * 0.4 + 90);

      const flight = clone.animate(
        [
          { transform: 'translate3d(0, 0, 0) scale(1)', opacity: 1, offset: 0 },
          {
            transform: `translate3d(${dx * 0.5}px, ${dy * 0.5 - lift}px, 0) scale(0.5)`,
            opacity: 0.95,
            offset: 0.55,
          },
          {
            transform: `translate3d(${dx}px, ${dy}px, 0) scale(0.12)`,
            opacity: 0,
            offset: 1,
          },
        ],
        { duration: 640, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' }
      );

      flight.finished
        .catch(() => {})
        .finally(() => {
          clone.remove();
          window.dispatchEvent(new Event(LANDED_EVENT));
        });
    }

    window.addEventListener(FLY_EVENT, onFly);
    return () => window.removeEventListener(FLY_EVENT, onFly);
  }, []);

  // A bare positioned container that never paints, so it cannot intercept a
  // click. Deliberately no `overflow` or `contain`: either would make this a
  // containing block for the fixed clone, and the clone's coordinates are
  // viewport-relative.
  return <div ref={layerRef} aria-hidden="true" className="pointer-events-none fixed inset-0 z-[80]" />;
}
