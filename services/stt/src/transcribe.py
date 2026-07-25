"""Transcription routes, vendor dispatch and error mapping.

The `is_garbage` policy lives here and not inside the adapters so there is
exactly one implementation of it (design Decision 9). Audio is read into
memory, forwarded, and the reference dropped - it never reaches the filesystem
(RNF-04, REQ-PRV-1).
"""

import time
from asyncio import sleep as _asyncio_sleep
from uuid import uuid4

import httpx
from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse

from src.logging_setup import get_logger
from src.settings import Settings
from src.vendors import deepgram, groq
from src.vendors.base import (
    TranscriptionResult,
    VendorAdapter,
    VendorAudioRejected,
    VendorBadResponse,
)

#: Resolved once at boot; `STT_VENDOR` is the only switch (REQ-VND-3).
ADAPTERS: dict[str, VendorAdapter] = {
    "deepgram": deepgram.transcribe,
    "groq": groq.transcribe,
}

router = APIRouter()
logger = get_logger()

#: Vendor statuses worth a second try: rate limiting and the server-side
#: failures a vendor recovers from on its own. Everything else - 400, 401, 403,
#: an unparsable body - answers the same way however often we ask (REQ-VND-6).
TRANSIENT_STATUS = frozenset({429, 500, 502, 503, 504})

#: Seam for the backoff wait, so tests can assert the schedule without
#: spending it. Production always uses `asyncio.sleep`.
sleep = _asyncio_sleep


def is_transient(exc: Exception) -> bool:
    """Whether retrying `exc` could plausibly produce a different answer."""
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code in TRANSIENT_STATUS
    # TimeoutException is itself a RequestError; both mean the call never got a
    # verdict from the vendor.
    return isinstance(exc, httpx.RequestError)


def fallback_vendor(settings: Settings) -> str | None:
    """The vendor to fail over to, or None when there is nowhere to go.

    Failover needs both the switch and a usable key: the non-active vendor's
    key is optional at boot (REQ-VND-5), so it is often simply absent.
    """
    if not settings.stt_fallback_enabled:
        return None
    for name in ADAPTERS:
        if name != settings.stt_vendor and settings.api_key_for(name):
            return name
    return None


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


async def call_vendor(
    vendor: str,
    audio: bytes,
    content_type: str,
    settings: Settings,
    client: httpx.AsyncClient,
    attempts: int,
    request_id: str,
) -> TranscriptionResult:
    """Call one vendor up to `attempts` times, backing off between tries.

    A non-transient failure propagates on the first attempt: retrying bad
    credentials or rejected audio only makes the speaker wait longer for the
    same answer (REQ-VND-6).
    """
    last_error: Exception | None = None
    for attempt in range(1, attempts + 1):
        try:
            return await ADAPTERS[vendor](audio, content_type, settings, client)
        except Exception as exc:
            if not is_transient(exc):
                raise
            last_error = exc
            if attempt == attempts:
                break
            delay = settings.stt_retry_backoff_s * 2 ** (attempt - 1)
            logger.debug(
                "vendor attempt failed, backing off",
                extra={
                    "request_id": request_id,
                    "vendor": vendor,
                    "attempt": attempt,
                    "backoff_s": delay,
                },
            )
            await sleep(delay)

    assert last_error is not None  # the loop only breaks after a failure
    raise last_error


async def dispatch(
    audio: bytes,
    content_type: str,
    settings: Settings,
    client: httpx.AsyncClient,
    request_id: str,
) -> tuple[TranscriptionResult, str]:
    """Transcribe with the primary vendor, falling over to the other one.

    Returns the result together with the vendor that actually produced it, so
    the response and the request log name the truth rather than the
    configuration (REQ-VND-7).
    """
    primary = settings.stt_vendor
    try:
        result = await call_vendor(
            primary,
            audio,
            content_type,
            settings,
            client,
            settings.stt_retry_attempts,
            request_id,
        )
        return result, primary
    except Exception as primary_error:
        fallback = fallback_vendor(settings)
        if fallback is None or not is_transient(primary_error):
            raise

        logger.debug(
            "primary vendor exhausted, failing over",
            extra={
                "request_id": request_id,
                "vendor": primary,
                "fallback_vendor": fallback,
            },
        )
        try:
            result = await call_vendor(
                fallback, audio, content_type, settings, client, 1, request_id
            )
        except Exception:
            # Both vendors are down; the primary's failure is the honest
            # diagnosis for the caller.
            raise primary_error from None
        return result, fallback


@router.get("/health")
async def health(request: Request) -> dict[str, str]:
    return {"status": "ok", "vendor": request.app.state.settings.stt_vendor}


@router.post("/transcribe")
async def transcribe(request: Request, file: UploadFile = File(...)) -> JSONResponse:
    settings: Settings = request.app.state.settings
    client: httpx.AsyncClient = request.app.state.http_client
    vendor = settings.stt_vendor
    # On the request scope, not just a local, so a crash anywhere downstream
    # reports the id that is already in the logs (JD-6).
    request_id = request.state.request_id = str(uuid4())
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
            result, vendor = await dispatch(
                audio,
                file.content_type or "application/octet-stream",
                settings,
                client,
                request_id,
            )
        except VendorAudioRejected:
            return error_response(
                400, "invalid_audio", "vendor could not decode the audio", request_id
            )
        except httpx.TimeoutException:
            return error_response(
                502, "vendor_timeout", f"{vendor} timed out", request_id
            )
        except VendorBadResponse:
            return error_response(
                502,
                "vendor_error",
                f"{vendor} returned an unusable response",
                request_id,
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
