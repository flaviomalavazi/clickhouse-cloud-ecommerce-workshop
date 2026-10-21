"""No password-shaped literal in tests, docs, notebooks or examples.

GitGuardian flags them on the pull request (it flagged a fixture password in `tools/test_clickpipes.py`). Tests build fake
credentials at run time instead (`secrets.token_hex(8)`), and never write a password into the source. Words that are plainly not credentials
(`"key"`, `"secret"`, `<password>`, `your-password`, `********`) are fine: a literal counts only when it mixes letters with
digits or symbols, the way a real password does.
"""

import re

import pytest

import seed_postgres

ROOT = seed_postgres.ROOT
pytestmark = pytest.mark.skipif(not (ROOT / "AGENTS.md").exists(), reason="the repo is not mounted")

# The one that GitGuardian already flagged (commit de9c934); the owner accepted it. Do not copy it, and do not add to this list.
ACCEPTED = {"tools/test_clickpipes.py"}

NAME = r"(?:password|passwd|pwd|secret|token|api_?key)"
QUOTED = re.compile(rf"""(?i)\b[\w.]*{NAME}\w*["']?\s*[=:]\s*["']([^"'\s]{{6,}})["']""")
UNQUOTED = re.compile(r"(?m)^\s*[A-Z0-9_]*(?:PASSWORD|PASSWD|PWD|SECRET|TOKEN|API_?KEY)[A-Z0-9_]*=([^\s#]{8,})")   # .env style: upper case


def looks_like_a_secret(value: str) -> bool:
    """Letters mixed with digits or symbols, and not a reference (`$VAR`, `<password>`, `{x}`) or a mask (`****`)."""
    value = value.strip("\"'")
    if not value or value[0] in "$<{%@" or set(value) <= set("*•.x-_"):
        return False
    return bool(re.search(r"[A-Za-z]", value)) and bool(re.search(r"[0-9!#$%^&*+=?]", value))


def literals_in(text: str) -> list[str]:
    return [v for rx in (QUOTED, UNQUOTED) for v in rx.findall(text) if looks_like_a_secret(v)]


def files_to_scan():
    skip = ("node_modules", "/.git/", "/base_contents/", "/.workshop/", "/.next/", "/assets/certs/")
    patterns = ["**/test_*.py", "**/*_test.py", "**/tests/**/*.py", "**/*.md", "notebooks/*.ipynb", ".env.example", "deploy/**/*.yaml", "scripts/**/*.sh"]
    seen = set()
    for pattern in patterns:
        for path in ROOT.glob(pattern):
            rel = "/" + path.relative_to(ROOT).as_posix()
            if path.is_file() and not any(s in rel for s in skip):
                seen.add(path)
    return sorted(seen)


# Built from parts so that this file holds no password-shaped literal itself.
SHAPED = "ab" + "12" * 3


@pytest.mark.parametrize("text", [
    f'password="{SHAPED}"', f"PGPASSWORD={SHAPED}", f"api_key: '{SHAPED}'", f'token = "{SHAPED}!"', f"dict(secret='{SHAPED}')",
])
def test_the_detector_sees_password_shaped_literals(text):
    assert literals_in(text)


@pytest.mark.parametrize("text", [
    'CloudAPI("key", "secret")', "PGPASSWORD=", "CLICKHOUSE_PASSWORD=<your password>", "password=********", 'password="your-password"',
    "CLICKHOUSE_CLOUD_API_KEY_SECRET=...", 'secret = os.environ["X"]', 'token="$TOKEN"', "api_key=${KEY}", 'PGPASSWORD="••••••••"',
    '"password": "********"',
])
def test_the_detector_leaves_placeholders_and_references_alone(text):
    assert not literals_in(text)


def test_nothing_new_has_a_password_shaped_literal():
    found = {}
    for path in files_to_scan():
        rel = path.relative_to(ROOT).as_posix()
        if rel in ACCEPTED:
            continue
        hits = literals_in(path.read_text(errors="ignore"))
        if hits:
            found[rel] = len(hits)
    assert not found, f"password-shaped literals (generate fake ones at run time): {found}"


def test_the_accepted_exception_is_still_the_only_one_and_still_needed():
    """If the accepted fixture is fixed one day, take it off the list instead of keeping a blind spot."""
    text = (ROOT / "tools" / "test_clickpipes.py").read_text()
    assert literals_in(text), "tools/test_clickpipes.py no longer has a literal: remove it from ACCEPTED"
