"""Benchmark report + matrix regeneration (REQ-BMK-7, REQ-BMK-11, REQ-BMK-12).

This suite covers:

* Matrix + aggregate regeneration from a stored ``results.json`` (Task 3.3, RED).
* Privacy / ignore coverage for results, matrix, summary (Task 4.1, RED).
"""

from __future__ import annotations

import csv
import io
import json
from pathlib import Path

import pytest

# RED import surface: ``benchmarks.report`` must expose these symbols.
from benchmarks import report  # noqa: E402,F401
from benchmarks.report import (  # noqa: E402,F401
    MATRIX_COLUMNS,
    REGENERATABLE_OUTPUTS,
    render_matrix_csv,
    render_summary_table,
    summarise_results,
)


# --- matrix + aggregate regeneration (Task 3.3 RED) -----------------------


def test_summarise_results_includes_overall_and_per_condition(
    fixture_results: dict,
) -> None:
    summary = summarise_results(fixture_results)
    assert "overall" in summary
    assert "by_condition" in summary
    assert "clean" in summary["by_condition"]


def test_matrix_columns_have_documented_order() -> None:
    assert MATRIX_COLUMNS == (
        "id",
        "dataset",
        "audio",
        "condition",
        "dificultad",
        "acertividad",
        "status",
        "latency_ms",
        "vendor",
        "expected",
        "actual",
        "digit_correct",
        "digit_total",
        "wer",
        "hallucinated",
        "error",
    )


def test_render_matrix_csv_returns_one_row_per_clip(fixture_results: dict) -> None:
    matrix = render_matrix_csv(fixture_results)
    rows = list(csv.reader(io.StringIO(matrix)))
    # header + 6 fixture clips
    assert len(rows) == 1 + len(fixture_results["clips"])


def test_matrix_keeps_failed_clips_with_empty_actual(
    fixture_results: dict,
) -> None:
    matrix = render_matrix_csv(fixture_results)
    rows = list(csv.reader(io.StringIO(matrix)))
    header = rows[0]
    failed = next(row for row in rows[1:] if row[header.index("status")] == "502")
    actual_idx = header.index("actual")
    expected_idx = header.index("expected")
    error_idx = header.index("error")
    assert failed[actual_idx] == ""
    assert "doce botellas de aceite" in failed[expected_idx]
    assert "vendor_timeout" in failed[error_idx]


def test_matrix_rows_follow_loaded_clip_order(fixture_results: dict) -> None:
    matrix_rows = render_matrix_csv(fixture_results).splitlines()
    ids = [line.split(",", 1)[0] for line in matrix_rows[1:]]
    expected_ids = [clip["clip_id"] for clip in fixture_results["clips"]]
    assert ids == expected_ids


def test_aggregate_regeneration_is_byte_identical(
    tmp_path: Path, fixture_results: dict
) -> None:
    first = render_summary_table(fixture_results)
    results_path = tmp_path / "results.json"
    results_path.write_text(
        json.dumps(fixture_results, ensure_ascii=False), encoding="utf-8"
    )
    reread = json.loads(results_path.read_text(encoding="utf-8"))
    second = render_summary_table(reread)
    assert first == second


# --- regeneratable outputs surface (Task 3.4) -----------------------------


def test_regeneratable_outputs_lists_matrix_and_summary() -> None:
    assert set(REGENERATABLE_OUTPUTS) >= {"matrix.csv", "summary.txt"}


# --- ignores: BD_Pruebas, audio, workbooks, results, matrix, summary ------


def test_root_gitignore_covers_bd_pruebas(repo_root: Path) -> None:
    text = (repo_root / ".gitignore").read_text(encoding="utf-8")
    assert "BD_Pruebas/" in text


def test_benchmarks_gitignore_covers_results_and_matrix(repo_root: Path) -> None:
    text = (repo_root / "benchmarks" / ".gitignore").read_text(encoding="utf-8")
    assert "results.json" in text
    assert "benchmark_matrices" in text


# --- fixtures -------------------------------------------------------------


@pytest.fixture
def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


@pytest.fixture
def fixture_results() -> dict:
    return {
        "run_at": "2026-07-25T06:00:00+00:00",
        "vendor": "deepgram",
        "base_url": "http://localhost:8001",
        "schema_version": 2,
        "normalizer_version": "stt-es-v1",
        "config_fingerprint": "0" * 64,
        "clips": [
            {
                "clip_id": "Braejan/00001",
                "dataset": "Braejan",
                "condition": "unknown",
                "dificultad": "FACIL",
                "acertividad": "irrelevante",
                "transcript": "uno",
                "items": [],
                "is_garbage": False,
                "audio_path": "Braejan/NOTAS_VOZ/1.ogg",
                "status": 200,
                "latency_ms": 800,
                "error": None,
                "response": {
                    "raw_transcript": "uno",
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
                "dificultad": "MEDIO",
                "acertividad": "filler",
                "transcript": "filler uno",
                "items": [],
                "is_garbage": False,
                "audio_path": "Daniel/NOTAS_VOZ/1.ogg",
                "status": 200,
                "latency_ms": 700,
                "error": None,
                "response": {
                    "raw_transcript": "filler uno",
                    "stt_vendor": "deepgram",
                    "stt_confidence": 0.9,
                    "audio_duration_ms": 1000,
                    "request_id": "r-2",
                },
            },
            {
                "clip_id": "Braejan/00002",
                "dataset": "Braejan",
                "condition": "clean",
                "dificultad": "FACIL",
                "acertividad": "irrelevante",
                "transcript": "dos",
                "items": [],
                "is_garbage": False,
                "audio_path": "Braejan/NOTAS_VOZ/2.ogg",
                "status": 200,
                "latency_ms": 700,
                "error": None,
                "response": {
                    "raw_transcript": "dos",
                    "stt_vendor": "deepgram",
                    "stt_confidence": 0.9,
                    "audio_duration_ms": 1000,
                    "request_id": "r-3",
                },
            },
            {
                "clip_id": "Daniel/00002",
                "dataset": "Daniel",
                "condition": "unknown",
                "dificultad": "FACIL",
                "acertividad": "cancion",
                "transcript": "song lyrics here",
                "items": [],
                "is_garbage": False,
                "audio_path": "Daniel/NOTAS_VOZ/2.ogg",
                "status": 200,
                "latency_ms": 800,
                "error": None,
                "response": {
                    "raw_transcript": "song lyrics here",
                    "stt_vendor": "deepgram",
                    "stt_confidence": 0.7,
                    "audio_duration_ms": 1300,
                    "request_id": "r-4",
                },
            },
            {
                "clip_id": "Braejan/00003",
                "dataset": "Braejan",
                "condition": "noisy",
                "dificultad": "DIFICIL",
                "acertividad": "mixto",
                "transcript": "tres inventario seis",
                "items": [],
                "is_garbage": False,
                "audio_path": "Braejan/NOTAS_VOZ/3.ogg",
                "status": 200,
                "latency_ms": 900,
                "error": None,
                "response": {
                    "raw_transcript": "tres inventario seis",
                    "stt_vendor": "deepgram",
                    "stt_confidence": 0.9,
                    "audio_duration_ms": 1500,
                    "request_id": "r-5",
                },
            },
            {
                "clip_id": "Daniel/00003",
                "dataset": "Daniel",
                "condition": "clean",
                "dificultad": "MEDIO",
                "acertividad": "irrelevante",
                "transcript": "doce botellas de aceite",
                "items": [],
                "is_garbage": False,
                "audio_path": "Daniel/NOTAS_VOZ/3.ogg",
                "status": 502,
                "latency_ms": 900,
                "error": "vendor_timeout",
                "response": None,
            },
        ],
    }
