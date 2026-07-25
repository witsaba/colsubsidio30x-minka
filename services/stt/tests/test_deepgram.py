"""Deepgram primary adapter (REQ-VND-1).

The request parameters are frozen by the spec: nova-3, language=es (never
`multi`), numerals=true, mip_opt_out=true.
"""

from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
import respx

from src.settings import Settings
from src.vendors import deepgram
from src.vendors.base import VendorAudioRejected
from tests.conftest import DEEPGRAM_URL, deepgram_payload

AUDIO = b"OggS-fake-audio-bytes"


@pytest.fixture
def settings(monkeypatch) -> Settings:
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    monkeypatch.setenv("STT_VENDOR", "deepgram")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    return Settings()


@pytest.fixture
async def client():
    async with httpx.AsyncClient() as client:
        yield client


@respx.mock
async def test_request_carries_the_frozen_parameters(settings, client):
    route = respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )

    await deepgram.transcribe(AUDIO, "audio/webm", settings, client)

    request = route.calls.last.request
    query = parse_qs(urlsplit(str(request.url)).query)
    assert query["model"] == ["nova-3"]
    assert query["language"] == ["es"]
    assert query["numerals"] == ["true"]
    assert query["mip_opt_out"] == ["true"]
    assert "multi" not in str(request.url)
    assert "smart_format" not in str(request.url)


@respx.mock
async def test_request_sends_raw_bytes_with_the_callers_content_type(settings, client):
    route = respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )

    await deepgram.transcribe(AUDIO, "audio/ogg", settings, client)

    request = route.calls.last.request
    assert request.content == AUDIO
    assert request.headers["content-type"] == "audio/ogg"
    assert request.headers["authorization"] == "Token dg-key"


@respx.mock
async def test_maps_transcript_confidence_and_duration(settings, client):
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(
            200,
            json=deepgram_payload(
                transcript="doce botellas de aceite", confidence=0.91, duration_s=4.2
            ),
        )
    )

    result = await deepgram.transcribe(AUDIO, "audio/webm", settings, client)

    assert result.raw_transcript == "doce botellas de aceite"
    assert result.stt_confidence == 0.91
    assert result.audio_duration_ms == 4200


@respx.mock
async def test_missing_metadata_duration_maps_to_none(settings, client):
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload(duration_s=None))
    )

    result = await deepgram.transcribe(AUDIO, "audio/webm", settings, client)

    assert result.audio_duration_ms is None


@respx.mock
async def test_empty_channels_map_to_an_empty_transcript(settings, client):
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(
            200, json={"metadata": {"duration": 0.4}, "results": {"channels": []}}
        )
    )

    result = await deepgram.transcribe(AUDIO, "audio/webm", settings, client)

    assert result.raw_transcript == ""
    assert result.stt_confidence is None
    assert result.audio_duration_ms == 400


@respx.mock
async def test_audio_rejection_raises_vendor_audio_rejected(settings, client):
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(
            400, json={"err_code": "CORRUPT_DATA", "err_msg": "failed to process audio"}
        )
    )

    with pytest.raises(VendorAudioRejected):
        await deepgram.transcribe(AUDIO, "audio/webm", settings, client)


@respx.mock
async def test_auth_failure_raises_an_http_status_error(settings, client):
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(401, json={"err_msg": "invalid credentials"})
    )

    with pytest.raises(httpx.HTTPStatusError):
        await deepgram.transcribe(AUDIO, "audio/webm", settings, client)


@respx.mock
async def test_server_error_raises_an_http_status_error(settings, client):
    respx.post(DEEPGRAM_URL).mock(return_value=httpx.Response(503))

    with pytest.raises(httpx.HTTPStatusError):
        await deepgram.transcribe(AUDIO, "audio/webm", settings, client)
