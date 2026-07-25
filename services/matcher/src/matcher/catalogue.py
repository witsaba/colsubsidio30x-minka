"""Catalogue resolution at startup (REQ-CSS-1/5, design D2/D5).

The catalogue no longer comes from a SQLite file: it is read from Supabase
through a `CatalogueSource` and cached as a versioned snapshot behind a
`SnapshotCache`. `load_index` is the fallback chain between the two.

`Row`, `Snapshot` and the two Protocols live in `ports.py` and are re-exported
here, so the public `matcher.catalogue.Row` import path design D2 specifies
keeps resolving. The SQLite loader (`STOCK_TABLES`, `open_readonly`,
`load_catalogue` and the old stock-carrying `Row`) is deleted with the
requirement it served: REQ-API-5 is REMOVED by this change's spec delta, and
under REQ-CSS-4 stock is now never even loaded.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from matcher.ports import CatalogueSource, Row, Snapshot, SnapshotCache

__all__ = [
    "CatalogueSource",
    "CatalogueUnavailableError",
    "LoadedCatalogue",
    "Row",
    "Snapshot",
    "SnapshotCache",
    "load_index",
]

logger = logging.getLogger("matcher")

SOURCE_REDIS_SNAPSHOT = "redis-snapshot"
SOURCE_REDIS_SNAPSHOT_STALE = "redis-snapshot-stale"
SOURCE_SUPABASE = "supabase"


class CatalogueUnavailableError(RuntimeError):
    """The catalogue cannot be loaded: startup must abort, never serve empty."""


@dataclass(frozen=True)
class LoadedCatalogue:
    """The catalogue plus where it came from, for the startup log line."""

    catalogue: dict[str, list[Row]]
    source: str


def _group(rows: list[Row]) -> dict[str, list[Row]]:
    """Rebuild the per-warehouse grouping from a flat snapshot payload."""
    grouped: dict[str, list[Row]] = {}
    for row in rows:
        grouped.setdefault(row.warehouse_code, []).append(row)
    return grouped


def _flatten(catalogue: dict[str, list[Row]]) -> list[Row]:
    return [row for rows in catalogue.values() for row in rows]


def _is_fresh(snapshot: Snapshot, ttl_seconds: int) -> bool:
    """Freshness is judged from `loaded_at`, never from the Redis key expiry."""
    loaded_at = snapshot.loaded_at
    if loaded_at.tzinfo is None:
        loaded_at = loaded_at.replace(tzinfo=UTC)
    return (datetime.now(UTC) - loaded_at).total_seconds() < ttl_seconds


def _cached(cache: SnapshotCache) -> Snapshot | None:
    """Read the cache, tolerating an adapter that fails louder than its port.

    `RedisSnapshotCache` already swallows every `redis.RedisError` into a miss,
    so this guard only catches a cache that breaks its own contract -- but a
    cache is a soft dependency (REQ-RCC-3) and must never abort a startup that
    Supabase could still serve. A snapshot with no rows is treated as a miss:
    an empty catalogue is never a valid result (REQ-CSS-5).
    """
    try:
        snapshot = cache.get()
    except Exception as exc:  # noqa: BLE001 - a cache must never break startup
        logger.warning("catalogue snapshot unreadable, ignoring cache: %s", exc)
        return None
    if snapshot is None or not snapshot.rows:
        return None
    return snapshot


def load_index(
    source: CatalogueSource,
    cache: SnapshotCache,
    ttl_seconds: int,
) -> LoadedCatalogue:
    """Resolve the catalogue at startup through the D5 fallback chain.

    1. a fresh snapshot is used as-is -- **zero** source calls (REQ-RCC-1);
    2. otherwise the source is read and the snapshot written back (best effort);
    3. otherwise a stale-but-parseable snapshot is served with a warning;
    4. otherwise `CatalogueUnavailableError` aborts startup (REQ-CSS-5).
    """
    snapshot = _cached(cache)
    if snapshot is not None and _is_fresh(snapshot, ttl_seconds):
        return LoadedCatalogue(_group(snapshot.rows), SOURCE_REDIS_SNAPSHOT)

    try:
        catalogue = source.load()
    except CatalogueUnavailableError as exc:
        if snapshot is None:
            raise
        logger.warning(
            "catalogue source unavailable, serving the stale snapshot "
            "loaded at %s: %s",
            snapshot.loaded_at,
            exc,
        )
        return LoadedCatalogue(_group(snapshot.rows), SOURCE_REDIS_SNAPSHOT_STALE)

    try:
        cache.put(Snapshot(rows=_flatten(catalogue), loaded_at=datetime.now(UTC)))
    except Exception as exc:  # noqa: BLE001 - the write back is best effort
        logger.warning("catalogue snapshot not cached: %s", exc)
    return LoadedCatalogue(catalogue, SOURCE_SUPABASE)
