/**
 * One column rhythm for every product grid.
 *
 * The three grids used to disagree: home ran to six columns at xl (≈190px
 * cards), the category listing to four, best-deals to four at md. Same card,
 * three different sizes on one site.
 */
export const PRODUCT_GRID = 'grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 sm:gap-5';

/** Best-deals runs a fixed four items, so it skips the 3-up step. */
export const DEALS_GRID = 'grid grid-cols-2 gap-4 lg:grid-cols-4 sm:gap-5';

/**
 * Opt-in scroll-driven arrival, composed onto a grid that wants it.
 *
 * Deliberately not baked into PRODUCT_GRID. The search results use that same
 * constant and already animate: every keystroke re-renders the grid inside a
 * View Transition, so surviving products slide to their new cell. Adding an
 * arrival animation on top would mean two effects competing for the same cards
 * on the same surface, which reads as noise rather than as either effect.
 *
 * Category listings, best-deals and the home recommendations are static once
 * rendered, so the arrival is theirs.
 */
export const REVEAL = 'reveal-grid';
