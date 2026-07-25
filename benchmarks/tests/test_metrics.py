"""Benchmark metrics (REQ-BMK-3/4/5/6).

Digit accuracy is the primary claim, the garbage-clip hallucination rate is the
second, and WER is a secondary sanity signal. All three are pure functions over
a results.json payload.
"""

import pytest

from benchmarks.metrics import (
    is_hallucinated,
    normalise_tokens,
    score_digit_tokens,
    summarise,
    word_error_rate,
)


# --- normalisation ---------------------------------------------------------


def test_normalisation_lowercases_unaccents_and_strips_punctuation():
    assert normalise_tokens("¡Quince Canastas, de Mangó!") == [
        "quince",
        "canastas",
        "de",
        "mango",
    ]


def test_normalisation_of_an_empty_transcript_is_an_empty_token_list():
    assert normalise_tokens("   ") == []


# --- digit accuracy (REQ-BMK-3) --------------------------------------------


def test_exact_quantity_match_scores_correct():
    correct, total = score_digit_tokens(["3", "12"], "3 kilos de lechuga y 12 botellas")

    assert (correct, total) == (2, 2)


def test_near_miss_counts_as_a_full_failure():
    """Said 90, transcribed 900 - a discrete failure, not a fractional penalty."""
    correct, total = score_digit_tokens(["90"], "900 gramos de tomate")

    assert (correct, total) == (0, 1)


def test_missing_quantity_scores_incorrect():
    correct, total = score_digit_tokens(["3", "12"], "3 kilos de lechuga")

    assert (correct, total) == (1, 2)


def test_repeated_quantities_are_matched_as_a_multiset():
    correct, total = score_digit_tokens(["2", "2"], "2 cajas y 2 bultos")
    assert (correct, total) == (2, 2)

    correct, total = score_digit_tokens(["2", "2"], "2 cajas y 5 bultos")
    assert (correct, total) == (1, 2)


def test_a_clip_with_no_labelled_quantities_contributes_nothing():
    assert score_digit_tokens([], "no hay cantidades aqui") == (0, 0)


# --- hallucination detector (design Decision 11, REQ-BMK-4) -----------------


@pytest.mark.parametrize(
    "transcript",
    [
        "dos cajas",
        "15 canastas",
        "quince canastas de mango",
        "3 bultos",
        "media docena de huevos",
    ],
)
def test_inventory_shaped_output_is_hallucinated(transcript):
    assert is_hallucinated(transcript) is True


@pytest.mark.parametrize(
    "transcript",
    [
        "eh este pues",
        "",
        "   ",
        "dos eh",
        "mmm ah listo",
    ],
)
def test_filler_or_empty_output_is_not_hallucinated(transcript):
    assert is_hallucinated(transcript) is False


def test_item_further_than_two_tokens_from_the_quantity_is_not_hallucinated():
    assert is_hallucinated("dos eh este pues canastas") is False


def test_item_within_two_tokens_of_the_quantity_is_hallucinated():
    assert is_hallucinated("dos de canastas") is True


def test_short_alphabetic_token_after_a_quantity_is_not_an_item():
    assert is_hallucinated("dos de la") is False


def test_quantity_without_any_following_token_is_not_hallucinated():
    assert is_hallucinated("quince") is False


# --- WER (REQ-BMK-5) -------------------------------------------------------


def test_identical_transcripts_have_zero_wer():
    assert word_error_rate("tres kilos de lechuga", "tres kilos de lechuga") == 0.0


def test_one_substitution_in_four_tokens_is_a_quarter():
    assert word_error_rate(
        "tres kilos de lechuga", "tres kilos de tomate"
    ) == pytest.approx(0.25)


def test_deletion_and_insertion_are_counted():
    assert word_error_rate("tres kilos de lechuga", "tres kilos lechuga") == pytest.approx(
        0.25
    )
    assert word_error_rate(
        "tres kilos de lechuga", "tres kilos de lechuga fresca"
    ) == pytest.approx(0.25)


def test_empty_reference_has_no_defined_wer():
    assert word_error_rate("", "algo") is None


# --- aggregation split by condition (REQ-BMK-4, REQ-BMK-6) -----------------


def clip(
    clip_id,
    condition,
    transcript="",
    items=(),
    is_garbage=False,
    hypothesis="",
    status=200,
):
    return {
        "clip_id": clip_id,
        "condition": condition,
        "transcript": transcript,
        "items": list(items),
        "is_garbage": is_garbage,
        "status": status,
        "response": {"raw_transcript": hypothesis},
        "latency_ms": 120,
        "error": None,
    }


def test_metrics_are_split_by_condition():
    summary = summarise(
        [
            clip("c1", "clean", "tres kilos", ["3"], hypothesis="3 kilos"),
            clip("c2", "noisy", "tres kilos", ["3"], hypothesis="300 kilos"),
            clip("c3", "spontaneous", "dos cajas", ["2"], hypothesis="2 cajas"),
        ]
    )

    assert set(summary["by_condition"]) == {"clean", "noisy", "spontaneous"}
    assert summary["by_condition"]["clean"]["digit_accuracy"] == 1.0
    assert summary["by_condition"]["noisy"]["digit_accuracy"] == 0.0
    assert summary["by_condition"]["spontaneous"]["digit_accuracy"] == 1.0
    assert summary["overall"]["digit_accuracy"] == pytest.approx(2 / 3)


def test_hallucination_denominator_is_exactly_the_number_of_garbage_clips():
    clips = [
        clip("g1", "noisy", is_garbage=True, hypothesis="dos cajas"),
        clip("g2", "noisy", is_garbage=True, hypothesis="eh este"),
        clip("g3", "clean", is_garbage=True, hypothesis=""),
        clip("s1", "clean", "tres kilos", ["3"], hypothesis="3 kilos"),
    ]

    summary = summarise(clips)

    assert summary["overall"]["garbage_clips"] == 3
    assert summary["overall"]["hallucinated"] == 1
    assert summary["overall"]["hallucination_rate"] == pytest.approx(1 / 3)
    assert summary["by_condition"]["noisy"]["garbage_clips"] == 2
    assert summary["by_condition"]["noisy"]["hallucination_rate"] == pytest.approx(0.5)


def test_garbage_clips_do_not_pollute_digit_accuracy():
    summary = summarise(
        [
            clip("s1", "clean", "tres kilos", ["3"], hypothesis="3 kilos"),
            clip("g1", "clean", is_garbage=True, hypothesis="dos cajas"),
        ]
    )

    assert summary["by_condition"]["clean"]["digit_total"] == 1
    assert summary["by_condition"]["clean"]["digit_accuracy"] == 1.0


def test_a_condition_without_garbage_clips_has_no_hallucination_rate():
    summary = summarise([clip("s1", "clean", "tres kilos", ["3"], hypothesis="3 kilos")])

    assert summary["by_condition"]["clean"]["garbage_clips"] == 0
    assert summary["by_condition"]["clean"]["hallucination_rate"] is None


def test_wer_is_reported_alongside_digit_accuracy():
    summary = summarise(
        [clip("s1", "clean", "tres kilos de lechuga", ["3"], hypothesis="tres kilos de tomate")]
    )

    assert summary["by_condition"]["clean"]["wer"] == pytest.approx(0.25)
    assert "digit_accuracy" in summary["by_condition"]["clean"]


def test_failed_clips_are_counted_but_not_scored():
    summary = summarise(
        [
            clip("s1", "clean", "tres kilos", ["3"], hypothesis="3 kilos"),
            {
                "clip_id": "s2",
                "condition": "clean",
                "transcript": "dos cajas",
                "items": ["2"],
                "is_garbage": False,
                "status": 502,
                "response": None,
                "latency_ms": 30,
                "error": "vendor_timeout",
            },
        ]
    )

    assert summary["overall"]["clips"] == 2
    assert summary["overall"]["failed_clips"] == 1
    assert summary["overall"]["digit_total"] == 1
    assert summary["overall"]["digit_accuracy"] == 1.0
