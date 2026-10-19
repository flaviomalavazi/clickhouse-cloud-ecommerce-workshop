'use client';

import { flushSync } from 'react-dom';

/**
 * Run a state update inside a same-document View Transition.
 *
 * `flushSync` is required: the transition captures the DOM at the moment the
 * callback returns, so React has to have written the new tree by then. A
 * concurrent update would be captured half-applied.
 *
 * Progressive by construction — a browser without the API, or a visitor who
 * asked for less motion, just gets the plain update.
 */
export function withViewTransition(apply: () => void): void {
  if (typeof document === 'undefined') {
    apply();
    return;
  }

  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  if (!doc.startViewTransition || reduced) {
    apply();
    return;
  }

  doc.startViewTransition(() => flushSync(apply));
}
