"""Groq fallback adapter (REQ-VND-2).

Groq is OpenAI-compatible, so the request is multipart rather than raw bytes.
Its confidence is a derived proxy - the unweighted mean of exp(avg_logprob)
over the verbose_json segments (design Decision 4) - not a vendor-reported
score, and it is NOT comparable to Deepgram's.
"""

import math

import httpx
import pytest
import respx

from src.settings import Settings
from src.vendors import groq
from src.vendors.base import VendorAudioRejected
from tests.conftest import GROQ_URL, groq_payload

AUDIO = b"OggS-fake-audio-bytes"


@pytest.fixture
def settings(monkeypatch) -> Settings:
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    monkeypatch.setenv("STT_VENDOR", "groq")
    monkeypatch.setenv("GROQ_API_KEY", "gq-key")
    return Settings()


@pytest.fixture
async def client():
    async with httpx.AsyncClient() as client:
        yield client


@respx.mock
async def test_request_uses_the_openai_compatible_multipart_contract(settings, client):
    route = respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload())
    )

    await groq.transcribe(AUDIO, "audio/webm", settings, client)

    request = route.calls.last.request
    assert request.headers["content-type"].startswith("multipart/form-data")
    assert request.headers["authorization"] == "Bearer gq-key"
    body = request.content.decode("latin-1")
    assert "whisper-large-v3-turbo" in body
    assert 'name="language"' in body and "\r\n\r\nes\r\n" in body
    assert "verbose_json" in body
    assert AUDIO.decode("latin-1") in body


@respx.mock
async def test_maps_text_and_duration(settings, client):
    respx.post(GROQ_URL).mock(
        return_value=httpx.Response(
            200,
            json=groq_payload(text="quince canastas de mango", duration_s=6.5),
        )
    )

    result = await groq.transcribe(AUDIO, "audio/webm", settings, client)

    assert result.raw_transcript == "quince canastas de mango"
    assert result.audio_duration_ms == 6500


@respx.mock
async def test_confidence_is_the_unweighted_mean_of_exp_avg_logprob(settings, client):
    respx.post(GROQ_URL).mock(
        return_value=httpx.Response(
            200, json=groq_payload(avg_logprobs=(-0.1, -0.5, -0.3))
        )
    )

    result = await groq.transcribe(AUDIO, "audio/webm", settings, client)

    expected = sum(math.exp(v) for v in (-0.1, -0.5, -0.3)) / 3
    assert result.stt_confidence == pytest.approx(expected)


@respx.mock
async def test_confidence_is_clamped_to_one(settings, client):
    """A positive avg_logprob would exponentiate above 1."""
    respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload(avg_logprobs=(0.4, 0.2)))
    )

    result = await groq.transcribe(AUDIO, "audio/webm", settings, client)

    assert result.stt_confidence == 1.0


@respx.mock
async def test_no_segments_yields_no_confidence(settings, client):
    respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload(avg_logprobs=()))
    )

    result = await groq.transcribe(AUDIO, "audio/webm", settings, client)

    assert result.stt_confidence is None


@respx.mock
async def test_missing_duration_maps_to_none(settings, client):
    respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload(duration_s=None))
    )

    result = await groq.transcribe(AUDIO, "audio/webm", settings, client)

    assert result.audio_duration_ms is None


@respx.mock
async def test_audio_rejection_raises_vendor_audio_rejected(settings, client):
    respx.post(GROQ_URL).mock(
        return_value=httpx.Response(
            400, json={"error": {"message": "could not decode audio"}}
        )
    )

    with pytest.raises(VendorAudioRejected):
        await groq.transcribe(AUDIO, "audio/webm", settings, client)


@respx.mock
async def test_server_error_raises_an_http_status_error(settings, client):
    respx.post(GROQ_URL).mock(return_value=httpx.Response(503))

    with pytest.raises(httpx.HTTPStatusError):
        await groq.transcribe(AUDIO, "audio/webm", settings, client)
