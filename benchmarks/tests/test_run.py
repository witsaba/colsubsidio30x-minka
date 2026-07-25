"""Benchmark runner (REQ-BMK-1, REQ-BMK-2).

The runner must work on whatever clips exist - no hard-coded corpus size - and
must pair every clip's labels with the frozen response fields so `report.py`
can score them.
"""

import asyncio
import json

import httpx
import pytest
import respx

from benchmarks.run import DEFAULT_CONCURRENCY, load_corpus, run_benchmark

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

    with pytest.raises(FileNotFoundError) as excinfo:
        load_corpus(corpus)

    assert "missing-01" in str(excinfo.value)


@respx.mock
async def test_three_clip_corpus_produces_three_result_entries(corpus, tmp_path):
    respx.post(TRANSCRIBE_URL).mock(
        return_value=httpx.Response(200, json=frozen_response())
    )
    output = tmp_path / "results.json"

    await run_benchmark(corpus, BASE_URL, output=output)

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

    await run_benchmark(corpus, BASE_URL, output=output)

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

    await run_benchmark(corpus, BASE_URL, output=output)

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

    await run_benchmark(corpus, BASE_URL, output=output)

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
        corpus, BASE_URL, concurrency=2, output=tmp_path / "results.json"
    )

    assert peak <= 2
    assert peak > 1, "the runner must actually run clips concurrently"


def test_default_concurrency_is_four():
    assert DEFAULT_CONCURRENCY == 4
