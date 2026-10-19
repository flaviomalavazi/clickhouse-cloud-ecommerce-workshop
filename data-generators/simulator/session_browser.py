"""
Browser session: a headless Chromium shopper that walks a session plan through the
real storefront. The Snowplow tracker and the HyperDX SDK in the pages emit the
events and the browser telemetry themselves; this module only drives the clicks.

The decisions come from `config.plan_session()` — the search terms, how many
categories to visit, how many products to open in each, which of them go into the
cart, whether the cart goes on to checkout, and how it is paid (pix, boleto or
card). Nothing is re-rolled here, so the simulator and the web-events producer
stay on the same funnel.

What the plan cannot say is *which* product: the products are real ones that the
storefront lists, so the shopper takes them from the page. It mostly looks at the
first page of a category (the cheapest products) but sometimes pages deeper, so
orders reach the whole catalogue over a run.

How it navigates matters for the data it makes:
  - It reaches the cart and the checkout by clicking, not by loading the URL. A
    hard load of /checkout restores the cart too late for `checkout_start` to
    fire, and a hard load right after a click makes the tracker re-send events it
    had not yet confirmed (duplicate rows).
  - It reads the response of POST /api/checkout/complete rather than waiting for
    a URL: a sold-out product is a 409, and that is an outcome to count, not a
    timeout.
  - Every selector is a `data-testid`, never visible text, which is translated.
"""

from __future__ import annotations

import asyncio
import random
import re
from typing import TYPE_CHECKING

from playwright.async_api import (
    Browser,
    BrowserContext,
    Error as PWError,
    Page,
    async_playwright,
    TimeoutError as PWTimeout,
)

import config
import identity

if TYPE_CHECKING:
    from simulate import Stats

_PLAYWRIGHT = None
_BROWSER: Browser | None = None

# The storefront's automation hooks.
SEL_SEARCH        = "[data-testid='search-input']"
SEL_PRODUCT_LINK  = "a[data-testid='product-card-link']"
SEL_NEXT_PAGE     = "[data-testid='pagination-next']"
SEL_ADD_TO_CART   = "button[data-testid='add-to-cart']"
SEL_CART_LINK     = "[data-testid='cart-link']:visible"
SEL_CHECKOUT_LINK = "[data-testid='checkout-link']"
SEL_CONTINUE      = "[data-testid='checkout-continue']"
SEL_CONFIRM       = "[data-testid='checkout-confirm']"
# The checkout's own error message. Not [role='alert'] on its own: Next.js keeps a
# hidden role="alert" route announcer on every page, which matches at once.
SEL_CHECKOUT_ERR  = "[data-testid='checkout-error']"
PAYMENT_RADIO = {
    "pix":         "input[data-testid='payment-method-pix']",
    "credit_card": "input[data-testid='payment-method-credit-card']",
    "boleto":      "input[data-testid='payment-method-boleto']",
}


async def get_browser() -> Browser:
    """Return (and lazily create) the shared browser instance."""
    global _PLAYWRIGHT, _BROWSER
    if _BROWSER is None or not _BROWSER.is_connected():
        _PLAYWRIGHT = await async_playwright().start()
        _BROWSER = await _PLAYWRIGHT.chromium.launch(headless=True)
    return _BROWSER


async def close_browser() -> None:
    global _PLAYWRIGHT, _BROWSER
    if _BROWSER:
        await _BROWSER.close()
        _BROWSER = None
    if _PLAYWRIGHT:
        await _PLAYWRIGHT.stop()
        _PLAYWRIGHT = None


class BrowserSession:
    def __init__(self, base_url: str, stats: "Stats", shoppers: tuple[identity.Shopper, ...]):
        self.base_url = base_url.rstrip("/")
        self.stats    = stats
        self.plan     = config.plan_session()
        self.device   = self.plan.device
        self.locale   = identity.pick_locale()
        self.shopper  = random.choice(shoppers)
        self._context: BrowserContext | None = None
        self._page:    Page | None = None

        self._visited: set[str] = set()   # product hrefs already opened this session
        self._cart_adds = 0
        self._on_pdp = False              # the page is a product page we reached from a listing
        self._pdp_ready = False           # the planned product click found a product to open
        self._listing_page = 1            # which page of the category grid is showing
        self._last_query = ""             # the last term searched for
        self._step = None                 # the plan step in progress, for error messages
        self._done = False                # stop walking the plan (bounce, abandoned cart, failure)

    # ── Browser lifecycle ─────────────────────────────────────────────────────

    async def _setup(self) -> None:
        browser = await get_browser()
        width, _, height = self.device.get("res", "1920x1080").partition("x")
        self._context = await browser.new_context(
            user_agent=self.device["useragent"],
            # Keep the viewport consistent with the user-agent, so a mobile UA is
            # never paired with a desktop viewport in the collected data.
            viewport={"width": int(width), "height": int(height)},
            # The storefront picks its language from this, and sends it with every search.
            locale=self.locale,
            timezone_id="America/Sao_Paulo",
        )
        self._page = await self._context.new_page()

    async def _teardown(self) -> None:
        if self._context:
            await self._context.close()
            self._context = None
            self._page = None

    # ── The walk ──────────────────────────────────────────────────────────────

    async def run(self) -> None:
        await self._setup()
        self.stats.inc("sessions_started")
        try:
            for step in self.plan.steps:
                if self._done:
                    break
                self._step = step
                await self._do(step)
        except asyncio.CancelledError:
            raise
        except (PWTimeout, PWError) as exc:
            # A page that would not load, or a control that never appeared. Count it
            # and end the session; one short line, not a stack trace per failure.
            self.stats.inc("session_errors")
            where = f"{self._step.kind} {self._step.path}".strip() if self._step else "setup"
            print(f"  [browser] {where}: {type(exc).__name__}: {str(exc).splitlines()[0][:120]}", flush=True)
        finally:
            await self._teardown()
            self.stats.inc("sessions_completed")

    async def _do(self, step) -> None:
        kind = step.kind
        if kind == "landing":
            await self._landing(step)
        elif kind == "search":
            await self._search(step)
        elif kind == "page_view":
            await self._page_view(step)
        elif kind == "scroll":
            await self._scroll(step.depth)
        elif kind == "product_click":
            await self._product_click()
        elif kind == "add_to_cart":
            await self._add_to_cart(step)
        elif kind == "checkout_start":
            await asyncio.sleep(step.dwell)     # the checkout page tracks this itself
        elif kind == "payment_initiated":
            await self._start_payment(step)
        elif kind == "payment_confirmed":
            await self._confirm_payment(step)

    # ── Steps ─────────────────────────────────────────────────────────────────

    async def _landing(self, step) -> None:
        src = self.plan.source
        qs = "&".join(
            f"{k}={v}"
            for k, v in (
                ("utm_source",   src["source"]),
                ("utm_medium",   src["medium"]),
                ("utm_campaign", src["campaign"]),
                ("utm_content",  src["content"]),
            )
            if v
        )
        await self._page.goto(f"{self.base_url}/" + (f"?{qs}" if qs else ""),
                              wait_until="domcontentloaded", timeout=20_000)
        self.stats.inc("page_views")
        await asyncio.sleep(step.dwell)
        if self.plan.bounced:
            self.stats.inc("bounces")
            self._done = True

    async def _search(self, step) -> None:
        query = identity.localize_query(step.query, self.locale)
        if query == self._last_query:
            # Submitting the same term again goes to the URL the shopper is already on, so
            # nothing is searched and no response would ever arrive.
            await asyncio.sleep(step.dwell)
            return
        self._last_query = query
        box = self._page.locator(SEL_SEARCH).first
        await box.fill(query, timeout=5_000)
        # The results arrive from the API, so wait for that response rather than
        # guess at how long the page needs.
        async with self._page.expect_response(lambda r: "/api/search/text" in r.url, timeout=15_000):
            await box.press("Enter")
        self.stats.inc("searches")
        self.stats.inc("page_views")
        await asyncio.sleep(step.dwell)

    async def _page_view(self, step) -> None:
        path = step.path
        if path.startswith("/category/"):
            await self._open_category(path.removeprefix("/category/"))
        elif path.startswith("/product/"):
            # The product_click step that came before already opened it.
            if not self._pdp_ready:
                return
            self.stats.inc("page_views")
        elif path == "/cart":
            await self._open_cart()
        elif path == "/checkout":
            await self._open_checkout()
        elif path == "/checkout/confirmation":
            pass                                # reached by the confirm click
        else:
            await self._page.goto(self.base_url + path, wait_until="domcontentloaded", timeout=20_000)
            self.stats.inc("page_views")
        if not self._done:
            await asyncio.sleep(step.dwell)

    async def _open_category(self, slug: str) -> None:
        page = self._page
        link = page.locator(f"a[href='/category/{slug}']:visible").first
        try:
            await link.click(timeout=3_000)
            await page.wait_for_url(f"**/category/{slug}", timeout=15_000)
        except (PWTimeout, PWError):
            await page.goto(f"{self.base_url}/category/{slug}", wait_until="domcontentloaded", timeout=20_000)
        await page.wait_for_selector(SEL_PRODUCT_LINK, timeout=15_000)
        self._on_pdp = False
        self._pdp_ready = False
        self._listing_page = 1
        self.stats.inc("page_views")

    async def _scroll(self, depth: int) -> None:
        await self._page.evaluate(
            "(pct) => window.scrollTo(0, document.documentElement.scrollHeight * pct / 100)", depth
        )
        await asyncio.sleep(random.uniform(0.3, 0.8))

    async def _product_click(self) -> None:
        page = self._page
        self._pdp_ready = False
        if self._on_pdp:
            # Back to the listing the shopper came from; its grid starts again at page 1.
            await page.go_back(wait_until="domcontentloaded", timeout=15_000)
            await page.wait_for_selector(SEL_PRODUCT_LINK, timeout=15_000)
            self._on_pdp = False
            self._listing_page = 1

        await self._advance_to_page(identity.sample_page())
        href = await self._pick_product_href()
        if href is None:
            self.stats.inc("no_product_found")
            return
        await page.locator(f"{SEL_PRODUCT_LINK}[href='{href}']").first.click(timeout=8_000)
        await page.wait_for_url(f"**{href}", timeout=15_000)
        self._visited.add(href)
        self._on_pdp = True
        self._pdp_ready = True
        self.stats.inc("product_clicks")

    async def _advance_to_page(self, target: int) -> None:
        """Click through the category grid's pagination, as far as it goes."""
        page = self._page
        while self._listing_page < target:
            nxt = page.locator(SEL_NEXT_PAGE).first
            if await nxt.count() == 0 or await nxt.is_disabled():
                return
            async with page.expect_response(lambda r: "/api/products/category/" in r.url, timeout=10_000):
                await nxt.click(timeout=5_000)
            self._listing_page += 1
            await asyncio.sleep(0.4)            # let the new page of cards render

    async def _pick_product_href(self) -> str | None:
        hrefs = await self._page.eval_on_selector_all(
            SEL_PRODUCT_LINK, "els => els.map(e => e.getAttribute('href'))"
        )
        hrefs = [h for h in hrefs if h and re.fullmatch(r"/product/\d+", h)]
        fresh = [h for h in hrefs if h not in self._visited]
        pool = fresh or hrefs
        return random.choice(pool) if pool else None

    async def _add_to_cart(self, step) -> None:
        if not self._pdp_ready:
            return
        page = self._page
        # A product page shows either the add-to-cart button or, when it is sold out,
        # a disabled button without that hook.
        await page.wait_for_selector(f"{SEL_ADD_TO_CART}, button:disabled", timeout=10_000)
        button = page.locator(SEL_ADD_TO_CART).first
        if await button.count() == 0:
            self.stats.inc("out_of_stock")
            return
        await button.click(timeout=5_000)
        self._cart_adds += 1
        self.stats.inc("cart_adds")
        await asyncio.sleep(step.dwell)

    async def _open_cart(self) -> None:
        if self._cart_adds == 0:
            # Every planned add hit a sold-out product: nothing to check out.
            self._done = True
            return
        page = self._page
        await page.locator(SEL_CART_LINK).first.click(timeout=8_000)
        await page.wait_for_url("**/cart", timeout=15_000)
        self.stats.inc("page_views")

    async def _open_checkout(self) -> None:
        page = self._page
        await page.locator(SEL_CHECKOUT_LINK).first.click(timeout=8_000)
        await page.wait_for_selector("#checkout-name", timeout=15_000)
        self.stats.inc("page_views")

    async def _start_payment(self, step) -> None:
        page = self._page
        method = step.label
        await page.fill("#checkout-name", self.shopper.name, timeout=5_000)
        await page.fill("#checkout-email", self.shopper.email, timeout=5_000)
        # Two saved cards share the credit-card method; the first is deterministic.
        await page.locator(PAYMENT_RADIO[method]).first.check(force=True, timeout=5_000)
        await page.click(SEL_CONTINUE, timeout=5_000)

        # Pix and boleto go straight to the confirm screen. A card is authorised
        # first, and the gateway may refuse it: the form then shows an alert and
        # stays put.
        await page.wait_for_selector(f"{SEL_CONFIRM}, {SEL_CHECKOUT_ERR}", timeout=15_000)
        if await page.locator(SEL_CONFIRM).count() == 0:
            self.stats.inc("orders_failed")
            self.stats.inc(f"declined_{method}")
            self._done = True
            return
        await asyncio.sleep(step.dwell)

    async def _confirm_payment(self, step) -> None:
        page = self._page
        method = step.label
        async with page.expect_response(
            lambda r: r.url.endswith("/api/checkout/complete") and r.request.method == "POST",
            timeout=20_000,
        ) as response_info:
            await page.click(SEL_CONFIRM, timeout=5_000)
        response = await response_info.value

        if response.status == 200:
            await page.wait_for_url(re.compile(r".*/checkout/confirmation\?order=\d+"), timeout=15_000)
            self.stats.inc("orders_placed")
            self.stats.inc(f"orders_{method}")
        elif response.status == 409:
            # Somebody took the last unit first. Count it and move on.
            self.stats.inc("out_of_stock")
            self.stats.inc("orders_failed")
            self._done = True
        else:
            self.stats.inc("orders_failed")
            self._done = True
