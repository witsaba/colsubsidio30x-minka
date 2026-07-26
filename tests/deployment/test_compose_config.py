"""What Compose itself resolves the root file to (REQ-UCD-6).

`test_root_compose.py` asserts the committed text; this asserts the *rendered*
configuration, because Compose — not our regexes — is the authority on what a
`docker compose up` will actually do. It needs the `docker compose` binary but
never a running daemon, so it still runs in CI.

The rendering is done twice on purpose:

* with interpolation, against a throwaway env file, to check the contracts;
* with `--no-interpolate`, with a credential-shaped sentinel exported, to prove
  no rendering path can turn a real key into output.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path

import pytest

from .compose_text import COMPOSE_PATH, REPO_ROOT

#: Never a real key, and distinctive enough that finding it anywhere is proof.
SENTINEL = "sk-SENTINEL-0123456789-must-never-be-rendered"

SECRET_ENV = (
    "DEEPGRAM_API_KEY",
    "GROQ_API_KEY",
    "ELEVENLABS_API_KEY",
)

pytestmark = pytest.mark.skipif(
    shutil.which("docker") is None,
    reason="docker CLI not installed; the text contracts in "
    "test_root_compose.py still cover this file",
)


def compose_config(*extra: str, env: dict[str, str] | None = None):
    return subprocess.run(
        ["docker", "compose", "-f", str(COMPOSE_PATH), "config", *extra],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        env={**os.environ, **(env or {})},
    )


@pytest.fixture(scope="module")
def rendered(tmp_path_factory: pytest.TempPathFactory) -> dict:
    """The file as Compose resolves it, isolated from any local `.env`."""
    empty_env = tmp_path_factory.mktemp("env") / "empty.env"
    empty_env.write_text("", encoding="utf-8")
    result = subprocess.run(
        [
            "docker", "compose",
            "--env-file", str(empty_env),
            "-f", str(COMPOSE_PATH),
            "config", "--format", "json",
        ],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        env={key: value for key, value in os.environ.items()
             if key not in SECRET_ENV},
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout)


def published(port: dict) -> str:
    return str(port["published"])


class TestRenderedContract:
    def test_it_validates(self, rendered: dict) -> None:
        assert set(rendered["services"]) == {
            "stt",
            "matcher",
            "product_identification",
            "redis",
        }

    @pytest.mark.parametrize("name, port", [("stt", "8001"), ("matcher", "8002")])
    def test_each_service_publishes_its_documented_port(
        self, rendered: dict, name: str, port: str
    ) -> None:
        ports = rendered["services"][name]["ports"]
        assert len(ports) == 1, ports
        assert published(ports[0]) == port
        assert str(ports[0]["target"]) == port

    @pytest.mark.parametrize("name, port", [("stt", "8001"), ("matcher", "8002")])
    def test_each_service_probes_its_own_health_endpoint(
        self, rendered: dict, name: str, port: str
    ) -> None:
        probe = " ".join(rendered["services"][name]["healthcheck"]["test"])
        assert f"http://localhost:{port}/health" in probe

    @pytest.mark.parametrize("name", ["stt", "matcher"])
    def test_each_service_restarts_unless_stopped(
        self, rendered: dict, name: str
    ) -> None:
        assert rendered["services"][name]["restart"] == "unless-stopped"

    def test_the_matcher_renders_no_catalogue_mount(self, rendered: dict) -> None:
        """REQ-UCD-6. Compose, not our regexes, is the authority on what a
        `docker compose up` would actually mount."""
        matcher = rendered["services"]["matcher"]
        assert not matcher.get("volumes")
        assert "CATALOGUE_DB" not in matcher["environment"]

    def test_the_matcher_renders_the_supabase_and_redis_variables(
        self, rendered: dict
    ) -> None:
        environment = rendered["services"]["matcher"]["environment"]
        # Rendered against an empty env file, so the secret resolves to blank
        # and the two cache knobs to their reviewed defaults.
        assert environment["SUPABASE_URL"] == ""
        assert environment["SUPABASE_KEY"] == ""
        assert environment["REDIS_URL"] == "redis://redis:6379/0"
        assert environment["CATALOGUE_CACHE_TTL_SECONDS"] == "10800"

    def test_the_matcher_builds_from_the_repository_root(
        self, rendered: dict
    ) -> None:
        build = rendered["services"]["matcher"]["build"]
        assert Path(build["context"]) == REPO_ROOT
        assert build["dockerfile"].endswith("services/matcher/Dockerfile")

    def test_the_stt_builds_from_its_own_directory(self, rendered: dict) -> None:
        build = rendered["services"]["stt"]["build"]
        assert Path(build["context"]) == REPO_ROOT / "services" / "stt"

    @pytest.mark.parametrize(
        "name", ["stt", "matcher", "product_identification", "redis"]
    )
    def test_no_service_waits_for_the_other(
        self, rendered: dict, name: str
    ) -> None:
        assert not rendered["services"][name].get("depends_on")

    def test_the_redis_cache_renders_pinned_and_unpublished(
        self, rendered: dict
    ) -> None:
        redis = rendered["services"]["redis"]
        assert redis["image"] == "redis:7.4-alpine"
        assert not redis.get("ports")
        assert not redis.get("build")
        assert redis["healthcheck"]["test"] == ["CMD", "redis-cli", "ping"]

    def test_the_stt_receives_every_vendor_key_slot(self, rendered: dict) -> None:
        """Empty is the point: only the ACTIVE vendor's key is required, and
        the service — not Compose — is what enforces that."""
        environment = rendered["services"]["stt"]["environment"]
        for key in SECRET_ENV:
            assert key in environment
            assert environment[key] == ""


class TestNoCredentialCanBeRendered:
    def test_a_sentinel_key_never_reaches_the_rendered_output(
        self, tmp_path: Path
    ) -> None:
        result = compose_config(
            "--no-interpolate",
            env={key: SENTINEL for key in SECRET_ENV},
        )
        assert result.returncode == 0, result.stderr
        capture = tmp_path / "config.yaml"
        capture.write_text(result.stdout, encoding="utf-8")
        assert SENTINEL not in capture.read_text(encoding="utf-8")
        assert SENTINEL not in result.stderr

    def test_no_interpolate_keeps_the_placeholders_intact(self) -> None:
        """Which is *why* the sentinel cannot leak: nothing is resolved."""
        result = compose_config(
            "--no-interpolate",
            env={key: SENTINEL for key in SECRET_ENV},
        )
        assert "${DEEPGRAM_API_KEY" in result.stdout

    def test_the_committed_file_holds_no_credential_of_its_own(self) -> None:
        text = COMPOSE_PATH.read_text(encoding="utf-8")
        for key in SECRET_ENV:
            assert f"{key}: ${{{key}" in text, (
                f"{key} must be interpolated, never written in"
            )
