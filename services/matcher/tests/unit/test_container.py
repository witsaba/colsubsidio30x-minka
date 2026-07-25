"""Contract tests for the deployment artefacts (T10, REQ-API-6, design D5).

These assert the *content contract* of the matcher's `Dockerfile` and of its
service block in the root `docker-compose.yml`, without a Docker daemon, so the
guarantees survive in CI where no daemon exists. The live `docker compose up -d`
harness remains the runtime proof.

The Compose file moved to the repository root (REQ-UCD-1): one deployment
surface for every service. What is asserted here is the part of it that belongs
to this service, and only that — the cross-service contracts live in
`tests/deployment/`. The `matcher` block is sliced out first so a value that
happens to appear in a sibling service cannot satisfy an assertion made about
this one.

Parsed as text on purpose: PyYAML is not a project dependency and adding one
only to read two files would violate the "no dependency without a measured
need" rule this service already follows.
"""
from __future__ import annotations

import re
from pathlib import Path

import pytest

SERVICE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = Path(__file__).resolve().parents[4]


def _service_block(compose_text: str, service: str) -> str:
    """The body of one service in the root Compose, by indentation."""
    lines = compose_text.splitlines()
    start = next(
        index
        for index, line in enumerate(lines)
        if line.rstrip() == f"  {service}:"
    )
    body: list[str] = []
    for line in lines[start + 1 :]:
        if line.strip() and not line.startswith("    "):
            break
        body.append(line)
    return "\n".join(body)


@pytest.fixture(scope="module")
def dockerignore() -> str:
    path = REPO_ROOT / ".dockerignore"
    assert path.is_file(), f"missing {path}"
    return path.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def dockerfile() -> str:
    path = SERVICE_ROOT / "Dockerfile"
    assert path.is_file(), f"missing {path}"
    return path.read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def compose() -> str:
    """This service's block of the single root Compose file."""
    path = REPO_ROOT / "docker-compose.yml"
    assert path.is_file(), f"missing {path}"
    return _service_block(path.read_text(encoding="utf-8"), "matcher")


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

    def test_stdout_is_unbuffered(self, dockerfile: str) -> None:
        """Buffered stdout loses the crash evidence when the kernel SIGKILLs."""
        assert "ENV PYTHONUNBUFFERED=1" in dockerfile


class TestDockerignore:
    """The build context is the repo root, so it needs an exclusion list."""

    def test_excludes_git_metadata_and_python_caches(
        self, dockerignore: str
    ) -> None:
        for pattern in (".git", "**/__pycache__", "**/.venv", ".pytest_cache"):
            assert pattern in dockerignore.splitlines(), pattern

    def test_excludes_the_directories_the_image_never_needs(
        self, dockerignore: str
    ) -> None:
        for pattern in ("data/", "spikes/", "openspec/", ".codegraph/", ".atl/"):
            assert pattern in dockerignore.splitlines(), pattern

    def test_does_not_exclude_anything_the_dockerfile_copies(
        self, dockerignore: str, dockerfile: str
    ) -> None:
        excluded = set(dockerignore.splitlines())
        for required in (
            "pyproject.toml",
            "uv.lock",
            "services/matcher/src",
            "services/matcher/pyproject.toml",
        ):
            assert required in dockerfile
            assert required not in excluded


class TestCompose:
    def test_build_context_is_the_repo_root(self, compose: str) -> None:
        assert re.search(r"^\s+context:\s+\.\s*$", compose, re.MULTILINE)
        assert "dockerfile: services/matcher/Dockerfile" in compose

    def test_publishes_port_8002(self, compose: str) -> None:
        assert '"8002:8002"' in compose

    def test_mounts_the_catalogue_read_only(self, compose: str) -> None:
        assert "./data:/data:ro" in compose
        assert "CATALOGUE_DB: /data/bodegas-y-stock.sqlite" in compose

    @pytest.mark.parametrize(
        "key, value",
        [
            ("MATCH_ACCEPT_SCORE", "0.50"),
            ("MATCH_AMBIGUITY_MARGIN", "0.08"),
            ("MATCH_TSR_MARGIN", "0.08"),
            ("MATCH_MAX_CANDIDATES", "5"),
            ("MATCH_UNIT_RERANK", "true"),
        ],
    )
    def test_pins_every_tunable_threshold(
        self, compose: str, key: str, value: str
    ) -> None:
        """Overridable from the root `.env`, but only ever *overridable*: with
        no `.env` the deployment still runs on the value reviewed here."""
        assert f"{key}: ${{{key}:-{value}}}" in compose

    def test_compose_env_defaults_match_the_settings_defaults(
        self, compose: str
    ) -> None:
        """A drifting compose default would silently change production."""
        from matcher.config import Settings

        defaults = Settings(supabase_url="http://supabase.invalid", supabase_key="test")
        assert (
            "MATCH_ACCEPT_SCORE: "
            f"${{MATCH_ACCEPT_SCORE:-{defaults.match_accept_score:.2f}}}"
        ) in compose
        assert (
            "MATCH_AMBIGUITY_MARGIN: "
            f"${{MATCH_AMBIGUITY_MARGIN:-{defaults.match_ambiguity_margin:.2f}}}"
        ) in compose
        assert (
            "MATCH_TSR_MARGIN: "
            f"${{MATCH_TSR_MARGIN:-{defaults.match_tsr_margin:.2f}}}"
        ) in compose
        assert (
            "MATCH_MAX_CANDIDATES: "
            f"${{MATCH_MAX_CANDIDATES:-{defaults.match_max_candidates}}}"
        ) in compose
        assert (
            "MATCH_UNIT_RERANK: "
            f"${{MATCH_UNIT_RERANK:-{str(defaults.match_unit_rerank).lower()}}}"
        ) in compose

    def test_healthcheck_probes_the_health_endpoint(self, compose: str) -> None:
        assert "healthcheck:" in compose
        assert "http://localhost:8002/health" in compose
        assert "retries: 3" in compose

    def test_healthcheck_grants_a_start_period(self, compose: str) -> None:
        """Loading the catalogue takes time; probes before it are not failures."""
        assert "start_period: 10s" in compose

    def test_restarts_unless_stopped(self, compose: str) -> None:
        assert "restart: unless-stopped" in compose

    def test_pins_the_startup_retry_knobs(
        self, compose: str, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from matcher.config import Settings

        # Read the code defaults, not whatever the harness exported.
        monkeypatch.delenv("STARTUP_RETRIES", raising=False)
        monkeypatch.delenv("STARTUP_RETRY_DELAY_SECONDS", raising=False)
        defaults = Settings(supabase_url="http://supabase.invalid", supabase_key="test")
        assert (
            f"STARTUP_RETRIES: ${{STARTUP_RETRIES:-{defaults.startup_retries}}}"
            in compose
        )
        assert (
            "STARTUP_RETRY_DELAY_SECONDS: ${STARTUP_RETRY_DELAY_SECONDS:-"
            f"{defaults.startup_retry_delay_seconds:.1f}}}" in compose
        )
