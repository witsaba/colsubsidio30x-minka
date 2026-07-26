"""T6 RED — the three-way decision layer (REQ-ENG-3/4/5, design D3).

`decide()` is pure over `rank()` output: no I/O, no catalogue, no settings
globals. Statuses come from the RAW pre-re-rank trigram scores; the unit
re-rank only reorders candidates inside the ambiguity band and can never
remove, gate, or penalize anything.
"""
from __future__ import annotations

from dataclasses import dataclass

import pytest

from matcher.config import Settings
from matcher.decision import Candidate, Decision, decide
from matcher.units import resolve_unit


@dataclass(frozen=True)
class FakeRow:
    """Minimal structural stand-in for a catalogue row."""

    articulo: str
    unidad: str | None = None
    nr_articulo: str | None = None


def settings(**overrides: object) -> Settings:
    base: dict[str, object] = {
        "match_accept_score": 0.50,
        "match_ambiguity_margin": 0.08,
        "match_tsr_margin": 0.08,
        "match_max_candidates": 5,
        "match_unit_rerank": True,
    }
    base.update(overrides)
    return Settings(**base)  # type: ignore[arg-type]


# Two rows whose token sets differ sharply -> uncrowded token_set_ratio field.
UNCROWDED = [
    (FakeRow("ACHIOTE MOLIDO", "KG", "7003"), 0.87),
    (FakeRow("ARROZ BLANCO", "KG", "7004"), 0.66),
]
UNCROWDED_QUERY = "achiote molido"

# Two rows that both contain the full query token set -> tsr_1 == tsr_2 == 1.0.
CROWDED = [
    (FakeRow("ACEITE DE OLIVA 500", "LT", "8001"), 0.90),
    (FakeRow("ACEITE DE OLIVA 1000", "LT", "8002"), 0.70),
]
CROWDED_QUERY = "aceite de oliva"


class TestStatusTruthTable:
    def test_clear_winner_is_matched(self) -> None:
        result = decide(UNCROWDED, UNCROWDED_QUERY, None, settings())
        assert result.status == "matched"

    def test_clear_winner_reports_top_score_and_margin(self) -> None:
        result = decide(UNCROWDED, UNCROWDED_QUERY, None, settings())
        assert result.top_score == pytest.approx(0.87)
        assert result.margin == pytest.approx(0.21)

    def test_low_top_score_is_no_match(self) -> None:
        ranked = [(FakeRow("ARROZ BLANCO", "KG", "7004"), 0.31)]
        result = decide(ranked, "tabla de picar", None, settings())
        assert result.status == "no_match"

    def test_no_match_asserts_no_sku(self) -> None:
        ranked = [(FakeRow("ARROZ BLANCO", "KG", "7004"), 0.31)]
        result = decide(ranked, "tabla de picar", None, settings())
        # Candidates are still returned for review, but the status asserts nothing.
        assert result.status == "no_match"
        assert result.top_score == pytest.approx(0.31)

    def test_score_exactly_at_accept_is_not_no_match(self) -> None:
        ranked = [
            (FakeRow("ACHIOTE MOLIDO", "KG", "7003"), 0.50),
            (FakeRow("ARROZ BLANCO", "KG", "7004"), 0.10),
        ]
        result = decide(ranked, UNCROWDED_QUERY, None, settings())
        assert result.status == "matched"

    def test_narrow_trigram_margin_is_ambiguous(self) -> None:
        ranked = [
            (FakeRow("ACHIOTE MOLIDO", "KG", "7003"), 0.80),
            (FakeRow("ARROZ BLANCO", "KG", "7004"), 0.75),
        ]
        result = decide(ranked, UNCROWDED_QUERY, None, settings())
        assert result.status == "ambiguous"

    def test_margin_exactly_at_threshold_is_not_ambiguous(self) -> None:
        ranked = [
            (FakeRow("ACHIOTE MOLIDO", "KG", "7003"), 0.80),
            (FakeRow("ARROZ BLANCO", "KG", "7004"), 0.72),
        ]
        result = decide(ranked, UNCROWDED_QUERY, None, settings())
        assert result.status == "matched"

    def test_single_candidate_has_full_margin(self) -> None:
        ranked = [(FakeRow("ACHIOTE MOLIDO", "KG", "7003"), 0.87)]
        result = decide(ranked, UNCROWDED_QUERY, None, settings())
        assert result.margin == pytest.approx(0.87)
        assert result.status == "matched"

    def test_empty_ranked_list(self) -> None:
        result = decide([], "???", None, settings())
        assert result.candidates == []
        assert result.top_score == 0.0
        assert result.margin == 0.0

    def test_empty_ranked_list_is_no_match(self) -> None:
        assert decide([], "???", None, settings()).status == "no_match"

    def test_status_is_one_of_three(self) -> None:
        for ranked, query in ((UNCROWDED, UNCROWDED_QUERY), (CROWDED, CROWDED_QUERY)):
            assert decide(ranked, query, None, settings()).status in {
                "matched",
                "ambiguous",
                "no_match",
            }


class TestCrowdingCheck:
    def test_wide_margin_but_crowded_tsr_is_ambiguous(self) -> None:
        result = decide(CROWDED, CROWDED_QUERY, None, settings())
        assert result.margin >= 0.08
        assert result.status == "ambiguous"

    def test_uncrowded_tsr_stays_matched(self) -> None:
        result = decide(UNCROWDED, UNCROWDED_QUERY, None, settings())
        assert result.status == "matched"

    def test_crowding_uses_its_own_threshold(self) -> None:
        # Zero tsr margin disables the crowding signal; nothing else changes.
        result = decide(CROWDED, CROWDED_QUERY, None, settings(match_tsr_margin=0.0))
        assert result.status == "matched"

    def test_raising_tsr_margin_flags_an_uncrowded_field(self) -> None:
        result = decide(
            UNCROWDED, UNCROWDED_QUERY, None, settings(match_tsr_margin=1.0)
        )
        assert result.status == "ambiguous"

    def test_crowding_only_applies_above_the_accept_gate(self) -> None:
        low = [(row, score * 0.3) for row, score in CROWDED]
        result = decide(low, CROWDED_QUERY, None, settings())
        assert result.status == "no_match"

    def test_crowding_considers_at_most_max_candidates(self) -> None:
        # The crowding twin sits at position 6 and must be ignored at top-5.
        ranked = [
            (FakeRow("ACEITE DE OLIVA 500", "LT", "8001"), 0.90),
            (FakeRow("ARROZ BLANCO", "KG", "1"), 0.40),
            (FakeRow("AZUCAR MORENA", "KG", "2"), 0.30),
            (FakeRow("SAL MARINA", "KG", "3"), 0.20),
            (FakeRow("PANELA", "KG", "4"), 0.10),
            (FakeRow("ACEITE DE OLIVA 1000", "LT", "8002"), 0.05),
        ]
        result = decide(ranked, CROWDED_QUERY, None, settings())
        assert result.status == "matched"
        assert len(result.candidates) == 5

    def test_single_candidate_is_never_crowded(self) -> None:
        ranked = [(FakeRow("ACEITE DE OLIVA 500", "LT", "8001"), 0.90)]
        assert decide(ranked, CROWDED_QUERY, None, settings()).status == "matched"


class TestThresholdsAreConfigurable:
    def test_raising_accept_score_flips_matched_to_no_match(self) -> None:
        ranked = [
            (FakeRow("ACHIOTE MOLIDO", "KG", "7003"), 0.55),
            (FakeRow("ARROZ BLANCO", "KG", "7004"), 0.20),
        ]
        assert decide(ranked, UNCROWDED_QUERY, None, settings()).status == "matched"
        assert (
            decide(
                ranked, UNCROWDED_QUERY, None, settings(match_accept_score=0.60)
            ).status
            == "no_match"
        )

    def test_widening_ambiguity_margin_flips_matched_to_ambiguous(self) -> None:
        assert (
            decide(
                UNCROWDED, UNCROWDED_QUERY, None, settings(match_ambiguity_margin=0.30)
            ).status
            == "ambiguous"
        )

    def test_max_candidates_truncates_the_response(self) -> None:
        ranked = [(FakeRow(f"ITEM {i}", "UND", str(i)), 0.9 - i / 100) for i in range(9)]
        result = decide(ranked, "item 0", None, settings(match_max_candidates=3))
        assert len(result.candidates) == 3


class TestCandidateShape:
    def test_candidate_fields_are_carried_through(self) -> None:
        result = decide(UNCROWDED, UNCROWDED_QUERY, None, settings())
        top = result.candidates[0]
        assert isinstance(top, Candidate)
        assert top.nr_articulo == "7003"
        assert top.articulo == "ACHIOTE MOLIDO"
        assert top.unidad == "KG"
        assert top.score == pytest.approx(0.87)

    def test_unidad_display_is_the_spanish_copy(self) -> None:
        result = decide(UNCROWDED, UNCROWDED_QUERY, None, settings())
        assert result.candidates[0].unidad_display == "kg"

    def test_null_unidad_surfaces_as_none_not_unidad(self) -> None:
        ranked = [(FakeRow("ACHIOTE MOLIDO", None, "7003"), 0.87)]
        top = decide(ranked, UNCROWDED_QUERY, None, settings()).candidates[0]
        assert top.unidad is None
        assert top.unidad_display is None

    def test_unknown_canonical_unit_has_no_display(self) -> None:
        ranked = [(FakeRow("ACHIOTE MOLIDO", "Furlong", "7003"), 0.87)]
        top = decide(ranked, UNCROWDED_QUERY, None, settings()).candidates[0]
        assert top.unidad == "Furlong"
        assert top.unidad_display is None

    def test_decision_is_frozen(self) -> None:
        result = decide(UNCROWDED, UNCROWDED_QUERY, None, settings())
        assert isinstance(result, Decision)
        with pytest.raises(Exception):
            result.status = "no_match"  # type: ignore[misc]


class TestUnitRerank:
    def _band_case(self) -> list[tuple[FakeRow, float]]:
        return [
            (FakeRow("ACEITE VEGETAL", "KG", "1"), 0.90),
            (FakeRow("ACEITE DE OLIVA", "LT", "2"), 0.86),
            (FakeRow("ACEITE DE PALMA", "LT", "3"), 0.50),
        ]

    def test_unit_equal_candidate_moves_up_inside_the_band(self) -> None:
        result = decide(self._band_case(), "aceite", "litros", settings())
        assert [c.nr_articulo for c in result.candidates][:2] == ["2", "1"]

    def test_candidates_outside_the_band_never_move(self) -> None:
        result = decide(self._band_case(), "aceite", "litros", settings())
        assert result.candidates[-1].nr_articulo == "3"

    def test_rerank_never_removes_a_candidate(self) -> None:
        result = decide(self._band_case(), "aceite", "litros", settings())
        assert sorted(c.nr_articulo or "" for c in result.candidates) == ["1", "2", "3"]

    def test_rerank_does_not_change_scores(self) -> None:
        result = decide(self._band_case(), "aceite", "litros", settings())
        by_id = {c.nr_articulo: c.score for c in result.candidates}
        assert by_id == {
            "1": pytest.approx(0.90),
            "2": pytest.approx(0.86),
            "3": pytest.approx(0.50),
        }

    def test_status_uses_raw_pre_rerank_scores(self) -> None:
        # Raw top1-top2 margin is 0.04 < 0.08 -> ambiguous, despite the re-rank.
        result = decide(self._band_case(), "aceite", "litros", settings())
        assert result.status == "ambiguous"
        assert result.top_score == pytest.approx(0.90)
        assert result.margin == pytest.approx(0.04)

    def test_rerank_disabled_keeps_raw_order(self) -> None:
        result = decide(
            self._band_case(), "aceite", "litros", settings(match_unit_rerank=False)
        )
        assert [c.nr_articulo for c in result.candidates] == ["1", "2", "3"]

    def test_no_request_unit_keeps_raw_order(self) -> None:
        result = decide(self._band_case(), "aceite", None, settings())
        assert [c.nr_articulo for c in result.candidates] == ["1", "2", "3"]

    def test_unrecognized_request_unit_keeps_raw_order(self) -> None:
        result = decide(self._band_case(), "aceite", "barriles", settings())
        assert [c.nr_articulo for c in result.candidates] == ["1", "2", "3"]

    def test_null_unidad_never_counts_as_unit_equal(self) -> None:
        ranked = [
            (FakeRow("ACEITE VEGETAL", None, "1"), 0.90),
            (FakeRow("ACEITE DE OLIVA", "LT", "2"), 0.86),
        ]
        result = decide(ranked, "aceite", "litros", settings())
        assert [c.nr_articulo for c in result.candidates] == ["2", "1"]

    def test_null_unidad_is_not_penalized_beyond_stable_order(self) -> None:
        ranked = [
            (FakeRow("ACEITE VEGETAL", None, "1"), 0.90),
            (FakeRow("ACEITE DE PALMA", "KG", "2"), 0.88),
        ]
        # No unit-equal candidate at all -> order is untouched.
        result = decide(ranked, "aceite", "litros", settings())
        assert [c.nr_articulo for c in result.candidates] == ["1", "2"]

    def test_rerank_is_stable_among_unit_equal_candidates(self) -> None:
        ranked = [
            (FakeRow("ACEITE VEGETAL", "KG", "1"), 0.90),
            (FakeRow("ACEITE DE OLIVA", "LT", "2"), 0.88),
            (FakeRow("ACEITE DE PALMA", "LT", "3"), 0.86),
        ]
        result = decide(ranked, "aceite", "litros", settings())
        assert [c.nr_articulo for c in result.candidates] == ["2", "3", "1"]

    def test_rerank_band_width_follows_the_ambiguity_margin(self) -> None:
        ranked = [
            (FakeRow("ACEITE VEGETAL", "KG", "1"), 0.90),
            (FakeRow("ACEITE DE OLIVA", "LT", "2"), 0.70),
        ]
        # 0.70 is outside the default 0.08 band, but inside a 0.30 band.
        narrow = decide(ranked, "aceite", "litros", settings())
        wide = decide(ranked, "aceite", "litros", settings(match_ambiguity_margin=0.30))
        assert [c.nr_articulo for c in narrow.candidates] == ["1", "2"]
        assert [c.nr_articulo for c in wide.candidates] == ["2", "1"]

    def test_rerank_never_changes_the_status(self) -> None:
        ranked = self._band_case()
        with_rerank = decide(ranked, "aceite", "litros", settings())
        without = decide(ranked, "aceite", "litros", settings(match_unit_rerank=False))
        assert with_rerank.status == without.status


class TestUnitRerankSpeaksTheCatalogueVocabulary:
    """The re-rank only fires if `resolve_unit` speaks the catalogue's own
    `unidad` vocabulary. Since the Supabase cutover that vocabulary is
    `warehouse_products.unit_code` (`KG`/`LT`/`UND`/`POR`/`CAJA`), not the
    workbook labels the retired SQLite catalogue carried. A map keyed on the
    wrong vocabulary makes `_unit_rerank` silently inert while
    `MATCH_UNIT_RERANK` still reads `true`.
    """

    def _band_case(self) -> list[tuple[FakeRow, float]]:
        return [
            (FakeRow("ACEITE VEGETAL", "KG", "1"), 0.90),
            (FakeRow("ACEITE DE OLIVA", "LT", "2"), 0.86),
            (FakeRow("ACEITE DE PALMA", "LT", "3"), 0.50),
        ]

    def test_a_spoken_unit_promotes_the_code_vocabulary_candidate(self) -> None:
        result = decide(self._band_case(), "aceite", "litros", settings())
        assert [c.nr_articulo for c in result.candidates][:2] == ["2", "1"]

    def test_resolve_unit_returns_a_value_the_catalogue_can_equal(self) -> None:
        catalogue_vocabulary = {"KG", "LT", "UND", "POR", "CAJA"}
        resolved = {
            resolve_unit(spoken)
            for spoken in ("kilos", "litros", "unidades", "porciones")
        }
        assert resolved <= catalogue_vocabulary
        assert resolved == {"KG", "LT", "UND", "POR"}

    def test_the_rerank_is_inert_for_a_retired_label_vocabulary_row(self) -> None:
        """The workbook labels now live in `units.source_label` and never in
        `unidad`; a row still carrying one must not be treated as unit-equal."""
        ranked = [
            (FakeRow("ACEITE VEGETAL", "KG", "1"), 0.90),
            # A retired workbook label, deliberately not a unit code.
            (FakeRow("ACEITE DE OLIVA", "Liter", "2"), 0.86),
        ]
        result = decide(ranked, "aceite", "litros", settings())
        assert [c.nr_articulo for c in result.candidates] == ["1", "2"]
