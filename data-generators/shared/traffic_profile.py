"""
Shared traffic profile — the single source of truth for every ClickShop
data generator (the browser simulator and the web-events and credit-card
producers).

It defines four things the generators must agree on:

  1. Funnel rates and content (categories, page titles, UTM sources, search
     queries, device/geo pools) so a session looks the same whichever
     generator produced it.
  2. The intraday shape — HOURLY_WEIGHTS in UTC-03 — used both to *stamp*
     backfilled timestamps and to *modulate the live emission rate*.
  3. Run modes (`Clock`): `live` stamps everything at ~now; `mixed` dates a
     configurable share of sessions across a historical window.
  4. Rate pacing (`Pacer`) so a producer can hold a diurnal average rate
     instead of running flat out.

This is the ONLY copy. The simulator and producer Docker images build with
`data-generators/` as their context and COPY this file in, so the two halves
stay runnable independently without the file ever being duplicated.

Funnel rates come from published benchmarks:
  - Baymard Institute (2024): cart abandonment, checkout completion
  - Statista E-Commerce Report (2024): bounce, session duration
  - Nielsen Norman Group: page dwell times
  - Google Analytics benchmarks: channel mix

Measured output of plan_session() at these rates (40k sessions):

    bounce rate            41.6 %
    site conversion         2.5 %
    events per session      5.9
    session duration      ~186 s   (before DWELL_SCALE)
    per session: page_view 3.00 (1.00 landing + 2.00 in-site) · scroll 1.37
                 product_click 1.28 · search 0.155 · add_to_cart 0.052
                 checkout_start 0.037 · payment_confirmed 0.025

Rather than hand-maintaining that arithmetic, both generators report their
observed per-session mix at runtime — the numbers above are just a reference.
"""

from __future__ import annotations

import math
import os
import random
import time
from datetime import datetime, timedelta, timezone

__all__ = [
    # ── Intraday shape ──
    "LOCAL_TZ", "HOURLY_WEIGHTS", "PEAK_MULTIPLIER", "TROUGH_MULTIPLIER",
    "hour_multiplier", "sample_hour_weighted_timestamp",
    # ── Run modes / pacing ──
    "MODE_LIVE", "MODE_MIXED", "resolve_mode", "Clock", "Pacer",
    # ── Funnel & content ──
    "CATEGORIES", "TRAFFIC_SOURCES", "REFERRERS", "FUNNEL", "TIMING",
    "PAGE_TITLES", "SEARCH_QUERIES", "USER_AGENTS", "DEVICE_PROFILES",
    "GEO_POOL", "STOREFRONT_MERCHANT",
    # ── Payments ──
    "CARD_NETWORKS", "CARD_NETWORK_WEIGHTS", "CARD_BINS", "CURRENCIES",
    "CURRENCY_WEIGHTS", "PAYMENT_METHODS", "PAYMENT_METHOD_WEIGHTS",
    "pick_card_network", "pick_installments", "build_name_pool",
    "build_expiration_pool", "card_bin_for",
    # ── Transactions ──
    "FAULTY_FEATURES", "STOREFRONT_CHARGEBACK_RATE", "STOREFRONT_FAULTY_RATE",
    "corrupt_transaction", "build_storefront_transaction", "pick_currency",
    # ── Session plan ──
    "SessionPlan", "Step", "plan_session", "pick_payment_method",
    # ── Helpers ──
    "pick_source", "build_landing_url", "get_referrer", "dwell",
    "set_dwell_scale", "n_products_to_view", "pick_device", "pick_geo",
    "random_ip", "format_ts", "new_id", "env_float", "env_int", "env_bool",
]


# ══════════════════════════════════════════════════════════════════════════════
# Environment helpers
# ══════════════════════════════════════════════════════════════════════════════
# Defined first: several module-level constants below are read from the
# environment at import time.

def env_float(name: str, default: float) -> float:
    raw = os.getenv(name, "")
    try:
        return float(raw) if raw.strip() != "" else float(default)
    except ValueError:
        return float(default)


def env_int(name: str, default: int) -> int:
    raw = os.getenv(name, "")
    try:
        return int(float(raw)) if raw.strip() != "" else int(default)
    except ValueError:
        return int(default)


def env_bool(name: str, default: bool = False) -> bool:
    raw = os.getenv(name, "").strip().lower()
    if raw == "":
        return default
    return raw in ("1", "true", "yes", "on")


# ══════════════════════════════════════════════════════════════════════════════
# Intraday shape
# ══════════════════════════════════════════════════════════════════════════════

# Brazil / Argentina local time. The storefront is Brazilian, so the traffic
# curve, currency mix, and geo pool are all anchored to UTC-03.
LOCAL_TZ = timezone(timedelta(hours=-3))

# Index = hour of day in UTC-03; values are *relative* event-count weights that
# approximate real Brazilian e-commerce traffic:
#   deep trough overnight (0-6h) · moderate morning (7-11h) · lunch spike
#   (12-13h) · post-lunch dip (14-15h) · gradual build (16-17h) · strong
#   evening peak (18-22h, primary at 20h) · gentle decline (23h)
HOURLY_WEIGHTS: tuple[float, ...] = (
    20,  # 00:00 – late-night browsing, winding down
    10,  # 01:00
     5,  # 02:00
     3,  # 03:00 – sleeping
     3,  # 04:00
     4,  # 05:00
     8,  # 06:00 – early risers
    15,  # 07:00 – morning commute
    22,  # 08:00 – opening apps on the bus/metro
    20,  # 09:00
    22,  # 10:00 – mid-morning at desk
    25,  # 11:00
    32,  # 12:00 – lunch break spike
    28,  # 13:00
    20,  # 14:00 – post-lunch dip
    20,  # 15:00
    25,  # 16:00
    32,  # 17:00 – end of workday
    55,  # 18:00 – evening peak begins
    75,  # 19:00
    85,  # 20:00 – primary peak
    78,  # 21:00
    55,  # 22:00 – declining
    32,  # 23:00
)

_MAX_HOURLY_WEIGHT  = max(HOURLY_WEIGHTS)
_MEAN_HOURLY_WEIGHT = sum(HOURLY_WEIGHTS) / len(HOURLY_WEIGHTS)

# How far the instantaneous rate swings around the daily average.
PEAK_MULTIPLIER   = _MAX_HOURLY_WEIGHT / _MEAN_HOURLY_WEIGHT        # ≈ 2.94×
TROUGH_MULTIPLIER = min(HOURLY_WEIGHTS) / _MEAN_HOURLY_WEIGHT       # ≈ 0.10×


def _interpolated_weight(local: datetime) -> float:
    """
    Weight at an exact local time, treating HOURLY_WEIGHTS[h] as the value at
    h:30 and interpolating linearly between adjacent hours.

    Without interpolation the rate would jump discontinuously at the top of
    every hour, which is visibly artificial on a live "events per minute" chart.
    """
    frac = (local.minute * 60 + local.second) / 3600.0
    if frac < 0.5:
        lo = HOURLY_WEIGHTS[(local.hour - 1) % 24]
        hi = HOURLY_WEIGHTS[local.hour]
        t  = frac + 0.5
    else:
        lo = HOURLY_WEIGHTS[local.hour]
        hi = HOURLY_WEIGHTS[(local.hour + 1) % 24]
        t  = frac - 0.5
    return lo + (hi - lo) * t


def hour_multiplier(when: datetime | None = None) -> float:
    """
    Rate multiplier for `when` (default: now), relative to the daily average.

    1.0 == the daily mean, so a generator configured for an average of N
    events/s emits ≈0.10 N at the 04:00 trough and ≈2.94 N at the 20:00 peak
    while still averaging N over a full day.
    """
    when = when or datetime.now(timezone.utc)
    return _interpolated_weight(when.astimezone(LOCAL_TZ)) / _MEAN_HOURLY_WEIGHT


def sample_hour_weighted_timestamp(oldest_days: float, newest_days: float = 0.0) -> datetime:
    """
    A UTC timestamp uniformly dated between `oldest_days` and `newest_days` ago,
    whose UTC-03 hour is drawn from HOURLY_WEIGHTS by rejection sampling.

    Expected iterations = max(weights)/mean(weights) ≈ 2.9, and the loop is
    hard-bounded so a pathological weight table can never make it spin.
    """
    now  = datetime.now(timezone.utc)
    span = (oldest_days - newest_days) * 86400.0
    if span <= 0:
        return now

    base = newest_days * 86400.0
    dt   = now
    for _ in range(64):
        dt = now - timedelta(seconds=base + random.random() * span)
        if random.random() < HOURLY_WEIGHTS[dt.astimezone(LOCAL_TZ).hour] / _MAX_HOURLY_WEIGHT:
            return dt
    return dt   # bail-out: accept the last draw rather than loop unbounded


# ══════════════════════════════════════════════════════════════════════════════
# Run modes
# ══════════════════════════════════════════════════════════════════════════════

MODE_LIVE  = "live"    # every timestamp ≈ now — maximise today's throughput
MODE_MIXED = "mixed"   # a share of sessions backdated across a history window

_MODE_ALIASES = {
    "live": MODE_LIVE, "present": MODE_LIVE, "now": MODE_LIVE, "realtime": MODE_LIVE,
    "mixed": MODE_MIXED, "backfill": MODE_MIXED, "historical": MODE_MIXED, "history": MODE_MIXED,
}


def resolve_mode(value: str | None = None) -> str:
    """Normalise a mode string (or $EVENT_MODE) to MODE_LIVE / MODE_MIXED."""
    raw = (value if value is not None else os.getenv("EVENT_MODE", MODE_LIVE))
    key = str(raw).strip().lower()
    if key not in _MODE_ALIASES:
        raise SystemExit(
            f"[ERROR] EVENT_MODE must be live|mixed (aliases: present, backfill) — got '{raw}'"
        )
    return _MODE_ALIASES[key]


class Clock:
    """
    Mode-aware event-time source. Every generator asks the Clock where a
    session's first event belongs on the timeline.

    live   – all timestamps are ~now. The hour-of-day curve cannot shape the
             timestamps of a live stream (you can't backdate it), so in this
             mode it shapes the *emission rate* instead — see `Pacer`.
    mixed  – `backfill_ratio` of sessions are dated at a random hour-weighted
             point inside the last `backfill_days`; the remainder are live.
             Backfilled sessions stop `backfill_gap_days` short of now so
             "today" stays purely live and the two populations never overlap.
    """

    def __init__(
        self,
        mode: str | None = None,
        backfill_days: float | None = None,
        backfill_ratio: float | None = None,
        backfill_gap_days: float | None = None,
    ):
        self.mode = resolve_mode(mode)
        self.backfill_days = (
            env_float("BACKFILL_DAYS", 180.0) if backfill_days is None else float(backfill_days)
        )
        self.backfill_gap_days = (
            env_float("BACKFILL_GAP_DAYS", 1.0)
            if backfill_gap_days is None else float(backfill_gap_days)
        )
        ratio = (
            env_float("BACKFILL_RATIO", 0.5) if backfill_ratio is None else float(backfill_ratio)
        )
        # live mode is defined by having no historical component at all.
        self.backfill_ratio = 0.0 if self.mode == MODE_LIVE else min(1.0, max(0.0, ratio))

    def session_start(self, duration_s: float = 0.0) -> tuple[datetime, bool]:
        """
        Timestamp for a session's *first* event, plus whether it was backfilled.

        Live sessions are anchored `duration_s` in the past so the session's
        *last* event lands on ~now — which is how a real session that just
        finished actually looks.
        """
        if self.backfill_ratio and random.random() < self.backfill_ratio:
            return sample_hour_weighted_timestamp(self.backfill_days, self.backfill_gap_days), True
        return datetime.now(timezone.utc) - timedelta(seconds=duration_s), False

    def event_time(self) -> datetime:
        """Timestamp for a standalone event that has no session around it."""
        return self.session_start(0.0)[0]

    def describe(self) -> str:
        if self.mode == MODE_LIVE:
            return "live (all events stamped now)"
        return (
            f"mixed ({self.backfill_ratio:.0%} backfilled over {self.backfill_days:g}d "
            f"ending {self.backfill_gap_days:g}d ago, {1 - self.backfill_ratio:.0%} live)"
        )


class Pacer:
    """
    Diurnal rate limiter for a single worker.

    `avg_per_second` is the worker's share of the *daily-average* target rate.
    The instantaneous target is `avg × hour_multiplier(now)`, so the emitted
    rate follows the same curve that shapes backfilled timestamps.

    `avg_per_second == 0` disables pacing entirely: the worker runs flat out,
    which is what you want when the goal is peak ingest throughput.

    hour_multiplier() is re-evaluated only every `refresh_s` seconds, so the
    hot path costs one float compare and one add per event.
    """

    def __init__(self, avg_per_second: float, refresh_s: float = 10.0):
        self.avg        = max(0.0, float(avg_per_second))
        self._refresh_s = max(1.0, float(refresh_s))
        self._interval  = 0.0
        self._next      = time.monotonic()
        self._refresh_at = 0.0
        self._mult      = 1.0

    @property
    def enabled(self) -> bool:
        return self.avg > 0.0

    def target_per_second(self) -> float:
        """Current instantaneous target; 0 when pacing is disabled."""
        return self.avg * hour_multiplier() if self.enabled else 0.0

    def _refresh(self, now: float) -> None:
        self._mult = hour_multiplier()
        rate = self.avg * self._mult
        self._interval = (1.0 / rate) if rate > 0 else 0.0
        self._refresh_at = now + self._refresh_s

    def tick(self, n: int = 1) -> None:
        """Block until it is time to emit the next `n` events. No-op if disabled."""
        if not self.enabled:
            return
        now = time.monotonic()
        if now >= self._refresh_at:
            self._refresh(now)
        self._next += self._interval * n
        delay = self._next - now
        if delay > 0:
            time.sleep(delay)
        elif delay < -1.0:
            # More than a second behind schedule: give up on catching up rather
            # than emitting an unbounded burst once the backlog clears.
            self._next = now


# ══════════════════════════════════════════════════════════════════════════════
# Funnel & content
# ══════════════════════════════════════════════════════════════════════════════

CATEGORIES = [
    "shoes",
    "clothing",
    "books",
    "it-accessories",
    "electronics",
]

# Each entry: weight (relative share), utm_* params (None = omit from the URL).
# Channels with None source/medium produce "direct" sessions (no UTM appended).
TRAFFIC_SOURCES = [
    # Direct
    {"weight": 0.20, "source": None,               "medium": None,        "campaign": None,                "content": None},
    # Paid search – Google Ads
    {"weight": 0.17, "source": "google",            "medium": "cpc",       "campaign": "brand-keywords",    "content": "text-ad"},
    # Paid search – Microsoft / Bing
    {"weight": 0.04, "source": "bing",              "medium": "cpc",       "campaign": "brand-keywords",    "content": "text-ad"},
    # Organic search
    {"weight": 0.13, "source": "google",            "medium": "organic",   "campaign": None,                "content": None},
    # Facebook
    {"weight": 0.10, "source": "facebook",          "medium": "social",    "campaign": "retargeting-cart",  "content": "carousel"},
    # Instagram
    {"weight": 0.08, "source": "instagram",         "medium": "social",    "campaign": "awareness-spring",  "content": "story-ad"},
    # TikTok
    {"weight": 0.05, "source": "tiktok",            "medium": "social",    "campaign": "ugc-viral",         "content": "in-feed"},
    # LinkedIn
    {"weight": 0.03, "source": "linkedin",          "medium": "social",    "campaign": "b2b-accessories",   "content": "sponsored-post"},
    # Email – newsletter
    {"weight": 0.07, "source": "newsletter",        "medium": "email",     "campaign": "weekly-deals",      "content": "cta-button"},
    # Email – cart-abandonment
    {"weight": 0.03, "source": "cart-abandonment",  "medium": "email",     "campaign": "recover-cart",      "content": "reminder-1"},
    # Affiliate / partner networks
    {"weight": 0.05, "source": "affiliate-network", "medium": "affiliate", "campaign": "partners-q1",       "content": None},
    # Blog / editorial referral
    {"weight": 0.03, "source": "tech-review-blog",  "medium": "referral",  "campaign": None,                "content": None},
    # Display / programmatic
    {"weight": 0.02, "source": "display-network",   "medium": "display",   "campaign": "prospecting",       "content": "banner-300x250"},
]

# Referrer domains used for non-UTM sources in backend mode.
REFERRERS = {
    "google":            "https://www.google.com/search?q=online+store",
    "bing":              "https://www.bing.com/search?q=online+store",
    "facebook":          "https://www.facebook.com/",
    "instagram":         "https://www.instagram.com/",
    "tiktok":            "https://www.tiktok.com/",
    "linkedin":          "https://www.linkedin.com/",
    "newsletter":        "https://mail.google.com/",
    "cart-abandonment":  "https://mail.google.com/",
    "affiliate-network": "https://www.shareasale.com/",
    "tech-review-blog":  "https://www.techradar.com/",
    "display-network":   "https://www.example.com/",
}

FUNNEL = {
    # Fraction of sessions that leave immediately from the landing page
    "bounce_rate": 0.42,
    # Of non-bouncers: fraction that navigate from home → a category page
    "home_to_category": 0.80,
    # Of category viewers: fraction that click into a product detail page (PDP)
    "category_to_pdp": 0.65,
    # Per *PDP view* — not per session. A browsing user views
    # avg_products_per_category pages and stops at the first add-to-cart, so the
    # per-session add rate compounds to ≈1-(1-p)^n. At p=0.04, n≈3.5 that is
    # ≈13% of browsing sessions, which is what lands overall conversion on the
    # ≈2.5% below. (A per-PDP 0.13 compounds to a 6.8% site conversion — far
    # outside any retail benchmark.)
    "pdp_to_cart": 0.04,
    # Of cart viewers: fraction that start the checkout flow
    "cart_to_checkout": 0.72,
    # Of checkout starters: fraction that complete the purchase
    "checkout_to_purchase": 0.68,
    # Mean number of distinct products viewed per category browse
    "avg_products_per_category": 3.5,
    # Fraction of sessions that use the search bar at least once
    "search_rate": 0.27,
    # Fraction of sessions that trigger a scroll-depth event
    "scroll_rate": 0.72,
    # Fraction of non-bouncing sessions that visit more than one category
    "multi_category_rate": 0.30,
}

# Dwell-time ranges in seconds (min, max).
TIMING = {
    "bounce_dwell":        (5,  45),   # time on landing page before leaving
    "home_dwell":          (8,  40),   # time on home page for non-bouncers
    "category_dwell":      (20, 90),   # browsing a category listing
    "pdp_dwell":           (25, 180),  # reading a product detail page
    "cart_dwell":          (15, 60),   # reviewing the cart
    "checkout_step_dwell": (25, 120),  # each checkout step
    "think_time":          (1,  4),    # brief pause between actions
}

PAGE_TITLES = {
    "/":                        "ClickShop – Your Online Store",
    "/category/shoes":          "Shoes – ClickShop",
    "/category/clothing":       "Clothing – ClickShop",
    "/category/books":          "Books – ClickShop",
    "/category/it-accessories": "IT Accessories – ClickShop",
    "/category/electronics":    "Electronics – ClickShop",
    "/cart":                    "Cart – ClickShop",
    "/checkout":                "Checkout – ClickShop",
    "/checkout/confirmation":   "Order confirmed – ClickShop",
}

SEARCH_QUERIES = [
    "running shoes", "blue jeans", "python book", "wireless headphones",
    "laptop bag", "summer dress", "gaming mouse", "usb hub",
    "yoga mat", "leather wallet", "mechanical keyboard", "desk lamp",
    "data science", "sneakers", "hoodie", "coffee maker",
    "smartwatch", "bluetooth speaker", "hiking boots", "t-shirt",
]

# Device profiles: the user-agent plus the br_/os_/dvce_ values Snowplow
# enrichment would derive from it. The web-events producer has no real HTTP
# request to enrich, so it fills these columns from here — keeping its rows
# indistinguishable from bridge-inserted ones.
DEVICE_PROFILES = (
    {"weight": 0.16, "dvce_type": "Computer",
     "br_family": "Chrome",        "os_family": "Windows 10",
     "useragent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
     "res": "1920x1080"},
    {"weight": 0.11, "dvce_type": "Computer",
     "br_family": "Chrome",        "os_family": "Mac OS X",
     "useragent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
     "res": "1440x900"},
    {"weight": 0.05, "dvce_type": "Computer",
     "br_family": "Firefox",       "os_family": "Windows 10",
     "useragent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
     "res": "1920x1080"},
    {"weight": 0.05, "dvce_type": "Computer",
     "br_family": "Safari",        "os_family": "Mac OS X",
     "useragent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
     "res": "1440x900"},
    # Mobile dominates Brazilian e-commerce traffic (~63%).
    {"weight": 0.35, "dvce_type": "Mobile",
     "br_family": "Chrome Mobile", "os_family": "Android",
     "useragent": "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36",
     "res": "412x915"},
    {"weight": 0.28, "dvce_type": "Mobile",
     "br_family": "Mobile Safari", "os_family": "iOS",
     "useragent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Mobile/15E148 Safari/604.1",
     "res": "390x844"},
)

# Kept as a flat list for the browser/backend sessions, which only need the UA.
USER_AGENTS = [d["useragent"] for d in DEVICE_PROFILES]

# geo_country / geo_city pairs weighted by share of Brazilian online spend.
GEO_POOL = (
    ("BR", "Sao Paulo",       0.26),
    ("BR", "Rio de Janeiro",  0.12),
    ("BR", "Belo Horizonte",  0.07),
    ("BR", "Brasilia",        0.06),
    ("BR", "Curitiba",        0.05),
    ("BR", "Porto Alegre",    0.05),
    ("BR", "Salvador",        0.04),
    ("BR", "Fortaleza",       0.04),
    ("BR", "Recife",          0.04),
    ("BR", "Campinas",        0.03),
    ("BR", "Goiania",         0.03),
    ("BR", "Manaus",          0.02),
    ("BR", "Florianopolis",   0.02),
    ("BR", "Vitoria",         0.02),
    ("AR", "Buenos Aires",    0.04),
    ("PT", "Lisbon",          0.03),
    ("US", "Miami",           0.03),
    ("MX", "Mexico City",     0.02),
    ("CL", "Santiago",        0.02),
    ("UY", "Montevideo",      0.01),
)

# The merchant name reserved for storefront orders. Background credit-card
# traffic never uses it, so `merchant_name = 'ClickShop'` isolates exactly the
# transactions that have a matching purchase event.
STOREFRONT_MERCHANT = "ClickShop"

# IPv4 /8 blocks actually allocated to Latin American ISPs — makes
# user_ipaddress plausible for geo-IP enrichment demos.
_IP_PREFIXES = (177, 179, 186, 187, 189, 191, 200, 201)


# ══════════════════════════════════════════════════════════════════════════════
# Payments
# ══════════════════════════════════════════════════════════════════════════════

CARD_NETWORKS        = ("Visa", "Mastercard", "Elo", "Amex")
# Approximate Brazilian card-network share.
CARD_NETWORK_WEIGHTS = (0.42, 0.34, 0.19, 0.05)

CARD_BINS: dict[str, tuple[int, ...]] = {
    "Mastercard": (51, 52, 53, 54, 55),
    "Visa":       (4,),
    "Amex":       (34, 37),
    "Elo":        (636368, 636369, 438935, 504175, 451416, 636297, 5067, 4576, 4011, 506699),
}

# BRL-dominant with a plausible cross-border tail (was a flat uniform draw over
# 15 currencies, which made 93% of a Brazilian merchant's revenue non-BRL).
CURRENCIES = (
    "BRL", "USD", "EUR", "ARS", "GBP", "CLP", "COP",
    "MXN", "UYU", "PYG", "JPY", "CAD", "CHF",
)
CURRENCY_WEIGHTS = (
    0.880, 0.045, 0.020, 0.012, 0.010, 0.008, 0.007,
    0.006, 0.004, 0.003, 0.002, 0.002, 0.001,
)

# Payment method recorded in se_label on checkout_payment_confirmed. Only card
# purchases get a matching credit_card_transactions row: there is no card behind
# a pix transfer or a boleto, so those purchases legitimately have none.
PAYMENT_METHODS        = ("credit_card", "pix", "boleto")
PAYMENT_METHOD_WEIGHTS = (0.50, 0.30, 0.20)


def _weighted_pool(items, weights, size: int) -> tuple:
    """
    Expand a weighted distribution into a flat tuple for `random.choice`.

    `random.choices(..., k=1)[0]` costs ~0.4 µs (it builds cumulative weights and
    a result list on every call); `random.choice` over a pre-expanded pool costs
    ~0.1 µs. On a hot path called several times per generated row that difference
    is worth the few kB of tuple.

    `size` must be large enough to represent the smallest weight — the currency
    tail goes down to 0.001, hence a 1 000-entry pool there.
    """
    total = sum(weights)
    pool: list = []
    for item, weight in zip(items, weights):
        pool.extend([item] * max(1, round(weight / total * size)))
    return tuple(pool)


_CARD_NETWORK_POOL = _weighted_pool(CARD_NETWORKS, CARD_NETWORK_WEIGHTS, 100)
_CURRENCY_POOL     = _weighted_pool(CURRENCIES, CURRENCY_WEIGHTS, 1_000)

# Instalment plans by ticket size. Brazilian shoppers split larger baskets into
# interest-free instalments; small tickets are almost always single-payment.
_INSTALMENT_POOLS = (
    (120.0,   _weighted_pool((1,), (1.0,), 1)),
    (400.0,   _weighted_pool((1, 2, 3),        (0.68, 0.20, 0.12),       100)),
    (1000.0,  _weighted_pool((1, 2, 3, 6),     (0.40, 0.22, 0.24, 0.14), 100)),
    (float("inf"),
              _weighted_pool((1, 3, 6, 10, 12), (0.22, 0.24, 0.26, 0.14, 0.14), 100)),
)


def pick_card_network() -> str:
    return random.choice(_CARD_NETWORK_POOL)


def card_bin_for(network: str) -> int:
    return random.choice(CARD_BINS.get(network, (4,)))


def pick_installments(amount: float) -> int:
    """Instalment count appropriate to the ticket size."""
    amount = abs(amount)
    for ceiling, pool in _INSTALMENT_POOLS:
        if amount < ceiling:
            return random.choice(pool)
    return 1


_FIRST_NAMES = (
    "Ana", "Beatriz", "Carla", "Camila", "Daniela", "Eduarda", "Fernanda", "Gabriela",
    "Helena", "Isabela", "Juliana", "Larissa", "Luciana", "Mariana", "Natalia", "Patricia",
    "Renata", "Sabrina", "Tatiane", "Vanessa", "Bruna", "Leticia", "Amanda", "Priscila",
    "Adriana", "Cristiane", "Simone", "Viviane", "Rafaela", "Bianca",
    "Alexandre", "Bruno", "Carlos", "Daniel", "Eduardo", "Felipe", "Gustavo", "Henrique",
    "Igor", "Joao", "Leandro", "Lucas", "Marcelo", "Matheus", "Nelson", "Otavio",
    "Paulo", "Rafael", "Ricardo", "Rodrigo", "Sergio", "Thiago", "Vinicius", "Wagner",
    "Andre", "Fabio", "Guilherme", "Marcos", "Pedro", "Tiago",
)

_LAST_NAMES = (
    "Silva", "Santos", "Oliveira", "Souza", "Rodrigues", "Ferreira", "Alves", "Pereira",
    "Lima", "Gomes", "Ribeiro", "Carvalho", "Almeida", "Lopes", "Soares", "Fernandes",
    "Vieira", "Barbosa", "Rocha", "Dias", "Nascimento", "Andrade", "Moreira", "Nunes",
    "Marques", "Machado", "Mendes", "Freitas", "Cardoso", "Ramos", "Gonçalves", "Araujo",
    "Teixeira", "Correia", "Cavalcanti", "Monteiro", "Moura", "Batista", "Pinto", "Costa",
    "Azevedo", "Melo", "Duarte", "Campos", "Sales", "Farias", "Peixoto", "Bastos",
)


def build_name_pool(size: int) -> tuple[str, ...]:
    """
    Pre-generate cardholder names once at startup. Sampling this pool with
    random.choice per transaction is far cheaper than composing a name per row,
    and dropping the faker dependency removes a slow import from worker startup.
    """
    size = max(1, int(size))
    return tuple(
        f"{random.choice(_FIRST_NAMES)} {random.choice(_LAST_NAMES)} {random.choice(_LAST_NAMES)}"
        for _ in range(size)
    )


def build_expiration_pool() -> tuple[str, ...]:
    """MM/YY strings 1-6 years out — a small distinct set, generated once."""
    year = datetime.now(timezone.utc).year
    return tuple(
        f"{m:02d}/{(year + y) % 100:02d}"
        for y in range(1, 7)
        for m in range(1, 13)
    )


def pick_currency() -> str:
    return random.choice(_CURRENCY_POOL)


# ── Transaction anomalies ────────────────────────────────────────────────────
# The demo's anomaly signal: a small share of transactions are corrupted
# in exactly one field. Both the storefront transactions and the background
# credit-card traffic use this function, so an anomaly-detection query behaves
# identically on either population.
FAULTY_FEATURES = (
    "timestamp", "merchant_name", "bill_value", "installments",
    "card_network", "card_bin", "card_holder",
)

STOREFRONT_CHARGEBACK_RATE = env_float("STOREFRONT_CHARGEBACK_RATE", 0.03)
STOREFRONT_FAULTY_RATE     = env_float("STOREFRONT_FAULTY_RATE", 0.01)


def corrupt_transaction(txn: dict) -> dict:
    """
    Corrupt one field of `txn` in place and return it.

    `transaction_id` is never touched: a faulty *storefront* transaction must
    still join back to the purchase event that produced it, which is what makes
    "trace this anomaly to the web session that caused it" a workable demo.
    """
    feature = random.choice(FAULTY_FEATURES)
    if feature == "timestamp":
        # Dated after the order it belongs to — impossible, hence detectable.
        future = datetime.now(timezone.utc) + timedelta(
            hours=random.randint(1, 5), minutes=random.randint(0, 30)
        )
        txn["timestamp"] = format_ts(future)
    elif feature == "merchant_name":
        txn["merchant_name"] = None
    elif feature == "bill_value":
        txn["bill_value"] = -abs(txn["bill_value"])
    elif feature == "installments":
        txn["installments"] = 0
    elif feature == "card_network":
        txn["card_network"] = "UCB"          # not a real network
    elif feature == "card_bin":
        # A BIN that contradicts the declared network.
        others = [n for n in CARD_NETWORKS if n != txn.get("card_network")] or list(CARD_NETWORKS)
        txn["card_bin"] = card_bin_for(random.choice(others))
    elif feature == "card_holder":
        txn["card_holder"] = None
    return txn


def build_storefront_transaction(
    order: dict,
    when: datetime,
    name_pool: tuple[str, ...] | None = None,
    expiration_pool: tuple[str, ...] | None = None,
) -> dict | None:
    """
    The credit_card_transactions row for a storefront order.

    `transaction_id` is the order id the purchase event carried in se_property,
    which is the join:

        SELECT ...
        FROM   snowplow_events e
        JOIN   credit_card_transactions t ON t.transaction_id = toUUID(e.se_property)
        WHERE  e.event_name = 'checkout_payment_confirmed'
          AND  t.merchant_name = 'ClickShop'

    Returns None for pix and boleto orders — neither leaves a card transaction,
    so those purchases legitimately have no counterpart row.
    """
    if order.get("method") != "credit_card":
        return None

    network = order.get("card_network") or pick_card_network()
    holder  = random.choice(name_pool) if name_pool else build_name_pool(1)[0]
    expiry  = random.choice(expiration_pool) if expiration_pool else build_expiration_pool()[0]
    total   = float(order["total"])

    txn = {
        "transaction_id":       order["order_id"],
        "timestamp":            format_ts(when),
        "merchant_name":        STOREFRONT_MERCHANT,
        "merchant_type":        "retail",
        "bill_value":           round(total, 2),
        "installments":         pick_installments(total),
        "card_network":         network,
        "card_bin":             card_bin_for(network),
        "card_holder":          holder,
        "card_expiration_date": expiry,
        "currency":             "BRL",
        "type":                 "expense",
    }

    roll = random.random()
    if roll < STOREFRONT_CHARGEBACK_RATE:
        txn["type"]       = "chargeback"
        txn["bill_value"] = -txn["bill_value"]
    elif roll < STOREFRONT_CHARGEBACK_RATE + STOREFRONT_FAULTY_RATE:
        corrupt_transaction(txn)

    return txn


# ══════════════════════════════════════════════════════════════════════════════
# Helpers
# ══════════════════════════════════════════════════════════════════════════════

_SOURCE_WEIGHTS = [s["weight"] for s in TRAFFIC_SOURCES]
_DEVICE_WEIGHTS = [d["weight"] for d in DEVICE_PROFILES]
_GEO_WEIGHTS    = [g[2] for g in GEO_POOL]

_DWELL_SCALE = 1.0


def set_dwell_scale(scale: float) -> None:
    """
    Multiply every dwell time by `scale`.

    Dwell time is what bounds a generator's throughput per concurrent session:
    at scale 1.0 a session occupies a slot for minutes. Compressing it (e.g.
    0.05) lets the same concurrency drive far more sessions per second, at the
    cost of unrealistically short session durations.
    """
    global _DWELL_SCALE
    _DWELL_SCALE = max(0.0, float(scale))


def dwell(key: str, scale: float | None = None) -> float:
    """Random dwell time in seconds for the given page type (right-skewed)."""
    lo, hi = TIMING[key]
    mu     = (lo + hi) / 2
    sigma  = (hi - lo) / 4
    value  = max(lo, min(hi, random.gauss(mu, sigma)))
    return value * (_DWELL_SCALE if scale is None else max(0.0, float(scale)))


def n_products_to_view() -> int:
    """
    How many products a user views in one category browse, clipped to 1-10.

    Log-normal parameters are solved so the *mean* equals
    FUNNEL["avg_products_per_category"] — the previous formula used the target
    as a log-space parameter and averaged ~6 products against a declared 3.5,
    which made every derived funnel estimate wrong.
    """
    target = max(1.0, float(FUNNEL["avg_products_per_category"]))
    sigma  = 0.5
    mu     = math.log(target) - sigma * sigma / 2.0
    return max(1, min(10, round(random.lognormvariate(mu, sigma))))


def pick_source() -> dict:
    """Sample one traffic source according to its weight."""
    return random.choices(TRAFFIC_SOURCES, weights=_SOURCE_WEIGHTS, k=1)[0]


def pick_device() -> dict:
    """Sample a device profile (useragent + enrichment columns)."""
    return random.choices(DEVICE_PROFILES, weights=_DEVICE_WEIGHTS, k=1)[0]


def pick_geo() -> tuple[str, str]:
    """Sample a (geo_country, geo_city) pair."""
    country, city, _ = random.choices(GEO_POOL, weights=_GEO_WEIGHTS, k=1)[0]
    return country, city


def random_ip() -> str:
    return (
        f"{random.choice(_IP_PREFIXES)}.{random.randint(0, 255)}."
        f"{random.randint(0, 255)}.{random.randint(1, 254)}"
    )


def build_landing_url(base_url: str, source: dict) -> str:
    """Append UTM query params to the base URL when a source is defined."""
    base_url = base_url.rstrip("/")
    params: dict[str, str] = {}
    if source["source"]:
        params["utm_source"] = source["source"]
    if source["medium"]:
        params["utm_medium"] = source["medium"]
    if source["campaign"]:
        params["utm_campaign"] = source["campaign"]
    if source["content"]:
        params["utm_content"] = source["content"]
    if not params:
        return base_url + "/"
    qs = "&".join(f"{k}={v}" for k, v in params.items())
    return f"{base_url}/?{qs}"


def get_referrer(source: dict) -> str | None:
    """A plausible referrer URL for the given traffic source."""
    return REFERRERS.get(source.get("source") or "", None)


def format_ts(dt: datetime) -> str:
    """
    DateTime64(3) literal: 'YYYY-MM-DD HH:MM:SS.mmm' (UTC).

    isoformat() rather than strftime(): both are called once or twice per
    generated row, and strftime costs ~1.4 µs against ~0.6 µs here — strftime
    alone was ~20 % of a producer worker's per-event budget.

    The slice drops the UTC offset that isoformat() appends for aware datetimes;
    the wanted prefix is always exactly 23 characters, aware or naive.
    """
    return dt.isoformat(" ", "milliseconds")[:23]


_getrandbits = random.getrandbits


def new_id() -> str:
    """
    A random UUID v4 string.

    Equivalent output to `str(uuid.uuid4())` but ~5× cheaper: uuid4() reads from
    the OS CSPRNG and builds a UUID object, neither of which a synthetic data
    generator needs. Version and variant bits are set so the result is a
    well-formed v4 and round-trips through ClickHouse's UUID type.
    """
    n = _getrandbits(128)
    n &= ~(0xF << 76)     # clear the version nibble
    n |= 0x4 << 76        # version 4
    n &= ~(0x3 << 62)     # clear the variant bits
    n |= 0x2 << 62        # RFC 4122 variant
    h = "%032x" % n
    return f"{h[0:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}"


# ══════════════════════════════════════════════════════════════════════════════
# Session plan — the one funnel implementation
# ══════════════════════════════════════════════════════════════════════════════
#
# `plan_session()` decides *what* a session does; it never decides *when* or
# *how* the events are transmitted. Both generators consume the same plan:
#
#   simulator/session_browser.py   walks the steps in real time, driving a
#                                  headless browser through the storefront and
#                                  sleeping the step's dwell.
#   the web-events producer        walks the steps instantly, accumulating each
#                                  dwell into a synthetic timestamp offset.
#
# Because the funnel exists in exactly one place, the two generators cannot
# drift apart — a change to FUNNEL takes effect in both.

class Step:
    """One action in a session plan. `dwell` is the pause that follows it."""

    __slots__ = (
        "kind", "path", "dwell", "product_id", "category", "price",
        "query", "depth", "value", "label", "property_",
    )

    def __init__(
        self,
        kind: str,
        path: str = "",
        dwell: float = 0.0,
        product_id: int = 0,
        category: str = "",
        price: float = 0.0,
        query: str = "",
        depth: int = 0,
        value: float = 0.0,
        label: str = "",
        property_: str = "",
    ):
        self.kind       = kind
        self.path       = path
        self.dwell      = dwell
        self.product_id = product_id
        self.category   = category
        self.price      = price
        self.query      = query
        self.depth      = depth
        self.value      = value
        self.label      = label
        self.property_  = property_


class SessionPlan:
    """
    A fully-decided session: which steps fire, in what order, with what dwell,
    plus the session's traffic source, device, geo, and (if it converted) the
    order that a credit-card transaction must be reconciled against.
    """

    __slots__ = ("steps", "source", "device", "geo", "bounced", "cart", "order", "duration_s")

    def __init__(self, steps, source, device, geo, bounced, cart, order):
        self.steps      = steps
        self.source     = source
        self.device     = device
        self.geo        = geo
        self.bounced    = bounced
        self.cart       = cart
        self.order      = order
        self.duration_s = sum(s.dwell for s in steps)

    def category_outline(self) -> list[tuple[str, int]]:
        """
        [(category_slug, products_to_view), …] — the plan reduced to what a
        browser-driven session can act on.

        Browser mode has to take its product links from the live DOM, so it
        cannot replay the plan's chosen product ids. It follows this outline
        instead, which keeps its bounce rate, category count, and depth aligned
        with backend mode even though the individual products differ.
        """
        outline: list[tuple[str, int]] = []
        for step in self.steps:
            if step.kind == "page_view" and step.path.startswith("/category/"):
                outline.append((step.path.removeprefix("/category/"), 0))
            elif step.kind == "product_click" and outline:
                slug, n = outline[-1]
                outline[-1] = (slug, n + 1)
        return outline


def pick_payment_method() -> str:
    """`credit_card`, `pix` or `boleto`, by PAYMENT_METHOD_WEIGHTS."""
    return random.choices(PAYMENT_METHODS, PAYMENT_METHOD_WEIGHTS)[0]


def _default_pick_product(category: str) -> dict:
    return {"id": random.randint(1, 1000), "price": round(random.uniform(9.99, 499.99), 2)}


def plan_session(pick_product=None) -> SessionPlan:
    """
    Roll one complete session against the FUNNEL rates.

    `pick_product(category) -> {"id": int, "price": float}` supplies real
    catalog entries; it defaults to a synthetic 1-1000 range so the planner is
    usable before a catalog has loaded.
    """
    pick_product = pick_product or _default_pick_product

    steps: list[Step] = []
    source = pick_source()
    device = pick_device()
    geo    = pick_geo()
    cart: list[dict] = []
    order: dict | None = None

    # ── 1. Landing page ──────────────────────────────────────────────────────
    bounced = random.random() < FUNNEL["bounce_rate"]
    steps.append(Step(
        "landing", path="/",
        dwell=dwell("bounce_dwell" if bounced else "home_dwell"),
    ))
    if bounced:
        return SessionPlan(steps, source, device, geo, True, cart, None)

    search_rate = FUNNEL["search_rate"]

    # Search is split across the session so the two draws together add up to
    # FUNNEL["search_rate"] rather than 1.4× it.
    if random.random() < search_rate * 0.4:
        steps.append(Step("search", path="/", query=random.choice(SEARCH_QUERIES),
                          dwell=dwell("think_time")))

    # ── 2. Category browse ───────────────────────────────────────────────────
    categories: list[str] = []
    if random.random() < FUNNEL["home_to_category"]:
        categories.append(random.choice(CATEGORIES))
        if random.random() < FUNNEL["multi_category_rate"]:
            categories.append(random.choice([c for c in CATEGORIES if c != categories[0]]))

    if random.random() < search_rate * 0.6:
        steps.append(Step("search", path="/", query=random.choice(SEARCH_QUERIES),
                          dwell=dwell("think_time")))

    scroll_rate = FUNNEL["scroll_rate"]
    pdp_to_cart = FUNNEL["pdp_to_cart"]

    for category in categories:
        cat_path = f"/category/{category}"
        steps.append(Step("page_view", path=cat_path, category=category,
                          dwell=dwell("category_dwell")))

        if random.random() < scroll_rate:
            steps.append(Step("scroll", path=cat_path,
                              depth=random.choice((25, 50, 75, 90))))

        if random.random() > FUNNEL["category_to_pdp"]:
            continue

        n_products = n_products_to_view()

        for _ in range(n_products):
            product = pick_product(category)
            pid     = int(product["id"])
            price   = float(product["price"])
            pdp     = f"/product/{pid}"

            # product_click fires from the listing, so its page context is the
            # category page the user is still on.
            steps.append(Step("product_click", path=cat_path,
                              product_id=pid, category=category))
            steps.append(Step("page_view", path=pdp, product_id=pid,
                              category=category, dwell=dwell("pdp_dwell")))

            if random.random() < scroll_rate:
                steps.append(Step("scroll", path=pdp,
                                  depth=random.choice((25, 50, 75))))

            if random.random() < pdp_to_cart:
                steps.append(Step("add_to_cart", path=pdp, product_id=pid,
                                  category=category, price=price, value=price,
                                  dwell=dwell("think_time")))
                cart.append({"id": pid, "price": price})
                break   # users typically head to the cart after adding an item

            steps[-1].dwell += dwell("think_time")

    if not cart:
        return SessionPlan(steps, source, device, geo, False, cart, None)

    # ── 3. Cart & checkout ───────────────────────────────────────────────────
    total = round(sum(p["price"] for p in cart), 2)
    steps.append(Step("page_view", path="/cart", dwell=dwell("cart_dwell")))

    if random.random() > FUNNEL["cart_to_checkout"]:
        return SessionPlan(steps, source, device, geo, False, cart, None)

    steps.append(Step("page_view", path="/checkout"))
    steps.append(Step("checkout_start", path="/checkout", value=total,
                      property_=str(len(cart)), dwell=dwell("checkout_step_dwell")))

    if random.random() > FUNNEL["checkout_to_purchase"]:
        return SessionPlan(steps, source, device, geo, False, cart, None)

    # The order id is also the credit-card transaction_id for card payments,
    # which is what makes `toUUID(se_property) = transaction_id` a valid join.
    method   = pick_payment_method()
    order_id = new_id()
    network  = pick_card_network() if method == "credit_card" else ""

    steps.append(Step("payment_initiated", path="/checkout", value=total,
                      label=method, dwell=dwell("think_time")))
    steps.append(Step("payment_confirmed", path="/checkout", value=total,
                      label=method, property_=order_id))
    steps.append(Step("page_view", path="/checkout/confirmation"))

    order = {
        "order_id":     order_id,
        "total":        total,
        "items":        len(cart),
        "method":       method,
        "card_network": network,
    }
    return SessionPlan(steps, source, device, geo, False, cart, order)
