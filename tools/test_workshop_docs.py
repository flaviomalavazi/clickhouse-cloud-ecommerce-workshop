"""The human guide stays true to the repository it describes (no network).

Agent mode has had this since Phase 8 (test_agent_mode.py); the modules a participant reads deserve the same. A participant who types a
command from a README and gets "No rule to make target", or follows a link that is dead, loses trust in everything after it.
"""

import re

import pytest

from test_agent_mode import CREATED_BY_THE_PARTICIPANT, PATH_ROOTS, ROOT, code_segments, make_targets, mentioned_make_targets

pytestmark = pytest.mark.skipif(not (ROOT / "workshop").exists(), reason="the repo is not mounted")

MODULES = sorted((ROOT / "workshop" / "en").glob("[0-9][0-9]-*/README.md"))
GUIDE = [ROOT / "README.md", ROOT / "COMMANDS.md", ROOT / "workshop" / "FACILITATOR.md", ROOT / "docs" / "architecture.md", ROOT / "workshop" / "en" / "09-clickhouse-agents" / "langfuse.md", *MODULES]


def text_of(path):
    return path.read_text()


def missing_paths(text: str) -> list[str]:
    out = []
    for segment in code_segments(text):
        for line in segment.splitlines():
            if "kubectl" in line:                       # `logs deploy/frontend` is a Kubernetes name, not a path
                line = re.sub(r"(?<![\w/])deploy/(?!bin/)[A-Za-z0-9-]+\b", " ", line)
            for token in re.findall(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.*<>-]+)+/?", line):
                if token.split("/")[0] not in PATH_ROOTS or "*" in token or "<" in token or "NN" in token or token in CREATED_BY_THE_PARTICIPANT:
                    continue
                if not (ROOT / token.rstrip("/")).exists():
                    out.append(token)
    return out


def test_every_module_is_there_in_order():
    assert [p.parent.name[:2] for p in MODULES] == [f"{n:02d}" for n in range(11)]


@pytest.mark.parametrize("path", GUIDE, ids=lambda p: p.relative_to(ROOT).as_posix())
def test_every_make_target_the_guide_names_exists(path):
    targets = make_targets()
    for name in mentioned_make_targets(text_of(path)):
        if name.startswith("check-"):
            assert (ROOT / "scripts" / "checks" / f"{name}.sh").exists(), f"`make {name}`: no such check"
        else:
            assert name in targets, f"`make {name}` is not in the Makefile"


@pytest.mark.parametrize("path", GUIDE, ids=lambda p: p.relative_to(ROOT).as_posix())
def test_every_repo_path_the_guide_names_exists(path):
    assert not missing_paths(text_of(path)), f"paths that do not exist: {missing_paths(text_of(path))}"


@pytest.mark.parametrize("path", GUIDE, ids=lambda p: p.relative_to(ROOT).as_posix())
def test_every_relative_link_resolves(path):
    for target in re.findall(r"\]\(([^)\s]+)\)", text_of(path)):
        if re.match(r"[a-z]+:", target) or target.startswith("#"):
            continue
        assert (path.parent / target.split("#")[0]).exists(), f"{path.name}: dead link {target}"


@pytest.mark.parametrize("path", MODULES, ids=lambda p: p.parent.name)
def test_a_module_has_the_parts_a_participant_relies_on(path):
    text = text_of(path)
    number = path.parent.name[:2]
    assert re.match(rf"# Module {number}: ", text), "the title says which module it is"
    for part in ("**Goal:**", "**Time:**", "\n## Checkpoint\n", "\n## Troubleshooting\n"):
        assert part in text, f"missing {part.strip()}"
    if number != "10":
        assert "**Next:**" in text, "a module says where to go next"


def header_minutes(path) -> int:
    return int(re.search(r"\*\*Time:\*\*\s+about\s+(\d+)\s+minute", text_of(path)).group(1))


def table_minutes() -> dict[str, int]:
    rows = re.findall(r"^\|\s*(\d\d)\s*\|.*\|\s*(\d+)\s*min", text_of(ROOT / "README.md"), flags=re.M)
    return {number: int(minutes) for number, minutes in rows}


def test_the_time_in_each_module_header_is_the_time_in_the_readme_table():
    table = table_minutes()
    assert sorted(table) == [f"{n:02d}" for n in range(11)], "every module has a time in README.md"
    for path in MODULES:
        number = path.parent.name[:2]
        assert header_minutes(path) == table[number], f"module {number}: header says {header_minutes(path)} min, the README table {table[number]}"


@pytest.mark.parametrize("path", [ROOT / "README.md", ROOT / "AGENTS.md", ROOT / "agent-mode" / "README.md"], ids=lambda p: p.name)
def test_the_total_time_stated_matches_the_modules(path):
    total = sum(table_minutes().values())
    expected = "four hours" if 225 <= total <= 255 else None
    assert expected, f"the modules add up to {total} minutes: the total in README.md, AGENTS.md and agent-mode/README.md needs a new wording and this test a new range"
    assert f"about {expected}" in text_of(path).lower() or f"about {expected}" in text_of(path), f"{path.name} should say 'about {expected}' (the modules add up to {total} minutes)"
