"""ElevenLabs Scribe adapter (REQ-VND-9).

Third vendor, usable as a failover target only - never as the primary, which
RNF-04 forbids because ElevenLabs zero-retention is Enterprise-gated. Two
things set it apart from the other two adapters: it authenticates with an
`xi-api-key` header rather than `Authorization`, and it reports a
transcript-level `language_probability` that we take as the confidence
directly.

Because it can no longer be the primary, `vendor_settings` configures it the
way a real deployment does: a permitted primary plus an ElevenLabs key. The
adapter reads `api_key_for("elevenlabs")`, so it never depended on being the
selected vendor anyway.

The local fixtures here are named `vendor_settings` / `http_client` rather
than `settings` / `client` so they do not shadow conftest's ASGI `client` and
`make_client`, which the route-level tests at the bottom of this file need.
"""

import httpx
import pytest
import respx

from src.settings import Settings
from src.vendors import elevenlabs
from src.vendors.base import VendorBadResponse
from tests.conftest import (
    DEEPGRAM_URL,
    ELEVENLABS_URL,
    audio_upload,
    elevenlabs_payload,
)

AUDIO = b"OggS-fake-audio-bytes"


@pytest.fixture
def vendor_settings(monkeypatch) -> Settings:
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    monkeypatch.setenv("STT_VENDOR", "deepgram")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "el-key")
    return Settings()


@pytest.fixture
async def http_client():
    async with httpx.AsyncClient() as client:
        yield client


@respx.mock
async def test_request_uses_the_speech_to_text_multipart_contract(
    vendor_settings, http_client
):
    route = respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(200, json=elevenlabs_payload())
    )

    await elevenlabs.transcribe(AUDIO, "audio/webm", vendor_settings, http_client)

    request = route.calls.last.request
    assert request.url.path == "/v1/speech-to-text"
    # ElevenLabs authenticates on its own header, not Authorization.
    assert request.headers["xi-api-key"] == "el-key"
    assert "authorization" not in request.headers
    assert request.headers["content-type"].startswith("multipart/form-data")

    body = request.content.decode("latin-1")
    assert 'name="model_id"' in body and "\r\n\r\nscribe_v1\r\n" in body
    assert 'name="language_code"' in body and "\r\n\r\nes\r\n" in body
    # Event annotations ("[laughter]") would end up inside raw_transcript.
    assert 'name="tag_audio_events"' in body and "\r\n\r\nfalse\r\n" in body
    assert 'name="file"' in body
    assert AUDIO.decode("latin-1") in body


@respx.mock
async def test_the_model_is_configurable(monkeypatch, http_client):
    monkeypatch.setitem(Settings.model_config, "env_file", None)
    monkeypatch.setenv("STT_VENDOR", "deepgram")
    monkeypatch.setenv("DEEPGRAM_API_KEY", "dg-key")
    monkeypatch.setenv("ELEVENLABS_API_KEY", "el-key")
    monkeypatch.setenv("STT_ELEVENLABS_MODEL", "scribe_v2")
    route = respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(200, json=elevenlabs_payload())
    )

    await elevenlabs.transcribe(AUDIO, "audio/webm", Settings(), http_client)

    assert "\r\n\r\nscribe_v2\r\n" in route.calls.last.request.content.decode("latin-1")


@respx.mock
async def test_maps_text_confidence_and_duration(vendor_settings, http_client):
    respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(
            200,
            json=elevenlabs_payload(
                text="quince canastas de mango",
                language_probability=0.87,
                duration_s=6.5,
            ),
        )
    )

    result = await elevenlabs.transcribe(
        AUDIO, "audio/webm", vendor_settings, http_client
    )

    assert result.raw_transcript == "quince canastas de mango"
    assert result.stt_confidence == 0.87
    assert result.audio_duration_ms == 6500


@respx.mock
async def test_duration_seconds_are_rounded_to_milliseconds(
    vendor_settings, http_client
):
    respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(200, json=elevenlabs_payload(duration_s=1.2345))
    )

    result = await elevenlabs.transcribe(
        AUDIO, "audio/webm", vendor_settings, http_client
    )

    assert result.audio_duration_ms == 1234


@respx.mock
async def test_missing_duration_maps_to_none(vendor_settings, http_client):
    """Never 0: that would falsely fire the negligible-speech trigger."""
    respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(200, json=elevenlabs_payload(duration_s=None))
    )

    result = await elevenlabs.transcribe(
        AUDIO, "audio/webm", vendor_settings, http_client
    )

    assert result.audio_duration_ms is None


@respx.mock
async def test_missing_language_probability_maps_to_none(vendor_settings, http_client):
    """An absent confidence is unknown, so the floor trigger is skipped."""
    respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(
            200, json=elevenlabs_payload(language_probability=None)
        )
    )

    result = await elevenlabs.transcribe(
        AUDIO, "audio/webm", vendor_settings, http_client
    )

    assert result.stt_confidence is None
    assert result.raw_transcript == "tres kilos de lechuga"


@respx.mock
async def test_an_empty_transcript_is_still_a_valid_result(
    vendor_settings, http_client
):
    respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(200, json=elevenlabs_payload(text=""))
    )

    result = await elevenlabs.transcribe(
        AUDIO, "audio/webm", vendor_settings, http_client
    )

    assert result.raw_transcript == ""


@respx.mock
async def test_a_body_without_text_is_a_bad_response(vendor_settings, http_client):
    """`text` is the mandatory key, as `results` is for Deepgram."""
    respx.post(ELEVENLABS_URL).mock(return_value=httpx.Response(200, json={"foo": 1}))

    with pytest.raises(VendorBadResponse):
        await elevenlabs.transcribe(AUDIO, "audio/webm", vendor_settings, http_client)


@respx.mock
async def test_a_non_json_body_is_a_bad_response(vendor_settings, http_client):
    respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(200, text="<html>502 Bad Gateway</html>")
    )

    with pytest.raises(VendorBadResponse):
        await elevenlabs.transcribe(AUDIO, "audio/webm", vendor_settings, http_client)


@pytest.mark.parametrize("status", [401, 422, 503])
@respx.mock
async def test_error_statuses_raise_an_http_status_error(
    vendor_settings, http_client, status
):
    """422 included: it is a generic validation error, not "bad audio".

    ElevenLabs answers 422 for any invalid field, including ones we control.
    Calling that `invalid_audio` would blame the caller for our bug.
    """
    respx.post(ELEVENLABS_URL).mock(return_value=httpx.Response(status))

    with pytest.raises(httpx.HTTPStatusError):
        await elevenlabs.transcribe(AUDIO, "audio/webm", vendor_settings, http_client)


# --- route level -------------------------------------------------------------


async def test_elevenlabs_as_primary_is_rejected_at_boot(make_client):
    """The whole point of REQ-VND-9: backup only, and the code says so."""
    with pytest.raises(Exception) as excinfo:
        await make_client(STT_VENDOR="elevenlabs", ELEVENLABS_API_KEY="el-key")

    message = str(excinfo.value)
    assert "RNF-04" in message
    assert "STT_FALLBACK_VENDOR=elevenlabs" in message, "point at the supported use"


@respx.mock
async def test_elevenlabs_serves_as_the_fallback_and_reports_itself(make_client):
    """Deepgram is what the deployment selects; ElevenLabs is what saves it."""
    client = await make_client(ELEVENLABS_API_KEY="el-key")
    respx.post(DEEPGRAM_URL).mock(return_value=httpx.Response(503, text="unavailable"))
    route = respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(
            200, json=elevenlabs_payload(text="dos bultos de papa")
        )
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 200
    body = response.json()
    assert body["stt_vendor"] == "elevenlabs", "the response names who served it"
    assert body["raw_transcript"] == "dos bultos de papa"
    assert body["stt_confidence"] == 0.98
    assert body["audio_duration_ms"] == 4200
    assert body["is_garbage"] is False
    assert route.calls.last.request.headers["xi-api-key"] == "el-key"
    assert (
        await client.get("/health")
    ).json()["vendor"] == "deepgram", "/health reports the configured primary"


@respx.mock
async def test_a_failing_elevenlabs_fallback_is_tried_once_and_not_retried(
    make_client, backoff_sleeps
):
    """A fallback gets one attempt; the primary's failure stays the answer."""
    client = await make_client(ELEVENLABS_API_KEY="el-key")
    deepgram_route = respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(503, text="unavailable")
    )
    route = respx.post(ELEVENLABS_URL).mock(return_value=httpx.Response(401))

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "vendor_error"
    assert route.call_count == 1
    assert deepgram_route.call_count == 2, "the primary keeps its own retry budget"
    assert backoff_sleeps == [0.5], "one backoff, between the primary's two attempts"


@respx.mock
async def test_a_malformed_elevenlabs_fallback_body_stays_on_the_envelope(make_client):
    client = await make_client(ELEVENLABS_API_KEY="el-key")
    respx.post(DEEPGRAM_URL).mock(side_effect=httpx.ReadTimeout("too slow"))
    route = respx.post(ELEVENLABS_URL).mock(return_value=httpx.Response(200, json=[]))

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "vendor_timeout", "the primary's failure class"
    assert "deepgram" in error["message"]
    assert route.call_count == 1
