"""A 2xx from the vendor is not a promise that the body is usable (JD-3).

A malformed or unexpectedly shaped success body used to blow up inside the
adapter and leave the service as a bare plain-text 500 - outside the frozen
error envelope Module 2 parses. Every one of these must be a 502
`vendor_error`, and nothing at all may leave this service off-envelope.
"""

import httpx
import pytest
import respx

from tests.conftest import DEEPGRAM_URL, GROQ_URL, audio_upload

ENVELOPE_KEYS = {"code", "message", "request_id"}

#: 2xx bodies a vendor should never send, and that the adapters cannot parse.
MALFORMED_BODIES = {
    "not_json": {"text": "<html>502 Bad Gateway</html>"},
    "unexpected_object": {"json": {"foo": 1}},
    "top_level_array": {"json": []},
}


@pytest.fixture
async def tolerant_client(env):
    """Client that returns the app's 500 response instead of re-raising.

    Starlette's `ServerErrorMiddleware` always re-raises after handing the
    response to the server, which is what a real uvicorn worker wants and what
    an in-process transport must opt out of to see the body.
    """
    env()
    from src.main import create_app

    app = create_app()
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
            base_url="http://stt.test",
        ) as client:
            yield client


def _assert_vendor_error(response: httpx.Response) -> None:
    assert response.status_code == 502
    body = response.json()
    assert set(body) == {"error"}
    error = body["error"]
    assert set(error) == ENVELOPE_KEYS
    assert error["code"] == "vendor_error"
    assert error["request_id"]


@pytest.mark.parametrize("body", MALFORMED_BODIES.values(), ids=MALFORMED_BODIES)
@respx.mock
async def test_deepgram_malformed_2xx_body_maps_to_502(client, body):
    respx.post(DEEPGRAM_URL).mock(return_value=httpx.Response(200, **body))

    _assert_vendor_error(await client.post("/transcribe", files=audio_upload()))


@pytest.mark.parametrize("body", MALFORMED_BODIES.values(), ids=MALFORMED_BODIES)
@respx.mock
async def test_groq_malformed_2xx_body_maps_to_502(make_client, body):
    client = await make_client(STT_VENDOR="groq", GROQ_API_KEY="gq-key")
    respx.post(GROQ_URL).mock(return_value=httpx.Response(200, **body))

    _assert_vendor_error(await client.post("/transcribe", files=audio_upload()))


@respx.mock
async def test_deepgram_unparsable_nested_shape_maps_to_502(client):
    """A well-shaped envelope with junk underneath is still a vendor error."""
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json={"results": {"channels": ["junk"]}})
    )

    _assert_vendor_error(await client.post("/transcribe", files=audio_upload()))


@respx.mock
async def test_groq_non_numeric_logprob_maps_to_502(make_client):
    client = await make_client(STT_VENDOR="groq", GROQ_API_KEY="gq-key")
    respx.post(GROQ_URL).mock(
        return_value=httpx.Response(
            200, json={"text": "hola", "segments": [{"avg_logprob": "nope"}]}
        )
    )

    _assert_vendor_error(await client.post("/transcribe", files=audio_upload()))


@respx.mock
async def test_an_unexpected_internal_failure_still_uses_the_envelope(
    tolerant_client, monkeypatch
):
    """Belt and braces: no plain-text 500 may ever leave the service."""

    def _boom(*args, **kwargs):
        raise RuntimeError("something nobody planned for")

    monkeypatch.setattr("src.transcribe.evaluate_garbage", _boom)
    respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(
            200,
            json={
                "metadata": {"duration": 1.0},
                "results": {"channels": [{"alternatives": [{"transcript": "hola"}]}]},
            },
        )
    )

    response = await tolerant_client.post("/transcribe", files=audio_upload())

    assert response.status_code == 500
    assert response.headers["content-type"].startswith("application/json")
    error = response.json()["error"]
    assert set(error) == ENVELOPE_KEYS
    assert error["code"] == "internal_error"
    assert error["request_id"]
    assert "something nobody planned for" not in error["message"]
