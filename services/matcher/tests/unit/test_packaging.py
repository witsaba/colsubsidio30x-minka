"""Packaging smoke tests for the `matcher` workspace member (T1).

These lock the two packaging guarantees the rest of the suite depends on:
the package is importable from a clean `uv sync`, and `unidecode` is not part
of the resolved environment (REQ-ENG-1 dependency clause -- accent stripping
uses stdlib `unicodedata`).
"""
from __future__ import annotations

import importlib
import importlib.util
from pathlib import Path


def test_matcher_package_is_importable_from_the_synced_environment() -> None:
    module = importlib.import_module("matcher")

    assert module.__name__ == "matcher"
    assert Path(module.__file__).name == "__init__.py"


def test_unidecode_is_absent_from_the_resolved_environment() -> None:
    assert importlib.util.find_spec("unidecode") is None


def test_unicodedata_is_the_available_accent_stripping_backend() -> None:
    unicodedata = importlib.import_module("unicodedata")

    stripped = "".join(
        c
        for c in unicodedata.normalize("NFKD", "AZÚCAR")
        if not unicodedata.combining(c)
    )
    assert stripped == "AZUCAR"
