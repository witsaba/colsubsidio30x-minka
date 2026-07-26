"""`RedisSnapshotCache`: the Redis adapter behind the `SnapshotCache` port.

Covers the WU-2 contract of the redis-catalogue-cache change:

* a written snapshot reads back intact, under the pinned key, with a Redis key
  TTL of twice the configured freshness TTL (design D3) -- a warm restart after
  one missed refresh still finds a stale-but-usable snapshot;
* anything unusable in the slot (wrong schema version, corrupt bytes) reads as
  a clean miss rather than an exception reaching startup (REQ-RCC-1);
* Redis is a *soft* dependency: every `redis.RedisError` degrades to
  `None`/`False`/no-op and never propagates to the service (REQ-RCC-3);
* the `SET NX PX` refresh lock admits exactly one holder and frees itself when
  its holder dies (REQ-RCC-4, design D4).

The real adapter is exercised against a throwaway `fakeredis` backend -- the
repo's real-but-throwaway convention (D2). A hand-rolled cache fake would
re-implement `SET NX PX` expiry, which is precisely the thing under test.
"""
from __future__ import annotations

import json
import time
from datetime import UTC, datetime

import fakeredis
import pytest
import redis

from matcher.cache import (
    REFRESH_LOCK_KEY,
    SNAPSHOT_KEY,
    SNAPSHOT_SCHEMA_VERSION,
    RedisSnapshotCache,
    encode_snapshot,
)
from matcher.ports import Row, Snapshot, SnapshotCache

TTL_SECONDS = 10_800
LOCK_TTL_SECONDS = 60


def make_row(
    warehouse_code: str = "BOD-01",
    uid: str = "11111111-1111-4111-8111-111111111111",
    articulo: str = "AZUCAR MORENA X 500 G",
    unidad: str | None = "KG",
    nr_articulo: str | None = "SKU-0001",
) -> Row:
    return Row(
        warehouse_code=warehouse_code,
        uid=uid,
        articulo=articulo,
        unidad=unidad,
        nr_articulo=nr_articulo,
    )


def make_snapshot(loaded_at: datetime | None = None) -> Snapshot:
    return Snapshot(
        rows=[
            make_row(warehouse_code="BOD-01", uid="uid-a", articulo="ARROZ BLANCO"),
            make_row(
                warehouse_code="BOD-02",
                uid="uid-b",
                articulo="PANELA CUADRADA",
                unidad=None,
                nr_articulo=None,
            ),
        ],
        loaded_at=loaded_at or datetime(2026, 7, 25, 9, 30, 15, tzinfo=UTC),
    )


@pytest.fixture
def client() -> fakeredis.FakeRedis:
    return fakeredis.FakeRedis()


@pytest.fixture
def cache(client: fakeredis.FakeRedis) -> RedisSnapshotCache:
    return RedisSnapshotCache(
        client, ttl_seconds=TTL_SECONDS, lock_ttl_seconds=LOCK_TTL_SECONDS
    )


def unreachable_cache() -> RedisSnapshotCache:
    """A cache over a client that refuses every command, as a dead Redis does.

    `connected` lives on the `FakeServer`, not on the client: a disconnected
    server raises `redis.ConnectionError` from every command, which is the
    real 8.x exception the adapter must swallow.
    """
    server = fakeredis.FakeServer()
    server.connected = False
    return RedisSnapshotCache(
        fakeredis.FakeRedis(server=server),
        ttl_seconds=TTL_SECONDS,
        lock_ttl_seconds=LOCK_TTL_SECONDS,
    )


def test_the_unreachable_harness_really_refuses_commands() -> None:
    """Guard: a silently-working fake would make every soft-failure test vacuous."""
    server = fakeredis.FakeServer()
    server.connected = False

    with pytest.raises(redis.ConnectionError):
        fakeredis.FakeRedis(server=server).get(SNAPSHOT_KEY)


class TestPortConformance:
    def test_the_adapter_satisfies_the_snapshot_cache_port(
        self, cache: RedisSnapshotCache
    ) -> None:
        assert isinstance(cache, SnapshotCache)


class TestGetPut:
    def test_a_written_snapshot_is_read_back_intact(
        self, cache: RedisSnapshotCache
    ) -> None:
        snapshot = make_snapshot()

        cache.put(snapshot)
        restored = cache.get()

        assert restored is not None
        assert restored.loaded_at == snapshot.loaded_at
        assert restored.rows == snapshot.rows

    def test_it_writes_under_the_pinned_snapshot_key(
        self, cache: RedisSnapshotCache, client: fakeredis.FakeRedis
    ) -> None:
        """The key is an operational contract (`redis-cli GET ...`)."""
        cache.put(make_snapshot())

        assert client.exists(SNAPSHOT_KEY) == 1

    def test_get_on_an_empty_redis_returns_none(
        self, cache: RedisSnapshotCache
    ) -> None:
        assert cache.get() is None

    def test_put_sets_a_key_ttl_of_twice_the_configured_ttl(
        self, cache: RedisSnapshotCache, client: fakeredis.FakeRedis
    ) -> None:
        """D3: 2x TTL, so a warm restart survives one missed refresh."""
        cache.put(make_snapshot())

        ttl = client.ttl(SNAPSHOT_KEY)

        assert 2 * TTL_SECONDS - 2 <= ttl <= 2 * TTL_SECONDS

    def test_a_shorter_configured_ttl_shortens_the_key_ttl(
        self, client: fakeredis.FakeRedis
    ) -> None:
        """REQ-RCC-2: the key TTL derives from the setting, not a constant."""
        cache = RedisSnapshotCache(
            client, ttl_seconds=60, lock_ttl_seconds=LOCK_TTL_SECONDS
        )

        cache.put(make_snapshot())

        assert 118 <= client.ttl(SNAPSHOT_KEY) <= 120

    def test_a_second_put_replaces_the_stored_snapshot(
        self, cache: RedisSnapshotCache
    ) -> None:
        cache.put(make_snapshot(loaded_at=datetime(2026, 7, 25, 1, 0, tzinfo=UTC)))
        cache.put(
            Snapshot(
                rows=[make_row(uid="uid-newer", articulo="LENTEJA")],
                loaded_at=datetime(2026, 7, 25, 4, 0, tzinfo=UTC),
            )
        )

        restored = cache.get()

        assert restored is not None
        assert restored.loaded_at == datetime(2026, 7, 25, 4, 0, tzinfo=UTC)
        assert [row.uid for row in restored.rows] == ["uid-newer"]

    def test_a_version_mismatched_payload_reads_as_a_miss(
        self, cache: RedisSnapshotCache, client: fakeredis.FakeRedis
    ) -> None:
        """REQ-RCC-1: an incompatible snapshot is a clean miss, not a crash."""
        payload = json.loads(encode_snapshot(make_snapshot()))
        payload["schema_version"] = SNAPSHOT_SCHEMA_VERSION + 1
        client.set(SNAPSHOT_KEY, json.dumps(payload))

        assert cache.get() is None

    def test_a_corrupt_payload_reads_as_a_miss(
        self, cache: RedisSnapshotCache, client: fakeredis.FakeRedis
    ) -> None:
        """Undecodable bytes must never raise into startup."""
        client.set(SNAPSHOT_KEY, b"{truncated json")

        assert cache.get() is None


class TestRedisIsASoftDependency:
    """REQ-RCC-3: a cache failure is never a service failure."""

    def test_a_redis_error_on_get_returns_none_instead_of_raising(self) -> None:
        class ExplodingGet(fakeredis.FakeRedis):
            def get(self, name: object) -> bytes | None:
                raise redis.RedisError("GET failed")

        cache = RedisSnapshotCache(
            ExplodingGet(), ttl_seconds=TTL_SECONDS, lock_ttl_seconds=LOCK_TTL_SECONDS
        )

        assert cache.get() is None

    def test_get_returns_none_when_redis_is_unreachable(self) -> None:
        assert unreachable_cache().get() is None

    def test_put_never_raises_when_redis_is_down(self) -> None:
        """REQ-RCC-1: the snapshot write is best effort."""
        cache = unreachable_cache()

        cache.put(make_snapshot())

        assert cache.get() is None

    def test_a_redis_error_on_lock_acquisition_returns_false(self) -> None:
        """The lock is a stampede optimization, never a correctness dependency."""
        assert unreachable_cache().try_acquire_refresh_lock(LOCK_TTL_SECONDS) is False

    def test_releasing_never_raises_when_redis_is_down(self) -> None:
        unreachable_cache().release_refresh_lock()


class TestRefreshLock:
    """REQ-RCC-4 / D4: `SET NX PX` admits one holder and self-heals."""

    def test_only_the_first_caller_acquires_the_lock(
        self, client: fakeredis.FakeRedis
    ) -> None:
        first = RedisSnapshotCache(client, TTL_SECONDS, LOCK_TTL_SECONDS)
        second = RedisSnapshotCache(client, TTL_SECONDS, LOCK_TTL_SECONDS)

        assert first.try_acquire_refresh_lock(LOCK_TTL_SECONDS) is True
        assert second.try_acquire_refresh_lock(LOCK_TTL_SECONDS) is False

    def test_the_lock_carries_the_configured_px_expiry(
        self, cache: RedisSnapshotCache, client: fakeredis.FakeRedis
    ) -> None:
        cache.try_acquire_refresh_lock(LOCK_TTL_SECONDS)

        assert 0 < client.pttl(REFRESH_LOCK_KEY) <= LOCK_TTL_SECONDS * 1000

    def test_the_lock_defaults_to_the_configured_ttl(
        self, cache: RedisSnapshotCache, client: fakeredis.FakeRedis
    ) -> None:
        cache.try_acquire_refresh_lock()

        assert 0 < client.pttl(REFRESH_LOCK_KEY) <= LOCK_TTL_SECONDS * 1000

    def test_releasing_lets_the_next_caller_acquire(
        self, client: fakeredis.FakeRedis
    ) -> None:
        first = RedisSnapshotCache(client, TTL_SECONDS, LOCK_TTL_SECONDS)
        second = RedisSnapshotCache(client, TTL_SECONDS, LOCK_TTL_SECONDS)
        first.try_acquire_refresh_lock(LOCK_TTL_SECONDS)

        first.release_refresh_lock()

        assert second.try_acquire_refresh_lock(LOCK_TTL_SECONDS) is True

    def test_an_expired_lock_frees_itself(self, client: fakeredis.FakeRedis) -> None:
        """D4: a dead holder must never wedge refresh forever."""
        dead_holder = RedisSnapshotCache(client, TTL_SECONDS, LOCK_TTL_SECONDS)
        survivor = RedisSnapshotCache(client, TTL_SECONDS, LOCK_TTL_SECONDS)
        assert dead_holder.try_acquire_refresh_lock(0.05) is True
        assert survivor.try_acquire_refresh_lock(0.05) is False

        time.sleep(0.1)

        assert survivor.try_acquire_refresh_lock(LOCK_TTL_SECONDS) is True

    def test_the_lock_key_is_independent_of_the_snapshot_key(
        self, cache: RedisSnapshotCache, client: fakeredis.FakeRedis
    ) -> None:
        """Releasing the lock must not evict the snapshot it protects."""
        cache.put(make_snapshot())
        cache.try_acquire_refresh_lock(LOCK_TTL_SECONDS)

        cache.release_refresh_lock()

        assert client.exists(REFRESH_LOCK_KEY) == 0
        assert cache.get() is not None
