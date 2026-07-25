"""Privacy guarantees: RNF-04 (no audio on disk) and Ley 1581 (no transcript
in logs). REQ-PRV-1, REQ-PRV-2, REQ-PRV-3.

The no-disk proof is a trap, not an observation (design Decision 7): every
route the audio could take to the filesystem is monkeypatched to raise, so a
request that completes normally proves nothing was written.
"""

import logging
import tempfile

import httpx
import pytest
import respx

from src.logging_setup import LOGGER_NAME
from tests.conftest import DEEPGRAM_URL, audio_upload, deepgram_payload

MAX_UPLOAD_BYTES = 1_048_576
KNOWN_TRANSCRIPT = "quince canastas de mango tommy y dos bultos de papa"

_STANDARD_RECORD_ATTRS = set(
    logging.LogRecord("n", logging.INFO, "p", 1, "m", None, None).__dict__
) | {"message", "asctime", "taskName"}

ALLOWED_INFO_FIELDS = {"request_id", "duration_ms", "vendor"}


@pytest.fixture
def disk_writes_forbidden(monkeypatch):
    """Make every filesystem escape hatch explode."""

    def _explode(*args, **kwargs):
        raise AssertionError("audio must never touch the filesystem (RNF-04)")

    monkeypatch.setattr(tempfile.SpooledTemporaryFile, "rollover", _explode)
    monkeypatch.setattr(tempfile, "NamedTemporaryFile", _explode)
    monkeypatch.setattr(tempfile, "TemporaryFile", _explode)
    monkeypatch.setattr(tempfile, "mkstemp", _explode)


@respx.mock
async def test_success_path_never_writes_audio_to_disk(client, disk_writes_forbidden):
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )

    response = await client.post(
        "/transcribe", files=audio_upload(payload=b"a" * MAX_UPLOAD_BYTES)
    )

    assert response.status_code == 200
    assert response.json()["raw_transcript"] == "tres kilos de lechuga"


@respx.mock
async def test_error_path_never_writes_audio_to_disk(client, disk_writes_forbidden):
    respx.post(DEEPGRAM_URL).mock(side_effect=httpx.ReadTimeout("too slow"))

    response = await client.post(
        "/transcribe", files=audio_upload(payload=b"a" * MAX_UPLOAD_BYTES)
    )

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "vendor_timeout"


@respx.mock
async def test_transcript_never_appears_in_any_log_record(client, caplog):
    caplog.set_level(logging.DEBUG)
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(
            200, json=deepgram_payload(transcript=KNOWN_TRANSCRIPT)
        )
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.json()["raw_transcript"] == KNOWN_TRANSCRIPT
    for record in caplog.records:
        rendered = record.getMessage() + repr(record.__dict__)
        assert KNOWN_TRANSCRIPT not in rendered
        assert "canastas" not in rendered


@respx.mock
async def test_per_request_info_record_carries_only_the_allowed_fields(client, caplog):
    caplog.set_level(logging.INFO)
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(
            200, json=deepgram_payload(transcript=KNOWN_TRANSCRIPT)
        )
    )

    body = (await client.post("/transcribe", files=audio_upload())).json()

    info_records = [
        record
        for record in caplog.records
        if record.name == LOGGER_NAME and record.levelno == logging.INFO
    ]
    assert len(info_records) == 1, "exactly one per-request INFO record is expected"

    record = info_records[0]
    extras = set(record.__dict__) - _STANDARD_RECORD_ATTRS
    assert extras == ALLOWED_INFO_FIELDS
    assert record.request_id == body["request_id"]
    assert record.vendor == "deepgram"
    assert isinstance(record.duration_ms, (int, float))
    assert record.duration_ms >= 0


@respx.mock
async def test_client_filename_is_not_logged(client, caplog):
    """The uploaded filename is client-supplied payload data (REQ-PRV-3)."""
    caplog.set_level(logging.INFO)
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )

    await client.post(
        "/transcribe",
        files={"file": ("bodega-turno-noche.webm", b"audio", "audio/webm")},
    )

    for record in caplog.records:
        if record.levelno >= logging.INFO:
            assert "bodega-turno-noche" not in record.getMessage() + repr(
                record.__dict__
            )
