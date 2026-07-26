"""Trigram ranking, promoted from `spikes/matching/matchers.py` (design D2).

Only the measured winner is promoted: `TrigramSimilarityMatcher.rank()` with
its body unchanged, plus a bounded `token_set_ratio_01()` wrapper used by the
decision layer's crowding check.

Deliberately NOT promoted (research-only in the spike): the FTS5/bm25 matcher,
the RapidFuzz `WRatio` matcher (banned by REQ-ENG-2), the word-similarity
variant, and the hybrid token-overlap matcher. Stock level (`sd`) is never a
matching prior and there is no two-stage retrieval.
"""
from __future__ import annotations

from typing import Protocol

from rapidfuzz import fuzz
from rapidfuzz.utils import default_process

from matcher.normalize import strip_accents, trgm_similarity


class RowLike(Protocol):
    """Structural type of everything `rank()` reads from a catalogue row."""

    articulo: str
    uid: str


def _rf_processor(s: str) -> str:
    """The spike's exact RapidFuzz processor: accent stripping, then default."""
    return default_process(strip_accents(s))


def token_set_ratio_01(a: str, b: str) -> float:
    """`fuzz.token_set_ratio` rescaled from 0-100 to the 0.0-1.0 score domain."""
    return fuzz.token_set_ratio(a, b, processor=_rf_processor) / 100.0


class TrigramSimilarityMatcher:
    """Faithful reimplementation of pg_trgm similarity(), promoted unchanged."""

    name = "pg_trgm_similarity"

    def __init__(self) -> None:
        self.rows_by_table: dict[str, list[RowLike]] = {}

    def build(self, catalogue: dict[str, list[RowLike]]) -> None:
        self.rows_by_table = catalogue

    def rank(
        self, table: str, query: str, top_k: int = 10
    ) -> list[tuple[RowLike, float]]:
        rows = self.rows_by_table[table]
        scored = []
        for r in rows:
            s = trgm_similarity(query, r.articulo)
            scored.append((r, s))
        # Descending score, then ascending `uid` as a deterministic tie-break.
        # The scoring function is untouched: `uid` is consulted ONLY between
        # rows whose scores are exactly equal, so it can never outrank a better
        # score and it is not a matching prior (REQ-ENG-2 still holds).
        #
        # Without it, rank 1 inside a tie cluster is decided by the order the
        # catalogue source happened to return rows in -- measured, that alone
        # moved top-1 accuracy when the source changed from SQLite `rowid` order
        # to `warehouse_products.id` order, with identical rows and an identical
        # engine. A stable key makes ranking a property of the data, not of the
        # transport. It picks a *stable* winner among equals, not a *better* one.
        scored.sort(key=lambda t: (-t[1], t[0].uid))
        return scored[:top_k]
