'use client';

/**
 * Hand the clicked card's image and title to the product page.
 *
 * Cross-document View Transitions match elements by `view-transition-name`
 * across the two documents, so the outgoing page must name exactly one image
 * `product-hero` and one heading `product-title`. Naming every card up front
 * would put twenty elements under one name, and a duplicate name does not pick
 * a winner — it aborts the whole transition, silently. So the names are stamped
 * on the card the visitor actually clicked, at click time, and nowhere else.
 *
 * Stamped through the DOM rather than through React state on purpose. The
 * navigation begins in the same task as the click, and a state update would not
 * have committed by the time the browser snapshots the old page: the transition
 * would capture the card still unnamed. Writing the style directly is the only
 * way to be sure the snapshot sees it.
 *
 * The names have to come off again. Returning with the back button restores
 * this page from the back/forward cache with the stamp still on it, and the next
 * click on a different card would then create the duplicate that kills the
 * transition. `pageshow` fires on a bfcache restore where a plain effect does
 * not, which is why the cleanup listens for that.
 */

const HERO = 'product-hero';
const TITLE = 'product-title';

/** Every element this module has stamped, so it can find them again. */
const stamped = new Set<HTMLElement>();

let cleanupBound = false;

function clearAll(): void {
  // forEach rather than for...of: this project's tsconfig sets no `target`, so
  // iterating a Set would need downlevelIteration, and changing that setting to
  // suit one file is the wrong trade.
  stamped.forEach(el => { el.style.viewTransitionName = ''; });
  stamped.clear();
}
function bindCleanup(): void {
  if (cleanupBound || typeof window === 'undefined') return;
  cleanupBound = true;
  // Covers both a normal re-entry and a bfcache restore; `pageshow` is the only
  // one of the two that fires for the latter.
  window.addEventListener('pageshow', clearAll);
  window.addEventListener('popstate', clearAll);
}

function stamp(el: HTMLElement | null, name: string): void {
  if (!el) return;
  el.style.viewTransitionName = name;
  stamped.add(el);
}

/**
 * Name the image and heading inside `root` as the shared elements for the
 * navigation that is about to happen.
 *
 * Call it from the click handler of a product card. A visitor who asked for
 * reduced motion is left alone: the transition would be suppressed anyway, and
 * an unremoved name on a page that never transitioned is just dead weight.
 */
export function stampProductMorph(root: HTMLElement | null): void {
  if (!root || typeof window === 'undefined') return;
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  bindCleanup();
  // A previous click may have stamped a different card, and two cards holding
  // `product-hero` is exactly the duplicate that aborts the transition.
  clearAll();

  stamp(root.querySelector<HTMLElement>('[data-morph="hero"]'), HERO);
  stamp(root.querySelector<HTMLElement>('[data-morph="title"]'), TITLE);
}
