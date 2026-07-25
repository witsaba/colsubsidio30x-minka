"""In-memory matcher service (REQ-API-1/2, design D2/D4/D5).

`MatcherService` composes two ports -- a `CatalogueSource` (Supabase) and a
`SnapshotCache` (Redis) -- with the promoted trigram matcher and the pure
`decide()` function. The catalogue is resolved once in `__init__` through
`load_index`, so a catalogue that cannot be produced aborts startup
(`CatalogueUnavailableError`) instead of failing at first request; an unknown
`catalogue_id` at request time is a separate client error
(`UnknownCatalogueError`) and must never be reported as a `no_match`.

`catalogue_id` is a `warehouses.code`: the SQLite stock-table names are gone
with the loader that read them (REQ-CSS-1, REQ-API-2, BREAKING).

The service holds exactly one mutable attribute, `_index`, a frozen
`CatalogueIndex` bundling the catalogue AND the matcher already built over it.
Reads take that reference once at entry, so a refresh that replaces it can
never expose a catalogue paired with a foreign matcher (D4). `match()` performs
no I/O whatsoever: everything it needs is already in memory (REQ-RCC-3).

Queries are passed to the matcher exactly as the spike's evaluated
configuration did -- the promoted `TrigramSimilarityMatcher` scores raw
`articulo` text -- so the measured accuracy carries over unchanged.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import UTC, datetime

from matcher.catalogue import (
    SOURCE_REDIS_SNAPSHOT,
    SOURCE_SUPABASE,
    as_utc,
    flatten_catalogue,
    group_rows,
    load_index,
)
from matcher.config import Settings
from matcher.decision import Decision, decide
from matcher.ports import CatalogueSource, Row, Snapshot, SnapshotCache
from matcher.scoring import TrigramSimilarityMatcher

logger = logging.getLogger("matcher")


class UnknownCatalogueError(LookupError):
    """The requested `catalogue_id` is not one of the loaded warehouse codes."""


@dataclass(frozen=True)
class CatalogueIndex:
    """One catalogue and the matcher built over it, swapped as a single unit."""

    catalogue: dict[str, list[Row]]
    matcher: TrigramSimilarityMatcher
    source: str
    loaded_at: datetime


def build_index(
    catalogue: dict[str, list[Row]], source: str, loaded_at: datetime
) -> CatalogueIndex:
    """Build a complete, ready-to-serve index off to the side."""
    matcher = TrigramSimilarityMatcher()
    matcher.build(catalogue)
    return CatalogueIndex(
        catalogue=catalogue,
        matcher=matcher,
        source=source,
        loaded_at=as_utc(loaded_at),
    )


class MatcherService:
    """Resolves the catalogue at startup and answers requests from memory."""

    def __init__(
        self,
        settings: Settings,
        source: CatalogueSource,
        cache: SnapshotCache,
    ) -> None:
        self.settings = settings
        self._source = source
        self._cache = cache
        # Raises CatalogueUnavailableError -> the process must exit non-zero.
        loaded = load_index(source, cache, settings.catalogue_cache_ttl_seconds)
        self._index = build_index(loaded.catalogue, loaded.source, loaded.loaded_at)

    @property
    def source(self) -> str:
        """Where the currently served catalogue came from, for the log line."""
        return self._index.source

    def refresh(self) -> bool:
        """Run one refresh cycle. Returns whether the index was replaced.

        Called from the background loop in `main`, so it never raises: any
        failure is stale-while-refresh (REQ-RCC-3) -- the previous index keeps
        serving, the existing snapshot is left untouched, a WARNING is logged,
        and the next jittered cycle tries again.

        Cross-replica coordination is a `SET NX PX` lock (REQ-RCC-4). Winning it
        means fetching Supabase and publishing the snapshot. Losing it means the
        winner is already fetching, so this replica adopts the winner's snapshot
        when it is newer and otherwise skips the cycle -- either way, **zero**
        source calls. The lock is stampede control and not a correctness
        dependency: a Redis that can serve neither the lock nor a snapshot is
        bypassed and the refresh goes straight to the source (D4).
        """
        try:
            return self._refresh()
        except Exception as exc:  # noqa: BLE001 - a refresh must never escape
            logger.warning(
                "catalogue refresh failed, still serving the catalogue "
                "loaded at %s: %s",
                self._index.loaded_at,
                exc,
            )
            return False

    def _refresh(self) -> bool:
        if not self._try_acquire_lock():
            return self._follow_the_winner()
        try:
            return self._refresh_from_source()
        finally:
            self._guarded("refresh lock not released", self._cache.release_refresh_lock)

    def _refresh_from_source(self) -> bool:
        """Fetch the authoritative catalogue, swap it in, publish the snapshot."""
        catalogue = self._source.load()
        loaded_at = datetime.now(UTC)
        self._index = build_index(catalogue, SOURCE_SUPABASE, loaded_at)
        self._guarded(
            "refreshed snapshot not cached",
            self._cache.put,
            Snapshot(rows=flatten_catalogue(catalogue), loaded_at=loaded_at),
        )
        return True

    def _follow_the_winner(self) -> bool:
        """Adopt the lock winner's snapshot, or skip -- never fetch (REQ-RCC-4)."""
        snapshot = self._guarded("refresh could not read the snapshot", self._cache.get)
        if snapshot is None or not snapshot.rows:
            # No lock *and* no snapshot: Redis is unusable rather than busy, so
            # there is no winner to defer to. Refresh directly from the source.
            return self._refresh_from_source()
        loaded_at = as_utc(snapshot.loaded_at)
        if loaded_at <= self._index.loaded_at:
            return False
        self._index = build_index(
            group_rows(snapshot.rows), SOURCE_REDIS_SNAPSHOT, loaded_at
        )
        return True

    def _try_acquire_lock(self) -> bool:
        """A lock that cannot be reached is a refused lock, never an error."""
        return bool(
            self._guarded(
                "refresh lock unavailable", self._cache.try_acquire_refresh_lock
            )
        )

    @staticmethod
    def _guarded(what: str, call, *args):  # type: ignore[no-untyped-def]
        """Run a cache call whose failure must degrade instead of propagating.

        `RedisSnapshotCache` already swallows every `redis.RedisError`; this
        guard covers a cache that breaks its own port contract, because Redis is
        a soft dependency of the matcher and must never take a refresh -- or a
        request -- down with it (REQ-RCC-3).
        """
        try:
            return call(*args)
        except Exception as exc:  # noqa: BLE001 - the cache is a soft dependency
            logger.warning("%s: %s", what, exc)
            return None

    def catalogues(self) -> list[tuple[str, int]]:
        """`(catalogue_id, row_count)` for each loaded warehouse code."""
        index = self._index
        return [(code, len(rows)) for code, rows in index.catalogue.items()]

    def match(self, catalogue_id: str, spoken_name: str, unit: str | None) -> Decision:
        """Rank one spoken product name against a warehouse and decide."""
        index = self._index
        if catalogue_id not in index.catalogue:
            raise UnknownCatalogueError(f"unknown catalogue_id '{catalogue_id}'")
        ranked = index.matcher.rank(
            catalogue_id, spoken_name, top_k=self.settings.match_max_candidates
        )
        return decide(ranked, spoken_name, unit, self.settings)
