"""Packaging smoke tests for the `matcher` workspace member (T1).

These lock the packaging guarantees the rest of the suite depends on: the
package is importable from a clean `uv sync`, `unidecode` is not part of the
resolved environment (REQ-ENG-1 dependency clause -- accent stripping uses
stdlib `unicodedata`), and the catalogue clients the Supabase/Redis path needs
are declared as runtime dependencies rather than borrowed from the dev group.
"""
from __future__ import annotations

import importlib
import importlib.util
import tomllib
from pathlib import Path

MATCHER_PYPROJECT = Path(__file__).resolve().parents[2] / "pyproject.toml"


def declared_runtime_dependencies() -> list[str]:
    """The `[project].dependencies` the matcher wheel ships with."""
    manifest = tomllib.loads(MATCHER_PYPROJECT.read_text(encoding="utf-8"))
    return manifest["project"]["dependencies"]


def test_matcher_package_is_importable_from_the_synced_environment() -> None:
    module = importlib.import_module("matcher")

    assert module.__name__ == "matcher"
    assert Path(module.__file__).name == "__init__.py"


def test_unidecode_is_absent_from_the_resolved_environment() -> None:
    assert importlib.util.find_spec("unidecode") is None


class TestRuntimeDependencies:
    """The catalogue path talks PostgREST over httpx and caches in Redis (D1)."""

    def test_it_declares_the_postgrest_and_redis_clients(self) -> None:
        declared = declared_runtime_dependencies()

        for package in ("httpx", "redis"):
            assert any(req.startswith(package) for req in declared), (
                f"'{package}' not declared in services/matcher/pyproject.toml "
                f"[project].dependencies; got {declared}"
            )

    def test_the_declared_clients_are_importable_from_the_synced_environment(
        self,
    ) -> None:
        assert importlib.util.find_spec("httpx") is not None
        assert importlib.util.find_spec("redis") is not None

    def test_fakeredis_is_available_as_a_test_only_backend(self) -> None:
        """`fakeredis` backs the real `RedisSnapshotCache` in tests (D2).

        It is deliberately absent from `[project].dependencies`: a throwaway
        in-memory backend must never ship inside the runtime image.
        """
        assert importlib.util.find_spec("fakeredis") is not None
        assert not any(
            req.startswith("fakeredis") for req in declared_runtime_dependencies()
        )


def test_unicodedata_is_the_available_accent_stripping_backend() -> None:
    unicodedata = importlib.import_module("unicodedata")

    stripped = "".join(
        c
        for c in unicodedata.normalize("NFKD", "AZÚCAR")
        if not unicodedata.combining(c)
    )
    assert stripped == "AZUCAR"
