"""Redis snapshot cache: keys and the versioned JSON codec (design D3).

The catalogue is cached as one JSON value under a versioned key:

    {"schema_version": 1,
     "loaded_at": "<iso8601 utc>",
     "rows": [{"warehouse_code", "uid", "articulo", "unidad", "nr_articulo"}]}

JSON, not pickle: a shared cache must never be a deserialization-to-code path,
and the value stays readable with `redis-cli GET`. The version lives both in
the payload and in the key suffix, so an incompatible format is a clean miss
rather than a parse error on live data. It is a code constant on purpose --
an env-tunable schema version could desync from the parser that reads it.

`decode_snapshot` is total: every malformed, truncated, or version-mismatched
value returns `None`, which the caller treats exactly like a cache miss
(REQ-RCC-1).

The codec serializes exactly the five `Row` fields and nothing else, so no
stock quantity can enter Redis (REQ-RCC-5, RF-18).

`RedisSnapshotCache` is the adapter behind the `SnapshotCache` port. Redis is a
*soft* dependency of the matcher: every `redis.RedisError` is swallowed into a
miss, a no-op, or a refused lock, so a dead cache degrades to a Supabase read
and can never surface on `POST /match` (REQ-RCC-3).
"""
from __future__ import annotations

import json
from dataclasses import asdict
from datetime import UTC, datetime

import redis

from matcher.ports import Row, Snapshot

SNAPSHOT_SCHEMA_VERSION = 1
SNAPSHOT_KEY = f"matcher:catalogue:snapshot:v{SNAPSHOT_SCHEMA_VERSION}"
REFRESH_LOCK_KEY = f"matcher:catalogue:refresh-lock:v{SNAPSHOT_SCHEMA_VERSION}"


def _as_utc(moment: datetime) -> datetime:
    """Naive timestamps are read as UTC; staleness is judged against UTC now."""
    if moment.tzinfo is None:
        return moment.replace(tzinfo=UTC)
    return moment.astimezone(UTC)


def encode_snapshot(snapshot: Snapshot) -> bytes:
    """Serialize a snapshot to the versioned payload stored in Redis."""
    payload = {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "loaded_at": _as_utc(snapshot.loaded_at).isoformat(),
        "rows": [asdict(row) for row in snapshot.rows],
    }
    return json.dumps(payload, ensure_ascii=False).encode("utf-8")


def decode_snapshot(raw: bytes | str | None) -> Snapshot | None:
    """Parse a stored payload, or return `None` for anything unusable."""
    if not raw:
        return None
    try:
        payload = json.loads(raw)
        if payload["schema_version"] != SNAPSHOT_SCHEMA_VERSION:
            return None
        loaded_at = _as_utc(datetime.fromisoformat(payload["loaded_at"]))
        rows = [
            Row(
                warehouse_code=row["warehouse_code"],
                uid=row["uid"],
                articulo=row["articulo"],
                unidad=row["unidad"],
                nr_articulo=row["nr_articulo"],
            )
            for row in payload["rows"]
        ]
    except (ValueError, TypeError, KeyError, AttributeError):
        return None
    return Snapshot(rows=rows, loaded_at=loaded_at)


class RedisSnapshotCache:
    """Redis-backed `SnapshotCache`: versioned snapshot plus the refresh lock.

    `ttl_seconds` is the *freshness* window used to decide whether a snapshot
    is worth reusing. The Redis key expiry is deliberately twice that (D3): a
    replica restarting after one missed refresh still finds a stale-but-real
    snapshot to serve while it re-reads Supabase, instead of an empty slot.
    Staleness is judged from `Snapshot.loaded_at`, never from key expiry.
    """

    def __init__(
        self,
        client: redis.Redis,
        ttl_seconds: int,
        lock_ttl_seconds: float,
    ) -> None:
        self._client = client
        self._ttl_seconds = ttl_seconds
        self._lock_ttl_seconds = lock_ttl_seconds

    def get(self) -> Snapshot | None:
        """The cached snapshot, or `None` on miss, corruption or Redis error."""
        try:
            raw = self._client.get(SNAPSHOT_KEY)
        except redis.RedisError:
            return None
        return decode_snapshot(raw)

    def put(self, snapshot: Snapshot) -> None:
        """Store the snapshot at twice the freshness TTL. Best effort."""
        try:
            self._client.set(
                SNAPSHOT_KEY,
                encode_snapshot(snapshot),
                ex=2 * self._ttl_seconds,
            )
        except redis.RedisError:
            return

    def try_acquire_refresh_lock(self, ttl_seconds: float | None = None) -> bool:
        """Claim the right to refresh from the source via `SET NX PX`.

        The expiry frees a holder that died mid-refresh; no fencing token is
        needed because a duplicate Supabase read is idempotent and harmless
        (D4). A Redis error refuses the lock rather than raising -- the caller
        then refreshes directly, since the lock is stampede control and not a
        correctness dependency.
        """
        expiry = self._lock_ttl_seconds if ttl_seconds is None else ttl_seconds
        try:
            acquired = self._client.set(
                REFRESH_LOCK_KEY, b"1", nx=True, px=int(expiry * 1000)
            )
        except redis.RedisError:
            return False
        return bool(acquired)

    def release_refresh_lock(self) -> None:
        """Release the refresh lock. Best effort -- never raises."""
        try:
            self._client.delete(REFRESH_LOCK_KEY)
        except redis.RedisError:
            return
