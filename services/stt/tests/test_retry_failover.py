"""Bounded retry and automatic vendor failover (REQ-VND-6, REQ-VND-7).

A single vendor hiccup must not surface as a failed dictation. The service
retries the primary vendor on failures that are plausibly transient, then -
only if the other vendor's key is configured - tries the other vendor once.
Failures that a retry cannot fix (bad credentials, rejected audio, an
unparsable body) fail immediately: retrying them just burns the user's time.
"""

import logging

import httpx
import pytest
import respx

from src.logging_setup import LOGGER_NAME
from tests.conftest import (
    DEEPGRAM_URL,
    ELEVENLABS_URL,
    GROQ_URL,
    audio_upload,
    deepgram_payload,
    elevenlabs_payload,
    groq_payload,
)

BOTH_KEYS = {"DEEPGRAM_API_KEY": "dg-key", "GROQ_API_KEY": "gq-key"}
ALL_KEYS = {**BOTH_KEYS, "ELEVENLABS_API_KEY": "el-key"}


@respx.mock
async def test_transient_failure_is_retried_on_the_primary(client, backoff_sleeps):
    route = respx.post(DEEPGRAM_URL).mock(
        side_effect=[
            httpx.Response(503, text="unavailable"),
            httpx.Response(200, json=deepgram_payload()),
        ]
    )
    groq_route = respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload())
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 200
    assert response.json()["stt_vendor"] == "deepgram"
    assert route.call_count == 2
    assert not groq_route.called
    assert backoff_sleeps == [0.5]


@respx.mock
async def test_retry_budget_is_configurable_and_backs_off_exponentially(
    make_client, backoff_sleeps
):
    client = await make_client(STT_RETRY_ATTEMPTS=3)
    route = respx.post(DEEPGRAM_URL).mock(
        side_effect=[
            httpx.Response(429, text="slow down"),
            httpx.Response(500, text="oops"),
            httpx.Response(200, json=deepgram_payload()),
        ]
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 200
    assert route.call_count == 3
    assert backoff_sleeps == [0.5, 1.0]


@respx.mock
async def test_exhausted_primary_fails_over_to_the_other_vendor(make_client):
    client = await make_client(**BOTH_KEYS)
    deepgram_route = respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(503, text="unavailable")
    )
    groq_route = respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload(text="dos bultos de papa"))
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 200
    body = response.json()
    assert body["stt_vendor"] == "groq", "the response must name the vendor that served it"
    assert body["raw_transcript"] == "dos bultos de papa"
    assert deepgram_route.call_count == 2
    assert groq_route.call_count == 1, "the fallback gets one attempt, not a budget"
    assert (
        groq_route.calls[0].request.headers["Authorization"] == "Bearer gq-key"
    ), "the fallback must authenticate with its own key, not the primary's"


@respx.mock
async def test_failover_logs_the_vendor_that_actually_served(make_client, caplog):
    caplog.set_level(logging.INFO)
    client = await make_client(**BOTH_KEYS)
    respx.post(DEEPGRAM_URL).mock(return_value=httpx.Response(503, text="unavailable"))
    respx.post(GROQ_URL).mock(return_value=httpx.Response(200, json=groq_payload()))

    body = (await client.post("/transcribe", files=audio_upload())).json()

    info_records = [
        record
        for record in caplog.records
        if record.name == LOGGER_NAME and record.levelno == logging.INFO
    ]
    assert len(info_records) == 1
    record = info_records[0]
    assert record.vendor == "groq"
    assert record.request_id == body["request_id"]
    # Privacy regression guard: failover must not widen the INFO record.
    standard = set(
        logging.LogRecord("n", logging.INFO, "p", 1, "m", None, None).__dict__
    ) | {"message", "asctime", "taskName"}
    assert set(record.__dict__) - standard == {"request_id", "duration_ms", "vendor"}


@respx.mock
async def test_no_fallback_key_means_no_failover(client):
    """`BASE_ENV` configures Deepgram only; there is nowhere to fail over to."""
    route = respx.post(DEEPGRAM_URL).mock(side_effect=httpx.ReadTimeout("too slow"))
    groq_route = respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload())
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "vendor_timeout"
    assert route.call_count == 2
    assert not groq_route.called


@respx.mock
async def test_failover_can_be_switched_off(make_client):
    client = await make_client(STT_FALLBACK_ENABLED="false", **BOTH_KEYS)
    deepgram_route = respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(503, text="unavailable")
    )
    groq_route = respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload())
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "vendor_error"
    assert deepgram_route.call_count == 2
    assert not groq_route.called


@pytest.mark.parametrize(
    ("vendor_response", "expected_code", "expected_status"),
    [
        (httpx.Response(401, json={"err_msg": "invalid credentials"}), "vendor_error", 502),
        (httpx.Response(403, text="forbidden"), "vendor_error", 502),
        (
            httpx.Response(400, json={"err_code": "CORRUPT_DATA"}),
            "invalid_audio",
            400,
        ),
        (httpx.Response(200, text="<html>nope</html>"), "vendor_error", 502),
    ],
    ids=["unauthorized", "forbidden", "rejected_audio", "unparsable_body"],
)
@respx.mock
async def test_non_transient_failures_are_not_retried(
    make_client, backoff_sleeps, vendor_response, expected_code, expected_status
):
    """Retrying these only makes the user wait longer for the same answer."""
    client = await make_client(**BOTH_KEYS)
    deepgram_route = respx.post(DEEPGRAM_URL).mock(return_value=vendor_response)
    groq_route = respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload())
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == expected_status
    assert response.json()["error"]["code"] == expected_code
    assert deepgram_route.call_count == 1
    assert not groq_route.called
    assert backoff_sleeps == []


@respx.mock
async def test_when_the_fallback_also_fails_the_primary_failure_is_reported(
    make_client,
):
    client = await make_client(**BOTH_KEYS)
    respx.post(DEEPGRAM_URL).mock(side_effect=httpx.ReadTimeout("too slow"))
    groq_route = respx.post(GROQ_URL).mock(
        return_value=httpx.Response(503, text="unavailable")
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "vendor_timeout", "the primary's failure class is the answer"
    assert "deepgram" in error["message"]
    assert groq_route.call_count == 1


@respx.mock
async def test_an_explicit_fallback_vendor_wins_over_the_priority_order(make_client):
    """STT_FALLBACK_VENDOR is an operator's choice; auto-selection defers."""
    client = await make_client(STT_FALLBACK_VENDOR="elevenlabs", **ALL_KEYS)
    respx.post(DEEPGRAM_URL).mock(return_value=httpx.Response(503, text="unavailable"))
    groq_route = respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload())
    )
    elevenlabs_route = respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(
            200, json=elevenlabs_payload(text="dos bultos de papa")
        )
    )

    body = (await client.post("/transcribe", files=audio_upload())).json()

    assert body["stt_vendor"] == "elevenlabs"
    assert body["raw_transcript"] == "dos bultos de papa"
    assert elevenlabs_route.call_count == 1
    assert not groq_route.called, "groq is configured but was not the chosen fallback"
    assert elevenlabs_route.calls[0].request.headers["xi-api-key"] == "el-key"


@respx.mock
async def test_auto_selection_follows_the_priority_order(make_client):
    """Groq primary with two candidates configured: deepgram comes first."""
    client = await make_client(STT_VENDOR="groq", **ALL_KEYS)
    respx.post(GROQ_URL).mock(return_value=httpx.Response(503, text="unavailable"))
    deepgram_route = respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )
    elevenlabs_route = respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(200, json=elevenlabs_payload())
    )

    body = (await client.post("/transcribe", files=audio_upload())).json()

    assert body["stt_vendor"] == "deepgram"
    assert deepgram_route.call_count == 1
    assert not elevenlabs_route.called


@respx.mock
async def test_auto_selection_takes_the_only_configured_candidate(make_client):
    client = await make_client(
        STT_VENDOR="groq",
        GROQ_API_KEY="gq-key",
        ELEVENLABS_API_KEY="el-key",
        DEEPGRAM_API_KEY=None,
    )
    respx.post(GROQ_URL).mock(return_value=httpx.Response(503, text="unavailable"))
    deepgram_route = respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )
    elevenlabs_route = respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(200, json=elevenlabs_payload())
    )

    body = (await client.post("/transcribe", files=audio_upload())).json()

    assert body["stt_vendor"] == "elevenlabs"
    assert elevenlabs_route.call_count == 1
    assert not deepgram_route.called, "no deepgram key, so it is not a candidate"


@respx.mock
async def test_the_original_two_vendor_selection_is_unchanged(make_client):
    """Regression: deepgram primary + a groq key still fails over to groq."""
    client = await make_client(**BOTH_KEYS)
    respx.post(DEEPGRAM_URL).mock(return_value=httpx.Response(503, text="unavailable"))
    groq_route = respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload())
    )
    elevenlabs_route = respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(200, json=elevenlabs_payload())
    )

    body = (await client.post("/transcribe", files=audio_upload())).json()

    assert body["stt_vendor"] == "groq"
    assert groq_route.call_count == 1
    assert not elevenlabs_route.called


@respx.mock
async def test_the_switch_suppresses_an_explicit_fallback_too(make_client):
    client = await make_client(
        STT_FALLBACK_VENDOR="elevenlabs", STT_FALLBACK_ENABLED="false", **ALL_KEYS
    )
    respx.post(DEEPGRAM_URL).mock(return_value=httpx.Response(503, text="unavailable"))
    elevenlabs_route = respx.post(ELEVENLABS_URL).mock(
        return_value=httpx.Response(200, json=elevenlabs_payload())
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 502
    assert response.json()["error"]["code"] == "vendor_error"
    assert not elevenlabs_route.called


@respx.mock
async def test_connect_errors_are_transient_too(client, backoff_sleeps):
    route = respx.post(DEEPGRAM_URL).mock(
        side_effect=[
            httpx.ConnectError("connection refused"),
            httpx.Response(200, json=deepgram_payload()),
        ]
    )

    response = await client.post("/transcribe", files=audio_upload())

    assert response.status_code == 200
    assert route.call_count == 2
    assert backoff_sleeps == [0.5]


async def test_a_retry_budget_below_one_fails_boot(make_client):
    with pytest.raises(Exception) as excinfo:
        await make_client(STT_RETRY_ATTEMPTS=0)

    assert "stt_retry_attempts" in str(excinfo.value).lower()
