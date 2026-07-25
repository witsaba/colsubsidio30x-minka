"""Fan the corpus at a running STT service and write results.json.

Usage:
  BENCH_STT_URL=http://localhost:8001 \\
    uv run --project services/stt python benchmarks/run.py

REQ-BMK-1, REQ-BMK-2: the runner processes whatever clips the corpus contains -
there is no hard-coded corpus size - and records one entry per clip pairing its
labels with the frozen response fields.
"""

import argparse
import asyncio
import csv
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

# Run as a script the repo root is not on the path; under pytest it already is.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

DEFAULT_CONCURRENCY = 4
DEFAULT_BASE_URL = "http://localhost:8001"
DEFAULT_CORPUS = Path(__file__).resolve().parent / "corpus"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "results.json"
REQUEST_TIMEOUT_S = 60.0

TRUE_VALUES = {"true", "1", "yes", "y"}


def _audio_path(corpus_dir: Path, clip_id: str) -> Path:
    matches = sorted(
        path
        for path in corpus_dir.glob(f"{clip_id}.*")
        if path.suffix.lower() != ".csv"
    )
    if not matches:
        raise FileNotFoundError(f"no audio file found for clip {clip_id!r} in {corpus_dir}")
    return matches[0]


def load_corpus(corpus_dir: Path) -> list[dict]:
    """Read labels.csv and pair every row with its audio file."""
    labels = corpus_dir / "labels.csv"
    with labels.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))

    clips = []
    for row in rows:
        clip_id = row["clip_id"].strip()
        if not clip_id:
            continue
        clips.append(
            {
                "clip_id": clip_id,
                "condition": row["condition"].strip(),
                "transcript": row.get("transcript") or "",
                "items": json.loads(row.get("items") or "[]"),
                "is_garbage": (row.get("is_garbage") or "").strip().lower() in TRUE_VALUES,
                "audio_path": _audio_path(corpus_dir, clip_id),
            }
        )
    return clips


async def _transcribe_clip(
    clip: dict,
    base_url: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
) -> dict:
    entry = {key: value for key, value in clip.items() if key != "audio_path"}
    audio = clip["audio_path"].read_bytes()

    async with semaphore:
        started = time.perf_counter()
        try:
            response = await client.post(
                f"{base_url}/transcribe",
                files={"file": (clip["audio_path"].name, audio, "audio/webm")},
                timeout=REQUEST_TIMEOUT_S,
            )
        except httpx.HTTPError as exc:
            entry.update(
                status=None,
                response=None,
                error=type(exc).__name__,
                latency_ms=round((time.perf_counter() - started) * 1000, 3),
            )
            return entry

        entry["latency_ms"] = round((time.perf_counter() - started) * 1000, 3)

    entry["status"] = response.status_code
    if response.status_code == 200:
        entry["response"] = response.json()
        entry["error"] = None
    else:
        entry["response"] = None
        entry["error"] = _error_code(response)
    return entry


def _error_code(response: httpx.Response) -> str:
    try:
        return response.json()["error"]["code"]
    except Exception:
        return f"http_{response.status_code}"


async def _active_vendor(base_url: str, client: httpx.AsyncClient) -> str | None:
    try:
        response = await client.get(f"{base_url}/health", timeout=10.0)
        return response.json().get("vendor")
    except Exception:
        return None


async def run_benchmark(
    corpus_dir: Path,
    base_url: str,
    concurrency: int = DEFAULT_CONCURRENCY,
    output: Path = DEFAULT_OUTPUT,
) -> dict:
    clips = load_corpus(corpus_dir)
    semaphore = asyncio.Semaphore(concurrency)

    async with httpx.AsyncClient() as client:
        vendor = await _active_vendor(base_url, client)
        entries = await asyncio.gather(
            *(_transcribe_clip(clip, base_url, client, semaphore) for clip in clips)
        )

    results = {
        "run_at": datetime.now(timezone.utc).isoformat(),
        "vendor": vendor,
        "base_url": base_url,
        "clips": list(entries),
    }
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(results, indent=2, ensure_ascii=False), encoding="utf-8")
    return results


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Run the STT benchmark corpus.")
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    parser.add_argument(
        "--base-url", default=os.environ.get("BENCH_STT_URL", DEFAULT_BASE_URL)
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="load and validate the corpus without calling the service",
    )
    args = parser.parse_args(argv)

    clips = load_corpus(args.corpus)
    if args.dry_run:
        print(f"{len(clips)} clip(s) in {args.corpus}, target {args.base_url}")
        for clip in clips:
            flag = " [garbage]" if clip["is_garbage"] else ""
            print(f"  {clip['clip_id']:<24} {clip['condition']:<12}{flag}")
        return 0

    results = asyncio.run(
        run_benchmark(args.corpus, args.base_url, args.concurrency, args.output)
    )
    print(f"wrote {args.output} ({len(results['clips'])} clips, vendor={results['vendor']})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
