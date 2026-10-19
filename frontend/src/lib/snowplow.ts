'use client';

import {
  newTracker,
  trackPageView,
  trackStructEvent,
} from '@snowplow/browser-tracker';

let initialized = false;
let tracker: ReturnType<typeof newTracker> | null = null;

function ensureInitialized(): void {
  if (initialized || typeof window === 'undefined') return;
  initialized = true;
  // Use the Next.js proxy route so the tracker always talks to the same origin.
  // This prevents mixed-content blocks when the app is served over HTTPS
  // (e.g. dev tunnels) while the collector is plain HTTP on the internal network.
  const collectorUrl = `${window.location.origin}/api/snowplow`;
  tracker = newTracker('sp', collectorUrl, {
    appId:               process.env.NEXT_PUBLIC_SNOWPLOW_APP_ID ?? 'clickshop',
    platform:            'web',
    cookieSameSite:      'Lax',
    stateStorageStrategy: 'localStorage',
    discoverRootDomain:  false,
  });
}

// ── Public API ─────────────────────────────────────────────────────────────

export function initSnowplow(): void { ensureInitialized(); }

/**
 * This browser's anonymous Snowplow id — the `domain_userid` its events land
 * with in ClickHouse. The analytics dashboard uses it to point out the
 * viewer's own row ("you") among live visitors. Null before the tracker exists.
 */
export function getDomainUserId(): string | null {
  return tracker?.getDomainUserId() ?? null;
}

export function trackView(title?: string): void {
  if (typeof window === 'undefined') return;
  ensureInitialized();
  trackPageView({ title });
}

export function trackEvent(params: {
  category:  string;
  action:    string;
  label?:    string;
  property?: string;
  value?:    number;
  ctx?: {
    product_id?:    number;
    category_slug?: string;
    search_query?:  string;
    search_type?:   string;
  };
}): void {
  ensureInitialized();
  // Encode e-commerce context into se_label / se_property so the bridge
  // can extract ctx_* columns without requiring custom Iglu schemas.
  const label = params.label
    ?? (params.ctx?.product_id != null
          ? String(params.ctx.product_id)
          : (params.ctx?.search_query ?? ''));
  const property = params.property
    ?? (params.ctx?.category_slug ?? params.ctx?.search_type ?? '');

  trackStructEvent({
    category: params.category,
    action:   params.action,
    label,
    property,
    value:    params.value,
  });
}

export function trackAddToCart(productId: number, categorySlug: string, price: number): void {
  ensureInitialized();
  trackStructEvent({
    category: 'cart',
    action:   'add_to_cart',
    label:    String(productId),
    property: categorySlug,
    value:    price,
  });
}

export function trackCheckoutStart(totalPrice: number, itemCount: number): void {
  ensureInitialized();
  trackStructEvent({
    category: 'checkout',
    action:   'start',
    property: String(itemCount),
    value:    totalPrice,
  });
}

export type PaymentMethod = 'pix' | 'credit_card' | 'boleto';

export function trackPaymentInitiated(totalPrice: number, method: PaymentMethod): void {
  ensureInitialized();
  trackStructEvent({
    category: 'checkout',
    action:   'payment_initiated',
    label:    method,
    value:    totalPrice,
  });
}

export function trackPaymentConfirmed(totalPrice: number, method: PaymentMethod): void {
  ensureInitialized();
  trackStructEvent({
    category: 'checkout',
    action:   'payment_confirmed',
    label:    method,
    value:    totalPrice,
  });
}

export function trackScrollDepth(pct: number): void {
  ensureInitialized();
  trackStructEvent({
    category: 'engagement',
    action:   'scroll',
    label:    `${pct}%`,
    value:    pct,
  });
}
