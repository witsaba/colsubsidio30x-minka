"""Benchmark runner (REQ-BMK-1, REQ-BMK-2, REQ-BMK-7, REQ-BMK-12).

The runner must work on whatever clips exist - no hard-coded corpus size - and
must pair every clip's labels with the frozen response fields so `report.py`
can score them. The XLSX adapter is plugged in via ``corpus_loader``.
"""

import asyncio
import json
import os
from pathlib import Path

import httpx
import pytest
import respx

from benchmarks import run as run_module
from benchmarks.corpus_loader import CorpusValidationError
from benchmarks.run import (
    DEFAULT_CONCURRENCY,
    DEFAULT_CONCURRENCY as _DEFAULT_CONCURRENCY,
    build_argparser,
    main,
    run_benchmark,
)
from benchmarks.run import load_corpus

BASE_URL = "http://stt.test:8001"
TRANSCRIBE_URL = f"{BASE_URL}/transcribe"

LABELS = """\
clip_id,condition,transcript,items,is_garbage
clean-01,clean,tres kilos de lechuga,"[""3""]",false
noisy-01,noisy,noventa canastas,"[""90""]",false
garbage-01,noisy,,[],true
"""


def frozen_response(transcript="3 kilos de lechuga"):
    return {
        "raw_transcript": transcript,
        "is_garbage": False,
        "stt_confidence": 0.93,
        "audio_duration_ms": 3100,
        "stt_vendor": "deepgram",
        "request_id": "req-1",
    }


@pytest.fixture
def corpus(tmp_path):
    corpus_dir = tmp_path / "corpus"
    corpus_dir.mkdir()
    (corpus_dir / "labels.csv").write_text(LABELS, encoding="utf-8")
    for clip_id in ("clean-01", "noisy-01", "garbage-01"):
        (corpus_dir / f"{clip_id}.webm").write_bytes(b"fake-audio-" + clip_id.encode())
    return corpus_dir


def test_load_corpus_parses_labels_without_a_size_constraint(corpus):
    clips = load_corpus(corpus)

    assert [clip["clip_id"] for clip in clips] == ["clean-01", "noisy-01", "garbage-01"]
    assert clips[0]["condition"] == "clean"
    assert clips[0]["items"] == ["3"]
    assert clips[0]["is_garbage"] is False
    assert clips[2]["is_garbage"] is True
    assert clips[2]["items"] == []


def test_load_corpus_reports_a_clip_without_audio(corpus):
    (corpus / "labels.csv").write_text(
        LABELS + "missing-01,clean,algo,[],false\n", encoding="utf-8"
    )

    from benchmarks.corpus_loader import CorpusValidationError

    with pytest.raises(CorpusValidationError) as excinfo:
        load_corpus(corpus)

    assert "missing-01" in str(excinfo.value)


@respx.mock
async def test_three_clip_corpus_produces_three_result_entries(corpus, tmp_path):
    respx.post(TRANSCRIBE_URL).mock(
        return_value=httpx.Response(200, json=frozen_response())
    )
    output = tmp_path / "results.json"

    await run_benchmark(
        corpus, BASE_URL, output=output, unsafe_skip_ignore_check=True
    )

    results = json.loads(output.read_text(encoding="utf-8"))
    assert len(results["clips"]) == 3
    assert {clip["clip_id"] for clip in results["clips"]} == {
        "clean-01",
        "noisy-01",
        "garbage-01",
    }


@respx.mock
async def test_each_entry_pairs_labels_with_the_frozen_response(corpus, tmp_path):
    respx.post(TRANSCRIBE_URL).mock(
        return_value=httpx.Response(200, json=frozen_response())
    )
    output = tmp_path / "results.json"

    await run_benchmark(
        corpus, BASE_URL, output=output, unsafe_skip_ignore_check=True
    )

    entry = next(
        clip
        for clip in json.loads(output.read_text(encoding="utf-8"))["clips"]
        if clip["clip_id"] == "clean-01"
    )
    assert entry["condition"] == "clean"
    assert entry["transcript"] == "tres kilos de lechuga"
    assert entry["items"] == ["3"]
    assert entry["is_garbage"] is False
    assert entry["status"] == 200
    assert entry["error"] is None
    assert isinstance(entry["latency_ms"], (int, float))
    assert set(entry["response"]) == {
        "raw_transcript",
        "is_garbage",
        "stt_confidence",
        "audio_duration_ms",
        "stt_vendor",
        "request_id",
    }


@respx.mock
async def test_results_carry_the_run_metadata(corpus, tmp_path):
    respx.post(TRANSCRIBE_URL).mock(
        return_value=httpx.Response(200, json=frozen_response())
    )
    respx.get(f"{BASE_URL}/health").mock(
        return_value=httpx.Response(200, json={"status": "ok", "vendor": "groq"})
    )
    output = tmp_path / "results.json"

    await run_benchmark(
        corpus, BASE_URL, output=output, unsafe_skip_ignore_check=True
    )

    results = json.loads(output.read_text(encoding="utf-8"))
    assert results["base_url"] == BASE_URL
    assert results["vendor"] == "groq"
    assert results["run_at"]


@respx.mock
async def test_a_failing_clip_is_recorded_not_raised(corpus, tmp_path):
    respx.post(TRANSCRIBE_URL).mock(
        return_value=httpx.Response(
            502, json={"error": {"code": "vendor_timeout", "message": "x", "request_id": "r"}}
        )
    )
    output = tmp_path / "results.json"

    await run_benchmark(
        corpus, BASE_URL, output=output, unsafe_skip_ignore_check=True
    )

    clips = json.loads(output.read_text(encoding="utf-8"))["clips"]
    assert all(clip["status"] == 502 for clip in clips)
    assert all(clip["error"] == "vendor_timeout" for clip in clips)
    assert all(clip["response"] is None for clip in clips)


@respx.mock
async def test_concurrency_is_capped_by_the_semaphore(corpus, tmp_path):
    in_flight = 0
    peak = 0

    async def slow_vendor(request):
        nonlocal in_flight, peak
        in_flight += 1
        peak = max(peak, in_flight)
        await asyncio.sleep(0.05)
        in_flight -= 1
        return httpx.Response(200, json=frozen_response())

    respx.post(TRANSCRIBE_URL).mock(side_effect=slow_vendor)

    await run_benchmark(
        corpus,
        BASE_URL,
        concurrency=2,
        output=tmp_path / "results.json",
        unsafe_skip_ignore_check=True,
    )

    assert peak <= 2
    assert peak > 1, "the runner must actually run clips concurrently"


def test_default_concurrency_is_four():
    assert DEFAULT_CONCURRENCY == 4


# --- CLI / env precedence (REQ-BMK-1, REQ-BMK-2) ---------------------------


def test_arg_parser_carries_corpus_and_output_flags():
    parser = build_argparser()
    args = parser.parse_args(["--corpus", "/tmp/x", "--output", "/tmp/y.json"])
    assert Path(args.corpus) == Path("/tmp/x")
    assert Path(args.output) == Path("/tmp/y.json")


def test_base_url_defaults_to_env_variable(monkeypatch):
    monkeypatch.setenv("BENCH_STT_URL", "http://env-stt:8001")
    parser = build_argparser()
    args = parser.parse_args([])
    assert args.base_url == "http://env-stt:8001"


def test_base_url_flag_overrides_env(monkeypatch):
    monkeypatch.setenv("BENCH_STT_URL", "http://env-stt:8001")
    parser = build_argparser()
    args = parser.parse_args(["--base-url", "http://flag-stt:8001"])
    assert args.base_url == "http://flag-stt:8001"


def test_corpus_arg_accepts_external_xlsx_root(two_xlsx_corpus, tmp_path):
    """CLI parser must surface the xlsx path without rewriting it."""
    parser = build_argparser()
    args = parser.parse_args(["--corpus", str(two_xlsx_corpus), "--dry-run"])
    assert Path(args.corpus) == two_xlsx_corpus


# --- external XLSX path through the runner ---------------------------------


@respx.mock
async def test_xlsx_clip_is_posted_with_its_actual_mime(
    two_xlsx_corpus, tmp_path
):
    """The .ogg clip must hit /transcribe with multipart ``audio/ogg``."""
    captured: list[str] = []

    def _side_effect(request: httpx.Request) -> httpx.Response:
        for part in request.stream:
            if b"Content-Type:" in part:
                value = part.decode("utf-8", errors="ignore").splitlines()
                for header in value:
                    if header.lower().startswith("content-type:"):
                        captured.append(header.split(":", 1)[1].strip())
                        break
        return httpx.Response(
            200,
            json={
                "raw_transcript": "transcript for 1",
                "is_garbage": False,
                "stt_confidence": 0.9,
                "audio_duration_ms": 1200,
                "stt_vendor": "deepgram",
                "request_id": "req-ogg",
            },
        )

    respx.post(TRANSCRIBE_URL).mock(side_effect=_side_effect)
    output = tmp_path / "results.json"

    await run_benchmark(
        two_xlsx_corpus,
        BASE_URL,
        output=output,
        env_cwd=tmp_path,
        unsafe_skip_ignore_check=True,
    )

    assert any("audio/ogg" in ctype for ctype in captured), (
        "xlsx .ogg clips must be POSTed as audio/ogg"
    )


# --- all content classes posted (REQ-BMK-2, REQ-BMK-10) --------------------


@respx.mock
async def test_every_relevance_class_is_submitted_and_scored(
    all_classes_corpus, tmp_path, repo_root
):
    """irrelevante / filler / cancion / mixto / silencio clips are POSTed.

    The runner never short-circuits on ``ACERTIVIDAD``. Failures count, never
    drop, and every loaded clip produces exactly one matrix row.
    """
    captured_ids: list[str] = []

    def _side_effect(request: httpx.Request) -> httpx.Response:
        text_chunks = []
        for part in request.stream:
            try:
                text_chunks.append(part.decode("utf-8", errors="ignore"))
            except Exception:
                continue
        body = "\n".join(text_chunks)
        start = body.find('filename="')
        if start != -1:
            start += len('filename="')
            end = body.find('"', start)
            captured_ids.append(body[start:end])
        return httpx.Response(
            200,
            json={
                "raw_transcript": "transcripto",
                "is_garbage": False,
                "stt_confidence": 0.9,
                "audio_duration_ms": 1000,
                "stt_vendor": "deepgram",
                "request_id": "req",
            },
        )

    respx.post(TRANSCRIBE_URL).mock(side_effect=_side_effect)
    output = tmp_path / "results.json"

    await run_benchmark(
        all_classes_corpus,
        BASE_URL,
        output=output,
        env_cwd=repo_root,
        unsafe_skip_ignore_check=True,
    )

    # Every dataset produced exactly one POST (the 5 relevance classes).
    assert len(captured_ids) == 5
    # All clips share the unpadded ``1.ogg`` filename (1 row per workbook).
    assert all(name == "1.ogg" for name in captured_ids)
    # Verbatim ACERTIVIDAD made it through the loader for every clip.
    payload = json.loads((output).read_text(encoding="utf-8"))
    acertividades = sorted(
        clip["acertividad"] for clip in payload["clips"]
    )
    assert acertividades == sorted(
        ["irrelevante", "filler", "cancion", "mixto", "silencio"]
    )


# --- validation short-circuit (REQ-BMK-7 / REQ-CORPUS-*) ------------------


@respx.mock
async def test_loader_validation_failure_aborts_before_network(
    invalid_xlsx_corpus, tmp_path, repo_root
):
    """A failing XLSX loader must never produce a results.json nor POST."""
    respx.post(TRANSCRIBE_URL).mock(
        return_value=httpx.Response(200, json={"raw_transcript": "x"})
    )
    output = tmp_path / "results.json"

    with pytest.raises(CorpusValidationError):
        await run_benchmark(
            invalid_xlsx_corpus,
            BASE_URL,
            output=output,
            env_cwd=repo_root,
            unsafe_skip_ignore_check=True,
        )

    assert not output.exists(), (
        "no results.json may be produced when corpus validation fails"
    )
    assert respx.calls.call_count == 0


# --- results.json schema_version=2 + fingerprint --------------------------


@respx.mock
async def test_results_carry_schema_version_two_and_fingerprint(
    corpus, tmp_path
):
    respx.post(TRANSCRIBE_URL).mock(
        return_value=httpx.Response(200, json=frozen_response())
    )

    await run_benchmark(
        corpus,
        BASE_URL,
        output=tmp_path / "results.json",
        unsafe_skip_ignore_check=True,
    )

    payload = json.loads((tmp_path / "results.json").read_text(encoding="utf-8"))
    assert payload["schema_version"] == 2
    assert payload["normalizer_version"] == "stt-es-v1"
    assert isinstance(payload["config_fingerprint"], str) and len(
        payload["config_fingerprint"]
    ) == 64


# --- dry run does not POST (REQ-BMK-2) -------------------------------------


@respx.mock
async def test_dry_run_does_not_call_the_vendor(corpus, tmp_path, monkeypatch):
    respx.post(TRANSCRIBE_URL).mock(
        return_value=httpx.Response(200, json=frozen_response())
    )
    monkeypatch.setattr(
        "sys.argv", ["run.py", "--corpus", str(corpus), "--dry-run"]
    )
    rc = main()
    assert rc == 0
    assert respx.calls.call_count == 0


# --- every clip produces one ordered result (REQ-BMK-7) -------------------


@respx.mock
async def test_results_are_ordered_one_row_per_clip(
    corpus_with_counts, tmp_path
):
    respx.post(TRANSCRIBE_URL).mock(
        return_value=httpx.Response(200, json=frozen_response())
    )
    await run_benchmark(
        corpus_with_counts,
        BASE_URL,
        output=tmp_path / "results.json",
        unsafe_skip_ignore_check=True,
    )
    payload = json.loads((tmp_path / "results.json").read_text(encoding="utf-8"))
    assert [c["clip_id"] for c in payload["clips"]] == [
        f"clip-{i}" for i in range(7)
    ]


# --- transport failures are retained (REQ-BMK-7) --------------------------


@respx.mock
async def test_connect_error_is_recorded_per_clip(corpus, tmp_path):
    respx.post(TRANSCRIBE_URL).mock(side_effect=httpx.ConnectError("nope"))
    await run_benchmark(
        corpus,
        BASE_URL,
        output=tmp_path / "results.json",
        unsafe_skip_ignore_check=True,
    )
    payload = json.loads((tmp_path / "results.json").read_text(encoding="utf-8"))
    assert all(c["status"] is None for c in payload["clips"])
    assert all(c["error"] == "ConnectError" for c in payload["clips"])


# --- privacy: no transcripts in INFO logs (REQ-BMK-12) --------------------


@respx.mock
async def test_no_transcript_text_in_info_logs(corpus, tmp_path, caplog):
    transcript = "esto es secreto de la operacion"
    respx.post(TRANSCRIBE_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "raw_transcript": transcript,
                "is_garbage": False,
                "stt_confidence": 0.9,
                "audio_duration_ms": 1000,
                "stt_vendor": "deepgram",
                "request_id": "req",
            },
        )
    )
    with caplog.at_level("INFO"):
        await run_benchmark(
            corpus,
            BASE_URL,
            output=tmp_path / "results.json",
            unsafe_skip_ignore_check=True,
        )
    joined = "\n".join(record.message for record in caplog.records)
    assert transcript not in joined, (
        f"transcript body leaked into INFO logs: {joined!r}"
    )


# --- fixtures shared with the RED layer -----------------------------------


@pytest.fixture
def repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


@pytest.fixture
def two_xlsx_corpus(tmp_path, repo_root):
    corpus = tmp_path / "BD_Pruebas_fixture"
    corpus.mkdir()
    braejan = corpus / "Braejan"
    daniel = corpus / "Daniel"
    braejan.mkdir()
    daniel.mkdir()
    _seed_xlsx_dataset(
        braejan,
        rows=[(1.0, "uno", "irrelevante", "FACIL")],
    )
    _seed_xlsx_dataset(
        daniel,
        rows=[(1.0, "uno", "irrelevante", "FACIL")],
    )
    for dataset in (braejan, daniel):
        notas = dataset / "NOTAS_VOZ"
        notas.mkdir()
        (notas / "1.ogg").write_bytes(b"fake")
    return corpus


@pytest.fixture
def all_classes_corpus(tmp_path):
    """XLSX-only corpus with one clip per ACERTIVIDAD class."""
    classes = ["irrelevante-1", "filler-1", "cancion-1", "mixto-1", "silencio-1"]
    corpus = tmp_path / "all-classes"
    corpus.mkdir()
    for clip_id in classes:
        dataset = corpus / clip_id.upper()
        dataset.mkdir()
        notas = dataset / "NOTAS_VOZ"
        notas.mkdir()
        _seed_xlsx_dataset(
            dataset,
            rows=[(1.0, "transcripto", clip_id.split("-")[0], "MEDIO")],
        )
        (notas / "1.ogg").write_bytes(b"fake")
    return corpus


@pytest.fixture
def invalid_xlsx_corpus(tmp_path):
    dataset = tmp_path / "Daniel"
    dataset.mkdir()
    notas = dataset / "NOTAS_VOZ"
    notas.mkdir()
    _seed_xlsx_dataset(
        dataset,
        rows=[(1.0, "uno", "irrelevante", "FACIL")],
    )
    # No matching audio; intentionally fails mapping.
    (notas / "9.ogg").write_bytes(b"x")
    return dataset


@pytest.fixture
def corpus_with_counts(tmp_path):
    labels = tmp_path / "labels.csv"
    lines = ["clip_id,condition,transcript,items,is_garbage"]
    for index in range(7):
        lines.append(f"clip-{index},clean,tres,[],false")
    labels.write_text("\n".join(lines) + "\n", encoding="utf-8")
    for index in range(7):
        (tmp_path / f"clip-{index}.ogg").write_bytes(b"fake")
    return tmp_path


def _seed_xlsx_dataset(dataset_dir: Path, rows: list[tuple]) -> None:
    from openpyxl import Workbook

    wb = Workbook()
    sheet = wb.active
    sheet.title = "Sheet1"
    sheet.append(
        ["ID_UNICO", "TEXTO_AUDIO", "ACERTIVIDAD", "DIFICULTAD", "JSON PRODUCTOS"]
    )
    for raw_id, texto, acertividad, dificultad in rows:
        sheet.append([raw_id, texto, acertividad, dificultad, "{}"])
    wb.save(dataset_dir / "BD_AUDIOS.xlsx")
