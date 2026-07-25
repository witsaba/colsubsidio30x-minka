"""Background refresh: atomic swap, the cross-replica lock, and jitter (D4).

Three properties are under test here, and each one is asserted as *behaviour*
rather than as shape:

1. **Atomic swap** -- a `/match` running concurrently with a refresh sees the
   whole old index or the whole new one, never a catalogue paired with a
   foreign matcher. The test hammers `match()` from eight threads while a
   deliberately slow source rebuilds the index underneath, and asserts that no
   single decision ever mixes two catalogue generations. A test that only
   asserted `_index` was reassigned would prove nothing.
2. **Stampede control** (REQ-RCC-4) -- exactly one replica fetches Supabase per
   cycle. A replica that loses the `SET NX` lock adopts the winner's snapshot
   when it is newer and otherwise skips the cycle, in both cases performing
   **zero** source calls. A Redis that cannot serve the lock at all is *not* a
   correctness dependency: the refresh then goes straight to Supabase.
3. **Jitter** -- the delay is inside +/-10% of the TTL *and* is not constant,
   which is the whole point of de-syncing replicas.

Failure is always stale-while-refresh (REQ-RCC-3): the old index keeps serving
and the existing snapshot is never deleted.

Redis is the real `RedisSnapshotCache` over throwaway `fakeredis` (D2); the
source is `FakeCatalogueSource`, whose call counter is the only way the
zero-call assertions can be proven. **No test here touches the network.**
"""
from __future__ import annotations

import logging
import threading
import time
from datetime import UTC, datetime, timedelta

import fakeredis
import pytest
from conftest import FakeCatalogueSource, make_rows

from matcher.cache import REFRESH_LOCK_KEY, RedisSnapshotCache, encode_snapshot
from matcher.config import Settings
from matcher.main import _next_delay
from matcher.ports import Row, Snapshot
from matcher.service import MatcherService

TTL_SECONDS = 10_800
LOCK_TTL_SECONDS = 60

GEN_A = "GEN-A"
GEN_B = "GEN-B"

WAREHOUSE = "BOD-01"
PRODUCTS = ["TOMATE CHONTO", "TOMATE LARGO", "CEBOLLA CABEZONA", "PAPA PASTUSA"]


def generation_rows(generation: str) -> list[Row]:
    """One catalogue generation, every `articulo` tagged with its generation."""
    return make_rows({WAREHOUSE: [f"{generation} {name}" for name in PRODUCTS]})


def generation_of(articulo: str) -> str:
    """The generation tag an `articulo` carries, for the mixing assertion."""
    return articulo.split(" ", 1)[0]


@pytest.fixture
def client() -> fakeredis.FakeRedis:
    return fakeredis.FakeRedis()


@pytest.fixture
def cache(client: fakeredis.FakeRedis) -> RedisSnapshotCache:
    return RedisSnapshotCache(
        client, ttl_seconds=TTL_SECONDS, lock_ttl_seconds=LOCK_TTL_SECONDS
    )


@pytest.fixture
def settings() -> Settings:
    return Settings(
        supabase_url="http://supabase.invalid",
        supabase_key="test-key",
        redis_url="redis://localhost:6379/0",
    )


def write_snapshot(
    client: fakeredis.FakeRedis, rows: list[Row], loaded_at: datetime
) -> None:
    """Put a snapshot straight into Redis, as another replica would have."""
    from matcher.cache import SNAPSHOT_KEY

    client.set(SNAPSHOT_KEY, encode_snapshot(Snapshot(rows=rows, loaded_at=loaded_at)))


class SlowSource:
    """A source whose `load()` takes real wall time, so a swap can be raced.

    The delay is what makes the atomicity test meaningful: the new index is
    genuinely under construction while `/match` threads are reading the old one.
    """

    def __init__(self, rows: list[Row], delay_seconds: float) -> None:
        self._rows = rows
        self._delay_seconds = delay_seconds
        self.calls = 0

    def load(self) -> dict[str, list[Row]]:
        self.calls += 1
        time.sleep(self._delay_seconds)
        grouped: dict[str, list[Row]] = {}
        for row in self._rows:
            grouped.setdefault(row.warehouse_code, []).append(row)
        return grouped


class LockRefusingCache:
    """A cache whose lock command fails, as an unreachable Redis does.

    Delegates the snapshot side to a real cache over a dead `fakeredis` server,
    so `get`/`put` degrade exactly the way the production adapter does.
    """

    def __init__(self) -> None:
        server = fakeredis.FakeServer()
        server.connected = False
        self._inner = RedisSnapshotCache(
            fakeredis.FakeRedis(server=server),
            ttl_seconds=TTL_SECONDS,
            lock_ttl_seconds=LOCK_TTL_SECONDS,
        )

    def get(self) -> Snapshot | None:
        return self._inner.get()

    def put(self, snapshot: Snapshot) -> None:
        self._inner.put(snapshot)

    def try_acquire_refresh_lock(self, ttl_seconds: float | None = None) -> bool:
        raise RuntimeError("redis is unreachable")

    def release_refresh_lock(self) -> None:
        raise RuntimeError("redis is unreachable")


class TestAtomicSwap:
    def test_a_concurrent_match_never_observes_a_half_built_index(
        self, settings: Settings, cache: RedisSnapshotCache
    ) -> None:
        """Eight readers hammer `match()` while the index is swapped underneath.

        The catalogue is tagged per generation, so a decision whose candidates
        mix `GEN-A` and `GEN-B` rows is direct evidence that a reader observed a
        catalogue paired with a matcher built over different data.
        """
        service = MatcherService(
            settings, FakeCatalogueSource(generation_rows(GEN_A)), cache
        )
        started = threading.Event()
        stop = threading.Event()
        observed_generations: list[str] = []
        observed_index_ids: list[int] = []
        errors: list[BaseException] = []
        guard = threading.Lock()

        def hammer() -> None:
            local_generations: list[str] = []
            local_index_ids: list[int] = []
            try:
                started.set()
                # Bounded only as a runaway guard: the readers must still be
                # hammering while the slow rebuild is in flight, so the loop is
                # driven by `stop`, which the swapping thread sets afterwards.
                for _ in range(200_000):
                    if stop.is_set():
                        break
                    local_index_ids.append(id(service._index))
                    decision = service.match(WAREHOUSE, "TOMATE CHONTO", None)
                    assert decision.candidates, "a decision must carry candidates"
                    generations = {
                        generation_of(candidate.articulo)
                        for candidate in decision.candidates
                    }
                    assert len(generations) == 1, (
                        "a single decision mixed catalogue generations: "
                        f"{sorted(generations)}"
                    )
                    local_generations.append(generations.pop())
            except BaseException as exc:  # noqa: BLE001 - reported, not swallowed
                with guard:
                    errors.append(exc)
            finally:
                with guard:
                    observed_generations.extend(local_generations)
                    observed_index_ids.extend(local_index_ids)

        workers = [threading.Thread(target=hammer) for _ in range(8)]
        for worker in workers:
            worker.start()
        started.wait(timeout=5)
        service._source = SlowSource(generation_rows(GEN_B), delay_seconds=0.05)
        service.refresh()
        time.sleep(0.05)  # let the readers observe the post-swap generation too
        stop.set()
        for worker in workers:
            worker.join(timeout=30)

        assert not errors, f"a reader failed: {errors[0]!r}"
        assert set(observed_generations) == {GEN_A, GEN_B}, (
            "the swap did not land inside the hammering window; observed "
            f"{sorted(set(observed_generations))}"
        )
        assert len(set(observed_index_ids)) == 2

    def test_a_failed_refresh_keeps_the_previous_index(
        self,
        settings: Settings,
        client: fakeredis.FakeRedis,
        cache: RedisSnapshotCache,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        """Supabase down at refresh time is stale-while-refresh (REQ-RCC-3)."""
        rows = generation_rows(GEN_A)
        write_snapshot(client, rows, datetime.now(UTC))
        source = FakeCatalogueSource(rows, fail_times=1)
        service = MatcherService(settings, source, cache)
        old_index = service._index

        with caplog.at_level(logging.WARNING, logger="matcher"):
            refreshed = service.refresh()

        assert refreshed is False
        assert service._index is old_index
        assert service.match(WAREHOUSE, "TOMATE CHONTO", None).candidates
        warnings = [r for r in caplog.records if r.levelno == logging.WARNING]
        assert warnings, "a failed refresh must leave a WARNING"
        assert "refresh" in warnings[-1].getMessage()
        surviving = cache.get()
        assert surviving is not None
        assert [row.articulo for row in surviving.rows] == [
            row.articulo for row in rows
        ]

    def test_a_successful_refresh_writes_the_new_snapshot_back(
        self, settings: Settings, cache: RedisSnapshotCache
    ) -> None:
        """The winner publishes what it fetched, so the losers can adopt it."""
        service = MatcherService(
            settings, FakeCatalogueSource(generation_rows(GEN_A)), cache
        )
        service._source = FakeCatalogueSource(generation_rows(GEN_B))

        assert service.refresh() is True

        stored = cache.get()
        assert stored is not None
        assert {generation_of(row.articulo) for row in stored.rows} == {GEN_B}


class TestRefreshLock:
    def test_a_lost_lock_adopts_the_winners_newer_snapshot(
        self,
        settings: Settings,
        client: fakeredis.FakeRedis,
        cache: RedisSnapshotCache,
    ) -> None:
        """Losers read what the winner wrote instead of piling onto Supabase."""
        now = datetime.now(UTC)
        write_snapshot(client, generation_rows(GEN_A), now)
        source = FakeCatalogueSource(generation_rows(GEN_A))
        service = MatcherService(settings, source, cache)
        assert source.calls == 0, "a fresh snapshot must cost zero source calls"

        client.set(REFRESH_LOCK_KEY, b"another-replica")
        write_snapshot(client, generation_rows(GEN_B), now + timedelta(seconds=60))

        assert service.refresh() is True

        assert source.calls == 0
        served = {
            generation_of(row.articulo)
            for rows in service._index.catalogue.values()
            for row in rows
        }
        assert served == {GEN_B}

    def test_a_lost_lock_with_an_older_snapshot_skips_the_cycle(
        self,
        settings: Settings,
        client: fakeredis.FakeRedis,
        cache: RedisSnapshotCache,
    ) -> None:
        """Nothing newer to adopt: keep serving, do not fetch (REQ-RCC-4)."""
        now = datetime.now(UTC)
        write_snapshot(client, generation_rows(GEN_A), now)
        source = FakeCatalogueSource(generation_rows(GEN_A))
        service = MatcherService(settings, source, cache)
        old_index = service._index

        client.set(REFRESH_LOCK_KEY, b"another-replica")
        write_snapshot(client, generation_rows(GEN_B), now - timedelta(seconds=3600))

        assert service.refresh() is False

        assert source.calls == 0
        assert service._index is old_index

    def test_a_lost_lock_is_never_released_by_the_loser(
        self,
        settings: Settings,
        client: fakeredis.FakeRedis,
        cache: RedisSnapshotCache,
    ) -> None:
        """Releasing a lock you do not hold would re-open the stampede."""
        now = datetime.now(UTC)
        write_snapshot(client, generation_rows(GEN_A), now)
        service = MatcherService(settings, FakeCatalogueSource(), cache)

        client.set(REFRESH_LOCK_KEY, b"another-replica")
        service.refresh()

        assert client.get(REFRESH_LOCK_KEY) == b"another-replica"

    def test_the_lock_frees_itself_when_its_holder_dies(
        self, cache: RedisSnapshotCache, client: fakeredis.FakeRedis
    ) -> None:
        """`SET NX PX` expiry, observed for real, is what unblocks a dead holder."""
        assert cache.try_acquire_refresh_lock(ttl_seconds=0.2) is True
        assert cache.try_acquire_refresh_lock(ttl_seconds=0.2) is False

        time.sleep(0.35)

        assert client.get(REFRESH_LOCK_KEY) is None
        assert cache.try_acquire_refresh_lock(ttl_seconds=0.2) is True

    def test_the_winner_releases_the_lock_after_a_successful_refresh(
        self,
        settings: Settings,
        client: fakeredis.FakeRedis,
        cache: RedisSnapshotCache,
    ) -> None:
        service = MatcherService(
            settings, FakeCatalogueSource(generation_rows(GEN_A)), cache
        )
        service.refresh()

        assert client.get(REFRESH_LOCK_KEY) is None

    def test_the_winner_releases_the_lock_after_a_failed_refresh(
        self,
        settings: Settings,
        client: fakeredis.FakeRedis,
        cache: RedisSnapshotCache,
    ) -> None:
        """A holder that keeps the lock after failing would stall every replica."""
        service = MatcherService(
            settings, FakeCatalogueSource(generation_rows(GEN_A)), cache
        )
        service._source = FakeCatalogueSource(generation_rows(GEN_B), fail_times=1)

        assert service.refresh() is False
        assert client.get(REFRESH_LOCK_KEY) is None

    def test_redis_down_still_refreshes_directly_from_supabase(
        self, settings: Settings
    ) -> None:
        """The lock is stampede optimization, not a correctness dependency (D4)."""
        cache = LockRefusingCache()
        source = FakeCatalogueSource(generation_rows(GEN_A))
        service = MatcherService(settings, source, cache)
        assert source.calls == 1, "a dead cache must fall through to the source"
        old_index = service._index
        service._source = FakeCatalogueSource(generation_rows(GEN_B))

        assert service.refresh() is True

        assert service._source.calls == 1
        assert service._index is not old_index
        served = {
            generation_of(row.articulo)
            for rows in service._index.catalogue.values()
            for row in rows
        }
        assert served == {GEN_B}


class TestJitter:
    def test_the_delay_stays_within_ten_percent_of_the_ttl(self) -> None:
        """Bounded *and* non-constant: a constant would pass bounds alone."""
        samples = [_next_delay(TTL_SECONDS) for _ in range(200)]

        assert all(9_720 <= sample <= 11_880 for sample in samples), (
            f"out of bounds: min={min(samples)} max={max(samples)}"
        )
        assert len(set(samples)) > 1, "a constant delay would re-sync every replica"

    def test_the_jitter_spans_both_sides_of_the_ttl(self) -> None:
        """De-syncing needs both earlier and later cycles, not a one-sided skew."""
        samples = [_next_delay(TTL_SECONDS) for _ in range(200)]

        assert any(sample < TTL_SECONDS for sample in samples)
        assert any(sample > TTL_SECONDS for sample in samples)


class TestRefreshNeverRaises:
    def test_an_exploding_source_is_swallowed(
        self, settings: Settings, cache: RedisSnapshotCache
    ) -> None:
        """`refresh()` is called from a background loop: it must never escape."""

        class ExplodingSource:
            calls = 0

            def load(self) -> dict[str, list[Row]]:
                raise ValueError("boom")

        service = MatcherService(
            settings, FakeCatalogueSource(generation_rows(GEN_A)), cache
        )
        old_index = service._index
        service._source = ExplodingSource()

        assert service.refresh() is False
        assert service._index is old_index

    def test_an_unavailable_catalogue_is_swallowed(
        self, settings: Settings, cache: RedisSnapshotCache
    ) -> None:
        service = MatcherService(
            settings, FakeCatalogueSource(generation_rows(GEN_A)), cache
        )
        old_index = service._index
        failing = FakeCatalogueSource(generation_rows(GEN_B), fail_times=1)
        service._source = failing

        assert service.refresh() is False
        assert failing.calls == 1, "the source must have been read and have failed"
        assert service._index is old_index
