"""Groq fallback adapter (REQ-VND-2, REQ-VND-4).

Groq exposes an OpenAI-compatible transcription endpoint, so the request is
multipart. It reports no confidence, so we derive one from the verbose_json
segments (design Decision 4) - an uncalibrated proxy, deliberately kept so the
`is_garbage` confidence trigger stays alive on the fallback vendor. It is NOT
comparable to Deepgram's confidence.
"""

import math

import httpx

from src.settings import Settings
from src.vendors.base import (
    BAD_RESPONSE_ERRORS,
    TranscriptionResult,
    VendorAudioRejected,
    VendorBadResponse,
    seconds_to_ms,
)

TRANSCRIPTIONS_PATH = "/openai/v1/audio/transcriptions"
MODEL = "whisper-large-v3-turbo"
RESPONSE_FORMAT = "verbose_json"

#: Groq answers 400 when the audio itself is undecodable.
AUDIO_REJECTION_STATUS = 400


async def transcribe(
    audio: bytes,
    content_type: str,
    settings: Settings,
    client: httpx.AsyncClient,
) -> TranscriptionResult:
    response = await client.post(
        f"{settings.groq_base_url}{TRANSCRIPTIONS_PATH}",
        files={"file": ("clip", audio, content_type)},
        data={
            "model": MODEL,
            "language": settings.stt_language,
            "response_format": RESPONSE_FORMAT,
        },
        headers={"Authorization": f"Bearer {settings.active_api_key}"},
        timeout=settings.stt_vendor_timeout_s,
    )

    if response.status_code == AUDIO_REJECTION_STATUS:
        raise VendorAudioRejected("vendor rejected the audio")
    response.raise_for_status()

    try:
        return _to_result(response.json())
    except BAD_RESPONSE_ERRORS as exc:
        raise VendorBadResponse("groq returned an unparsable 2xx body") from exc


def mean_segment_confidence(segments: list[dict]) -> float | None:
    """Unweighted mean of exp(avg_logprob) over segments, clamped to [0, 1].

    Returns None when there are no segments, so the confidence floor is skipped
    rather than fired on a value we do not have.
    """
    logprobs = [
        segment["avg_logprob"]
        for segment in segments
        if segment.get("avg_logprob") is not None
    ]
    if not logprobs:
        return None
    mean = sum(math.exp(value) for value in logprobs) / len(logprobs)
    return min(max(mean, 0.0), 1.0)


def _to_result(payload: dict) -> TranscriptionResult:
    # `text` is mandatory on a Groq 2xx (verbose_json always carries it); its
    # absence means the body is not a transcription. Segments and duration stay
    # optional, so a vendor that omits them still yields a usable result.
    return TranscriptionResult(
        raw_transcript=payload["text"],
        stt_confidence=mean_segment_confidence(payload.get("segments") or []),
        audio_duration_ms=seconds_to_ms(payload.get("duration")),
    )
