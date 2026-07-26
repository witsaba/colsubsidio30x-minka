"""`load_index`: the startup fallback chain of design D5.

Startup must resolve the catalogue in exactly this order:

1. a **fresh** Redis snapshot -- and then perform **zero** Supabase calls.
   This is the user's headline requirement (REQ-RCC-1) and it is asserted
   directly, with an explicit call count, never implied by other behaviour;
2. otherwise Supabase, writing the snapshot back best-effort;
3. otherwise a *stale but parseable* snapshot, served with a WARNING -- stale
   real data beats an abort, and "never serve empty" still holds (REQ-CSS-5);
4. otherwise `CatalogueUnavailableError`, which the bounded startup retry in
   `main` turns into a non-zero exit (REQ-API-7).

Redis is exercised through the real `RedisSnapshotCache` over a throwaway
`fakeredis` backend (D2), so snapshot encoding, TTL and version semantics are
real. The source side is `FakeCatalogueSource`, whose `calls` counter is the
only way the zero-call guarantee can be proven; the real PostgREST adapter is
covered separately over `httpx.MockTransport`. **No test here touches the
network.**
"""
from __future__ import annotations

import json
import logging
from datetime import UTC, datetime, timedelta

import fakeredis
import pytest
from conftest import FakeCatalogueSource, make_rows

from matcher.cache import (
    SNAPSHOT_KEY,
    SNAPSHOT_SCHEMA_VERSION,
    RedisSnapshotCache,
    encode_snapshot,
)
from matcher.catalogue import CatalogueUnavailableError, load_index
from matcher.ports import Row, Snapshot

TTL_SECONDS = 10_800
LOCK_TTL_SECONDS = 60

SNAPSHOT_ROWS = make_rows({"BOD-01": ["ARROZ SNAPSHOT"], "BOD-02": ["PANELA SNAPSHOT"]})
SOURCE_ROWS = make_rows({"BOD-09": ["LENTEJA SUPABASE", "AZUCAR SUPABASE"]})


@pytest.fixture
def client() -> fakeredis.FakeRedis:
    return fakeredis.FakeRedis()


@pytest.fixture
def cache(client: fakeredis.FakeRedis) -> RedisSnapshotCache:
    return RedisSnapshotCache(
        client, ttl_seconds=TTL_SECONDS, lock_ttl_seconds=LOCK_TTL_SECONDS
    )


def unreachable_cache() -> RedisSnapshotCache:
    """A cache over a Redis that refuses every command.

    `connected` belongs to the `FakeServer`, not to the client: passing
    `connected=False` to `FakeRedis` is silently ignored by fakeredis and makes
    every soft-failure assertion vacuous.
    """
    server = fakeredis.FakeServer()
    server.connected = False
    return RedisSnapshotCache(
        fakeredis.FakeRedis(server=server),
        ttl_seconds=TTL_SECONDS,
        lock_ttl_seconds=LOCK_TTL_SECONDS,
    )


def seed(cache: RedisSnapshotCache, rows: list[Row], age_seconds: float) -> Snapshot:
    """Write a snapshot loaded `age_seconds` ago through the real adapter."""
    snapshot = Snapshot(
        rows=rows, loaded_at=datetime.now(UTC) - timedelta(seconds=age_seconds)
    )
    cache.put(snapshot)
    return snapshot


def articulos(catalogue: dict[str, list[Row]]) -> set[str]:
    return {row.articulo for rows in catalogue.values() for row in rows}


class TestWarmStart:
    """REQ-RCC-1: a fresh snapshot means Supabase is never dialed."""

    def test_a_fresh_snapshot_performs_zero_supabase_calls(
        self, cache: RedisSnapshotCache
    ) -> None:
        seed(cache, SNAPSHOT_ROWS, age_seconds=1)
        source = FakeCatalogueSource(SOURCE_ROWS)

        loaded = load_index(source, cache, ttl_seconds=TTL_SECONDS)

        assert source.calls == 0
        assert source.queried_tables == set()
        assert articulos(loaded.catalogue) == {"ARROZ SNAPSHOT", "PANELA SNAPSHOT"}

    def test_the_reported_source_is_redis_snapshot(
        self, cache: RedisSnapshotCache
    ) -> None:
        seed(cache, SNAPSHOT_ROWS, age_seconds=1)

        loaded = load_index(FakeCatalogueSource(SOURCE_ROWS), cache, TTL_SECONDS)

        assert loaded.source == "redis-snapshot"

    def test_the_snapshot_rows_are_regrouped_by_warehouse_code(
        self, cache: RedisSnapshotCache
    ) -> None:
        """The payload is flat; the grouping is rebuilt in-process (D3)."""
        seed(cache, SNAPSHOT_ROWS, age_seconds=1)

        loaded = load_index(FakeCatalogueSource(SOURCE_ROWS), cache, TTL_SECONDS)

        assert sorted(loaded.catalogue) == ["BOD-01", "BOD-02"]
        assert [row.articulo for row in loaded.catalogue["BOD-01"]] == [
            "ARROZ SNAPSHOT"
        ]

    def test_a_snapshot_just_inside_the_ttl_is_still_fresh(
        self, cache: RedisSnapshotCache
    ) -> None:
        seed(cache, SNAPSHOT_ROWS, age_seconds=TTL_SECONDS - 30)
        source = FakeCatalogueSource(SOURCE_ROWS)

        loaded = load_index(source, cache, TTL_SECONDS)

        assert source.calls == 0
        assert loaded.source == "redis-snapshot"


class TestColdStart:
    def test_an_empty_cache_fetches_supabase_exactly_once(
        self, cache: RedisSnapshotCache
    ) -> None:
        source = FakeCatalogueSource(SOURCE_ROWS)

        loaded = load_index(source, cache, TTL_SECONDS)

        assert source.calls == 1
        assert articulos(loaded.catalogue) == {"LENTEJA SUPABASE", "AZUCAR SUPABASE"}

    def test_the_reported_source_is_supabase(self, cache: RedisSnapshotCache) -> None:
        assert (
            load_index(FakeCatalogueSource(SOURCE_ROWS), cache, TTL_SECONDS).source
            == "supabase"
        )

    def test_a_cold_start_writes_the_snapshot_back(
        self, cache: RedisSnapshotCache
    ) -> None:
        load_index(FakeCatalogueSource(SOURCE_ROWS), cache, TTL_SECONDS)

        stored = cache.get()

        assert stored is not None
        assert {row.articulo for row in stored.rows} == {
            "LENTEJA SUPABASE",
            "AZUCAR SUPABASE",
        }

    def test_the_written_snapshot_is_immediately_fresh(
        self, cache: RedisSnapshotCache
    ) -> None:
        """A second start right after a cold one must be a warm start."""
        load_index(FakeCatalogueSource(SOURCE_ROWS), cache, TTL_SECONDS)
        second_source = FakeCatalogueSource(SOURCE_ROWS)

        loaded = load_index(second_source, cache, TTL_SECONDS)

        assert second_source.calls == 0
        assert loaded.source == "redis-snapshot"

    def test_a_failing_cache_put_does_not_fail_startup(self) -> None:
        """REQ-RCC-1: writing the snapshot back is best effort."""

        class ExplodingPut(RedisSnapshotCache):
            def put(self, snapshot: Snapshot) -> None:
                raise RuntimeError("redis write blew up")

        cache = ExplodingPut(fakeredis.FakeRedis(), TTL_SECONDS, LOCK_TTL_SECONDS)
        source = FakeCatalogueSource(SOURCE_ROWS)

        loaded = load_index(source, cache, TTL_SECONDS)

        assert source.calls == 1
        assert articulos(loaded.catalogue) == {"LENTEJA SUPABASE", "AZUCAR SUPABASE"}


class TestDegradedPaths:
    def test_a_stale_snapshot_triggers_a_supabase_fetch(
        self, cache: RedisSnapshotCache
    ) -> None:
        seed(cache, SNAPSHOT_ROWS, age_seconds=2 * TTL_SECONDS)
        source = FakeCatalogueSource(SOURCE_ROWS)

        loaded = load_index(source, cache, TTL_SECONDS)

        assert source.calls == 1
        assert loaded.source == "supabase"
        assert articulos(loaded.catalogue) == {"LENTEJA SUPABASE", "AZUCAR SUPABASE"}

    def test_a_stale_snapshot_serves_when_supabase_fails(
        self, cache: RedisSnapshotCache, caplog: pytest.LogCaptureFixture
    ) -> None:
        """D5 step 3: stale real data beats aborting the service."""
        seed(cache, SNAPSHOT_ROWS, age_seconds=2 * TTL_SECONDS)
        source = FakeCatalogueSource(SOURCE_ROWS, fail_times=1)

        with caplog.at_level(logging.WARNING, logger="matcher"):
            loaded = load_index(source, cache, TTL_SECONDS)

        assert loaded.source == "redis-snapshot-stale"
        assert articulos(loaded.catalogue) == {"ARROZ SNAPSHOT", "PANELA SNAPSHOT"}
        assert any(
            record.levelno == logging.WARNING and record.name == "matcher"
            for record in caplog.records
        )

    def test_an_incompatible_snapshot_version_is_treated_as_a_miss(
        self, cache: RedisSnapshotCache, client: fakeredis.FakeRedis
    ) -> None:
        """REQ-RCC-1: a future payload never blocks startup."""
        payload = json.loads(
            encode_snapshot(Snapshot(rows=SNAPSHOT_ROWS, loaded_at=datetime.now(UTC)))
        )
        payload["schema_version"] = SNAPSHOT_SCHEMA_VERSION + 1
        client.set(SNAPSHOT_KEY, json.dumps(payload))
        source = FakeCatalogueSource(SOURCE_ROWS)

        loaded = load_index(source, cache, TTL_SECONDS)

        assert source.calls == 1
        assert loaded.source == "supabase"

    def test_an_empty_snapshot_is_never_served(
        self, cache: RedisSnapshotCache
    ) -> None:
        """REQ-CSS-5: a zero-row snapshot is a miss, not a valid catalogue."""
        seed(cache, [], age_seconds=1)
        source = FakeCatalogueSource(SOURCE_ROWS)

        loaded = load_index(source, cache, TTL_SECONDS)

        assert source.calls == 1
        assert loaded.source == "supabase"

    def test_redis_unreachable_but_supabase_up_still_loads(self) -> None:
        """REQ-CSS-5 / REQ-RCC-3: a dead cache only costs a Supabase read."""
        source = FakeCatalogueSource(SOURCE_ROWS)

        loaded = load_index(source, unreachable_cache(), TTL_SECONDS)

        assert source.calls == 1
        assert loaded.source == "supabase"
        assert articulos(loaded.catalogue) == {"LENTEJA SUPABASE", "AZUCAR SUPABASE"}

    def test_a_cache_that_raises_on_read_is_survived_with_a_warning(
        self, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The adapter swallows Redis errors; anything that still escapes must
        degrade to a source read and leave an operational trace."""

        class ExplodingGet(RedisSnapshotCache):
            def get(self) -> Snapshot | None:
                raise RuntimeError("redis read blew up")

        cache = ExplodingGet(fakeredis.FakeRedis(), TTL_SECONDS, LOCK_TTL_SECONDS)
        source = FakeCatalogueSource(SOURCE_ROWS)

        with caplog.at_level(logging.WARNING, logger="matcher"):
            loaded = load_index(source, cache, TTL_SECONDS)

        assert source.calls == 1
        assert loaded.source == "supabase"
        assert any(
            record.levelno == logging.WARNING and record.name == "matcher"
            for record in caplog.records
        )


class TestBothUnavailable:
    def test_no_snapshot_and_a_failing_source_raises_catalogue_unavailable(
        self, cache: RedisSnapshotCache
    ) -> None:
        """REQ-CSS-5: startup aborts rather than serving an empty catalogue."""
        source = FakeCatalogueSource(SOURCE_ROWS, fail_times=1)

        with pytest.raises(CatalogueUnavailableError):
            load_index(source, cache, TTL_SECONDS)

    def test_a_dead_redis_and_a_failing_source_also_raise(self) -> None:
        source = FakeCatalogueSource(SOURCE_ROWS, fail_times=1)

        with pytest.raises(CatalogueUnavailableError):
            load_index(source, unreachable_cache(), TTL_SECONDS)
