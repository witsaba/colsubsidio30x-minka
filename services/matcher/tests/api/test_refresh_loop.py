"""The refresh loop as the app actually runs it (design D4, REQ-RCC-3/4).

`tests/unit/test_refresh.py` covers one refresh cycle in isolation. This module
covers the *lifecycle*: the loop is a real `asyncio` task owned by the FastAPI
lifespan, so it must start with the app, survive a failing cycle, and be
cancelled cleanly on shutdown -- a loop that dies silently would leave a
replica serving an ever-staler catalogue with nothing in the log to show for it.

It also pins the constraint the whole design exists to protect: `POST /match`
performs **zero** Redis and Supabase I/O (REQ-RCC-3, REQ-API-1). That is the
p95 ~1.8ms non-regression requirement expressed as a contract, and it is
asserted with real call counters on both sides, not inferred.

Only `_build_adapters` is faked; the app's own lifespan, settings parsing and
startup path all run for real. **No test here touches the network.**
"""
from __future__ import annotations

import logging
import time

import fakeredis
import pytest
from conftest import FIXTURE_CATALOGUE_ID, FakeCatalogueSource, make_rows
from fastapi.testclient import TestClient

from matcher import main as main_module
from matcher.cache import RedisSnapshotCache

TTL_SECONDS = 10_800
LOCK_TTL_SECONDS = 60


class CountingRedis(fakeredis.FakeRedis):
    """A `fakeredis` client that counts every command it is asked to run.

    The counter is the only way "`/match` performs no Redis I/O" can be proven
    rather than assumed: a wrapper that merely recorded `get`/`put` would miss
    the lock commands and any future call added below the adapter.
    """

    command_count = 0

    def execute_command(self, *args, **kwargs):  # type: ignore[no-untyped-def]
        self.command_count += 1
        return super().execute_command(*args, **kwargs)


def install_adapters(
    monkeypatch: pytest.MonkeyPatch,
    source: FakeCatalogueSource,
    client: fakeredis.FakeRedis,
) -> None:
    """Point the app's adapter seam at the supplied fakes."""
    cache = RedisSnapshotCache(
        client, ttl_seconds=TTL_SECONDS, lock_ttl_seconds=LOCK_TTL_SECONDS
    )
    monkeypatch.setattr(
        main_module, "_build_adapters", lambda _settings: (source, cache)
    )


class TestLifespanTask:
    def test_the_loop_task_starts_with_the_app_and_is_cancelled_on_shutdown(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """A leaked task would keep refreshing a service the app has dropped."""
        install_adapters(
            monkeypatch, FakeCatalogueSource(make_rows()), fakeredis.FakeRedis()
        )

        with TestClient(main_module.app) as client:
            client.get("/health")
            task = main_module.app.state.refresh_task
            assert task is not None
            assert not task.done(), "the refresh loop must be running"

        assert task.done(), "the refresh loop must not outlive the app"
        assert task.cancelled(), "shutdown must cancel the loop, not abandon it"

    @pytest.mark.asyncio
    async def test_shutdown_cancels_the_loop_inside_the_lifespan(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The lifespan itself must cancel the task, not leave it to loop teardown.

        `TestClient` runs the app in a portal whose event loop is torn down on
        exit, and that teardown cancels stray tasks by itself -- so the test
        above cannot distinguish a deliberate cancel from a leak. Driving the
        lifespan directly on a loop that stays alive afterwards can.
        """
        install_adapters(
            monkeypatch, FakeCatalogueSource(make_rows()), fakeredis.FakeRedis()
        )

        async with main_module.lifespan(main_module.app):
            task = main_module.app.state.refresh_task
            assert task is not None
            assert not task.done()

        assert task.cancelled(), "the lifespan must cancel its own refresh task"

    def test_a_refresh_exception_does_not_kill_the_loop(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """One bad cycle must not silently end every future refresh."""
        rows = make_rows()
        source = FakeCatalogueSource(rows, fail_times=1)
        # A fresh snapshot would make startup cost zero source calls; an empty
        # cache means attempt #1 is spent by startup, so the first *loop* cycle
        # is the one that succeeds after the failure below.
        failing_first_cycle = FakeCatalogueSource(rows, fail_times=1)
        install_adapters(monkeypatch, source, fakeredis.FakeRedis())
        monkeypatch.setattr(main_module, "_next_delay", lambda _ttl: 0.01)

        with caplog.at_level(logging.WARNING, logger="matcher"):
            with TestClient(main_module.app):
                service = main_module.app.state.service
                service._source = failing_first_cycle
                waited = 0.0
                while failing_first_cycle.calls < 2 and waited < 5.0:
                    time.sleep(0.05)
                    waited += 0.05

        assert failing_first_cycle.calls >= 2, (
            "the loop stopped after the failing cycle; calls="
            f"{failing_first_cycle.calls}"
        )
        assert any(
            "refresh" in record.getMessage()
            for record in caplog.records
            if record.levelno == logging.WARNING
        ), "the failed cycle must leave a WARNING"

    def test_the_loop_sleeps_the_configured_ttl_before_the_first_cycle(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """The delay is derived from the TTL, not from a hardcoded constant."""
        seen: list[float] = []

        def record(ttl: float) -> float:
            seen.append(ttl)
            return 3600.0

        install_adapters(
            monkeypatch, FakeCatalogueSource(make_rows()), fakeredis.FakeRedis()
        )
        monkeypatch.setattr(main_module, "_next_delay", record)

        with TestClient(main_module.app):
            for _ in range(20):
                if seen:
                    break
                time.sleep(0.05)

        assert seen, "the loop never asked for a delay"
        assert seen[0] == TTL_SECONDS


class TestNoPerRequestIO:
    def test_match_performs_no_redis_or_supabase_call(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """`/match` reads only the in-process index (REQ-RCC-3, REQ-API-1)."""
        source = FakeCatalogueSource(make_rows())
        redis_client = CountingRedis()
        install_adapters(monkeypatch, source, redis_client)

        with TestClient(main_module.app) as client:
            source_calls_after_startup = source.calls
            redis_client.command_count = 0

            for _ in range(20):
                response = client.post(
                    "/match",
                    json={
                        "catalogue_id": FIXTURE_CATALOGUE_ID,
                        "spoken_name": "arroz blanco",
                    },
                )
                assert response.status_code == 200
                assert response.json()["status"] in {"matched", "ambiguous", "no_match"}

            assert source.calls == source_calls_after_startup
            assert redis_client.command_count == 0
