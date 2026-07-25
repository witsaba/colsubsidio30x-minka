"""Transcription route layer.

For now it holds only the pure `is_garbage` policy; the policy lives here and
not inside the adapters so there is exactly one implementation of it
(design Decision 9).
"""

from src.settings import Settings
from src.vendors.base import TranscriptionResult


def evaluate_garbage(result: TranscriptionResult, settings: Settings) -> bool:
    """Return the `is_garbage` signal for a transcription result (REQ-STT-3).

    Any of three triggers flags garbage: an empty transcript, a known
    confidence below the floor, or a known duration below the minimum speech
    length. Unknown (None) confidence or duration never triggers on its own.
    """
    if not result.raw_transcript.strip():
        return True
    if (
        result.stt_confidence is not None
        and result.stt_confidence < settings.stt_confidence_floor
    ):
        return True
    if (
        result.audio_duration_ms is not None
        and result.audio_duration_ms < settings.stt_min_speech_ms
    ):
        return True
    return False
