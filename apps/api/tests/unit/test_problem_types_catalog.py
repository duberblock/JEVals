import ast
import json
from pathlib import Path

APP_ROOT = Path(__file__).resolve().parents[2] / "app"
CATALOG_PATH = Path(__file__).resolve().parents[4] / "packages" / "contracts" / "problem-types.json"


def _problem_type_literals() -> set[str]:
    """Collect every problem_type slug literally referenced in app/ source.

    Two shapes exist: `problem_response(..., problem_type="slug")` call
    keywords, and the conditional assignment feeding the shared
    HTTPException handler (`problem_type = "not-found" if ... else
    "http-error"`).
    """
    slugs: set[str] = set()
    for path in sorted(APP_ROOT.rglob("*.py")):
        tree = ast.parse(path.read_text())
        for node in ast.walk(tree):
            if isinstance(node, ast.Call):
                for keyword in node.keywords:
                    if keyword.arg == "problem_type" and isinstance(keyword.value, ast.Constant):
                        slugs.add(keyword.value.value)
            elif isinstance(node, ast.Assign):
                if any(
                    isinstance(target, ast.Name) and target.id == "problem_type"
                    for target in node.targets
                ):
                    for sub in ast.walk(node.value):
                        if isinstance(sub, ast.Constant) and isinstance(sub.value, str):
                            slugs.add(sub.value)
    return slugs


def test_every_problem_type_literal_is_registered_in_the_contracts_catalog():
    # ADR-006 Decision 3: packages/contracts/problem-types.json is the single
    # place pinning the problem taxonomy. Every slug the API can emit must be
    # registered there so the taxonomy cannot drift silently. Routes are NOT
    # refactored to consume it at runtime (that is fix-forward); this test is
    # the pin.
    catalog = json.loads(CATALOG_PATH.read_text())
    slugs = _problem_type_literals()

    assert slugs  # the scan must find the emitters for the pin to be meaningful
    missing = slugs - set(catalog)
    assert not missing, f"problem types missing from {CATALOG_PATH}: {sorted(missing)}"


def test_catalog_entries_carry_title_and_fixed_status_metadata():
    catalog = json.loads(CATALOG_PATH.read_text())

    for slug, metadata in catalog.items():
        assert isinstance(metadata["title"], str) and metadata["title"], slug
        # status is the fixed HTTP status when one exists (null otherwise,
        # e.g. the shared http-error handler whose status varies per raise).
        assert metadata["status"] is None or isinstance(metadata["status"], int), slug


def test_catalog_registers_the_web_proxy_synthetic_problem_type():
    # The web proxy's api-unreachable problem (its upstream 502) is part of
    # the shared taxonomy even though apps/api never emits it itself.
    catalog = json.loads(CATALOG_PATH.read_text())

    assert "api-unreachable" in catalog


def test_catalog_carries_no_dead_entries():
    # F8: the catalog must not outlive its emitters. Every entry is either a
    # slug the API literally emits or an explicitly registered synthetic
    # (the web proxy's api-unreachable). `not-implemented` lost its last
    # emitter when STEP 6 removed the final 501s and was deleted; if a later
    # phase reintroduces 501s, the forward test above catches the missing
    # registration — that is the designed safety net.
    catalog = json.loads(CATALOG_PATH.read_text())

    dead = set(catalog) - _problem_type_literals() - {"api-unreachable"}
    assert not dead, f"catalog entries nothing emits: {sorted(dead)}"
