"""
Session → Snowplow-shaped row rendering for the web-events producer.

Extracted from the producer (data-generators README, "Why the producer
generates sessions") so the rows it renders from a `traffic_profile.SessionPlan`
keep the event-shape logic in one place. Keeping this in one file is what keeps
producer rows and real browser rows (via snowplow-bridge) field-for-field
indistinguishable in ClickHouse — see data-generators/README.md "Event payload
contract".

The producer image COPYs this file in alongside `traffic_profile.py`.
"""

from __future__ import annotations

from datetime import timedelta
from urllib.parse import urlsplit

import traffic_profile as tp

__all__ = ["blank_row", "ctx_for", "render_session", "STRUCT_EVENTS"]

# (se_category, se_action) for each structured step kind. Values match
# frontend/src/lib/snowplow.ts so producer rows and browser rows are identical.
STRUCT_EVENTS = {
    "search":            ("search",     "text_search"),
    "scroll":            ("engagement", "scroll"),
    "product_click":     ("product",    "click"),
    "add_to_cart":       ("cart",       "add_to_cart"),
    "checkout_start":    ("checkout",   "start"),
    "payment_initiated": ("checkout",   "payment_initiated"),
    "payment_confirmed": ("checkout",   "payment_confirmed"),
}


def ctx_for(se_category: str, se_label: str, se_property: str):
    """
    Mirror of snowplow-bridge/main.py:extract_ctx.

    The bridge derives the ctx_* columns from se_label/se_property when it
    inserts a browser event. Rows produced here bypass the bridge, so they have
    to derive them the same way or the two populations would disagree on which
    columns are populated.
    """
    if se_category in ("product", "cart"):
        try:
            return int(se_label), se_property, "", ""
        except (TypeError, ValueError):
            return 0, se_property, "", ""
    if se_category == "search":
        return 0, "", se_label, se_property
    return 0, "", "", ""


def blank_row(base: dict) -> dict:
    row = dict(base)
    row.update({
        "event_id":          tp.new_id(),
        "event":             "",
        "event_name":        "",
        "page_url":          "",
        "page_urlpath":      "",
        "page_title":        "",
        "refr_urlpath":      "",
        "se_category":       "",
        "se_action":         "",
        "se_label":          "",
        "se_property":       "",
        "se_value":          0.0,
        "unstruct_event":    "",
        "ctx_product_id":    0,
        "ctx_category_slug": "",
        "ctx_search_query":  "",
        "ctx_search_type":   "",
    })
    return row


def render_session(
    plan,
    clock,
    rng,
    users,
    names,
    expirations,
    *,
    site_url: str,
    app_id: str,
    user_id: str = "",
    emit_purchase_cc: bool = True,
) -> tuple[list[dict], list[dict]]:
    """
    Turn a SessionPlan into (web-event rows, credit-card transactions).

    `user_id` is stamped on every row of the session. The workshop has no
    sign-in, so the producer always passes '' (anonymous) — the column stays so
    producer rows match the `snowplow_events` schema the bridge writes to.

    Timestamps are built by accumulating each step's dwell into an offset, then
    anchoring the whole session on the timeline via `clock` — so a live session
    ends at ~now and a backfilled one lands at a weighted past hour, with the
    intra-session gaps realistic either way.
    """
    device  = plan.device
    country, city = plan.geo
    session_ip = tp.random_ip()
    base = {
        "app_id":           app_id,
        "platform":         "web",
        "domain_userid":    rng.choice(users),      # repeat visitors reuse a userid
        "domain_sessionid": tp.new_id(),
        "user_id":          user_id,
        "user_ipaddress":   session_ip,
        "useragent":        device["useragent"],
        "br_family":        device["br_family"],
        "os_family":        device["os_family"],
        "dvce_type":        device["dvce_type"],
        "geo_country":      country,
        "geo_city":         city,
    }

    # Offsets are computed up front so the session can be anchored on the
    # timeline afterwards. Every event advances the clock by at least a few tens
    # of milliseconds even when the step has no dwell — otherwise a click and
    # the page view it causes would share a timestamp to the millisecond, and
    # anything that depends on event order (windowFunnel, sessionisation) would
    # see an ambiguous sequence.
    offsets: list[float] = []
    acc = 0.0
    for step in plan.steps:
        offsets.append(acc)
        acc += step.dwell + rng.uniform(0.02, 0.40)

    start, _ = clock.session_start(offsets[-1] if offsets else 0.0)

    rows: list[dict] = []
    txns: list[dict] = []
    purchase_ts = None

    # The page currently being viewed, and the referrer the tracker reports for
    # it. Structured events inherit both from their page, exactly as the JS
    # tracker does — a click on a category listing reports the *home* page as
    # its referrer, not the listing itself.
    referrer  = tp.get_referrer(plan.source)
    cur_url   = site_url + "/"
    cur_path  = "/"
    cur_refr  = (urlsplit(referrer).path or "/") if referrer else ""

    for step, offset in zip(plan.steps, offsets):
        row = blank_row(base)
        ts  = start + timedelta(seconds=offset)
        row["collector_tstamp"]    = tp.format_ts(ts)
        row["dvce_created_tstamp"] = tp.format_ts(
            ts - timedelta(milliseconds=rng.randint(50, 2000))
        )

        kind = step.kind

        if kind in ("landing", "page_view"):
            if kind == "landing":
                cur_url  = tp.build_landing_url(site_url, plan.source)
                cur_path = "/"
            else:
                cur_refr = cur_path
                cur_path = step.path
                cur_url  = site_url + step.path
            row["event"]        = "page_view"
            row["event_name"]   = "page_view"
            row["page_url"]     = cur_url
            row["page_urlpath"] = cur_path
            row["page_title"]   = tp.PAGE_TITLES.get(cur_path, "ClickShop")
            row["refr_urlpath"] = cur_refr
        else:
            se_category, se_action = STRUCT_EVENTS[kind]
            if kind == "search":
                se_label, se_property, se_value = step.query, "text", float(rng.randint(0, 24))
            elif kind == "scroll":
                se_label, se_property, se_value = f"{step.depth}%", "", float(step.depth)
            elif kind == "product_click":
                se_label, se_property, se_value = str(step.product_id), step.category, float(rng.randint(1, 12))
            elif kind == "add_to_cart":
                se_label, se_property, se_value = str(step.product_id), step.category, float(step.price)
            else:   # checkout_start / payment_initiated / payment_confirmed
                se_label, se_property, se_value = step.label, step.property_, float(step.value)

            row["event"]       = "struct"
            row["event_name"]  = f"{se_category}_{se_action}"
            row["se_category"] = se_category
            row["se_action"]   = se_action
            row["se_label"]    = se_label
            row["se_property"] = se_property
            row["se_value"]    = se_value
            # Inherited from the page the user is on, UTM params included.
            row["page_url"]     = cur_url
            row["page_urlpath"] = cur_path
            row["page_title"]   = tp.PAGE_TITLES.get(cur_path, "ClickShop")
            row["refr_urlpath"] = cur_refr
            (row["ctx_product_id"], row["ctx_category_slug"],
             row["ctx_search_query"], row["ctx_search_type"]) = ctx_for(
                se_category, se_label, se_property
            )
            if kind == "payment_confirmed":
                purchase_ts = ts

        rows.append(row)

    # The card transaction is stamped with the purchase event's own timestamp,
    # so the order and its payment agree to the millisecond.
    if emit_purchase_cc and plan.order and purchase_ts is not None:
        txn = tp.build_storefront_transaction(plan.order, purchase_ts, names, expirations)
        if txn is not None:
            txns.append(txn)

    return rows, txns
