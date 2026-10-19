"""The shared profile: payment methods, the confirmation page, and what a plan contains."""

import random
from collections import Counter

import traffic_profile as tp


def test_boleto_is_a_payment_method_with_a_weight():
    assert tp.PAYMENT_METHODS == ("credit_card", "pix", "boleto")
    assert len(tp.PAYMENT_METHOD_WEIGHTS) == 3 and abs(sum(tp.PAYMENT_METHOD_WEIGHTS) - 1.0) < 1e-9
    random.seed(1)
    picks = Counter(tp.pick_payment_method() for _ in range(6000))
    assert set(picks) == {"credit_card", "pix", "boleto"}
    for method, weight in zip(tp.PAYMENT_METHODS, tp.PAYMENT_METHOD_WEIGHTS):
        assert abs(picks[method] / 6000 - weight) < 0.03


def test_only_card_orders_leave_a_card_transaction():
    when = tp.Clock().event_time()
    base = {"order_id": "o-1", "total": 120.0}
    assert tp.build_storefront_transaction({**base, "method": "credit_card"}, when) is not None
    assert tp.build_storefront_transaction({**base, "method": "pix"}, when) is None
    assert tp.build_storefront_transaction({**base, "method": "boleto"}, when) is None


def test_a_purchase_ends_on_the_pages_the_storefront_really_has():
    random.seed(7)
    for _ in range(4000):
        plan = tp.plan_session()
        if plan.order:
            assert plan.steps[-1].path == "/checkout/confirmation"
            assert "/checkout/confirmation" in tp.PAGE_TITLES
            assert plan.order["method"] in tp.PAYMENT_METHODS
            return
    raise AssertionError("no purchase in 4000 sessions")


def test_every_path_a_plan_visits_has_a_page_title():
    random.seed(3)
    paths = {s.path for _ in range(3000) for s in tp.plan_session().steps if s.kind == "page_view"}
    missing = {p for p in paths if p not in tp.PAGE_TITLES and not p.startswith("/product/")}
    assert not missing
