"""Bounded startup retry and fail-fast fallback (JD-U).

A cold start can race the things it depends on: Supabase or Redis may not be
reachable yet, or PostgREST may still be warming up. Retrying a bounded number
of times
inside the process turns that race into a slower start instead of a crash,
while an actually broken deployment still aborts -- the process exits non-zero
(uvicorn exit code 3) and Docker's `restart: unless-stopped` becomes the outer,
unbounded retry layer. The two layers are deliberate: in-process retry handles
seconds-long races, Docker handles everything longer.

The service must never come up serving an empty catalogue, so exhaustion is
always an abort and never a degraded start.
"""
from __future__ import annotations

import logging
import subprocess
import sys
import time
from pathlib import Path

import pytest
from conftest import FakeCatalogueSource, make_cache, make_rows

REPO_ROOT = Path(__file__).resolve().parents[4]

SENTINEL_SUPABASE_KEY = "sb-secret-DO-NOT-LEAK-8f3a1c7e94b2"
"""A deliberately unmistakable stand-in for the live `service_role` key.

REQ-API-8 is only testable with a value that cannot appear in output by
coincidence. A placeholder like `unused` is a substring of ordinary English and
would make the absence assertion below prove nothing; this one appears in the
process output if and only if the credential itself escaped.
"""


@pytest.fixture
def sleeps(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    """Record the retry waits instead of serving them, so tests stay fast."""
    recorded: list[float] = []

    def fake_sleep(seconds: float) -> None:
        recorded.append(seconds)

    monkeypatch.setattr(time, "sleep", fake_sleep)
    return recorded


@pytest.fixture
def attempts(monkeypatch: pytest.MonkeyPatch) -> list[int]:
    """Count `MatcherService` constructions performed by the lifespan."""
    return []


def _install_service_factory(monkeypatch: pytest.MonkeyPatch, factory) -> None:
    """Patch the service factory, and the adapters it would otherwise dial.

    The retry loop under test builds the adapters once and then constructs the
    service per attempt; the fake pair keeps the attempt that finally succeeds
    offline, so this suite exercises the loop and nothing else.
    """
    from matcher import main as main_module

    monkeypatch.setattr(
        main_module,
        "_build_adapters",
        lambda _settings: (FakeCatalogueSource(make_rows()), make_cache()),
    )
    monkeypatch.setattr(main_module, "MatcherService", factory)


def _flaky_factory(attempts: list[int], failures: int):
    from matcher.catalogue import CatalogueUnavailableError
    from matcher.service import MatcherService

    def factory(settings, source, cache):
        attempts.append(1)
        if len(attempts) <= failures:
            raise CatalogueUnavailableError(
                "the Supabase catalogue is unavailable: connection refused"
            )
        return MatcherService(settings, source, cache)

    return factory


class TestRetryRecoversFromATransientFailure:
    def test_startup_succeeds_after_two_failed_attempts(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sleeps: list[float],
        attempts: list[int],
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.main import app

        monkeypatch.setenv("STARTUP_RETRIES", "3")
        monkeypatch.setenv("STARTUP_RETRY_DELAY_SECONDS", "2")
        _install_service_factory(monkeypatch, _flaky_factory(attempts, 2))

        with TestClient(app) as client:
            assert client.get("/health").json()["status"] == "ok"

        assert len(attempts) == 3

    def test_it_waits_between_attempts(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sleeps: list[float],
        attempts: list[int],
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.main import app

        monkeypatch.setenv("STARTUP_RETRIES", "3")
        monkeypatch.setenv("STARTUP_RETRY_DELAY_SECONDS", "2")
        _install_service_factory(monkeypatch, _flaky_factory(attempts, 2))

        with TestClient(app):
            pass

        assert sleeps == [2.0, 2.0]

    def test_each_retry_is_logged_as_a_warning(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sleeps: list[float],
        attempts: list[int],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.main import app

        monkeypatch.setenv("STARTUP_RETRIES", "3")
        _install_service_factory(monkeypatch, _flaky_factory(attempts, 2))

        with caplog.at_level(logging.INFO, logger="matcher"):
            with TestClient(app):
                pass

        warnings = [
            r.getMessage()
            for r in caplog.records
            if r.name == "matcher" and r.levelno == logging.WARNING
        ]
        assert len(warnings) == 2
        assert "1/4" in warnings[0]
        assert "2/4" in warnings[1]
        assert "connection refused" in warnings[0]

    def test_a_recovered_startup_still_logs_the_catalogue_summary(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sleeps: list[float],
        attempts: list[int],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.main import app

        _install_service_factory(monkeypatch, _flaky_factory(attempts, 2))

        with caplog.at_level(logging.INFO, logger="matcher"):
            with TestClient(app):
                pass

        assert any(
            "catalogue loaded" in r.getMessage()
            for r in caplog.records
            if r.levelno == logging.INFO
        )


class TestExhaustedRetriesFailFast:
    def test_it_aborts_after_one_attempt_plus_the_configured_retries(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sleeps: list[float],
        attempts: list[int],
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.catalogue import CatalogueUnavailableError
        from matcher.main import app

        monkeypatch.setenv("STARTUP_RETRIES", "3")
        _install_service_factory(monkeypatch, _flaky_factory(attempts, 99))

        with pytest.raises(CatalogueUnavailableError):
            with TestClient(app):
                pass

        assert len(attempts) == 4
        assert len(sleeps) == 3

    def test_zero_retries_means_a_single_attempt(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sleeps: list[float],
        attempts: list[int],
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.catalogue import CatalogueUnavailableError
        from matcher.main import app

        monkeypatch.setenv("STARTUP_RETRIES", "0")
        _install_service_factory(monkeypatch, _flaky_factory(attempts, 99))

        with pytest.raises(CatalogueUnavailableError):
            with TestClient(app):
                pass

        assert len(attempts) == 1
        assert sleeps == []

    def test_exhaustion_logs_an_error_naming_the_attempt_count(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sleeps: list[float],
        attempts: list[int],
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.catalogue import CatalogueUnavailableError
        from matcher.main import app

        monkeypatch.setenv("STARTUP_RETRIES", "2")
        _install_service_factory(monkeypatch, _flaky_factory(attempts, 99))

        with caplog.at_level(logging.INFO, logger="matcher"):
            with pytest.raises(CatalogueUnavailableError):
                with TestClient(app):
                    pass

        errors = [
            r.getMessage()
            for r in caplog.records
            if r.name == "matcher" and r.levelno == logging.ERROR
        ]
        assert len(errors) == 1
        assert "3 attempts" in errors[0]

    def test_no_service_is_left_behind(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sleeps: list[float],
        attempts: list[int],
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.catalogue import CatalogueUnavailableError
        from matcher.main import app

        monkeypatch.setenv("STARTUP_RETRIES", "1")
        _install_service_factory(monkeypatch, _flaky_factory(attempts, 99))

        with pytest.raises(CatalogueUnavailableError):
            with TestClient(app):
                pass

        assert getattr(app.state, "service", None) is None

    def test_a_misconfigured_setting_is_never_retried(
        self,
        monkeypatch: pytest.MonkeyPatch,
        sleeps: list[float],
    ) -> None:
        """Bad env is permanent; only an unavailable catalogue is transient."""
        from fastapi.testclient import TestClient
        from pydantic import ValidationError

        from matcher.main import app

        monkeypatch.setenv("MATCH_ACCEPT_SCORE", "not-a-number")

        with pytest.raises(ValidationError):
            with TestClient(app):
                pass

        assert sleeps == []


class TestTheProcessActuallyExitsThree:
    """The outer layer only works if the process really dies non-zero."""

    def test_uvicorn_exits_with_code_three_when_the_catalogue_is_missing(
        self,
    ) -> None:
        """Both dependencies point at closed *localhost* ports: connection
        refused arrives locally and instantly, so this test needs no network.
        """
        import os

        env = dict(
            os.environ,
            SUPABASE_URL="http://127.0.0.1:9/",
            SUPABASE_KEY=SENTINEL_SUPABASE_KEY,
            REDIS_URL="redis://127.0.0.1:9/0",
            STARTUP_RETRIES="1",
            STARTUP_RETRY_DELAY_SECONDS="0",
        )
        completed = subprocess.run(
            [
                sys.executable,
                "-m",
                "uvicorn",
                "matcher.main:app",
                "--port",
                "8123",
            ],
            cwd=REPO_ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=60,
        )

        assert completed.returncode == 3, completed.stderr
        assert "startup aborted after 2 attempts" in completed.stderr

        # REQ-API-8, verified where it actually matters. This is the only test
        # that runs the real, unmocked failure path in a real process, so it is
        # the only place Python renders the full chained traceback -- every
        # `raise ... from exc` frame, every adapter repr, every argument the
        # exception carried. If the credential can escape at all, it escapes
        # here. A hit means an operator's logs, a crash reporter, or a support
        # paste now carries the live `service_role` key.
        for stream, contents in (("stderr", completed.stderr), ("stdout", completed.stdout)):
            assert SENTINEL_SUPABASE_KEY not in contents, (
                f"SUPABASE_KEY leaked into {stream} of a crashing matcher: the "
                f"service_role credential bypasses RLS, so anything that reads "
                f"this process's output now has full database access"
            )
