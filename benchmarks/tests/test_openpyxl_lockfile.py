"""openpyxl regression for the benchmark harness (Task 1.3/1.4).

The XLSX adapter fails fast if openpyxl is missing, so a regression in either
the running environment or the lockfile surfaces here first. The lockfile check
guards against accidental removal during a future dep churn.
"""

from __future__ import annotations

from pathlib import Path

import pytest


WORKSPACE_ROOT = Path(__file__).resolve().parents[2]
PYPROJECT = WORKSPACE_ROOT / "services" / "stt" / "pyproject.toml"
LOCKFILE = WORKSPACE_ROOT / "services" / "stt" / "uv.lock"


def test_openpyxl_is_importable_in_the_active_environment() -> None:
    import openpyxl  # noqa: F401 - regression: missing dep is the failure

    assert openpyxl.__version__


def test_openpyxl_is_pinned_as_a_dev_dependency_in_pyproject() -> None:
    text = PYPROJECT.read_text(encoding="utf-8")
    assert "openpyxl" in text, "openpyxl must be declared in services/stt/pyproject.toml"


def test_openpyxl_is_resolved_in_the_stt_lockfile() -> None:
    text = LOCKFILE.read_text(encoding="utf-8")
    assert "openpyxl" in text, "openpyxl must be resolved in services/stt/uv.lock"


def test_openpyxl_dependency_group_is_dev_only() -> None:
    text = PYPROJECT.read_text(encoding="utf-8")

    in_prod = False
    in_dev = False
    current = None
    for raw in text.splitlines():
        stripped = raw.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            current = stripped
            continue
        if "openpyxl" not in stripped:
            continue
        # A dependency entry looks like a quoted string with `=`, e.g.
        # ``"openpyxl>=3.1.5",``. Plain word mentions (descriptions) do not.
        if '"' not in stripped:
            continue
        if current == "[project]":
            in_prod = True
        elif current == "[dependency-groups]":
            in_dev = True
    assert in_dev, "openpyxl should appear in the [dependency-groups] dev list"
    assert not in_prod, "openpyxl must not be in [project] dependencies"
