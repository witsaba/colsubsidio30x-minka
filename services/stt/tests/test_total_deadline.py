"""One end-to-end budget for all vendor work (REQ-VND-8).

Retry and failover multiply the time a caller can wait: with the shipped
defaults the per-call timeout alone allows 30s + 0.5s + 30s + 30s before a
502 comes back. `STT_TOTAL_DEADLINE_S` caps the whole of `dispatch`, so adding
resilience cannot quietly cost availability.
"""

import asyncio
import logging

import httpx
import pytest
import respx

from src.logging_setup import LOGGER_NAME
from tests.conftest import (
    DEEPGRAM_URL,
    GROQ_URL,
    audio_upload,
    deepgram_payload,
    groq_payload,
)

BOTH_KEYS = {"DEEPGRAM_API_KEY": "dg-key", "GROQ_API_KEY": "gq-key"}
TINY_DEADLINE = 0.05

_STANDARD_RECORD_ATTRS = set(
    logging.LogRecord("n", logging.INFO, "p", 1, "m", None, None).__dict__
) | {"message", "asctime", "taskName"}


async def _never_answers(request):
    """A vendor that accepted the connection and then went quiet."""
    await asyncio.sleep(30)
    raise AssertionError("the deadline should have cut this off")


def _info_records(caplog):
    return [
        record
        for record in caplog.records
        if record.name == LOGGER_NAME and record.levelno == logging.INFO
    ]


@respx.mock
async def test_a_hanging_vendor_is_cut_off_at_the_total_deadline(make_client, caplog):
    caplog.set_level(logging.INFO)
    client = await make_client(STT_TOTAL_DEADLINE_S=TINY_DEADLINE)
    respx.post(DEEPGRAM_URL).mock(side_effect=_never_answers)

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 502
    error = response.json()["error"]
    assert set(error) == {"code", "message", "request_id"}
    assert error["code"] == "vendor_timeout"

    records = _info_records(caplog)
    assert len(records) == 1, "a cut-off request is still a served request"
    record = records[0]
    assert record.request_id == error["request_id"]
    assert record.vendor == "deepgram"
    assert set(record.__dict__) - _STANDARD_RECORD_ATTRS == {
        "request_id",
        "duration_ms",
        "vendor",
    }


@respx.mock
async def test_the_deadline_reports_the_vendor_that_was_in_flight(make_client, caplog):
    """During failover the budget is spent on the fallback, so name it."""
    caplog.set_level(logging.INFO)
    client = await make_client(STT_TOTAL_DEADLINE_S=TINY_DEADLINE, **BOTH_KEYS)
    respx.post(DEEPGRAM_URL).mock(return_value=httpx.Response(503, text="unavailable"))
    respx.post(GROQ_URL).mock(side_effect=_never_answers)

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "vendor_timeout"
    assert _info_records(caplog)[0].vendor == "groq"


@respx.mock
async def test_the_deadline_bounds_the_wait_far_below_the_retry_arithmetic(
    make_client,
):
    """The point of the budget: the caller waits ~the deadline, not the sum."""
    client = await make_client(
        STT_TOTAL_DEADLINE_S=TINY_DEADLINE, STT_VENDOR_TIMEOUT_S=30, **BOTH_KEYS
    )
    respx.post(DEEPGRAM_URL).mock(side_effect=_never_answers)
    respx.post(GROQ_URL).mock(side_effect=_never_answers)

    started = asyncio.get_running_loop().time()
    response = await client.post("/transcribe", files=audio_upload())
    elapsed = asyncio.get_running_loop().time() - started

    assert response.status_code == 502
    assert elapsed < 1.0, f"waited {elapsed:.2f}s against a {TINY_DEADLINE}s deadline"


@respx.mock
async def test_a_generous_deadline_leaves_retry_and_failover_untouched(make_client):
    client = await make_client(STT_TOTAL_DEADLINE_S=30, **BOTH_KEYS)
    deepgram_route = respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(503, text="unavailable")
    )
    groq_route = respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload(text="dos bultos de papa"))
    )

    body = (await client.post("/transcribe", files=audio_upload())).json()

    assert body["stt_vendor"] == "groq"
    assert body["raw_transcript"] == "dos bultos de papa"
    assert deepgram_route.call_count == 2
    assert groq_route.call_count == 1


@respx.mock
async def test_the_deadline_does_not_disturb_the_happy_path(make_client):
    client = await make_client(STT_TOTAL_DEADLINE_S=30)
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 200
    assert response.json()["raw_transcript"] == "tres kilos de lechuga"


async def test_a_non_positive_deadline_fails_boot(make_client):
    with pytest.raises(Exception) as excinfo:
        await make_client(STT_TOTAL_DEADLINE_S=0)

    assert "stt_total_deadline_s" in str(excinfo.value).lower()
