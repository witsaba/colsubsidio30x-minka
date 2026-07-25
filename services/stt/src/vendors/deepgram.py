"""Deepgram primary adapter (REQ-VND-1, REQ-VND-4).

Plain httpx, no vendor SDK: the whole call is one POST, and staying on raw HTTP
is what makes the Groq fallback a function swap rather than a dependency swap.
"""

import httpx

from src.settings import Settings
from src.vendors.base import (
    TranscriptionResult,
    VendorAudioRejected,
    seconds_to_ms,
)

LISTEN_PATH = "/v1/listen"

#: Deepgram answers 400 when the audio itself is undecodable; every other
#: non-2xx (auth, rate limit, 5xx) is our problem with the vendor, not the
#: client's problem with the clip.
AUDIO_REJECTION_STATUS = 400


def _build_params(settings: Settings) -> dict[str, str]:
    return {
        "model": settings.stt_model,
        "language": settings.stt_language,
        "numerals": str(settings.stt_numerals).lower(),
        "mip_opt_out": str(settings.stt_mip_opt_out).lower(),
    }


async def transcribe(
    audio: bytes,
    content_type: str,
    settings: Settings,
    client: httpx.AsyncClient,
) -> TranscriptionResult:
    response = await client.post(
        f"{settings.deepgram_base_url}{LISTEN_PATH}",
        params=_build_params(settings),
        content=audio,
        headers={
            "Authorization": f"Token {settings.active_api_key}",
            "Content-Type": content_type,
        },
        timeout=settings.stt_vendor_timeout_s,
    )

    if response.status_code == AUDIO_REJECTION_STATUS:
        raise VendorAudioRejected(_rejection_detail(response))
    response.raise_for_status()

    return _to_result(response.json())


def _rejection_detail(response: httpx.Response) -> str:
    try:
        body = response.json()
    except ValueError:
        return "vendor rejected the audio"
    return str(body.get("err_code") or body.get("err_msg") or "vendor rejected the audio")


def _to_result(payload: dict) -> TranscriptionResult:
    channels = payload.get("results", {}).get("channels") or []
    alternatives = channels[0].get("alternatives") if channels else None
    alternative = alternatives[0] if alternatives else {}

    return TranscriptionResult(
        raw_transcript=alternative.get("transcript", ""),
        stt_confidence=alternative.get("confidence"),
        audio_duration_ms=seconds_to_ms(payload.get("metadata", {}).get("duration")),
    )
