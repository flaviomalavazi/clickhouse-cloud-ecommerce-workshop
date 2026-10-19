/**
 * English is the source of truth: every other dictionary is typed against this
 * object's keys, so a missing or misspelled translation is a compile error
 * rather than a blank string on screen.
 *
 * Keys are flat and dotted, `area.thing`. Placeholders are `{name}`.
 * A pair of `.one` / `.other` keys marks a plural — English, Portuguese and
 * Spanish all use that same two-form split.
 *
 * Not translated here, and why:
 *   · Product names, brands and descriptions come from Postgres.
 *   · The names in "Built with" are products.
 *   · Prices stay `$0.00` in every locale — the figures are data, and switching
 *     separators mid-demo invites a misread.
 */
export const en = {
  // ── Assistive text and control labels ────────────────────────────────────
  'a11y.skipToContent': 'Skip to content',
  'a11y.homeLink': 'ClickShop home',
  'a11y.breadcrumb': 'Breadcrumb',
  'a11y.categoryNav': 'Product categories',
  'a11y.pagination': 'Pagination',
  'a11y.prevPage': 'Previous page',
  'a11y.nextPage': 'Next page',
  'a11y.page': 'Page {n}',
  'a11y.openMenu': 'Open menu',
  'a11y.closeMenu': 'Close menu',
  'a11y.language': 'Language',
  'a11y.searchLandmark': 'Search products',
  'a11y.searchQuery': 'Search query',
  'a11y.loadingProducts': 'Loading products',
  'a11y.checkoutProgress': 'Checkout progress',
  'a11y.cartEmpty': 'Cart, empty',
  'a11y.cartItems.one': 'Cart, {n} item',
  'a11y.cartItems.other': 'Cart, {n} items',
  'a11y.addNamed': 'Add {name} to cart',
  'a11y.addedNamed': '{name} added to cart',
  'a11y.removeNamed': 'Remove {name} from cart',
  'a11y.decreaseNamed': 'Decrease quantity of {name}',
  'a11y.increaseNamed': 'Increase quantity of {name}',

  // ── Header ───────────────────────────────────────────────────────────────
  'header.poweredBy': 'Powered by ClickHouse Cloud',
  'header.liveAnalytics': 'Live analytics',
  'header.search': 'Search',
  'header.analytics': 'Analytics',
  'header.searchPlaceholder': 'Search products, brands, categories…',

  // ── Footer ───────────────────────────────────────────────────────────────
  'footer.blurb':
    'A retail storefront built to show ClickHouse handling full-text search and behavioural analytics on live data.',
  'footer.tryCloud': 'Try ClickHouse Cloud free',
  'footer.categories': 'Categories',
  'footer.explore': 'Explore',
  'footer.builtWith': 'Built with',
  'footer.textSearch': 'Text search',
  'footer.liveAnalytics': 'Live analytics',
  'footer.yourCart': 'Your cart',
  'footer.legal': 'ClickShop. A ClickHouse and PostgreSQL retail demo, not a real store.',
  'footer.streaming': 'Events streaming to ClickHouse',

  // ── Home ─────────────────────────────────────────────────────────────────
  'home.heroLine1': 'Discover Your',
  'home.heroLine2': 'Perfect Product',
  'home.heroSub':
    'Type what you are after. Thousands of products, found in an instant.',
  'home.ctaSearch': 'Search Products',
  'home.capFullText': 'Full-text search',
  'home.capAnalytics': 'Live event analytics',
  'home.shopByCategory': 'Shop by Category',
  'home.orSearch': 'Or search everything',
  'home.recommended': 'Recommended for You',
  'home.picks': '{n} picks',

  // ── Category names and blurbs ────────────────────────────────────────────
  // Keyed by slug. The five rows also exist in Postgres in English; the
  // dictionary wins so the nav, the tiles and the page heading never disagree.
  'categories.shoes': 'Shoes',
  'categories.clothing': 'Clothing',
  'categories.books': 'Books',
  'categories.it-accessories': 'IT Accessories',
  'categories.electronics': 'Electronics',
  'categoryDesc.shoes': 'Footwear for every occasion, from sports to formal',
  'categoryDesc.clothing': 'Apparel for men, women and kids across all seasons',
  'categoryDesc.books': 'Fiction, non-fiction, technical and educational titles',
  'categoryDesc.it-accessories': 'Keyboards, mice, cables, hubs and peripherals',
  'categoryDesc.electronics': 'TVs, audio equipment, cameras and home gadgets',

  // ── Category page ────────────────────────────────────────────────────────
  'category.bestDeals': 'Best Deals',
  'category.upTo': 'up to {n}% off',
  'category.allProducts': 'All Products',
  'category.range': '{from}–{to} of {total}',
  'category.emptyTitle': 'Nothing here yet',
  'category.emptyHint': 'This category has no active products right now.',
  'category.loadFailed': 'We couldn’t load page {n}. Your connection may have dropped.',
  'category.retry': 'Try again',

  // ── Product ──────────────────────────────────────────────────────────────
  'product.home': 'Home',
  'product.addToCart': 'Add to Cart',
  'product.added': 'Added',
  'product.outOfStock': 'Out of stock',
  'product.inStock': '{n} in stock',
  'product.save': 'Save {n}%',
  'product.off': '{n}% off',
  'product.sku': 'SKU',
  'product.details': 'Product details',

  // ── Cart ─────────────────────────────────────────────────────────────────
  'cart.emptyTitle': 'Your cart is empty',
  'cart.emptyHint': 'Nothing added yet. Browse the catalogue or search for something specific.',
  'cart.startShopping': 'Start shopping',
  'cart.searchProducts': 'Search products',
  'cart.title': 'Shopping Cart',
  'cart.items.one': '{n} item',
  'cart.items.other': '{n} items',
  'cart.each': '{price} each',
  'cart.remove': 'Remove',
  'cart.clear': 'Clear cart',
  'cart.continue': 'Continue shopping',
  'cart.summary': 'Order summary',
  'cart.subtotal': 'Subtotal',
  'cart.shipping': 'Shipping',
  'cart.free': 'Free',
  'cart.total': 'Total',
  'cart.checkout': 'Proceed to checkout',

  // ── Checkout ─────────────────────────────────────────────────────────────
  'checkout.title': 'Checkout',
  'checkout.step1': 'Your details',
  'checkout.step2': 'Pay with Pix',
  'checkout.contact': 'Contact information',
  'checkout.fullName': 'Full name',
  'checkout.namePlaceholder': 'Ana Silva',
  'checkout.email': 'Email',
  'checkout.emailPlaceholder': 'ana@example.com',
  'checkout.emailNote': 'Your payment confirmation goes here. Nothing is charged; this is a demo.',
  'checkout.paymentMethod': 'Payment method',
  'checkout.methodPix': 'Pix',
  'checkout.yourCards': 'Your credit cards',
  'checkout.endingIn': 'ending in',
  'checkout.installments': 'Up to 12x interest free',
  'checkout.pixInstant': 'Approved immediately',
  'checkout.cardDeclined': 'We could not reach the card network. Try again, or choose another payment method.',
  'checkout.authorizing': 'Authorizing…',
  'checkout.cardApproved': 'Card authorized',
  'checkout.methodCard': 'Credit card',
  'checkout.methodBoleto': 'Boleto',
  'checkout.cardDesc': 'Saved card, charged on confirmation',
  'checkout.boletoDesc': 'Bank slip, clears in up to 3 business days',
  'checkout.savedCard': 'Saved card',
  'checkout.cardHolder': 'Cardholder',
  'checkout.cardExpiry': 'Expires',
  'checkout.payNow': 'Pay {amount}',
  'checkout.step2Pix': 'Pay with Pix',
  'checkout.step2Card': 'Confirm card',
  'checkout.step2Boleto': 'Boleto',
  'checkout.boletoLine': 'Barcode line',
  'checkout.boletoHint': 'Pay this slip at any bank or in your banking app.',
  'checkout.boletoDue': 'Due date',
  'checkout.pixDesc': 'Instant payment by QR code, from Banco Central do Brasil',
  'checkout.continueToPayment': 'Continue to payment',
  'checkout.scanHint': 'Scan this code with your banking app to complete the payment.',
  'checkout.amount': 'Amount',
  'checkout.pixKey': 'Pix key (CNPJ)',
  'checkout.copy': 'Copy',
  'checkout.copied': 'Copied',
  'checkout.merchant': 'Merchant',
  'checkout.demoTag': '(demo)',
  'checkout.confirm': 'I have completed the payment',
  'checkout.processing': 'Processing…',
  'checkout.paymentFailed': 'We could not confirm the payment. Please try again.',
  'checkout.outOfStock': 'Sorry, one of the items sold out while you were checking out. Please review your cart.',
  'checkout.back': 'Back to details',

  // ── Confirmation ─────────────────────────────────────────────────────────
  'confirm.title': 'Payment confirmed',
  'confirm.orderNumber': 'Order #{n}',
  'confirm.body': 'Thank you for your purchase. Your order is being processed.',
  'confirm.pitch':
    'If you liked this demo, give ClickHouse Cloud a go and see what else you can build with it.',
  'confirm.tryCloud': 'Try ClickHouse Cloud free',
  'confirm.continueShopping': 'Continue shopping',
  'confirm.seeEvents': 'See the events land',

  // ── Search ───────────────────────────────────────────────────────────────
  'search.title': 'Search Products',
  'search.hintText': 'Matched against name, description and brand using a ClickHouse full-text index.',
  'search.placeholder': 'Search by name, brand, description…',
  'search.submit': 'Search',
  'search.results.one': '{n} result',
  'search.results.other': '{n} results',
  // The latency instrument. `roundTrip` and `server` are named for what they
  // actually measure — the API returns no query time of its own, so the client
  // cannot honestly print one.
  'search.resultsLabel.one': 'result',
  'search.resultsLabel.other': 'results',
  'search.roundTrip': 'round-trip',
  'search.server': 'server',
  'search.searching': 'Searching…',
  'search.failed': 'Search failed. Check your connection and try again.',
  'search.meterLabel': 'Search latency over the last {n} queries',
  'search.noResultsTitle': 'No results found',
  'search.noResultsHintText': 'Try a shorter query, a brand name, or drop the plural.',
  'search.idleTitleText': 'Search the catalogue',
  'search.idleHintText': 'Results come straight from ClickHouse as you search.',
  'search.partial': 'Nothing matches all of your words, so these match some of them.',

  // ── Error boundary ───────────────────────────────────────────────────────
  'error.title': 'Something went wrong',
  'error.body': 'We couldn’t load this page just now. This is usually temporary, so please try again.',
  'error.retry': 'Try again',
  'error.backToShop': 'Back to shop',
  'error.reference': 'Reference',

  // ── 404 ──────────────────────────────────────────────────────────────────
  'notFound.title': 'We can’t find that page',
  'notFound.body':
    'The product or category you were looking for isn’t here. It may have been removed, or the link may be wrong.',
  'notFound.backToShop': 'Back to shop',
  'notFound.searchProducts': 'Search products',
  'notFound.browseCategories': 'Browse categories',
} as const;

export type TranslationKey = keyof typeof en;

/** Every locale must supply exactly the same keys. */
export type Dictionary = Record<TranslationKey, string>;
