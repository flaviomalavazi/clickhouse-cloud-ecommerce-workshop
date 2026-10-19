"""
Who the simulated shoppers are, what language they browse in, and what they search for.

Kept free of Playwright so it can be tested on its own.
"""

from __future__ import annotations

import random
import re
import unicodedata
from typing import NamedTuple

import config

# Browser locales, with the share of sessions that use each. The storefront picks its
# UI language from navigator.languages and sends it with every search, so the
# locale decides which text index a search hits.
LOCALES: tuple[tuple[str, float], ...] = (("en-US", 0.40), ("pt-BR", 0.40), ("es-MX", 0.20))

# The plan's search terms, in English (config.SEARCH_QUERIES). A session that browses
# in Portuguese or Spanish searches for the same thing in that language, by position:
# an English term typed into a Portuguese page would mostly find nothing.
_PT = (
    "tênis de corrida", "calça jeans azul", "livro de python", "fones de ouvido sem fio",
    "mochila para notebook", "vestido de verão", "mouse gamer", "hub usb",
    "tapete de yoga", "carteira de couro", "teclado mecânico", "luminária de mesa",
    "ciência de dados", "tênis casual", "moletom", "cafeteira",
    "relógio inteligente", "caixa de som bluetooth", "bota de trilha", "camiseta",
)
_ES = (
    "zapatillas para correr", "jeans azules", "libro de python", "audífonos inalámbricos",
    "mochila para laptop", "vestido de verano", "mouse gamer", "hub usb",
    "tapete de yoga", "billetera de cuero", "teclado mecánico", "lámpara de escritorio",
    "ciencia de datos", "zapatillas", "sudadera", "cafetera",
    "reloj inteligente", "altavoz bluetooth", "botas de senderismo", "camiseta",
)
_TRANSLATIONS = {"pt-BR": _PT, "es-MX": _ES}


def pick_locale(rng: random.Random | None = None) -> str:
    r = rng or random
    return r.choices([loc for loc, _ in LOCALES], [w for _, w in LOCALES])[0]


def localize_query(planned: str, locale: str) -> str:
    """The plan's English search term, in the session's language. Unknown terms pass through."""
    table = _TRANSLATIONS.get(locale)
    if table is None:
        return planned
    try:
        return table[config.SEARCH_QUERIES.index(planned)]
    except (ValueError, IndexError):
        return planned


def sample_page(rng: random.Random | None = None) -> int:
    """
    Which page of a price-sorted category listing a shopper picks a product from.

    Most stay on the first page (the cheapest products), a tail goes a few pages
    deep, and now and then someone goes much further, so orders reach the whole
    catalogue over a run and not just the cheapest dozen.
    """
    r = rng or random
    if r.random() < 0.55:
        return 1
    return 2 + int(r.expovariate(1 / 3))


class Shopper(NamedTuple):
    name: str
    email: str


def _slug(text: str) -> str:
    ascii_text = unicodedata.normalize("NFKD", text).encode("ascii", "ignore").decode()
    return re.sub(r"[^a-z0-9]+", ".", ascii_text.lower()).strip(".")


def build_shoppers(size: int = 5_000, seed: int = 42) -> tuple[Shopper, ...]:
    """
    A fixed population of shoppers: the same names and emails on every run.

    A shopper who is picked twice is the same customer twice, so the `customers`
    table grows the way a store's does: mostly new people at first, more repeat
    customers as the run goes on. The global RNG is saved and restored, so building
    the pool never disturbs the sessions' own randomness.
    """
    state = random.getstate()
    random.seed(seed)
    try:
        names = config.build_name_pool(size)
    finally:
        random.setstate(state)
    return tuple(Shopper(name, f"{_slug(name)}.{i}@example.com") for i, name in enumerate(names))
