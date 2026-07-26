"""`scripts/smoke-compose.sh` is the runtime proof (REQ-UCD-7).

`docker compose up -d` returns before anything is healthy, so "it started" and
"it works" are different claims. This script waits for the healthcheck and then
asks each service's `/health` itself.

What matters most here is the *skip* behaviour: a stage that cannot run must
say which credential or which dependency is missing. Silently dropping it would
turn a stack that never came up into a green run.
"""

from __future__ import annotations

import os
import re
import shutil
import stat
import subprocess

import pytest

from .compose_text import REPO_ROOT

SMOKE_SCRIPT = REPO_ROOT / "scripts" / "smoke-compose.sh"


def run_smoke(*args: str, env: dict[str, str] | None = None):
    return subprocess.run(
        ["bash", str(SMOKE_SCRIPT), *args],
        cwd=REPO_ROOT,
        capture_output=True,
        text=True,
        env={**os.environ, **(env or {})},
    )


def test_the_script_is_executable() -> None:
    assert SMOKE_SCRIPT.is_file(), f"missing {SMOKE_SCRIPT}"
    assert SMOKE_SCRIPT.stat().st_mode & stat.S_IXUSR


class TestPlan:
    """`--plan` answers "what would run, and what would not" with no daemon."""

    def test_it_lists_every_service_in_the_compose_file(self) -> None:
        result = run_smoke("--plan")
        assert result.returncode == 0, result.stderr
        assert "stt" in result.stdout
        assert "matcher" in result.stdout
        assert "product_identification" in result.stdout
        assert "frontend" in result.stdout

    def test_it_resolves_each_published_port_from_the_compose_file(self) -> None:
        result = run_smoke("--plan")
        assert "8001" in result.stdout
        assert "8002" in result.stdout
        assert "8003" in result.stdout
        assert "4321" in result.stdout

    def test_it_names_the_credential_that_would_skip_a_service(self) -> None:
        result = run_smoke(
            "--plan", env={"STT_VENDOR": "deepgram", "DEEPGRAM_API_KEY": ""}
        )
        combined = result.stdout + result.stderr
        assert re.search(r"(?i)skip.*stt", combined), combined
        assert "DEEPGRAM_API_KEY" in combined

    def test_it_does_not_skip_a_service_whose_credential_is_present(self) -> None:
        result = run_smoke(
            "--plan",
            env={"STT_VENDOR": "deepgram", "DEEPGRAM_API_KEY": "present"},
        )
        assert not re.search(r"(?i)skip.*stt", result.stdout + result.stderr)

    def test_it_reads_the_active_vendor_rather_than_assuming_one(self) -> None:
        result = run_smoke(
            "--plan",
            env={
                "STT_VENDOR": "groq",
                "GROQ_API_KEY": "present",
                "DEEPGRAM_API_KEY": "",
            },
        )
        assert not re.search(r"(?i)skip.*stt", result.stdout + result.stderr)

    def test_it_names_the_credential_that_would_skip_the_matcher(self) -> None:
        """REQ-UCD-7. The catalogue moved from a committed SQLite file to
        Supabase, so the matcher now has a credential precondition exactly like
        stt does. Without this gate the stage does not merely fail: it calls
        `docker compose up` on a service that cannot boot, recreating whatever
        container was already running."""
        result = run_smoke("--plan", "matcher", env={"SUPABASE_SECRET_KEY": ""})
        combined = result.stdout + result.stderr
        assert re.search(r"(?i)skip.*matcher", combined), combined
        assert "SUPABASE_SECRET_KEY" in combined

    def test_it_does_not_skip_the_matcher_once_supabase_is_configured(
        self,
    ) -> None:
        result = run_smoke(
            "--plan",
            "matcher",
            env={
                "SUPABASE_URL": "https://project.supabase.co",
                "SUPABASE_SECRET_KEY": "present",
            },
        )
        assert not re.search(r"(?i)skip.*matcher", result.stdout + result.stderr)

    def test_a_blank_supabase_url_is_named_too(self) -> None:
        """Both halves are required, and the reason must say which is missing
        rather than reporting a generic misconfiguration."""
        result = run_smoke(
            "--plan",
            "matcher",
            env={"SUPABASE_URL": "", "SUPABASE_SECRET_KEY": "present"},
        )
        combined = result.stdout + result.stderr
        assert re.search(r"(?i)skip.*matcher", combined), combined
        assert "SUPABASE_URL" in combined

    def test_a_named_service_narrows_the_plan(self) -> None:
        result = run_smoke("--plan", "matcher")
        assert "matcher" in result.stdout
        assert not re.search(r"^\s*stt\b", result.stdout, re.MULTILINE)

    def test_an_unknown_service_fails_loudly(self) -> None:
        """The name must stay one the compose file does not define. `frontend`
        used to serve here and stopped being unknown the moment it shipped."""
        result = run_smoke("--plan", "nonexistent-service")
        assert result.returncode != 0
        assert "nonexistent-service" in result.stderr

    def test_an_unknown_flag_fails_loudly(self) -> None:
        result = run_smoke("--wat")
        assert result.returncode != 0
        assert "--wat" in result.stderr


class TestDaemonGate:
    def test_it_skips_with_a_named_reason_when_docker_is_unreachable(self) -> None:
        """A CI box without a daemon must not report this as a failure — the
        daemon-free contracts already ran."""
        result = run_smoke(env={"DOCKER_HOST": "unix:///nonexistent.sock"})
        combined = result.stdout + result.stderr
        assert result.returncode == 0, combined
        assert re.search(r"(?i)skip.*docker", combined), combined


@pytest.mark.skipif(
    shutil.which("docker") is None
    or subprocess.run(
        ["docker", "info"], capture_output=True, check=False
    ).returncode
    != 0,
    reason="no reachable Docker daemon; the daemon-free contracts still ran",
)
@pytest.mark.skipif(
    not (os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SECRET_KEY")),
    reason="SUPABASE_URL/SUPABASE_SECRET_KEY are not exported; the matcher cannot "
    "load its catalogue, and starting it would recreate a running container "
    "into a crash loop (REQ-UCD-7: skip with a named reason)",
)
class TestAgainstARunningDaemon:
    def test_the_matcher_reaches_a_healthy_health_endpoint(self) -> None:
        """The catalogue comes from Supabase now, so this stage is gated on the
        credential above rather than on a committed database file."""
        result = run_smoke("matcher")
        combined = result.stdout + result.stderr
        assert result.returncode == 0, combined
        assert '"status"' in combined and '"ok"' in combined
