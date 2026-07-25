"""Contract tests for the deployment artefacts (T10, REQ-API-6, design D5).

These assert the *content contract* of `Dockerfile` and `docker-compose.yml`
without a Docker daemon, so the guarantees survive in CI where no daemon
exists. The live `docker compose up -d` harness remains the runtime proof.

Parsed as text on purpose: PyYAML is not a project dependency and adding one
only to read two files would violate the "no dependency without a measured
need" rule this service already follows.
"""
from __future__ import annotations

from pathlib import Path

import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[2]


@pytest.fixture(scope="module")
def dockerfile() -> str:
    path = SERVICE_ROOT / "Dockerfile"
    assert path.is_file(), f"missing {path}"
    return path.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def compose() -> str:
    path = SERVICE_ROOT / "docker-compose.yml"
    assert path.is_file(), f"missing {path}"
    return path.read_text(encoding="utf-8")


class TestDockerfile:
    def test_uses_the_documented_base_image(self, dockerfile: str) -> None:
        assert "FROM python:3.12-slim" in dockerfile

    def test_installs_with_uv_frozen_and_without_dev_dependencies(
        self, dockerfile: str
    ) -> None:
        sync_lines = [
            line for line in dockerfile.splitlines() if "uv sync" in line
        ]
        assert sync_lines, "Dockerfile must install dependencies with uv sync"
        for line in sync_lines:
            assert "--frozen" in line, line
            assert "--no-dev" in line, line

    def test_copies_the_lockfile_before_the_sources_for_layer_caching(
        self, dockerfile: str
    ) -> None:
        body = dockerfile
        assert body.index("uv.lock") < body.index("services/matcher/src")

    def test_serves_the_installable_package_entrypoint_on_8002(
        self, dockerfile: str
    ) -> None:
        assert (
            'CMD ["uvicorn", "matcher.main:app", '
            '"--host", "0.0.0.0", "--port", "8002"]' in dockerfile
        )
        assert "src.main:app" not in dockerfile, "spike entrypoint is superseded"
        assert "EXPOSE 8002" in dockerfile


class TestCompose:
    def test_build_context_is_the_repo_root(self, compose: str) -> None:
        assert "context: ../.." in compose
        assert "dockerfile: services/matcher/Dockerfile" in compose

    def test_publishes_port_8002(self, compose: str) -> None:
        assert '"8002:8002"' in compose

    def test_mounts_the_catalogue_read_only(self, compose: str) -> None:
        assert "../../data:/data:ro" in compose
        assert "CATALOGUE_DB: /data/bodegas-y-stock.sqlite" in compose

    @pytest.mark.parametrize(
        "key, value",
        [
            ("MATCH_ACCEPT_SCORE", '"0.50"'),
            ("MATCH_AMBIGUITY_MARGIN", '"0.08"'),
            ("MATCH_TSR_MARGIN", '"0.08"'),
            ("MATCH_MAX_CANDIDATES", '"5"'),
            ("MATCH_UNIT_RERANK", '"true"'),
        ],
    )
    def test_pins_every_tunable_threshold(
        self, compose: str, key: str, value: str
    ) -> None:
        assert f"{key}: {value}" in compose

    def test_compose_env_defaults_match_the_settings_defaults(
        self, compose: str
    ) -> None:
        """A drifting compose default would silently change production."""
        from matcher.config import Settings

        defaults = Settings(catalogue_db=Path("/data/bodegas-y-stock.sqlite"))
        assert f'MATCH_ACCEPT_SCORE: "{defaults.match_accept_score:.2f}"' in compose
        assert (
            f'MATCH_AMBIGUITY_MARGIN: "{defaults.match_ambiguity_margin:.2f}"'
            in compose
        )
        assert f'MATCH_TSR_MARGIN: "{defaults.match_tsr_margin:.2f}"' in compose
        assert f'MATCH_MAX_CANDIDATES: "{defaults.match_max_candidates}"' in compose
        assert (
            f'MATCH_UNIT_RERANK: "{str(defaults.match_unit_rerank).lower()}"'
            in compose
        )

    def test_healthcheck_probes_the_health_endpoint(self, compose: str) -> None:
        assert "healthcheck:" in compose
        assert "http://localhost:8002/health" in compose
        assert "retries: 3" in compose

    def test_restarts_unless_stopped(self, compose: str) -> None:
        assert "restart: unless-stopped" in compose
