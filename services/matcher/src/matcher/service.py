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

from dataclasses import dataclass

from matcher.catalogue import load_index
from matcher.config import Settings
from matcher.decision import Decision, decide
from matcher.ports import CatalogueSource, Row, SnapshotCache
from matcher.scoring import TrigramSimilarityMatcher


class UnknownCatalogueError(LookupError):
    """The requested `catalogue_id` is not one of the loaded warehouse codes."""


@dataclass(frozen=True)
class CatalogueIndex:
    """One catalogue and the matcher built over it, swapped as a single unit."""

    catalogue: dict[str, list[Row]]
    matcher: TrigramSimilarityMatcher
    source: str


def build_index(catalogue: dict[str, list[Row]], source: str) -> CatalogueIndex:
    """Build a complete, ready-to-serve index off to the side."""
    matcher = TrigramSimilarityMatcher()
    matcher.build(catalogue)
    return CatalogueIndex(catalogue=catalogue, matcher=matcher, source=source)


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
        self._index = build_index(loaded.catalogue, loaded.source)

    @property
    def source(self) -> str:
        """Where the currently served catalogue came from, for the log line."""
        return self._index.source

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
