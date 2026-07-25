"""Transcription routes, vendor dispatch and error mapping.

The `is_garbage` policy lives here and not inside the adapters so there is
exactly one implementation of it (design Decision 9). Audio is read into
memory, forwarded, and the reference dropped - it never reaches the filesystem
(RNF-04, REQ-PRV-1).
"""

import time
from asyncio import sleep as _asyncio_sleep
from asyncio import timeout as _asyncio_timeout
from uuid import uuid4

import httpx
from fastapi import APIRouter, File, Request, UploadFile
from fastapi.responses import JSONResponse

from src.logging_setup import get_logger
from src.settings import Settings
from src.vendors import deepgram, elevenlabs, groq
from src.vendors.base import (
    TranscriptionResult,
    VendorAdapter,
    VendorAudioRejected,
    VendorBadResponse,
    VendorDeadlineExceeded,
)

#: Resolved once at boot; `STT_VENDOR` is the only switch (REQ-VND-3).
ADAPTERS: dict[str, VendorAdapter] = {
    "deepgram": deepgram.transcribe,
    "groq": groq.transcribe,
    "elevenlabs": elevenlabs.transcribe,
}

#: Order in which an unconfigured failover picks a vendor. Explicit rather
#: than "whatever `ADAPTERS` happens to iterate as", because which vendor
#: takes over is an operational decision, not an implementation detail
#: (REQ-VND-9). A test keeps it in step with `ADAPTERS`.
#:
#: Deepgram leads: it is the sanctioned primary. ElevenLabs is second because
#: it is the stronger Spanish transcriber, and by the time it is reached the
#: primary has already failed - a dictation that would otherwise be lost is
#: worth the bounded retention exposure RNF-04 refuses to accept for *every*
#: clip. Groq is the third layer rather than the second for the same reason
#: read the other way: it is the weaker transcriber, so it answers only when
#: the two above it are both down.
FALLBACK_PRIORITY: tuple[str, ...] = ("deepgram", "elevenlabs", "groq")

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


def fallback_chain(settings: Settings) -> tuple[str, ...]:
    """The vendors to try in order once the primary is exhausted, if any.

    An explicitly named `STT_FALLBACK_VENDOR` is the *whole* chain, not its
    first entry: an operator who names a vendor has sanctioned that one, and
    walking past it to another would send audio somewhere they did not choose.
    Boot already proved it differs from the primary and has a key, so there is
    nothing left to check here.

    Otherwise the chain is automatic: every other vendor with a usable key, in
    `FALLBACK_PRIORITY` order. A non-active vendor's key is optional at boot
    (REQ-VND-5), so absent ones simply drop out (REQ-VND-9).
    """
    if not settings.stt_fallback_enabled:
        return ()
    if settings.stt_fallback_vendor:
        return (settings.stt_fallback_vendor,)
    return tuple(
        name
        for name in FALLBACK_PRIORITY
        if name != settings.stt_vendor and settings.api_key_for(name)
    )


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
    """Transcribe with the primary vendor, falling over down the chain.

    Returns the result together with the vendor that actually produced it, so
    the response and the request log name the truth rather than the
    configuration (REQ-VND-7).

    The whole of it runs under one deadline. Attempts, backoffs and the
    failovers otherwise add up to a wait no single setting expresses, and the
    caller is a person holding a push-to-talk button (REQ-VND-8).
    """
    primary = settings.stt_vendor
    in_flight = primary

    async def _attempt_all() -> tuple[TranscriptionResult, str]:
        nonlocal in_flight
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
            chain = fallback_chain(settings)
            if not chain or not is_transient(primary_error):
                raise

            for fallback in chain:
                logger.debug(
                    "vendor exhausted, failing over",
                    extra={
                        "request_id": request_id,
                        "vendor": in_flight,
                        "fallback_vendor": fallback,
                    },
                )
                in_flight = fallback
                try:
                    result = await call_vendor(
                        fallback, audio, content_type, settings, client, 1, request_id
                    )
                except Exception:
                    # This layer is down too; keep going. A fallback gets one
                    # attempt each, so the chain costs at most one call per
                    # vendor and stays inside the deadline below.
                    continue
                return result, fallback

            # Every vendor is down; the primary's failure is the honest
            # diagnosis for the caller.
            raise primary_error from None

    try:
        async with _asyncio_timeout(settings.stt_total_deadline_s):
            return await _attempt_all()
    except TimeoutError as exc:
        # The cancellation that got us here is not a vendor verdict, so it must
        # not look like one to the retry logic above.
        raise VendorDeadlineExceeded(in_flight, settings.stt_total_deadline_s) from exc


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
        except VendorDeadlineExceeded as exc:
            # Budget exhaustion IS a timeout, so it shares the vendor_timeout
            # code Module 2 already handles.
            vendor = exc.vendor
            return error_response(
                502,
                "vendor_timeout",
                f"vendor work exceeded STT_TOTAL_DEADLINE_S ({exc.deadline_s}s)",
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
