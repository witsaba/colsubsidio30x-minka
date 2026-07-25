"""STT_VENDOR is a real runtime switch (REQ-VND-3).

The kill criteria in spike 01 require swapping vendors mid-build. If the swap
needs a code change, the kill criteria are decorative - so this file asserts
that one env var, and nothing else, moves the traffic.
"""

import httpx
import pytest
import respx

from tests.conftest import DEEPGRAM_URL, GROQ_URL, audio_upload, deepgram_payload, groq_payload


@respx.mock
async def test_groq_vendor_routes_to_groq_and_reports_it(make_client):
    client = await make_client(STT_VENDOR="groq", GROQ_API_KEY="gq-key")
    deepgram_route = respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )
    groq_route = respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload(text="dos bultos de papa"))
    )

    body = (await client.post("/transcribe", files=audio_upload())).json()
    health = (await client.get("/health")).json()

    assert groq_route.called
    assert not deepgram_route.called
    assert body["stt_vendor"] == "groq"
    assert body["raw_transcript"] == "dos bultos de papa"
    assert health == {"status": "ok", "vendor": "groq"}


@respx.mock
async def test_deepgram_vendor_routes_to_deepgram(make_client):
    client = await make_client(STT_VENDOR="deepgram", GROQ_API_KEY="gq-key")
    deepgram_route = respx.post(DEEPGRAM_URL).mock(
        return_value=httpx.Response(200, json=deepgram_payload())
    )
    groq_route = respx.post(GROQ_URL).mock(
        return_value=httpx.Response(200, json=groq_payload())
    )

    body = (await client.post("/transcribe", files=audio_upload())).json()

    assert deepgram_route.called
    assert not groq_route.called
    assert body["stt_vendor"] == "deepgram"


async def test_unknown_vendor_fails_at_boot(make_client):
    """`elevenlabs` used to be the unknown value here - it is a vendor now."""
    with pytest.raises(Exception) as excinfo:
        await make_client(STT_VENDOR="whisper-cpp")

    assert "whisper-cpp" in str(excinfo.value)


async def test_every_supported_vendor_has_an_adapter():
    from src.settings import VENDOR_KEY_ENV
    from src.transcribe import ADAPTERS

    assert (
        set(ADAPTERS) == set(VENDOR_KEY_ENV) == {"deepgram", "groq", "elevenlabs"}
    )


async def test_the_fallback_priority_order_covers_every_vendor():
    """A new adapter must be placed in the order, not silently left out."""
    from src.transcribe import ADAPTERS, FALLBACK_PRIORITY

    assert set(FALLBACK_PRIORITY) == set(ADAPTERS)
    assert len(FALLBACK_PRIORITY) == len(ADAPTERS), "no duplicates in the order"


async def test_missing_groq_key_fails_boot_when_groq_is_selected(make_client):
    with pytest.raises(Exception) as excinfo:
        await make_client(STT_VENDOR="groq", GROQ_API_KEY=None)

    assert "GROQ_API_KEY" in str(excinfo.value)
