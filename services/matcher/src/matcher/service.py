"""In-memory matcher service (REQ-API-2/4/5, design §Error Handling).

`MatcherService` composes the three layers built so far: the read-only
catalogue loader, the promoted trigram matcher, and the pure `decide()`
function. The catalogue is loaded once in `__init__` so a broken database
aborts startup (`CatalogueUnavailableError`) instead of failing at first
request; an unknown `catalogue_id` at request time is a separate client error
(`UnknownCatalogueError`) and must never be reported as a `no_match`.

Queries are passed to the matcher exactly as the spike's evaluated
configuration did -- the promoted `TrigramSimilarityMatcher` scores raw
`articulo` text -- so the measured accuracy carries over unchanged.
"""
from __future__ import annotations

from matcher.catalogue import load_catalogue
from matcher.config import Settings
from matcher.decision import Decision, decide
from matcher.scoring import TrigramSimilarityMatcher


class UnknownCatalogueError(LookupError):
    """The requested `catalogue_id` is not one of the loaded stock tables."""


class MatcherService:
    """Loads the catalogue at startup and answers match requests from memory."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        # Raises CatalogueUnavailableError -> the process must exit non-zero.
        self._catalogue = load_catalogue(settings.catalogue_db)
        self._matcher = TrigramSimilarityMatcher()
        self._matcher.build(self._catalogue)

    def catalogues(self) -> list[tuple[str, int]]:
        """`(catalogue_id, row_count)` for each loaded stock table."""
        return [(table, len(rows)) for table, rows in self._catalogue.items()]

    def match(self, catalogue_id: str, spoken_name: str, unit: str | None) -> Decision:
        """Rank one spoken product name against a catalogue and decide."""
        if catalogue_id not in self._catalogue:
            raise UnknownCatalogueError(f"unknown catalogue_id '{catalogue_id}'")
        ranked = self._matcher.rank(
            catalogue_id, spoken_name, top_k=self.settings.match_max_candidates
        )
        return decide(ranked, spoken_name, unit, self.settings)
