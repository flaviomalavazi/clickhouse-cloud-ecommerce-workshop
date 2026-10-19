"""
Browser session: launches a headless Chromium browser via Playwright and
navigates the storefront as a real user would. The Snowplow JS tracker
embedded in the frontend fires events automatically to whatever collector
URL was configured when the frontend was built (NEXT_PUBLIC_SNOWPLOW_COLLECTOR_URL).

Events go to the collector the frontend is already talking to.

The funnel decisions come from `config.plan_session()` — the bounce roll, how
many categories to visit, and how deep to browse each one are all taken from the
shared plan, so the simulator and the producer stay comparable. What the browser
cannot replay is the plan's *product ids*: links have to come from the live DOM.
It therefore follows `plan.category_outline()` rather than the step list.

Two consequences worth knowing when comparing datasets:
  - The event payloads are whatever `frontend/src/lib/snowplow.ts` emits, so
    `payment_confirmed` carries no order id in se_property. Browser purchases
    are therefore *not* joinable to a credit-card transaction — order-level
    reconciliation is a producer capability.
  - Add-to-cart depends on the real button being present and clickable, so the
    realised cart rate can fall slightly below FUNNEL["pdp_to_cart"].
"""

from __future__ import annotations

import asyncio
import random
import re
from typing import TYPE_CHECKING

from playwright.async_api import (
    Browser,
    BrowserContext,
    Page,
    async_playwright,
    TimeoutError as PWTimeout,
)

import config

if TYPE_CHECKING:
    from simulate import Stats

_PLAYWRIGHT = None
_BROWSER: Browser | None = None


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


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _safe_click(page: Page, selector: str, timeout: int = 5_000) -> bool:
    try:
        await page.click(selector, timeout=timeout)
        return True
    except PWTimeout:
        return False


async def _safe_goto(page: Page, url: str, timeout: int = 15_000) -> bool:
    try:
        await page.goto(url, wait_until="domcontentloaded", timeout=timeout)
        return True
    except Exception:
        return False


async def _scroll(page: Page) -> None:
    """Simulate realistic scroll-down behaviour."""
    for pct in [25, 50, 75]:
        if random.random() < 0.6:
            await page.evaluate(
                f"window.scrollTo(0, document.body.scrollHeight * {pct / 100})"
            )
            await asyncio.sleep(random.uniform(0.4, 1.2))


async def _extract_product_links(page: Page) -> list[str]:
    """Return all product hrefs found on the current page."""
    links = await page.eval_on_selector_all(
        "a[href*='/product/']",
        "els => els.map(e => e.getAttribute('href'))",
    )
    return [l for l in links if l and re.search(r"/product/\d+", l)]


# ── Session class ─────────────────────────────────────────────────────────────

class BrowserSession:
    def __init__(self, base_url: str, stats: "Stats"):
        self.base_url = base_url.rstrip("/")
        self.stats    = stats
        self.plan     = config.plan_session()
        self.source   = self.plan.source
        self.device   = self.plan.device
        self._context: BrowserContext | None = None
        self._page:    Page | None = None

    async def _setup(self) -> None:
        browser = await get_browser()
        width, _, height = self.device.get("res", "1920x1080").partition("x")
        self._context = await browser.new_context(
            user_agent=self.device["useragent"],
            # Keep the viewport consistent with the user-agent, so a mobile UA is
            # never paired with a desktop viewport in the collected data.
            viewport={"width": int(width), "height": int(height)},
            locale="pt-BR",
            timezone_id="America/Sao_Paulo",
        )
        self._page = await self._context.new_page()

    async def _teardown(self) -> None:
        if self._context:
            await self._context.close()
            self._context = None
            self._page = None

    # ── Navigation helpers ────────────────────────────────────────────────────

    async def _goto(self, path: str, qs: str = "") -> bool:
        url = self.base_url + path + (f"?{qs}" if qs else "")
        ok  = await _safe_goto(self._page, url)
        if ok:
            self.stats.inc("page_views")
        return ok

    # ── Funnel steps ──────────────────────────────────────────────────────────

    async def _home(self) -> bool:
        """Navigate to the landing page (with UTM params). Return False on bounce."""
        src = self.source
        qs = "&".join(
            f"{k}={v}"
            for k, v in [
                ("utm_source",   src["source"]),
                ("utm_medium",   src["medium"]),
                ("utm_campaign", src["campaign"]),
                ("utm_content",  src["content"]),
            ]
            if v
        )

        if not await self._goto("/", qs):
            return False

        await _scroll(self._page)

        # The bounce roll comes from the shared plan, not a second independent
        # draw, so browser and backend modes report the same bounce rate.
        if self.plan.bounced:
            await asyncio.sleep(config.dwell("bounce_dwell"))
            self.stats.inc("bounces")
            return False

        await asyncio.sleep(config.dwell("home_dwell"))
        return True

    async def _search(self) -> None:
        query = random.choice(config.SEARCH_QUERIES)
        # Try to find a search input on the page
        for sel in ["input[placeholder*='search' i]", "input[type='search']", "input[name='q']"]:
            try:
                await self._page.fill(sel, query, timeout=3_000)
                await self._page.keyboard.press("Enter")
                self.stats.inc("searches")
                await asyncio.sleep(config.dwell("think_time"))
                return
            except PWTimeout:
                continue

    async def _browse_category(self, category: str, want_products: int) -> list[str]:
        """Navigate to a category page and return product links found."""
        if not await self._goto(f"/category/{category}"):
            return []

        await asyncio.sleep(config.dwell("category_dwell"))
        await _scroll(self._page)

        # want_products == 0 means the plan had this session leave the category
        # without clicking through (the category_to_pdp roll already happened).
        if want_products <= 0:
            return []

        links = await _extract_product_links(self._page)
        return links

    async def _view_product(self, link: str) -> bool:
        """Navigate to a PDP and optionally add to cart. Return True if added."""
        url = link if link.startswith("http") else self.base_url + link
        if not await _safe_goto(self._page, url):
            return False
        self.stats.inc("page_views")
        self.stats.inc("product_clicks")

        await asyncio.sleep(config.dwell("pdp_dwell"))
        await _scroll(self._page)

        if random.random() > config.FUNNEL["pdp_to_cart"]:
            return False

        # Try common "Add to Cart" button patterns
        for sel in [
            "button:has-text('Add to Cart')",
            "button:has-text('Add to Bag')",
            "button[data-testid='add-to-cart']",
            "button.add-to-cart",
        ]:
            if await _safe_click(self._page, sel):
                self.stats.inc("add_to_cart")
                await asyncio.sleep(config.dwell("think_time"))
                return True
        return False

    async def _checkout(self) -> bool:
        """Visit cart and run through checkout. Return True if purchase completes."""
        if not await self._goto("/cart"):
            return False
        await asyncio.sleep(config.dwell("cart_dwell"))

        if random.random() > config.FUNNEL["cart_to_checkout"]:
            return False

        if not await self._goto("/checkout"):
            return False
        await asyncio.sleep(config.dwell("checkout_step_dwell"))

        if random.random() > config.FUNNEL["checkout_to_purchase"]:
            return False

        # Fill the actual form and use the payment method planned by the shared
        # funnel. A browser run must never claim a purchase by navigating to a
        # made-up success URL after the form rejected the submission.
        await self._page.fill("#checkout-name", "Cliente Demo")
        await self._page.fill("#checkout-email", "demo@example.com")
        method = self.plan.order["method"] if self.plan.order else "pix"
        payment_selector = {
            "pix": "input[data-testid='payment-method-pix']",
            "credit_card": "input[data-testid='payment-method-credit-card']",
            "boleto": "input[data-testid='payment-method-boleto']",
        }[method]
        # Two saved cards share the credit-card method; selecting the first is
        # deterministic and avoids a strict-locator error on that method.
        await self._page.locator(payment_selector).first.check(force=True)

        if not await _safe_click(self._page, "[data-testid='checkout-continue']", timeout=4_000):
            return False
        try:
            await self._page.wait_for_selector("[data-testid='checkout-confirm']", timeout=8_000)
        except PWTimeout:
            return False

        await asyncio.sleep(config.dwell("think_time"))
        if not await _safe_click(self._page, "[data-testid='checkout-confirm']", timeout=4_000):
            return False
        try:
            await self._page.wait_for_url("**/checkout/confirmation", timeout=10_000)
        except PWTimeout:
            return False

        self.stats.inc("purchases")
        return True

    # ── Main entry point ──────────────────────────────────────────────────────

    async def run(self) -> None:
        await self._setup()
        self.stats.inc("sessions_started")
        cart_items = 0
        try:
            if not await self._home():
                return

            # Categories, depth, and the search roll all come from the plan.
            outline = self.plan.category_outline()
            if any(s.kind == "search" for s in self.plan.steps):
                await self._search()

            for category, want_products in outline:
                links = await self._browse_category(category, want_products)
                if not links:
                    continue

                n = min(want_products, len(links))
                for link in random.sample(links, n):
                    added = await self._view_product(link)
                    if added:
                        cart_items += 1
                        break
                    await asyncio.sleep(config.dwell("think_time"))

            if cart_items:
                await self._checkout()

        finally:
            await self._teardown()
            self.stats.inc("sessions_completed")
