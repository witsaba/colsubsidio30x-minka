"""Shared test fixtures: in-process ASGI client and vendor payload builders.

The test client talks to the app through `httpx.ASGITransport`, so no socket is
opened. `respx` patches the real network transport only, which is exactly the
outbound vendor call we want to mock.
"""

from contextlib import AsyncExitStack

import httpx
import pytest

from src.settings import Settings

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"
GROQ_URL = "https://api.groq.com/openai/v1/audio/transcriptions"
ELEVENLABS_URL = "https://api.elevenlabs.io/v1/speech-to-text"

BASE_ENV = {"STT_VENDOR": "deepgram", "DEEPGRAM_API_KEY": "dg-key"}

MANAGED_ENV_VARS = (
    "STT_VENDOR",
    "DEEPGRAM_API_KEY",
    "GROQ_API_KEY",
    "ELEVENLABS_API_KEY",
    "STT_ELEVENLABS_MODEL",
    "STT_LANGUAGE",
    "STT_MODEL",
    "STT_NUMERALS",
    "STT_MIP_OPT_OUT",
    "STT_CONFIDENCE_FLOOR",
    "STT_MIN_SPEECH_MS",
    "STT_MAX_UPLOAD_BYTES",
    "STT_VENDOR_TIMEOUT_S",
    "STT_TOTAL_DEADLINE_S",
    "STT_RETRY_ATTEMPTS",
    "STT_RETRY_BACKOFF_S",
    "STT_FALLBACK_ENABLED",
    "LOG_LEVEL",
)


@pytest.fixture(autouse=True)
def backoff_sleeps(monkeypatch):
    """Nothing in the suite waits on a real backoff.

    Yields the recorded delay schedule, so a test can assert the retry timing
    it asked for without spending it. `raising=False` keeps this harmless for
    the tests that run before the seam exists.
    """
    delays: list[float] = []

    async def _record(delay: float) -> None:
        delays.append(delay)

    monkeypatch.setattr("src.transcribe.sleep", _record, raising=False)
    return delays


@pytest.fixture
def env(monkeypatch):
    """Give each test a clean, explicit environment and let it override it."""
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    for name in MANAGED_ENV_VARS:
        monkeypatch.delenv(name, raising=False)

    def _set(**overrides):
        for key, value in {**BASE_ENV, **overrides}.items():
            if value is None:
                monkeypatch.delenv(key, raising=False)
            else:
                monkeypatch.setenv(key, str(value))

    _set()
    return _set


@pytest.fixture
async def make_client(env):
    """Build an ASGI-backed client for an app configured with `overrides`."""
    async with AsyncExitStack() as stack:

        async def _make(**overrides) -> httpx.AsyncClient:
            env(**overrides)
            from src.main import create_app

            app = create_app()
            await stack.enter_async_context(app.router.lifespan_context(app))
            return await stack.enter_async_context(
                httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=app),
                    base_url="http://stt.test",
                )
            )

        yield _make


@pytest.fixture
async def client(make_client) -> httpx.AsyncClient:
    return await make_client()


def audio_upload(payload: bytes = b"OggS-fake-audio-bytes", content_type="audio/webm"):
    """A multipart `file` field, shaped the way Module 2 will send it."""
    return {"file": ("clip.webm", payload, content_type)}


def deepgram_payload(
    transcript: str = "tres kilos de lechuga",
    confidence: float | None = 0.94,
    duration_s: float | None = 4.2,
) -> dict:
    alternative: dict = {"transcript": transcript}
    if confidence is not None:
        alternative["confidence"] = confidence
    metadata: dict = {"request_id": "vendor-side-id"}
    if duration_s is not None:
        metadata["duration"] = duration_s
    return {
        "metadata": metadata,
        "results": {"channels": [{"alternatives": [alternative]}]},
    }


def elevenlabs_payload(
    text: str = "tres kilos de lechuga",
    language_probability: float | None = 0.98,
    duration_s: float | None = 4.2,
) -> dict:
    payload: dict = {"language_code": "es", "text": text, "words": []}
    if language_probability is not None:
        payload["language_probability"] = language_probability
    if duration_s is not None:
        payload["audio_duration_secs"] = duration_s
    return payload


def groq_payload(
    text: str = "tres kilos de lechuga",
    avg_logprobs: tuple[float, ...] = (-0.1, -0.2),
    duration_s: float | None = 4.2,
) -> dict:
    payload: dict = {
        "text": text,
        "segments": [{"avg_logprob": value} for value in avg_logprobs],
    }
    if duration_s is not None:
        payload["duration"] = duration_s
    return payload
