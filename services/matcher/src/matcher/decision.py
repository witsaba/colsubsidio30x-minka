"""Three-way decision layer (REQ-ENG-3/4/5, design D3).

`decide()` is pure over `TrigramSimilarityMatcher.rank()` output. A confident
wrong match is worse than `no_match`, so two independent ambiguity signals can
demote an otherwise strong result:

    top_score = ranked[0].score (0.0 when empty)
    margin    = top_score - second (second = 0.0 when there is no second)

    if top_score < MATCH_ACCEPT_SCORE               -> no_match
    elif margin < MATCH_AMBIGUITY_MARGIN
         or (tsr_1 - tsr_2) < MATCH_TSR_MARGIN      -> ambiguous
    else                                            -> matched

`tsr_i` are the two highest `token_set_ratio_01` scores between the query and
the top-`MATCH_MAX_CANDIDATES` articulo strings: a field of near-identical
names is crowded even when the trigram margin looks comfortable.

Status is always computed from the RAW pre-re-rank scores. The unit re-rank is
a stable partition inside the band `score >= top_score - MATCH_AMBIGUITY_MARGIN`
only: candidates outside the band never move, nothing is ever removed, and a
NULL `unidad` neither counts as unit-equal nor is penalized beyond keeping its
relative order. Since a `matched` result has, by definition, a single-candidate
band, the re-rank can only reorder crowds -- secondary, never a gate.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Protocol, Sequence

from matcher.config import Settings
from matcher.scoring import token_set_ratio_01
from matcher.units import UNIT_DISPLAY, resolve_unit

Status = Literal["matched", "ambiguous", "no_match"]


class RowLike(Protocol):
    """Structural type of everything the decision layer reads from a row."""

    articulo: str
    unidad: str | None
    nr_articulo: str | None


@dataclass(frozen=True)
class Candidate:
    """One ranked catalogue row as exposed to callers."""

    nr_articulo: str | None
    articulo: str
    unidad: str | None
    unidad_display: str | None
    score: float


@dataclass(frozen=True)
class Decision:
    """The full outcome of one match request."""

    status: Status
    candidates: list[Candidate]
    top_score: float
    margin: float


def _to_candidate(row: RowLike, score: float) -> Candidate:
    unidad = row.unidad
    return Candidate(
        nr_articulo=row.nr_articulo,
        articulo=row.articulo,
        unidad=unidad,
        # NULL unidad has no display copy; never coerced to "Unidad"/"unidades".
        unidad_display=UNIT_DISPLAY.get(unidad) if unidad is not None else None,
        score=score,
    )


def _is_crowded(candidates: Sequence[Candidate], query: str, tsr_margin: float) -> bool:
    """True when the two highest token_set_ratio scores sit within the margin."""
    if len(candidates) < 2:
        return False
    scores = sorted(
        (token_set_ratio_01(query, c.articulo) for c in candidates), reverse=True
    )
    return (scores[0] - scores[1]) < tsr_margin


def _unit_rerank(
    candidates: list[Candidate], unit: str | None, settings: Settings
) -> list[Candidate]:
    """Stable partition of the ambiguity band: unit-equal candidates first."""
    if not settings.match_unit_rerank or not candidates:
        return candidates
    canonical = resolve_unit(unit)
    if canonical is None:
        return candidates

    floor = candidates[0].score - settings.match_ambiguity_margin
    band = [c for c in candidates if c.score >= floor]
    if len(band) < 2:
        return candidates
    tail = candidates[len(band) :]

    equal = [c for c in band if c.unidad == canonical]
    other = [c for c in band if c.unidad != canonical]
    return equal + other + tail


def decide(
    ranked: Sequence[tuple[RowLike, float]],
    query: str,
    unit: str | None,
    settings: Settings,
) -> Decision:
    """Turn a ranked candidate list into a status plus ordered candidates."""
    top = list(ranked[: settings.match_max_candidates])
    candidates = [_to_candidate(row, score) for row, score in top]

    top_score = candidates[0].score if candidates else 0.0
    second = candidates[1].score if len(candidates) > 1 else 0.0
    margin = top_score - second

    if top_score < settings.match_accept_score:
        status: Status = "no_match"
    elif margin < settings.match_ambiguity_margin or _is_crowded(
        candidates, query, settings.match_tsr_margin
    ):
        status = "ambiguous"
    else:
        status = "matched"

    return Decision(
        status=status,
        candidates=_unit_rerank(candidates, unit, settings),
        top_score=top_score,
        margin=margin,
    )
