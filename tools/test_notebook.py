"""The ClickPipe notebook stays in step with the code it calls (it needs credentials to run, so this checks its shape)."""

import ast
import inspect
import json

import pytest

import clickpipes
import cloud_api
import nuke_data
import seed_postgres

NOTEBOOK = seed_postgres.ROOT / "notebooks" / "01_create_clickpipes.ipynb"
pytestmark = pytest.mark.skipif(not NOTEBOOK.exists(), reason="the repo is not mounted")


def code_cells():
    nb = json.loads(NOTEBOOK.read_text())
    assert nb["nbformat"] == 4
    return ["".join(c["source"]) for c in nb["cells"] if c["cell_type"] == "code"]


def test_every_code_cell_is_valid_python():
    for source in code_cells():
        ast.parse(source)


def test_the_notebook_never_prints_a_secret():
    text = "\n".join(code_cells())
    assert "redacted(" in text, "the request must be shown through redacted()"
    assert "print(os.environ" not in text and "print(payload)" not in text


def test_what_the_notebook_calls_exists():
    modules = {"clickpipes": clickpipes, "cloud_api": cloud_api, "nuke_data": nuke_data, "seed_postgres": seed_postgres}
    text = "\n".join(code_cells())
    for name in ("payload_from_env", "redacted", "create_pipe", "wait_until_running", "wait_for_mirror", "pipes_path", "TABLES"):
        assert hasattr(clickpipes, name) and f"clickpipes.{name}" in text, name
    for name in ("context_from_env",):
        assert hasattr(cloud_api, name) and name in text
    for name in ("clickhouse_counts", "postgres_counts"):
        assert hasattr(nuke_data, name) and name in text
    assert "schema_only" in inspect.signature(seed_postgres.run).parameters and "seed_postgres.run(schema_only=True)" in text
    assert modules  # imported above, so the notebook's imports resolve


def test_the_order_is_migrate_then_pipe_then_seed():
    text = "\n".join(code_cells())
    assert text.index("schema_only=True") < text.index("create_pipe(") < text.index("seed_postgres.run()")
