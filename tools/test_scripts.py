"""The shell scripts run on a participant's laptop, and on a Mac that is bash 3.2.

The unit tests run in a Linux container with a current bash, so a script that only breaks on bash 3.2 passes every test and then
fails on the first command of the workshop. This reads the scripts instead.

  * Under `set -u`, bash 3.2 treats the expansion of an EMPTY array as an unbound variable (fixed in 4.4). `net_flags` in
    deploy/bin/_env.sh is empty until the cluster's network exists, which is every first run: `make prefetch` failed on it.
  * bash 4 features (associative arrays, mapfile, case-changing expansions, ...) do not exist in 3.2.
"""

import re

import pytest

import seed_postgres

ROOT = seed_postgres.ROOT
pytestmark = pytest.mark.skipif(not (ROOT / "deploy" / "bin").exists(), reason="the repo is not mounted")

BASH_4_ONLY = [
    (r"declare\s+-A", "associative arrays"),
    (r"\bmapfile\b|\breadarray\b", "mapfile / readarray"),
    (r"\$\{[A-Za-z_]\w*(?:,,|\^\^|,|\^)\}", "case-changing expansion"),
    (r"&>>|\|&", "&>> or |&"),
    (r"\[\[\s+-v\s", "[[ -v var ]]"),
    (r"\bcoproc\b", "coproc"),
]


def shell_scripts():
    paths = [p for p in (ROOT / "deploy" / "bin").iterdir() if p.is_file()]
    paths += list((ROOT / "deploy").glob("*.sh")) + list((ROOT / "scripts").rglob("*.sh"))
    return sorted(paths)


def arrays_that_start_empty(text: str) -> set[str]:
    return set(re.findall(r"^\s*(?:local\s+)?(\w+)=\(\)", text, flags=re.M))


def unsafe_expansions(text: str, names: set[str]) -> list[str]:
    """Expansions of an array that may be empty, other than the 3.2-safe form `${a[@]+"${a[@]}"}`."""
    bad = []
    for name in sorted(names):
        safe = re.escape('${' + name + '[@]+"${' + name + '[@]}"}')
        without_safe = re.sub(safe, "", text)
        bad += re.findall(r"\$\{" + name + r"\[@\]\}", without_safe)
    return bad


def test_the_detector_tells_the_safe_form_from_the_unsafe_one():
    unsafe = 'x=()\nexec docker run "${x[@]}" y\n'
    safe = 'x=()\nexec docker run ${x[@]+"${x[@]}"} y\n'
    assert unsafe_expansions(unsafe, arrays_that_start_empty(unsafe))
    assert not unsafe_expansions(safe, arrays_that_start_empty(safe))


def test_the_wrappers_expand_net_flags_safely_because_it_is_empty_before_the_cluster_exists():
    env = (ROOT / "deploy" / "bin" / "_env.sh").read_text()
    names = arrays_that_start_empty(env)
    assert "net_flags" in names, "if net_flags is no longer empty at first, this test and the wrappers can be simplified"
    for wrapper in (ROOT / "deploy" / "bin").iterdir():
        if wrapper.name == "_env.sh" or not wrapper.is_file():
            continue
        assert not unsafe_expansions(wrapper.read_text(), names), f"{wrapper.name} expands an empty array unsafely: breaks on macOS bash 3.2"


@pytest.mark.parametrize("script", shell_scripts(), ids=lambda p: p.relative_to(ROOT).as_posix() if p.is_absolute() else str(p))
def test_a_script_uses_nothing_bash_3_2_lacks(script):
    text = script.read_text()
    for pattern, what in BASH_4_ONLY:
        assert not re.search(pattern, text), f"{script.name} uses {what}, which macOS's bash 3.2 does not have"


# ── the Makefile: a command that needs the cluster says so, in one line ──────────────────────────────────────────

NEEDS_THE_CLUSTER = ("$(KUBECTL)", "$(HELM)", "deploy/images.sh", "deploy/secrets.sh", "deploy/bin/kubectl")
# Targets that create it, remove it, report on it, or only prefetch; the guards themselves.
EXEMPT = {"cluster": "creates it", "down": "says the cluster does not exist", "status": "prints 'no cluster: run make cluster'",
          "prefetch": "builds and downloads, needs no cluster", "need-cluster": "the guard", "need-app": "the guard"}
# `if $(APP_UP) ...; else nothing to stop`: a stop command succeeds when there is nothing to stop.
STOP_COMMANDS = {"generators-stop", "sim-stop", "traffic-stop"}


def makefile_rules() -> dict[str, tuple[list[str], str]]:
    """{target: (prerequisites, recipe)} for the plain targets of the Makefile."""
    rules, current = {}, None
    for line in (ROOT / "Makefile").read_text().splitlines():
        head = re.match(r"^([A-Za-z0-9_.-]+)\s*:(?!=)\s*([^#]*)", line)
        if head and not line.startswith("\t"):
            current = head.group(1)
            rules[current] = (head.group(2).split(), "")
        elif line.startswith("\t") and current:
            rules[current] = (rules[current][0], rules[current][1] + line + "\n")
        elif line.strip() and not line.startswith("#"):
            current = None
    return rules


def closure(target: str, rules: dict, seen=None) -> set[str]:
    seen = seen if seen is not None else set()
    for prerequisite in rules.get(target, ([], ""))[0]:
        if prerequisite not in seen:
            seen.add(prerequisite)
            closure(prerequisite, rules, seen)
    return seen


def test_every_target_that_needs_the_cluster_checks_for_it_first():
    rules = makefile_rules()
    assert "sim-start" in rules and "need-cluster" in rules, "the Makefile parser found nothing"
    unguarded = []
    for name, (_, recipe) in rules.items():
        if name in EXEMPT or name in STOP_COMMANDS or not any(marker in recipe for marker in NEEDS_THE_CLUSTER):
            continue
        if not ({"need-cluster", "need-app"} & closure(name, rules)):
            unguarded.append(name)
    assert not unguarded, f"these targets use the cluster without need-cluster or need-app (a participant gets a kubectl error about localhost:8080): {unguarded}"


def test_the_stop_commands_succeed_when_there_is_nothing_to_stop():
    rules = makefile_rules()
    for name in STOP_COMMANDS:
        assert "$(APP_UP)" in rules[name][1] and "nothing to stop" in rules[name][1], f"make {name} must not fail when the application is not running"


def test_the_guards_say_what_to_run():
    recipe_cluster, recipe_app = makefile_rules()["need-cluster"][1], makefile_rules()["need-app"][1]
    assert "make up" in recipe_cluster and "make setup" in recipe_cluster
    assert "make up" in recipe_app


def test_the_check_scripts_stop_with_one_line_when_there_is_no_cluster():
    lib = (ROOT / "scripts" / "checks" / "lib.sh").read_text()
    assert "need_cluster()" in lib and "make up" in lib
    for number in ("05", "06"):
        assert "need_cluster" in (ROOT / "scripts" / "checks" / f"check-{number}.sh").read_text(), f"check-{number} must call need_cluster"


def test_the_one_command_starts_run_what_their_long_forms_run():
    rules = makefile_rules()
    up, traffic, start = (rules[n][1] for n in ("up", "traffic-start", "start"))
    assert "cluster images secrets app" in up, "make up is make cluster images secrets app"
    assert "generators-start sim-start" in traffic, "make traffic-start starts both kinds of load"
    assert "up traffic-start" in start, "make start is make up, then make traffic-start"
    assert "need-app" in rules["traffic-start"][0], "starting the load without the application should fail with one line"
    # The existing long forms keep working: the modules still teach them one by one.
    for name in ("cluster", "images", "secrets", "app", "generators-start", "sim-start", "traffic-stop"):
        assert name in rules


# ── docker build, without Docker's "legacy builder is deprecated" notice ─────────────────────────────────────────

STUB_DOCKER = """#!/bin/sh
printf 'DEPRECATED: The legacy builder is deprecated and will be removed in a future release.\\n' >&2
printf '            Install the buildx component to build images with BuildKit:\\n' >&2
printf '            https://docs.docker.com/go/buildx/\\n\\n' >&2
case "$STUB_MODE" in
  ok)   echo sha256:abc123 ;;
  warn) echo "WARNING: something that is the build's own" >&2; echo sha256:abc123 ;;
  fail) echo "ERROR: failed to solve: the Dockerfile is wrong" >&2; exit 3 ;;
esac
"""


def run_build_helper(tmp_path, mode):
    import os
    import subprocess

    stub = tmp_path / "docker"
    stub.write_text(STUB_DOCKER)
    stub.chmod(0o755)
    env = {**os.environ, "PATH": f"{tmp_path}:{os.environ['PATH']}", "STUB_MODE": mode, "TMPDIR": str(tmp_path)}
    return subprocess.run(["bash", str(ROOT / "scripts" / "docker-build.sh"), "-q", "-t", "x", "."], capture_output=True, text=True, env=env)


def test_the_build_helper_hides_the_legacy_builder_notice_and_nothing_else(tmp_path):
    ok = run_build_helper(tmp_path, "ok")
    assert (ok.returncode, ok.stdout.strip(), ok.stderr) == (0, "sha256:abc123", ""), "a good build prints its image id and nothing on stderr"
    warn = run_build_helper(tmp_path, "warn")
    assert warn.returncode == 0 and "legacy builder" not in warn.stderr
    assert "something that is the build's own" in warn.stderr, "a warning of the build itself is kept"


def test_a_failing_build_keeps_its_error_and_its_exit_status(tmp_path):
    fail = run_build_helper(tmp_path, "fail")
    assert fail.returncode == 3, "the exit status is Docker's"
    assert "failed to solve" in fail.stderr and "legacy builder" not in fail.stderr


def test_nothing_calls_docker_build_directly():
    """Every image build goes through scripts/docker-build.sh, or the notice comes back on every `make up`."""
    offenders = []
    for path in [ROOT / "Makefile", *shell_scripts()]:
        if path.name == "docker-build.sh":
            continue
        for number, line in enumerate(path.read_text().splitlines(), 1):
            if re.search(r"\bdocker build\b", line) and not line.lstrip().startswith("#"):
                offenders.append(f"{path.relative_to(ROOT)}:{number}")
    assert not offenders, f"call scripts/docker-build.sh instead of docker build: {offenders}"
