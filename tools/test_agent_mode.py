"""Agent mode stays in step with the repository it drives: everything the guide's texts name exists.

The playbooks in agent-mode/ and the rulebook AGENTS.md are prose, so nothing else notices when a `make` target is renamed, a check
is removed or an example query is renumbered. This does: it reads them the way an agent would and checks every command, file and
numbered query they name, and that each playbook has the sections the guide relies on.
"""

import json
import re

import pytest

import query
import seed_postgres

ROOT = seed_postgres.ROOT
AGENT_MODE = ROOT / "agent-mode"
AGENTS_MD = ROOT / "AGENTS.md"
pytestmark = pytest.mark.skipif(not AGENTS_MD.exists(), reason="the repo is not mounted")

PLAYBOOKS = sorted(AGENT_MODE.glob("[0-9][0-9]-*.md"))
TAGS = {"AGENT RUNS", "PARTICIPANT DOES — console", "EXPLAIN"}
SECTIONS = ["## Preconditions", "## Steps", "## Talking points", "## Checkpoint", "## Failure playbook", "## Fast track", "## Exit criteria"]
# Commands that open a prompt or follow forever: right for a person, useless to an agent without a terminal.
NEEDS_A_TERMINAL = {"psql", "ch-client", "notebook", "logs"}
# Paths a participant creates on their machine: named in the texts, never in the repository.
CREATED_BY_THE_PARTICIPANT = {"assets/certs/ca-certificate.pem"}
# Written for the participant, used by both modes: the agent a participant builds in module 09.
SHARED_ASSETS = "workshop/09-clickhouse-agents/agents/"
PATH_ROOTS = ("workshop", "sql", "deploy", "scripts", "tools", "docs", "agent-mode", "assets", "notebooks", ".claude", "frontend", "data-generators")


def text_of(path):
    return path.read_text()


def code_segments(text):
    """The fenced blocks and the inline code spans of a markdown text: where commands and paths are written."""
    segments = re.findall(r"```[a-z]*\n(.*?)```", text, flags=re.S)
    return segments + re.findall(r"`([^`\n]+)`", re.sub(r"```.*?```", "", text, flags=re.S))


def make_targets():
    return set(re.findall(r"^([A-Za-z0-9_.-]+)\s*:(?!=)", text_of(ROOT / "Makefile"), flags=re.M))


def mentioned_make_targets(text):
    """The targets named after a `make` that starts a command: `make cluster images secrets app` names four.

    The words stop at the first one that is not a plain target name (`Q=...`, `check-NN`, a pipe), and a `make` that is
    only a word in a list (`command -v make git`) is not a command.
    """
    found = []
    for segment in code_segments(text):
        for line in segment.splitlines():
            for rest in re.findall(r"(?:^|[;&|(]\s*|\$\s+)make\b(.*)", line):
                for word in rest.split():
                    if not re.fullmatch(r"[a-z][a-z0-9-]*", word):
                        break
                    found.append(word)
    return found


def everything_agent_facing():
    return [AGENTS_MD, AGENT_MODE / "README.md", *PLAYBOOKS, ROOT / ".claude" / "commands" / "workshop.md"]


def test_there_is_a_playbook_for_every_module():
    assert [p.name[:2] for p in PLAYBOOKS] == [f"{n:02d}" for n in range(11)]


def test_claude_md_just_points_at_agents_md():
    assert text_of(ROOT / "CLAUDE.md").strip() == "@AGENTS.md"


def test_the_slash_command_starts_the_guide():
    command = text_of(ROOT / ".claude" / "commands" / "workshop.md")
    assert command.startswith("---\ndescription:") and "AGENTS.md" in command and "agent-mode/README.md" in command


def test_the_root_readme_points_at_agent_mode():
    readme = text_of(ROOT / "README.md")
    assert "AGENTS.md" in readme and "agent-mode/README.md" in readme


@pytest.mark.parametrize("playbook", PLAYBOOKS, ids=lambda p: p.name)
def test_a_playbook_has_the_sections_the_guide_relies_on(playbook):
    text = text_of(playbook)
    assert re.match(rf"# Module {playbook.name[:2]}: .+\(agent playbook", text), "the title says which module it is"
    for label in ("**Objective:**", "**Step ids:**", "**Time:**"):
        assert label in text, f"{label} is missing"
    positions = [text.find(f"\n{section}\n") for section in SECTIONS]
    assert all(p >= 0 for p in positions), f"missing section: {[s for s, p in zip(SECTIONS, positions) if p < 0]}"
    assert positions == sorted(positions), "the sections are out of order"
    exit_section = text[positions[-1]:]
    assert "progress file" in exit_section, "the exit criteria must say what to record"


@pytest.mark.parametrize("playbook", PLAYBOOKS, ids=lambda p: p.name)
def test_steps_are_numbered_tagged_and_match_the_listed_ids(playbook):
    text = text_of(playbook)
    heads = re.findall(r"^### (\d+)\. `([^`]+)` (.+)$", text, flags=re.M)
    assert heads, "no steps"
    assert [int(n) for n, _, _ in heads] == list(range(1, len(heads) + 1)), "steps must be numbered 1..n"
    ids = [i for _, i, _ in heads]
    assert len(set(ids)) == len(ids) and all(re.fullmatch(r"[a-z][a-z0-9-]*", i) for i in ids), "step ids: unique, kebab-case"
    for _, step, rest in heads:
        tags = re.findall(r"\[([^\]]+)\]", rest)
        assert tags and set(tags) <= TAGS, f"{step}: every step carries a tag from {sorted(TAGS)}"
    listed = re.search(r"\*\*Step ids:\*\*(.+)", text).group(1)
    assert set(re.findall(r"`([^`]+)`", listed)) == set(ids), "the Step ids line must list exactly the steps"


@pytest.mark.parametrize("path", everything_agent_facing(), ids=lambda p: p.name)
def test_every_make_target_named_exists(path):
    targets = make_targets()
    for name in mentioned_make_targets(text_of(path)):
        if name.startswith("check-"):                  # the Makefile's check-% pattern: scripts/checks/<name>.sh
            assert (ROOT / "scripts" / "checks" / f"{name}.sh").exists(), f"`make {name}`: no such check"
        else:
            assert name in targets, f"`make {name}` is not in the Makefile"


@pytest.mark.parametrize("path", everything_agent_facing(), ids=lambda p: p.name)
def test_every_repo_path_named_exists(path):
    for segment in code_segments(text_of(path)):
        for line in segment.splitlines():
            if "kubectl" in line:                       # `logs deploy/frontend` is a Kubernetes name, not a path
                line = re.sub(r"(?<![\w/])deploy/(?!bin/)[A-Za-z0-9-]+\b", " ", line)
            for token in re.findall(r"[A-Za-z0-9_.-]+(?:/[A-Za-z0-9_.*<>-]+)+/?", line):
                if token.split("/")[0] not in PATH_ROOTS or "*" in token or "<" in token or "NN" in token:
                    continue
                if token in CREATED_BY_THE_PARTICIPANT:
                    continue
                assert (ROOT / token.rstrip("/")).exists(), f"{token} does not exist"


@pytest.mark.parametrize("path", everything_agent_facing(), ids=lambda p: p.name)
def test_every_numbered_example_query_named_exists(path):
    text = text_of(path)
    for file, number in re.findall(r"FILE=(\S+)\s+N=(\d+)", text):
        sections = query.numbered_sections(text_of(ROOT / file))
        assert int(number) in sections, f"{file} has no query numbered {number}"


@pytest.mark.parametrize("playbook", PLAYBOOKS, ids=lambda p: p.name)
def test_a_playbook_never_tells_the_agent_to_run_what_needs_a_terminal(playbook):
    named = set(mentioned_make_targets(text_of(playbook)))
    assert not (named & NEEDS_A_TERMINAL), f"use make ch-query / pg-query and kubectl logs instead: {sorted(named & NEEDS_A_TERMINAL)}"


@pytest.mark.parametrize("playbook", PLAYBOOKS, ids=lambda p: p.name)
def test_a_playbook_is_its_own_source_and_does_not_send_the_agent_to_the_human_modules(playbook):
    text = text_of(playbook)
    # The shared agent assets (the agent's instructions and questions) live next to module 09; nothing else under workshop/ is read.
    named = [m for m in re.findall(r"(?<![\w.])workshop/[^\s`)\"']*", text) if not m.startswith(SHARED_ASSETS)]
    assert not named, f"agent mode does not read the human modules (.workshop/ is the progress folder): {named}"


@pytest.mark.parametrize("playbook", [p for p in PLAYBOOKS if not p.name.startswith("09")], ids=lambda p: p.name)
def test_a_playbook_ends_in_its_own_check(playbook):
    number = playbook.name[:2]
    checkpoint = text_of(playbook).split("\n## Checkpoint\n")[1].split("\n## ")[0]
    wanted = {"01": ["check-01", "check-02"]}.get(number, [f"check-{number}"])
    section_steps = text_of(playbook)
    for check in wanted:
        assert f"make {check}" in section_steps, f"{playbook.name} never runs `make {check}`"
    assert checkpoint.strip(), "the checkpoint says what a pass looks like"


def test_agents_md_lists_every_destructive_command_under_ask_first():
    rules = text_of(AGENTS_MD).split("### Ask first")[1].split("\n## ")[0]
    for command in ("make down", "make nuke-data", "make pg-reset", "make clickpipes-delete", "FORCE=1", "rm .env", "make break-card-gateway"):
        assert command in rules, f"{command} must be in the ask-first table"


def test_agents_md_keeps_the_golden_rules_the_workshop_depends_on():
    text = text_of(AGENTS_MD)
    for must in ("make doctor", "[PARTICIPANT DOES — console]", "make check-NN", "paste a secret", "retail_otel", "make ch-query", "make pg-query"):
        assert must in text, f"AGENTS.md lost: {must}"


def test_the_fast_track_is_the_default_and_nobody_is_made_to_choose_first():
    for name, text in (("AGENTS.md", text_of(AGENTS_MD)), ("agent-mode/README.md", text_of(AGENT_MODE / "README.md")),
                       (".claude/commands/workshop.md", text_of(ROOT / ".claude" / "commands" / "workshop.md"))):
        assert "fast track" in text and "default" in text, f"{name} must say the fast track is the default"
        assert "ask one question" not in text and "Ask once" not in text, f"{name} still asks which track"


def test_the_guide_asks_for_the_language_once_and_remembers_it():
    """Spanish and English participants are both guided in their own language, and the answer outlives the session."""
    agents = text_of(AGENTS_MD)
    start = agents.split("## Start or resume")[1].split("## Golden rules")[0]
    assert "which language" in start and "English" in start and "Spanish" in start, "AGENTS.md must ask for the language when it starts"
    for name, text in (("AGENTS.md", agents), ("agent-mode/README.md", text_of(AGENT_MODE / "README.md")),
                       (".claude/commands/workshop.md", text_of(ROOT / ".claude" / "commands" / "workshop.md"))):
        assert "notes.language" in text, f"{name} must say that the language is recorded in the progress file"
    assert "the track is not part of it" in start, "the language is the only question asked first: the track still is not"


def test_claude_code_is_denied_the_env_file_but_not_its_template():
    settings = json.loads(text_of(ROOT / ".claude" / "settings.json"))
    deny = settings["permissions"]["deny"]
    assert "Read(./.env)" in deny, "reading .env must be denied"
    # Read(./.env.*) would also match .env.example, the template the agent and the participant do read.
    assert not [rule for rule in deny if re.search(r"\.env[.*?\[]", rule)], f"a deny rule that could match .env.example: {deny}"
    assert "allow" not in settings["permissions"], "the committed settings only restrict"
    assert set(settings) == {"permissions"}, "nothing else (sandbox, hooks, MCP) rides along in the committed settings"


def test_the_progress_file_example_is_valid_json_with_known_statuses():
    readme = text_of(AGENT_MODE / "README.md")
    block = re.search(r"```json\n(.*?)```", readme, flags=re.S).group(1)
    progress = json.loads(block)
    assert progress["version"] == 1 and progress["track"] in {"fast", "guided"}
    assert {m["status"] for m in progress["modules"].values()} <= {"not_started", "in_progress", "done", "skipped"}
    assert set(progress["modules"]) <= {p.name[:2] for p in PLAYBOOKS}
