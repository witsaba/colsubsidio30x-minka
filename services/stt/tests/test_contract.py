"""Frozen HTTP contract with Module 2 (REQ-STT-1/2/3/4/5).

These tests are the contract. If one of them has to change, the change must go
through the 06:00 sync with Daniel first.
"""

import httpx
import pytest
import respx

from tests.conftest import DEEPGRAM_URL, audio_upload, deepgram_payload

FROZEN_FIELDS = {
    "raw_transcript",
    "is_garbage",
    "stt_confidence",
    "audio_duration_ms",
    "stt_vendor",
    "request_id",
}


@respx.mock
async def test_successful_transcription_returns_exactly_the_frozen_fields(client):
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 200
    body = response.json()
    assert set(body) == FROZEN_FIELDS
    assert body["raw_transcript"] == "tres kilos de lechuga"
    assert body["is_garbage"] is False
    assert body["stt_confidence"] == 0.94
    assert body["audio_duration_ms"] == 4200
    assert body["stt_vendor"] == "deepgram"
    assert isinstance(body["request_id"], str) and body["request_id"]


@respx.mock
async def test_request_id_is_unique_per_request(client):
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )

    first = await client.post("/transcribe", files=audio_upload())
    second = await client.post("/transcribe", files=audio_upload())

    assert first.json()["request_id"] != second.json()["request_id"]


@respx.mock
async def test_vendor_without_duration_yields_null_and_no_garbage(client):
    """Chunked MediaRecorder webm has no duration header (REQ-STT-1)."""
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload(duration_s=None))
    )

    body = (await client.post("/transcribe", files=audio_upload())).json()

    assert body["audio_duration_ms"] is None
    assert body["is_garbage"] is False


@respx.mock
async def test_empty_transcript_is_flagged_but_still_returns_200(client):
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(
            200, json=deepgram_payload(transcript="", confidence=0.10)
        )
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 200
    body = response.json()
    assert body["is_garbage"] is True
    assert set(body) == FROZEN_FIELDS


@respx.mock
async def test_confidence_below_floor_is_flagged_and_reported_verbatim(make_client):
    client = await make_client(STT_CONFIDENCE_FLOOR="0.60")
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload(confidence=0.40))
    )

    body = (await client.post("/transcribe", files=audio_upload())).json()

    assert body["is_garbage"] is True
    assert body["stt_confidence"] == 0.40


@respx.mock
async def test_number_words_pass_through_un_normalised(client):
    """RF-17 inverse text normalisation belongs to Module 2 (REQ-STT-4)."""
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(
            200,
            json=deepgram_payload(transcript="novecientos gramos de tomate"),
        )
    )

    body = (await client.post("/transcribe", files=audio_upload())).json()

    assert body["raw_transcript"] == "novecientos gramos de tomate"


async def test_health_reports_the_active_vendor(client):
    response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "vendor": "deepgram"}


@respx.mock
async def test_vendor_timeout_maps_to_502_vendor_timeout(client):
    respx.post(DEEPGRAM_URL).mock(side_effect=httpx.ReadTimeout("too slow"))

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "vendor_timeout"
    assert error["request_id"]
    assert "raw_transcript" not in response.json()


@respx.mock
async def test_vendor_5xx_maps_to_502_vendor_error(client):
    respx.post(DEEPGRAM_URL).mock(return_value=httpx.Response(503, text="unavailable"))

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "vendor_error"
    assert error["request_id"]


@respx.mock
async def test_vendor_auth_failure_maps_to_502_vendor_error(client):
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(401, json={"err_msg": "invalid credentials"})
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "vendor_error"


@respx.mock
async def test_vendor_audio_rejection_maps_to_400_invalid_audio(client):
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(
            400, json={"err_code": "CORRUPT_DATA", "err_msg": "failed to process audio"}
        )
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 400
    error = response.json()["error"]
    assert error["code"] == "invalid_audio"
    assert error["request_id"]


async def test_missing_file_field_is_a_4xx(client):
    response = await client.post("/transcribe", files={"clip": ("a.webm", b"x")})

    assert 400 <= response.status_code < 500


@respx.mock
async def test_upload_above_the_cap_is_rejected_with_413(make_client):
    client = await make_client(STT_MAX_UPLOAD_BYTES=1024)
    route = respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )

    response = await client.post(
        "/transcribe", files=audio_upload(payload=b"a" * 2048)
    )

    assert response.status_code == 413
    error = response.json()["error"]
    assert error["code"] == "payload_too_large"
    assert error["request_id"]
    assert not route.called, "an oversized upload must never reach the vendor"


@respx.mock
async def test_upload_at_the_cap_is_accepted(make_client):
    client = await make_client(STT_MAX_UPLOAD_BYTES=1024)
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )

    response = await client.post("/transcribe", files=audio_upload(payload=b"a" * 1024))

    assert response.status_code == 200


@respx.mock
async def test_one_byte_above_the_default_cap_is_413(client):
    """The boundary that matters: 1 MiB + 1 is where Starlette used to spill.

    The proof that no byte reaches the filesystem at this size lives in
    `tests/test_privacy.py` (JD-1); here we only pin the contract answer.
    """
    route = respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )

    response = await client.post(
        "/transcribe", files=audio_upload(payload=b"a" * (1_048_576 + 1))
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "payload_too_large"
    assert not route.called


@pytest.mark.parametrize("vendor_key", ["DEEPGRAM_API_KEY"])
async def test_missing_active_vendor_key_fails_before_serving(make_client, vendor_key):
    with pytest.raises(Exception) as excinfo:
        await make_client(**{vendor_key: None})

    assert vendor_key in str(excinfo.value)
