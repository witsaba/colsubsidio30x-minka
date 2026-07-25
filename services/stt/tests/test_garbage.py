"""is_garbage policy (REQ-STT-3, REQ-STT-1 null-duration scenario).

evaluate_garbage is a pure, vendor-agnostic function: same inputs, same answer,
no I/O (design Decision 9).
"""

import pytest

from src.settings import Settings
from src.transcribe import evaluate_garbage
from src.vendors.base import TranscriptionResult


@pytest.fixture
def settings(monkeypatch) -> Settings:
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    monkeypatch.setenv("STT_VENDOR", "deepgram")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("STT_CONFIDENCE_FLOOR", "0.60")
    monkeypatch.setenv("STT_MIN_SPEECH_MS", "300")
    return Settings()


def result(transcript="tres kilos de lechuga", confidence=0.94, duration_ms=4200):
    return TranscriptionResult(
        raw_transcript=transcript,
        stt_confidence=confidence,
        audio_duration_ms=duration_ms,
    )


def test_normal_clip_is_not_garbage(settings):
    assert evaluate_garbage(result(), settings) is False


def test_empty_transcript_is_garbage(settings):
    assert evaluate_garbage(result(transcript=""), settings) is True


def test_whitespace_only_transcript_is_garbage(settings):
    assert evaluate_garbage(result(transcript="   \n\t "), settings) is True


def test_confidence_below_floor_is_garbage(settings):
    assert evaluate_garbage(result(confidence=0.40), settings) is True


def test_confidence_exactly_at_floor_is_not_garbage(settings):
    assert evaluate_garbage(result(confidence=0.60), settings) is False


def test_null_confidence_skips_the_floor_trigger(settings):
    assert evaluate_garbage(result(confidence=None), settings) is False


def test_negligible_duration_is_garbage(settings):
    assert evaluate_garbage(result(duration_ms=120), settings) is True


def test_duration_exactly_at_the_floor_is_not_garbage(settings):
    assert evaluate_garbage(result(duration_ms=300), settings) is False


def test_null_duration_alone_does_not_flag_garbage(settings):
    """Chunked MediaRecorder webm carries no duration header (Decision 5)."""
    assert evaluate_garbage(result(duration_ms=None), settings) is False


def test_null_duration_with_empty_transcript_is_still_garbage(settings):
    assert evaluate_garbage(result(transcript="", duration_ms=None), settings) is True
