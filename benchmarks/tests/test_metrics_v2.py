"""Extended metrics coverage (REQ-BMK-3..11).

Adds v2 contract tests on top of the legacy regression suite:

* Normalizer version constant ``stt-es-v1`` is the only one the report uses.
* ACERTIVIDAD is opaque metadata: every relevance class is transcribed and
  scored; nothing in scoring reads or filters on ACERTIVIDAD.
* Absent / unknown condition lands in ``by_condition["unknown"]`` and never
  gets fabricated from ``DIFICULTAD``.
* Full-content WER counts every transcripted clip, not only the labelled
  digit-token subset.
"""

from __future__ import annotations

import pytest

from benchmarks import metrics as metrics_module
from benchmarks.metrics import (
    NORMALIZER_VERSION,
    normalise_tokens,
    summarise_results,
    word_error_rate,
)


# --- normalizer version stamp -----------------------------------------------


def test_normalizer_version_is_stt_es_v1() -> None:
    """Single fixed normalizer until a future version is explicitly cut."""

    assert NORMALIZER_VERSION == "stt-es-v1"


def test_normalise_tokens_is_documented_as_part_of_stt_es_v1() -> None:
    """The token reducer is the documented normalizer; anything else drifts."""

    # README + design point to ``normalise_tokens`` as the canonical normalizer.
    tokens = normalise_tokens("¡Quince Canastas, de Mangó!")
    assert tokens == [
        "quince",
        "canastas",
        "de",
        "mango",
    ]


# --- summarise_results over v2 results.json ---------------------------------


def _v2(clip_id, condition, transcript, actual, items=(), is_garbage=False,
        acertividad="irrelevante", dificultad="FACIL", status=200,
        error=None):
    return {
        "run_at": "2026-07-25T06:00:00+00:00",
        "vendor": "deepgram",
        "base_url": "http://localhost:8001",
        "schema_version": 2,
        "normalizer_version": "stt-es-v1",
        "clips": [
            {
                "clip_id": clip_id,
                "dataset": clip_id.split("/", 1)[0],
                "condition": condition,
                "dificultad": dificultad,
                "acertividad": acertividad,
                "transcript": transcript,
                "items": list(items),
                "is_garbage": is_garbage,
                "status": status,
                "latency_ms": 100,
                "error": error,
                "response": {
                    "raw_transcript": actual,
                    "stt_vendor": "deepgram",
                    "stt_confidence": 0.9,
                    "audio_duration_ms": 1000,
                    "request_id": "req",
                },
            }
        ],
    }


def test_summarise_results_reads_clips_out_of_v2_envelope() -> None:
    summary = summarise_results(
        _v2(
            "Braejan/00001",
            "unknown",
            "tres kilos",
            "3 kilos",
            items=("3",),
        )
    )
    assert summary["overall"]["digit_total"] == 1
    assert summary["overall"]["digit_accuracy"] == 1.0
    assert summary["by_condition"]["unknown"]["digit_total"] == 1


def test_acertividad_is_never_used_to_filter_or_score() -> None:
    """irrelevante / filler / cancion / mixto carry digit metrics like stock."""

    results = {
        "schema_version": 2,
        "normalizer_version": "stt-es-v1",
        "clips": [
            {
                "clip_id": f"Daniel/{tag}00001",
                "dataset": "Daniel",
                "condition": "unknown",
                "dificultad": "MEDIO",
                "acertividad": tag,
                "transcript": "tres kilos",
                "items": ["3"],
                "is_garbage": False,
                "status": 200,
                "latency_ms": 100,
                "error": None,
                "response": {
                    "raw_transcript": "3 kilos",
                    "stt_vendor": "deepgram",
                    "stt_confidence": 0.9,
                    "audio_duration_ms": 1000,
                    "request_id": f"req-{tag}",
                },
            }
            for tag in ("irrelevante", "filler", "cancion", "mixto")
        ],
    }
    summary = summarise_results(results)
    # Every ACERTIVIDAD class contributes one digit to the aggregate.
    assert summary["overall"]["digit_total"] == 4
    assert summary["overall"]["digit_accuracy"] == 1.0


def test_acertividad_is_never_used_to_filter_or_score_unknown_value() -> None:
    """Unknown ACERTIVIDAD values are accepted and scored without filter."""

    results = {
        "schema_version": 2,
        "normalizer_version": "stt-es-v1",
        "clips": [
            {
                "clip_id": "Braejan/00001",
                "dataset": "Braejan",
                "condition": "unknown",
                "dificultad": "MEDIO",
                "acertividad": "nuevo-tipo-2027",
                "transcript": "3 kilos",
                "items": ["3"],
                "is_garbage": False,
                "status": 200,
                "latency_ms": 100,
                "error": None,
                "response": {
                    "raw_transcript": "3 kilos",
                    "stt_vendor": "deepgram",
                    "stt_confidence": 0.9,
                    "audio_duration_ms": 1000,
                    "request_id": "r",
                },
            }
        ],
    }
    # The aggregate does not raise and counts the digit the same way it would
    # for any known ACERTIVIDAD value: 1 expected token, 1 hypothesis token.
    summary = summarise_results(results)
    assert summary["overall"]["digit_total"] == 1
    assert summary["overall"]["digit_correct"] == 1


# --- condition handling ----------------------------------------------------


def test_unknown_condition_appears_in_by_condition() -> None:
    summary = summarise_results(
        _v2(
            "Daniel/00019",
            "unknown",
            "tres",
            "tres",
            items=("3",),
        )
    )
    assert "unknown" in summary["by_condition"]
    assert summary["by_condition"]["unknown"]["clips"] == 1


def test_unknown_condition_is_never_substituted_from_dificultad() -> None:
    """``dificultad='DIFICIL'`` MUST NOT translate into ``condition='noisy'``."""

    results = {
        "schema_version": 2,
        "normalizer_version": "stt-es-v1",
        "clips": [
            {
                "clip_id": "Braejan/00001",
                "dataset": "Braejan",
                "condition": "unknown",
                "dificultad": "DIFICIL",
                "acertividad": "irrelevante",
                "transcript": "tres kilos",
                "items": ["3"],
                "is_garbage": False,
                "status": 200,
                "latency_ms": 100,
                "error": None,
                "response": {
                    "raw_transcript": "3 kilos",
                    "stt_vendor": "deepgram",
                    "stt_confidence": 0.9,
                    "audio_duration_ms": 1000,
                    "request_id": "r",
                },
            }
        ],
    }
    summary = summarise_results(results)
    assert "noisy" not in summary["by_condition"]
    assert summary["by_condition"]["unknown"]["clips"] == 1


# --- WER counts every transcripted clip ------------------------------------


def test_full_content_wer_counts_every_transcripted_clip() -> None:
    results = {
        "schema_version": 2,
        "normalizer_version": "stt-es-v1",
        "clips": [
            {
                "clip_id": f"Braejan/{index:05d}",
                "dataset": "Braejan",
                "condition": "unknown",
                "dificultad": "FACIL",
                "acertividad": "irrelevante",
                "transcript": "tres kilos de lechuga",
                "items": ["3"],
                "is_garbage": False,
                "status": 200,
                "latency_ms": 100,
                "error": None,
                "response": {
                    "raw_transcript": "tres kilos de lechuga",
                    "stt_vendor": "deepgram",
                    "stt_confidence": 0.9,
                    "audio_duration_ms": 1000,
                    "request_id": f"r-{index}",
                },
            }
            for index in range(1, 4)
        ],
    }
    summary = summarise_results(results)
    # The `wer` aggregate is the average over all 3 clips; each is 0.0.
    assert summary["overall"]["wer"] == pytest.approx(0.0)


# --- legacy regressions: digit accuracy, hallucination, WER ---------------


def test_digit_accuracy_regression_via_summarise_results() -> None:
    results = {
        "schema_version": 2,
        "normalizer_version": "stt-es-v1",
        "clips": [
            {
                "clip_id": "Braejan/00001",
                "dataset": "Braejan",
                "condition": "unknown",
                "dificultad": "FACIL",
                "acertividad": "irrelevante",
                "transcript": "tres kilos",
                "items": ["3"],
                "is_garbage": False,
                "status": 200,
                "latency_ms": 100,
                "error": None,
                "response": {
                    "raw_transcript": "3 kilos",
                    "stt_vendor": "deepgram",
                    "stt_confidence": 0.9,
                    "audio_duration_ms": 1000,
                    "request_id": "r-1",
                },
            },
            {
                "clip_id": "Daniel/00001",
                "dataset": "Daniel",
                "condition": "unknown",
                "dificultad": "FACIL",
                "acertividad": "irrelevante",
                "transcript": "noventa bultos",
                "items": ["90"],
                "is_garbage": False,
                "status": 200,
                "latency_ms": 100,
                "error": None,
                "response": {
                    "raw_transcript": "900 bultos",
                    "stt_vendor": "deepgram",
                    "stt_confidence": 0.9,
                    "audio_duration_ms": 1000,
                    "request_id": "r-2",
                },
            },
        ],
    }
    summary = summarise_results(results)
    assert summary["overall"]["digit_total"] == 2
    assert summary["overall"]["digit_correct"] == 1
    assert summary["overall"]["digit_accuracy"] == pytest.approx(0.5)


def test_explicit_garbage_hits_hallucination_denominator() -> None:
    """``is_garbage=True`` is the explicit hallucination signal."""

    results = {
        "schema_version": 2,
        "normalizer_version": "stt-es-v1",
        "clips": [
            {
                "clip_id": "Daniel/garbage-01",
                "dataset": "Daniel",
                "condition": "unknown",
                "dificultad": "MEDIO",
                "acertividad": "silencio",
                "transcript": "",
                "items": [],
                "is_garbage": True,
                "status": 200,
                "latency_ms": 100,
                "error": None,
                "response": {
                    "raw_transcript": "tres cajas",
                    "stt_vendor": "deepgram",
                    "stt_confidence": 0.7,
                    "audio_duration_ms": 1000,
                    "request_id": "r-g",
                },
            },
        ],
    }
    summary = summarise_results(results)
    assert summary["overall"]["garbage_clips"] == 1
    assert summary["overall"]["hallucinated"] == 1
    assert summary["overall"]["hallucination_rate"] == 1.0


def test_wer_secondary_signal_is_returned() -> None:
    """WER secondary signal: present and normalized by stt-es-v1."""

    assert NORMALIZER_VERSION == "stt-es-v1"
    # Diff: "tres kilos" vs "tres bultos" — 1 substitution in 2 tokens → 0.5
    assert word_error_rate("tres kilos", "tres bultos") == pytest.approx(0.5)


# --- module-level manifest -------------------------------------------------


def test_metrics_module_does_not_use_acertividad_in_scoring() -> None:
    """Source-level guard: ACERTIVIDAD never gates digit / hallucination / WER."""

    source = metrics_module.__file__
    text = open(source, encoding="utf-8").read()
    # No arithmetic / scoring path references acertividad. The only mention
    # that exists is the documentation in the module docstring.
    scoring_lines = [
        line
        for line in text.splitlines()
        if line.strip().startswith(("return", "bucket[", "if "))
        and "acertividad" in line
    ]
    assert not scoring_lines, scoring_lines
