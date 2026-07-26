"""Fan the corpus at a running STT service and write results.json.

Usage:

    # legacy CSV layout
    BENCH_STT_URL=http://localhost:8001 \\
      uv run --project services/stt python benchmarks/run.py

    # external XLSX root (BD_Pruebas or equivalent)
    BENCH_STT_URL=http://localhost:8001 \\
      uv run --project services/stt python benchmarks/run.py \\
      --corpus /path/to/BD_Pruebas

REQ-BMK-1, REQ-BMK-2, REQ-BMK-7, REQ-BMK-10, REQ-BMK-11, REQ-BMK-12: the
runner processes every clip the corpus contains - never a sample - pairs each
clip's labels with the frozen response fields, persists v2 metadata, and
refuses to write transcript-bearing output anywhere that is not under a
git-ignored location.
"""

from __future__ import annotations

import argparse
import asyncio
import csv
import json
import logging
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import httpx

# Make ``benchmarks`` importable when invoked as a script.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from benchmarks import artifacts, corpus_loader  # noqa: E402
from benchmarks.artifacts import (  # noqa: E402
    atomic_write_text,
    assert_path_ignored,
    config_fingerprint,
)
from benchmarks.corpus_loader import (  # noqa: E402
    CorpusValidationError,
    MIME_BY_EXT,
)

DEFAULT_CONCURRENCY = 4
DEFAULT_BASE_URL = "http://localhost:8001"
DEFAULT_CORPUS = Path(__file__).resolve().parent / "corpus"
DEFAULT_OUTPUT = Path(__file__).resolve().parent / "results.json"
REPO_ROOT = Path(__file__).resolve().parents[1]
NORMALIZER_VERSION = "stt-es-v1"
REQUEST_TIMEOUT_S = 60.0

logger = logging.getLogger(__name__)


# --- legacy aliases (kept for the historic test suite) ---------------------


TRUE_VALUES = {"true", "1", "yes", "y"}


def load_corpus(corpus_dir: Path) -> list[dict]:
    """Dispatch to the appropriate loader.

    Delegates to :func:`benchmarks.corpus_loader.load_corpus` so the CSV and
    XLSX adapters stay in one place. Kept as a thin shim so the historic
    `benchmarks.tests.test_run` suite still imports a name from this module.
    """

    return corpus_loader.load_corpus(Path(corpus_dir))


# --- arg parsing -------------------------------------------------------------


def build_argparser() -> argparse.ArgumentParser:
    """Build the runner CLI. Flag > environment > default precedence.

    ``--base-url`` wins over ``$BENCH_STT_URL`` which wins over
    :data:`DEFAULT_BASE_URL`. ``--corpus`` / ``$BENCHMARK_CORPUS`` follow the
    same ordering for the corpus root.
    """

    parser = argparse.ArgumentParser(
        description=(
            "Run the STT benchmark. Uses uv-managed environment. "
            "Outputs land under gitignored paths only."
        )
    )
    default_corpus = Path(
        os.environ.get("BENCHMARK_CORPUS", str(DEFAULT_CORPUS))
    )
    default_base_url = os.environ.get("BENCH_STT_URL", DEFAULT_BASE_URL)
    parser.add_argument("--corpus", type=Path, default=default_corpus)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--concurrency", type=int, default=DEFAULT_CONCURRENCY)
    parser.add_argument("--base-url", default=default_base_url)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="load and validate the corpus without calling the service",
    )
    return parser


# --- helpers ----------------------------------------------------------------


def _error_code(response: httpx.Response) -> str:
    try:
        return response.json()["error"]["code"]
    except Exception:
        return f"http_{response.status_code}"


def _resolve_safe_output(target: Path) -> Path:
    """Ensure ``target`` is gitignored (REQ-BMK-12)."""

    return assert_path_ignored(target, REPO_ROOT)


async def _active_vendor(base_url: str, client: httpx.AsyncClient) -> str | None:
    try:
        response = await client.get(f"{base_url}/health", timeout=10.0)
        return response.json().get("vendor")
    except Exception:
        return None


# --- per-clip POST ---------------------------------------------------------


async def _transcribe_clip(
    clip: dict,
    base_url: str,
    client: httpx.AsyncClient,
    semaphore: asyncio.Semaphore,
) -> dict:
    """POST one clip; never raise - all outcomes become ``entry`` fields.

    The runner is the only place the harness touches the network, so transport
    errors are captured as ``status=None`` / ``error=ConnectError`` rather than
    aborting the whole gather. ``actual_transcript`` and ``expected`` are
    always populated on the result entry (the latter from the labels, the
    former from the response body when available).
    """

    entry: dict = {}
    # Surface the labels for downstream reporting. ``audio_path`` is dropped
    # because its on-disk location is not JSON-friendly.
    for key, value in clip.items():
        if key == "audio_path":
            entry["audio_path"] = str(value)
            continue
        entry[key] = value

    mime_type = clip.get("mime_type") or "audio/webm"
    audio_path = clip["audio_path"]
    audio_bytes = Path(audio_path).read_bytes()
    filename = Path(audio_path).name

    async with semaphore:
        started = time.perf_counter()
        try:
            response = await client.post(
                f"{base_url}/transcribe",
                files={"file": (filename, audio_bytes, mime_type)},
                timeout=REQUEST_TIMEOUT_S,
            )
        except httpx.HTTPError as exc:
            entry["latency_ms"] = round(
                (time.perf_counter() - started) * 1000, 3
            )
            entry["status"] = None
            entry["response"] = None
            entry["error"] = type(exc).__name__
            return entry

        entry["latency_ms"] = round(
            (time.perf_counter() - started) * 1000, 3
        )

    entry["status"] = response.status_code
    if response.status_code == 200:
        entry["response"] = response.json()
        entry["error"] = None
    else:
        entry["response"] = None
        entry["error"] = _error_code(response)
    return entry


# --- driver -----------------------------------------------------------------


async def run_benchmark(
    corpus_dir: Path,
    base_url: str,
    concurrency: int = DEFAULT_CONCURRENCY,
    output: Path = DEFAULT_OUTPUT,
    *,
    env_cwd: Path | None = None,
    unsafe_skip_ignore_check: bool = False,
) -> dict:
    """Load, dispatch, gather, persist - the whole loop in one awaitable.

    ``env_cwd`` and ``unsafe_skip_ignore_check`` are test-only hooks. The
    production entry point (``main``) never passes them; the flag exists so
    a unit test that points ``--output`` at ``tmp_path`` (which the safety
    check would otherwise reject) can drive the runner end-to-end without
    disabling the production guard.
    """

    corpus_dir = Path(corpus_dir)
    output = Path(output)

    if unsafe_skip_ignore_check:
        output.parent.mkdir(parents=True, exist_ok=True)
    else:
        _resolve_safe_output(output)

    clips = corpus_loader.load_corpus(corpus_dir)

    semaphore = asyncio.Semaphore(concurrency)
    async with httpx.AsyncClient() as client:
        vendor = await _active_vendor(base_url, client)
        entries = await asyncio.gather(
            *(
                _transcribe_clip(clip, base_url, client, semaphore)
                for clip in clips
            )
        )

    fingerprint = config_fingerprint(
        corpus_path=corpus_dir,
        base_url=base_url,
        concurrency=concurrency,
        normalizer_version=NORMALIZER_VERSION,
    )

    results = {
        "schema_version": 2,
        "run_at": datetime.now(timezone.utc).isoformat(),
        "vendor": vendor,
        "base_url": base_url,
        "normalizer_version": NORMALIZER_VERSION,
        "config_fingerprint": fingerprint,
        "clips": list(entries),
    }
    atomic_write_text(
        output, json.dumps(results, indent=2, ensure_ascii=False)
    )
    return results


# --- entry point ------------------------------------------------------------


def main(argv: list[str] | None = None) -> int:
    parser = build_argparser()
    args = parser.parse_args(argv)

    if args.dry_run:
        clips = corpus_loader.load_corpus(args.corpus)
        print(
            f"{len(clips)} clip(s) in {args.corpus}, target {args.base_url}"
        )
        for clip in clips:
            ident = clip["clip_id"]
            print(f"  {ident}")
        return 0

    try:
        results = asyncio.run(
            run_benchmark(
                args.corpus,
                args.base_url,
                args.concurrency,
                args.output,
            )
        )
    except CorpusValidationError as exc:
        print(f"corpus validation failed: {exc}", file=sys.stderr)
        return 2
    except artifacts.OutputPathError as exc:
        print(f"output target is not gitignored: {exc}", file=sys.stderr)
        return 2

    print(
        f"wrote {args.output} ({len(results['clips'])} clips, "
        f"vendor={results['vendor']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
