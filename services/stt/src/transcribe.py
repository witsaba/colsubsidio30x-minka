"""Transcription routes, vendor dispatch and error mapping.

The `is_garbage` policy lives here and not inside the adapters so there is
exactly one implementation of it (design Decision 9). Audio is read into
memory, forwarded, and the reference dropped - it never reaches the filesystem
(RNF-04, REQ-PRV-1).
"""

import time
from uuid import uuid4

import httpx
from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse

from src.logging_setup import get_logger
from src.settings import Settings
from src.vendors import deepgram
from src.vendors.base import TranscriptionResult, VendorAdapter, VendorAudioRejected

#: Resolved once at boot; `STT_VENDOR` is the only switch (REQ-VND-3).
ADAPTERS: dict[str, VendorAdapter] = {"deepgram": deepgram.transcribe}

router = APIRouter()
logger = get_logger()


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


def error_response(
    status_code: int, code: str, message: str, request_id: str
) -> JSONResponse:
    """The single error envelope shape shared by every failure path."""
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message, "request_id": request_id}},
    )


def _log_request(request_id: str, vendor: str, started: float) -> None:
    """The one per-request INFO record: request_id, duration, vendor only.

    Nothing derived from the payload - not the transcript, not the confidence,
    not the client's filename (REQ-PRV-2, REQ-PRV-3, Ley 1581).
    """
    logger.info(
        "transcribe request completed",
        extra={
            "request_id": request_id,
            "duration_ms": round((time.perf_counter() - started) * 1000, 3),
            "vendor": vendor,
        },
    )


@router.get("/health")
async def health(request: Request) -> dict[str, str]:
    return {"status": "ok", "vendor": request.app.state.settings.stt_vendor}


@router.post("/transcribe")
async def transcribe(request: Request, file: UploadFile = File(...)) -> JSONResponse:
    settings: Settings = request.app.state.settings
    client: httpx.AsyncClient = request.app.state.http_client
    vendor = settings.stt_vendor
    request_id = str(uuid4())
    started = time.perf_counter()

    audio = await file.read()
    try:
        if len(audio) > settings.stt_max_upload_bytes:
            logger.debug(
                "upload rejected by cap",
                extra={"request_id": request_id, "size_bytes": len(audio)},
            )
            return error_response(
                413,
                "payload_too_large",
                f"upload exceeds STT_MAX_UPLOAD_BYTES ({settings.stt_max_upload_bytes})",
                request_id,
            )

        try:
            result = await ADAPTERS[vendor](
                audio,
                file.content_type or "application/octet-stream",
                settings,
                client,
            )
        except VendorAudioRejected:
            return error_response(
                400, "invalid_audio", "vendor could not decode the audio", request_id
            )
        except httpx.TimeoutException:
            return error_response(
                502, "vendor_timeout", f"{vendor} timed out", request_id
            )
        except (httpx.HTTPStatusError, httpx.RequestError):
            return error_response(
                502, "vendor_error", f"{vendor} call failed", request_id
            )
    finally:
        del audio
        _log_request(request_id, vendor, started)

    return JSONResponse(
        status_code=200,
        content={
            "raw_transcript": result.raw_transcript,
            "is_garbage": evaluate_garbage(result, settings),
            "stt_confidence": result.stt_confidence,
            "audio_duration_ms": result.audio_duration_ms,
            "stt_vendor": vendor,
            "request_id": request_id,
        },
    )
