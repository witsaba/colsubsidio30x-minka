"""Render the benchmark metrics table from a results.json (REQ-BMK-5/6).

Usage: uv run --project services/stt python benchmarks/report.py results.json
"""

import argparse
import json
import sys
from pathlib import Path

# Run as a script (`python benchmarks/report.py`) the repo root is not on the
# path; under pytest it already is. Both entry points must work.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmarks.metrics import CONDITIONS, summarise  # noqa: E402

CAVEAT = """\
Corpus validity caveat
  These numbers describe THIS corpus only. Digit accuracy and hallucination
  rate are the accuracy claim; WER is a secondary sanity signal and must not be
  quoted as the headline number. The hallucination detector looks for
  inventory-shaped output (a quantity followed within two tokens by an item
  word), so an item invented WITHOUT any quantity is not counted."""

_HEADERS = (
    "condition",
    "clips",
    "failed",
    "digit acc",
    "digit n",
    "garbage",
    "halluc rate",
    "WER (2nd)",
)


def _percent(value: float | None) -> str:
    return "n/a" if value is None else f"{value * 100:.1f}%"


def _row(condition: str, bucket: dict) -> tuple[str, ...]:
    return (
        condition,
        str(bucket["clips"]),
        str(bucket["failed_clips"]),
        _percent(bucket["digit_accuracy"]),
        str(bucket["digit_total"]),
        str(bucket["garbage_clips"]),
        _percent(bucket["hallucination_rate"]),
        "n/a" if bucket["wer"] is None else f"{bucket['wer']:.3f}",
    )


def render(summary: dict) -> str:
    ordered = [c for c in CONDITIONS if c in summary["by_condition"]]
    ordered += sorted(set(summary["by_condition"]) - set(CONDITIONS))

    rows = [_HEADERS]
    rows += [_row(condition, summary["by_condition"][condition]) for condition in ordered]
    rows.append(_row("OVERALL", summary["overall"]))

    widths = [max(len(row[i]) for row in rows) for i in range(len(_HEADERS))]
    lines = []
    for index, row in enumerate(rows):
        lines.append("  ".join(cell.ljust(widths[i]) for i, cell in enumerate(row)).rstrip())
        if index == 0:
            lines.append("  ".join("-" * width for width in widths))

    return "\n".join(lines) + "\n\n" + CAVEAT


def load_clips(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("results", type=Path, help="path to results.json")
    args = parser.parse_args(argv)

    results = load_clips(args.results)
    print(f"STT benchmark — vendor={results.get('vendor')} run_at={results.get('run_at')}")
    print(render(summarise(results.get("clips", []))))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
