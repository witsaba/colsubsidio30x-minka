"""Render the benchmark from a v2 ``results.json`` (REQ-BMK-7, REQ-BMK-11).

The report reads only the stored ``results.json`` so regeneration is fully
deterministic and split into three pieces:

* ``summarise_results`` — the per-condition + overall aggregate numbers
  (digit accuracy, hallucination rate, WER).
* ``render_matrix_csv`` — a private per-audio matrix with stable column order,
  one row per loaded/submitted clip including failures.
* ``render_summary_table`` — the human-readable aggregate view.

Usage::

    uv run --project services/stt python benchmarks/report.py results.json
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
from collections import OrderedDict
from pathlib import Path

# Run as a script (``python benchmarks/report.py``) the repo root is not on
# the path; under pytest it already is. Both entry points must work.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmarks.metrics import (  # noqa: E402
    CONDITIONS,
    summarise_results,
    word_error_rate,
)

#: Stable column order for the per-audio matrix. Reordering is a breaking
#: change for downstream tooling; new columns append.
MATRIX_COLUMNS: tuple[str, ...] = (
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

#: Filenames the regenerator emits; tests assert these match the names the
#: runner writes so consumers can find them on disk.
REGENERATABLE_OUTPUTS: set[str] = {"matrix.csv", "summary.txt"}

CAVEAT = """\
Corpus validity caveat
  These numbers describe THIS corpus only. Digit accuracy and hallucination
  rate are the accuracy claim; WER is a secondary sanity signal and must not be
  quoted as the headline number. The hallucination detector looks for
  inventory-shaped output (a quantity followed within two tokens by an item
  word), so an item invented WITHOUT any quantity is not counted."""


def _row(condition: str, bucket: dict) -> tuple[str, ...]:
    digit_acc = (
        f"{bucket['digit_accuracy'] * 100:.1f}%"
        if bucket.get("digit_accuracy") is not None
        else "n/a"
    )
    halluc = (
        f"{bucket['hallucination_rate'] * 100:.1f}%"
        if bucket.get("hallucination_rate") is not None
        else "n/a"
    )
    return (
        condition,
        str(bucket["clips"]),
        str(bucket["failed_clips"]),
        digit_acc,
        str(bucket["digit_total"]),
        str(bucket["garbage_clips"]),
        halluc,
        "n/a" if bucket["wer"] is None else f"{bucket['wer']:.3f}",
    )


def render(summary: dict) -> str:
    """Render the human-readable table view of a v2 summary."""

    ordered = [c for c in CONDITIONS if c in summary["by_condition"]]
    ordered += sorted(set(summary["by_condition"]) - set(CONDITIONS))

    headers = (
        "condition",
        "clips",
        "failed",
        "digit acc",
        "digit n",
        "garbage",
        "halluc rate",
        "WER (2nd)",
    )
    rows = [headers]
    rows += [_row(condition, summary["by_condition"][condition]) for condition in ordered]
    rows.append(_row("OVERALL", summary["overall"]))

    widths = [max(len(row[i]) for row in rows) for i in range(len(headers))]
    lines = []
    for index, row in enumerate(rows):
        lines.append(
            "  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)).rstrip()
        )
        if index == 0:
            lines.append("  ".join("-" * width for width in widths))

    return "\n".join(lines) + "\n\n" + CAVEAT


# --- regeneration surface ---------------------------------------------------


def _vendor_of(clip: dict) -> str:
    response = clip.get("response") or {}
    return response.get("stt_vendor") or ""


def _actual_transcript_of(clip: dict) -> str:
    """Empty string for failed clips — preserves expected (REQ-BMK-7)."""

    if clip.get("status") != 200:
        return ""
    response = clip.get("response") or {}
    return str(response.get("raw_transcript") or "")


def _digit_metrics(clip: dict) -> tuple[int, int]:
    response = clip.get("response") or {}
    if clip.get("status") != 200:
        return 0, 0
    from benchmarks.metrics import (  # local import to avoid cycle at module load
        is_hallucinated,
        score_digit_tokens,
    )

    if clip.get("is_garbage"):
        # Garbage clips contribute 0/0 to digit accuracy but still feed
        # hallucination rate. We surface digits for transparency.
        hallucinated = bool(is_hallucinated(response.get("raw_transcript") or ""))
        # Surface hallucinated flag separately; return 0/0 for digit scoring.
        return 0, 0

    correct, total = score_digit_tokens(
        clip.get("items") or [], response.get("raw_transcript") or ""
    )
    return correct, total


def _hallucinated_flag(clip: dict) -> str:
    response = clip.get("response") or {}
    if clip.get("status") != 200:
        return "false"
    if not clip.get("is_garbage"):
        return "false"
    from benchmarks.metrics import is_hallucinated

    return "true" if is_hallucinated(response.get("raw_transcript") or "") else "false"


def _wer_value(clip: dict) -> str:
    if clip.get("status") != 200:
        return ""
    response = clip.get("response") or {}
    transcript = clip.get("transcript") or ""
    actual = response.get("raw_transcript") or ""
    if not transcript:
        return ""
    wer = word_error_rate(transcript, actual)
    return "" if wer is None else f"{wer:.3f}"


def _matrix_row(clip: dict) -> list[str]:
    digit_correct, digit_total = _digit_metrics(clip)
    actual = _actual_transcript_of(clip)
    return [
        clip.get("clip_id", ""),
        clip.get("dataset", ""),
        Path(str(clip.get("audio_path", ""))).name if clip.get("audio_path") else "",
        clip.get("condition", "unknown"),
        clip.get("dificultad", ""),
        clip.get("acertividad", ""),
        "" if clip.get("status") is None else str(clip.get("status")),
        "" if clip.get("latency_ms") is None else f"{clip['latency_ms']:.3f}",
        _vendor_of(clip),
        clip.get("transcript", "") or "",
        actual,
        "" if digit_total == 0 else str(digit_correct),
        "" if digit_total == 0 else str(digit_total),
        _wer_value(clip),
        _hallucinated_flag(clip),
        clip.get("error") or "",
    ]


def render_matrix_csv(results: dict) -> str:
    """Render the per-audio matrix CSV strictly from stored results.

    The matrix has exactly ``len(results["clips"])`` rows; failures preserve
    expected, leave actual empty, and populate ``error``.
    """

    if not isinstance(results, dict) or "clips" not in results:
        raise TypeError("render_matrix_csv expects a v2 results.json envelope")

    buffer = io.StringIO()
    writer = csv.writer(buffer, quoting=csv.QUOTE_MINIMAL)
    writer.writerow(MATRIX_COLUMNS)
    for clip in results.get("clips", []):
        writer.writerow(_matrix_row(clip))
    return buffer.getvalue()


def render_summary_table(results: dict) -> str:
    """Render the aggregate view from a stored v2 ``results.json``."""

    return render(summarise_results(results))


def regenerate(results_path: Path, out_dir: Path) -> "OrderedDict[str, Path]":
    """Persist the regeneratable views into ``out_dir``.

    Returns a mapping ``{name: written_path}`` for the two outputs. Used by
    the CLI when a caller wants both the matrix CSV and the summary text
    refreshed without re-running the live benchmark.
    """

    payload = json.loads(results_path.read_text(encoding="utf-8"))
    out_dir.mkdir(parents=True, exist_ok=True)
    matrix_target = out_dir / "matrix.csv"
    summary_target = out_dir / "summary.txt"
    matrix_target.write_text(render_matrix_csv(payload), encoding="utf-8")
    summary_target.write_text(render_summary_table(payload), encoding="utf-8")
    return OrderedDict(
        [("matrix.csv", matrix_target), ("summary.txt", summary_target)]
    )


# --- legacy CLI -------------------------------------------------------------


def load_clips(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path, help="path to results.json")
    parser.add_argument(
        "--matrix",
        type=Path,
        default=None,
        help="write the per-audio matrix CSV to this path",
    )
    args = parser.parse_args(argv)

    results = load_clips(args.results)
    print(f"STT benchmark — vendor={results.get('vendor')} run_at={results.get('run_at')}")
    print(render_summary_table(results))
    if args.matrix is not None:
        args.matrix.parent.mkdir(parents=True, exist_ok=True)
        args.matrix.write_text(render_matrix_csv(results), encoding="utf-8")
        print(f"matrix written to {args.matrix}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
