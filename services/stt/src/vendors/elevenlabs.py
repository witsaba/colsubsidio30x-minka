"""ElevenLabs Scribe adapter (REQ-VND-9).

Usable as primary or as fallback, like the other two. It differs from them in
two ways worth knowing before reading the code:

- it authenticates with its own `xi-api-key` header, not `Authorization`;
- it reports `language_probability`, a transcript-level score in [0, 1], which
  we take as the confidence directly. It is the vendor's own number rather
  than the derived proxy Groq needs (design Decision 13).

`tag_audio_events` is sent as false on purpose: event annotations such as
"[laughter]" would land inside `raw_transcript`, and Module 2 parses that text
as an inventory line.
"""

import httpx

from src.settings import Settings
from src.vendors.base import (
    BAD_RESPONSE_ERRORS,
    TranscriptionResult,
    VendorBadResponse,
    seconds_to_ms,
)

SPEECH_TO_TEXT_PATH = "/v1/speech-to-text"
MODEL = "scribe_v1"


async def transcribe(
    audio: bytes,
    content_type: str,
    settings: Settings,
    client: httpx.AsyncClient,
) -> TranscriptionResult:
    response = await client.post(
        f"{settings.elevenlabs_base_url}{SPEECH_TO_TEXT_PATH}",
        files={"file": ("clip", audio, content_type)},
        data={
            "model_id": settings.stt_elevenlabs_model,
            "language_code": settings.stt_language,
            "tag_audio_events": "false",
        },
        # This adapter's own key, never `active_api_key`: on failover it is the
        # vendor that is not active (REQ-VND-7).
        headers={"xi-api-key": settings.api_key_for("elevenlabs") or ""},
        timeout=settings.stt_vendor_timeout_s,
    )

    # No status is special-cased to VendorAudioRejected. ElevenLabs answers 422
    # for any invalid field, including `model_id` - ours, not the caller's - so
    # calling it `invalid_audio` would blame the caller for our own bug. Every
    # non-2xx is a vendor error, and 422 is not in TRANSIENT_STATUS, so it
    # fails fast rather than being retried.
    response.raise_for_status()

    try:
        return _to_result(response.json())
    except BAD_RESPONSE_ERRORS as exc:
        raise VendorBadResponse("elevenlabs returned an unparsable 2xx body") from exc


def _to_result(payload: dict) -> TranscriptionResult:
    # `text` is mandatory on a 2xx, mirroring Deepgram's `results` and Groq's
    # `text`. Confidence and duration stay optional: an absent value is None,
    # never a fabricated number (design Decision 5).
    return TranscriptionResult(
        raw_transcript=payload["text"],
        stt_confidence=payload.get("language_probability"),
        audio_duration_ms=seconds_to_ms(payload.get("audio_duration_secs")),
    )
