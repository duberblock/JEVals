from __future__ import annotations

import ast
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[2] / "app"
PERSISTENCE_PACKAGE = "app.persistence"
ALLOWED_PERSISTENCE_ROOT = APP_ROOT / "persistence"
COMPOSITION_ROOT = APP_ROOT / "api" / "dependencies.py"


def _app_python_files() -> list[Path]:
    return sorted(path for path in APP_ROOT.rglob("*.py") if "__pycache__" not in path.parts)


def _is_allowed_persistence_importer(path: Path) -> bool:
    return path.is_relative_to(ALLOWED_PERSISTENCE_ROOT) or path == COMPOSITION_ROOT


def _targets_persistence(module_name: str) -> bool:
    return module_name == PERSISTENCE_PACKAGE or module_name.startswith(f"{PERSISTENCE_PACKAGE}.")


def _persistence_import_offenders_for_source(source: str, relative_path: Path) -> list[str]:
    offenders: list[str] = []
    tree = ast.parse(source, filename=str(relative_path))
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and _import_from_targets_persistence(node):
            offenders.append(f"{relative_path}:{node.lineno}")
        elif isinstance(node, ast.Import):
            for alias in node.names:
                if _targets_persistence(alias.name):
                    offenders.append(f"{relative_path}:{node.lineno}")
                    break
        elif isinstance(node, ast.Call) and _dynamic_import_target(node):
            offenders.append(f"{relative_path}:{node.lineno}")
    return offenders


def _import_from_targets_persistence(node: ast.ImportFrom) -> bool:
    if node.module is None:
        return False
    if _targets_persistence(node.module):
        return True
    return any(_targets_persistence(f"{node.module}.{alias.name}") for alias in node.names)


def _dynamic_import_target(node: ast.Call) -> bool:
    if not node.args or not isinstance(node.args[0], ast.Constant) or not isinstance(node.args[0].value, str):
        return False
    if not _targets_persistence(node.args[0].value):
        return False
    if isinstance(node.func, ast.Name):
        return node.func.id in {"__import__", "import_module"}
    return isinstance(node.func, ast.Attribute) and node.func.attr == "import_module"


@pytest.mark.parametrize(
    "source",
    [
        "from app.persistence.repositories import executions as e\n",
        "from app.persistence.repositories.executions import execution_repository_for_session\n",
        "import app.persistence.repositories.executions as executions\n",
        "importlib.import_module('app.persistence.repositories.executions')\n",
        "__import__('app.persistence.repositories.executions')\n",
    ],
)
def test_boundary_detector_flags_any_persistence_import_form(source: str):
    assert _persistence_import_offenders_for_source(source, Path("application/service.py")) == ["application/service.py:1"]


def test_api_dependencies_is_the_explicit_composition_root_for_concrete_repository_wiring():
    source = COMPOSITION_ROOT.read_text()

    assert "execution_repository_for_session" in source
    assert "ExecutionRepository" in source


def test_application_and_api_layers_do_not_import_persistence_outside_composition_root():
    offenders: list[str] = []
    for path in _app_python_files():
        if _is_allowed_persistence_importer(path):
            continue
        offenders.extend(_persistence_import_offenders_for_source(path.read_text(), path.relative_to(APP_ROOT)))

    assert offenders == []
