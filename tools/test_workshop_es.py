"""The Spanish guide stays the same guide as the English one (no network).

A participant can follow the workshop in Spanish (`README.es.md` and `workshop/es/`) or in English. The two must teach the same thing:
the same steps, the same commands and the same checks. English stays the source: a command, a table name, a console label or a piece
of program output is never translated, so what is checked here is that the structure and everything that is typed or clicked is
identical, and that a page was not left half in English or in the wrong register.
"""

import re
from collections import Counter

import pytest

from test_agent_mode import ROOT
from test_workshop_docs import MODULES, header_minutes, missing_paths, table_minutes, text_of

pytestmark = pytest.mark.skipif(not (ROOT / "workshop").exists(), reason="the repo is not mounted")

LANGFUSE = ROOT / "workshop" / "en" / "09-clickhouse-agents" / "langfuse.md"
PAIRS = [(ROOT / "README.md", ROOT / "README.es.md")]
PAIRS += [(m, ROOT / "workshop" / "es" / m.parent.name / "README.md") for m in MODULES]
PAIRS += [(LANGFUSE, ROOT / "workshop" / "es" / LANGFUSE.parent.name / LANGFUSE.name)]
PAIRS += [(ROOT / "COMMANDS.md", ROOT / "COMMANDS.es.md")]
IDS = [es.relative_to(ROOT).as_posix() for _, es in PAIRS]
FENCE = re.compile(r"^[ \t]*```[^\n]*\n.*?^[ \t]*```[ \t]*$", re.S | re.M)   # also the blocks indented inside a list item


def prose_of(text: str) -> str:
    """The text a person reads as sentences: no fenced blocks, no inline code, no link targets."""
    text = FENCE.sub("", text)
    text = re.sub(r"`[^`\n]+`", "", text)
    text = re.sub(r"<https?://[^>]+>", "", text)
    return re.sub(r"\]\([^)\s]*\)", "]", text)


def code_blocks(text: str) -> list[str]:
    return FENCE.findall(text)


def headings(text: str) -> list[tuple[int, str]]:
    """(level, the number a numbered heading starts with, or '') for every heading outside a code block."""
    out = []
    for line in FENCE.sub("", text).splitlines():
        m = re.match(r"(#{1,6}) +(?:(\d+)\. )?", line)
        if m:
            out.append((len(m.group(1)), m.group(2) or ""))
    return out


def inline_code(text: str) -> Counter:
    return Counter(re.findall(r"`([^`\n]+)`", FENCE.sub("", text)))


def table_rows(text: str) -> int:
    return len(re.findall(r"^\|", FENCE.sub("", text), flags=re.M))


def list_items(text: str) -> int:
    return len(re.findall(r"^\s*(?:[-*]|\d+\.)\s", FENCE.sub("", text), flags=re.M))


def external_links(text: str) -> Counter:
    return Counter(re.findall(r"\]\((https?://[^)\s]+)\)|<(https?://[^>]+)>", text))


def local_links(text: str) -> list[str]:
    """The relative links, not counting the language-switch line at the top of the two READMEs."""
    text = re.sub(r"^\*\*(?:Language|Idioma):\*\*.*$", "", text, flags=re.M)
    return [t for t in re.findall(r"\]\(([^)\s]+)\)", text) if not re.match(r"[a-z]+:", t) and not t.startswith("#")]


def first_number_after(label: str, text: str) -> int:
    return int(re.search(rf"\*\*{label}:\*\*[^\n]*?(\d+)", text).group(1))


@pytest.mark.parametrize("en, es", PAIRS, ids=IDS)
def test_every_english_page_has_its_spanish_page(en, es):
    assert es.exists(), f"{es.relative_to(ROOT)} is missing (translation of {en.relative_to(ROOT)})"


def test_there_is_no_spanish_page_without_an_english_one():
    expected = {es for _, es in PAIRS}
    found = set((ROOT / "workshop" / "es").rglob("*.md")) | {ROOT / "README.es.md"}
    assert found <= expected, f"Spanish pages with no English source: {sorted(p.relative_to(ROOT).as_posix() for p in found - expected)}"


@pytest.mark.parametrize("en, es", PAIRS, ids=IDS)
def test_same_headings_in_the_same_order(en, es):
    assert headings(text_of(es)) == headings(text_of(en)), "headings (level and number) differ from the English page"


@pytest.mark.parametrize("en, es", PAIRS, ids=IDS)
def test_every_code_block_is_identical(en, es):
    english, spanish = code_blocks(text_of(en)), code_blocks(text_of(es))
    assert len(spanish) == len(english), f"{len(spanish)} code blocks, the English page has {len(english)}"
    for i, (a, b) in enumerate(zip(english, spanish), 1):
        assert a == b, f"code block {i} differs from the English one (code, comments and output are never translated)"


@pytest.mark.parametrize("en, es", PAIRS, ids=IDS)
def test_every_inline_code_span_is_identical(en, es):
    english, spanish = inline_code(text_of(en)), inline_code(text_of(es))
    assert spanish == english, f"only in Spanish: {sorted((spanish - english).elements())[:8]}; only in English: {sorted((english - spanish).elements())[:8]}"


@pytest.mark.parametrize("en, es", PAIRS, ids=IDS)
def test_tables_lists_and_notes_have_the_same_shape(en, es):
    a, b = text_of(en), text_of(es)
    assert table_rows(b) == table_rows(a), "a table has more or fewer rows than the English one"
    assert list_items(b) == list_items(a), "a list has more or fewer items than the English one"
    assert b.count("TODO(owner)") == a.count("TODO(owner)"), "the TODO(owner) notes differ from the English page"


@pytest.mark.parametrize("en, es", PAIRS, ids=IDS)
def test_links_go_to_the_same_places(en, es):
    spanish_text, english_text = text_of(es), text_of(en)
    assert external_links(spanish_text) == external_links(english_text), "external links differ"
    assert len(local_links(spanish_text)) == len(local_links(english_text)), "a link was added or dropped"
    for target in local_links(spanish_text):
        assert (es.parent / target.split("#")[0]).exists(), f"dead link {target}"


@pytest.mark.parametrize("en, es", PAIRS, ids=IDS)
def test_commands_and_paths_the_page_names_exist(en, es):
    assert not missing_paths(text_of(es)), f"paths that do not exist: {missing_paths(text_of(es))}"


@pytest.mark.parametrize("en, es", [p for p in PAIRS if p[0] in MODULES or p[0] == LANGFUSE], ids=lambda p: p.parent.name if hasattr(p, "parent") else "")
def test_a_module_says_the_same_time_and_has_the_same_parts(en, es):
    a, b = text_of(en), text_of(es)
    if en in MODULES:
        number = en.parent.name[:2]
        assert re.match(rf"# Módulo {number}: ", b), "the title says which module it is: '# Módulo NN: ...'"
    else:
        assert b.startswith("# "), "a page starts with its title"
    assert first_number_after("Tiempo", b) == first_number_after("Time", a), "the time differs from the English page"
    for label in ("Objetivo", "Tiempo"):
        assert f"**{label}:**" in b


def test_the_total_and_the_time_per_module_in_the_spanish_readme_are_the_english_ones():
    english = table_minutes()
    spanish = dict(re.findall(r"^\|\s*(\d\d)\s*\|.*\|\s*(\d+)\s*min", text_of(ROOT / "README.es.md"), flags=re.M))
    assert {k: int(v) for k, v in spanish.items()} == english
    for en, es in PAIRS[1:12]:
        assert first_number_after("Tiempo", text_of(es)) == header_minutes(en)


def test_the_two_readmes_point_at_each_other():
    assert "(README.es.md)" in text_of(ROOT / "README.md"), "the English README must link to the Spanish one"
    assert "(README.md)" in text_of(ROOT / "README.es.md"), "the Spanish README must link to the English one"


# The register: neutral Latin American Spanish, informal "tú". Words that give away another one.
WRONG_REGISTER = re.compile(r"\b(?:usted(?:es)?|vos|vosotros|ordenador(?:es)?|coger|cogemos|tenés|querés|podés|hacé|abrí|ejecutá)\b", re.I)
# Words that only English has, in prose: a few are fine (a quoted message), a paragraph left untranslated is not.
ENGLISH_ONLY = re.compile(r"\b(?:the|and|you|your|with|this|that|which|from|when|are|will|have|does|not|can|then)\b")


@pytest.mark.parametrize("en, es", PAIRS, ids=IDS)
def test_the_spanish_is_latin_american_and_informal(en, es):
    found = WRONG_REGISTER.findall(prose_of(text_of(es)))
    assert not found, f"another register (use 'tú', Latin American words): {sorted(set(found))}"


@pytest.mark.parametrize("en, es", PAIRS, ids=IDS)
def test_no_paragraph_was_left_in_english(en, es):
    prose = prose_of(text_of(es))
    quoted = re.findall(r'"[^"\n]+"|\*\*[^*\n]+\*\*', prose)       # a quoted message or a bold console label can be English
    for q in quoted:
        prose = prose.replace(q, " ")
    words = ENGLISH_ONLY.findall(prose.lower())
    assert len(words) <= 6, f"looks partly untranslated ({len(words)} English function words): {Counter(words).most_common(5)}"
