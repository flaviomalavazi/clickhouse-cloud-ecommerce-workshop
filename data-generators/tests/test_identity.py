"""The simulator's shoppers, locales and search terms (no browser needed)."""

import random

import config
import identity


def test_search_terms_follow_the_session_language():
    assert identity.localize_query("running shoes", "en-US") == "running shoes"
    assert identity.localize_query("running shoes", "pt-BR") == "tênis de corrida"
    assert identity.localize_query("running shoes", "es-MX") == "zapatillas para correr"


def test_every_planned_term_has_a_translation_at_the_same_position():
    assert len(identity._PT) == len(identity._ES) == len(config.SEARCH_QUERIES)
    for term in config.SEARCH_QUERIES:
        assert identity.localize_query(term, "pt-BR") != "" and identity.localize_query(term, "es-MX") != ""


def test_an_unknown_term_passes_through():
    assert identity.localize_query("something new", "pt-BR") == "something new"


def test_locales_are_picked_by_weight():
    rng = random.Random(0)
    picks = [identity.pick_locale(rng) for _ in range(5000)]
    assert {loc for loc, _ in identity.LOCALES} == set(picks)
    assert abs(picks.count("pt-BR") / 5000 - 0.40) < 0.03


def test_the_shopper_pool_is_the_same_every_run_and_has_unique_emails():
    a, b = identity.build_shoppers(500), identity.build_shoppers(500)
    assert a == b
    assert len({s.email for s in a}) == 500
    assert all(s.email.endswith("@example.com") and s.email.isascii() and " " not in s.email for s in a)


def test_building_the_pool_does_not_disturb_the_global_random_stream():
    random.seed(99)
    expected = [random.random() for _ in range(3)]
    random.seed(99)
    identity.build_shoppers(100)
    assert [random.random() for _ in range(3)] == expected


def test_most_shoppers_look_at_the_first_page_and_some_go_deeper():
    rng = random.Random(1)
    pages = [identity.sample_page(rng) for _ in range(10_000)]
    assert min(pages) == 1 and max(pages) > 5
    assert 0.5 < pages.count(1) / 10_000 < 0.6


def test_the_workshop_funnel_converts_more_than_the_shared_one(monkeypatch):
    realistic = dict(config.FUNNEL)
    try:
        monkeypatch.delenv("SIM_REALISTIC_FUNNEL", raising=False)
        assert config.apply_workshop_funnel() is True
        random.seed(5)
        workshop_orders = sum(1 for _ in range(4000) if config.plan_session().order)
        config.FUNNEL.update(realistic)
        random.seed(5)
        realistic_orders = sum(1 for _ in range(4000) if config.plan_session().order)
        assert workshop_orders > 4 * realistic_orders
        monkeypatch.setenv("SIM_REALISTIC_FUNNEL", "true")
        assert config.apply_workshop_funnel() is False
    finally:
        config.FUNNEL.update(realistic)
