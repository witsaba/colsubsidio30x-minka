"""Characterization tests for the promoted trigram scorer (T3).

REQ-ENG-2: ranking uses the pg_trgm-faithful `similarity` scorer over
normalized names, returns at most `top_k` candidates ordered descending, and
never uses `WRatio`, stock level (`sd`), or two-stage retrieval.

The trigram assertions below are the worked examples from the PostgreSQL
pg_trgm documentation (`show_trgm('cat')`, `show_trgm('cat and dog')`), which
is what makes them a real oracle rather than a snapshot of our own output.
"""
from __future__ import annotations

from dataclasses import dataclass

import pytest

from matcher.normalize import trgm_similarity, trigrams
from matcher.scoring import TrigramSimilarityMatcher, token_set_ratio_01

TRGM_CAT = {"  c", " ca", "cat", "at "}
TRGM_CAT_AND_DOG = {
    "  c",
    " an",
    " ca",
    " do",
    "and",
    "at ",
    "cat",
    "d d",
    "dog",
    "nd ",
    "og ",
    "t a",
}


@dataclass(frozen=True)
class FakeRow:
    """Minimal structural stand-in for a catalogue row.

    `rank()` reads `articulo` to score and `uid` to break ties deterministically.
    """

    articulo: str
    uid: str = ""
    unidad: str | None = None
    sd: float | None = None


# --- pg_trgm documented examples ----------------------------------------------


def test_trigrams_matches_the_documented_show_trgm_of_cat() -> None:
    assert trigrams("cat") == frozenset(TRGM_CAT)


def test_trigrams_matches_the_documented_show_trgm_of_cat_and_dog() -> None:
    assert trigrams("cat and dog") == frozenset(TRGM_CAT_AND_DOG)


def test_trigrams_keeps_digits_in_the_same_word_class_as_letters() -> None:
    # pg_trgm's ISWORDCHR does not split "x50" into "x" + "50".
    assert trigrams("x50") == frozenset({"  x", " x5", "x50", "50 "})


def test_trigram_similarity_is_intersection_over_union_of_the_documented_sets() -> None:
    inter = len(TRGM_CAT & TRGM_CAT_AND_DOG)
    union = len(TRGM_CAT | TRGM_CAT_AND_DOG)
    assert (inter, union) == (4, 12)

    assert trgm_similarity("cat", "cat and dog") == pytest.approx(4 / 12)


def test_trigram_similarity_is_one_for_identical_strings_and_zero_with_no_overlap() -> None:
    assert trgm_similarity("achiote molido", "achiote molido") == 1.0
    assert trgm_similarity("cat", "zzz qqq") == 0.0


def test_trigram_similarity_is_zero_when_a_side_has_no_trigrams() -> None:
    # "???" yields an empty trigram set -- a valid 0.0 score, never an error.
    assert trigrams("???") == frozenset()
    assert trgm_similarity("???", "achiote molido") == 0.0


# --- rank(): ordering, truncation, and score identity -------------------------


def _matcher(rows: list[FakeRow]) -> TrigramSimilarityMatcher:
    matcher = TrigramSimilarityMatcher()
    matcher.build({"synthetic": rows})
    return matcher


def test_rank_scores_rows_with_the_documented_similarity_values() -> None:
    ranked = _matcher([FakeRow("cat"), FakeRow("cat and dog")]).rank("synthetic", "cat")

    assert [row.articulo for row, _ in ranked] == ["cat", "cat and dog"]
    assert [score for _, score in ranked] == pytest.approx([1.0, 4 / 12])


def test_rank_orders_candidates_by_similarity_descending() -> None:
    rows = [
        FakeRow("AZUCAR MORENA"),
        FakeRow("ACHIOTE MOLIDO"),
        FakeRow("ACHIOTE MOLIDO ORGANICO"),
    ]

    ranked = _matcher(rows).rank("synthetic", "ACHIOTE MOLIDO")

    assert [row.articulo for row, _ in ranked] == [
        "ACHIOTE MOLIDO",
        "ACHIOTE MOLIDO ORGANICO",
        "AZUCAR MORENA",
    ]
    scores = [score for _, score in ranked]
    assert scores == sorted(scores, reverse=True)
    assert scores[0] == 1.0
    assert 0.0 < scores[1] < 1.0


def test_rank_truncates_to_top_k() -> None:
    rows = [FakeRow(f"ACHIOTE MOLIDO {i}") for i in range(10)]

    ranked = _matcher(rows).rank("synthetic", "ACHIOTE MOLIDO", top_k=3)

    assert len(ranked) == 3
    assert all(score > 0.0 for _, score in ranked)


def test_rank_ignores_stock_level_as_a_matching_prior() -> None:
    # REQ-ENG-2: `sd` must never influence the ranking.
    plentiful = FakeRow("AZUCAR MORENA", sd=9999.0)
    exact = FakeRow("ACHIOTE MOLIDO", sd=0.0)

    ranked = _matcher([plentiful, exact]).rank("synthetic", "ACHIOTE MOLIDO")

    assert ranked[0][0] is exact
    assert ranked[0][1] == 1.0


def test_rank_returns_every_row_with_a_zero_score_for_an_untrigrammable_query() -> None:
    ranked = _matcher([FakeRow("ACHIOTE MOLIDO"), FakeRow("AZUCAR")]).rank(
        "synthetic", "???"
    )

    assert len(ranked) == 2
    assert [score for _, score in ranked] == [0.0, 0.0]


# --- rank(): deterministic tie-break ------------------------------------------


class TestDeterministicTieBreak:
    """Ranking must not depend on the order the catalogue source returns rows.

    WU-6 proved this was not hypothetical: the same 1,405 rows and an unchanged
    scoring engine produced a different top-1 accuracy purely because the row
    order moved from SQLite `rowid` to `warehouse_products.id` (a UUID). Six of
    the seven top-1 misses were EXACT score ties, so rank 1 was decided by
    catalogue order and nothing else.

    These three real eval rows tie at 0.696969... against the query below --
    the actual `porcion filete pechuga` tie-cluster from the eval set, not a
    contrived example.
    """

    QUERY = "porcion filete pechuga"

    def _tied_rows(self) -> list[FakeRow]:
        return [
            FakeRow("PORCION FILETE PECHUGA X 100 GRS", uid="c-100"),
            FakeRow("PORCION FILETE PECHUGA X 230 GRS", uid="a-230"),
            FakeRow("PORCION FILETE PECHUGA X 180 GRS", uid="b-180"),
        ]

    def test_the_rows_under_test_really_do_tie(self) -> None:
        """Guard: if these stopped tying, the tests below would prove nothing."""
        scores = [score for _, score in _matcher(self._tied_rows()).rank("synthetic", self.QUERY)]

        assert len(set(scores)) == 1
        assert scores[0] == pytest.approx(0.696969, abs=1e-5)

    def test_the_same_catalogue_in_two_row_orders_ranks_identically(self) -> None:
        rows = self._tied_rows()

        forward = _matcher(list(rows)).rank("synthetic", self.QUERY)
        reversed_ = _matcher(list(reversed(rows))).rank("synthetic", self.QUERY)
        rotated = _matcher(rows[1:] + rows[:1]).rank("synthetic", self.QUERY)

        assert [row.uid for row, _ in forward] == ["a-230", "b-180", "c-100"]
        assert [row.uid for row, _ in reversed_] == [row.uid for row, _ in forward]
        assert [row.uid for row, _ in rotated] == [row.uid for row, _ in forward]

    def test_the_tie_break_survives_truncation_to_top_k(self) -> None:
        rows = self._tied_rows()

        forward = _matcher(list(rows)).rank("synthetic", self.QUERY, top_k=1)
        reversed_ = _matcher(list(reversed(rows))).rank(
            "synthetic", self.QUERY, top_k=1
        )

        assert [row.uid for row, _ in forward] == ["a-230"]
        assert [row.uid for row, _ in reversed_] == ["a-230"]

    def test_rows_with_different_scores_keep_their_score_order(self) -> None:
        """The stable key breaks ties only; it never outranks a better score.

        Every `uid` here sorts in the exact opposite direction to its score, so
        a tie-break that leaked outside equal scores would invert the list.
        """
        rows = [
            FakeRow("ACHIOTE MOLIDO", uid="zzz"),
            FakeRow("ACHIOTE MOLIDO ORGANICO", uid="mmm"),
            FakeRow("AZUCAR MORENA", uid="aaa"),
        ]

        ranked = _matcher(rows).rank("synthetic", "ACHIOTE MOLIDO")

        assert [row.uid for row, _ in ranked] == ["zzz", "mmm", "aaa"]
        scores = [score for _, score in ranked]
        assert scores == sorted(scores, reverse=True)
        assert len(set(scores)) == 3

    def test_only_the_tied_subset_is_reordered(self) -> None:
        """A better-scoring row keeps rank 1 even with the last `uid` of all."""
        rows = [
            FakeRow("PORCION FILETE PECHUGA X 100 GRS", uid="c-100"),
            FakeRow("PORCION FILETE PECHUGA", uid="zzz-exact"),
            FakeRow("PORCION FILETE PECHUGA X 230 GRS", uid="a-230"),
        ]

        ranked = _matcher(rows).rank("synthetic", self.QUERY)

        assert [row.uid for row, _ in ranked] == ["zzz-exact", "a-230", "c-100"]
        assert ranked[0][1] == 1.0


# --- token_set_ratio_01(): bounded 0-1 wrapper --------------------------------


def test_token_set_ratio_01_is_one_for_reordered_tokens() -> None:
    assert token_set_ratio_01("ACEITE OLIVA", "OLIVA ACEITE") == 1.0


def test_token_set_ratio_01_ignores_accents_via_the_spike_processor() -> None:
    assert token_set_ratio_01("AZÚCAR MORENA", "azucar morena") == 1.0


def test_token_set_ratio_01_returns_a_bounded_fraction_for_a_partial_match() -> None:
    score = token_set_ratio_01("ACEITE DE OLIVA", "ACEITE DE GIRASOL")

    assert 0.0 < score < 1.0


def test_token_set_ratio_01_is_zero_for_disjoint_strings() -> None:
    assert token_set_ratio_01("ACHIOTE", "zzzz") == 0.0
