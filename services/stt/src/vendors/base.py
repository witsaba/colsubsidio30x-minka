"""Vendor-agnostic transcription result and adapter protocol (Decision 3).

Adapters are module-level async functions, not classes: swapping vendor is a
function swap, so the kill criteria in spike 01 stay executable.
"""

from typing import Protocol

import httpx
from pydantic import BaseModel

from src.settings import Settings


class TranscriptionResult(BaseModel):
    """What every adapter must produce, whatever the vendor payload looks like."""

    raw_transcript: str
    stt_confidence: float | None
    audio_duration_ms: int | None


class VendorAdapter(Protocol):
    async def __call__(
        self,
        audio: bytes,
        content_type: str,
        settings: Settings,
        client: httpx.AsyncClient,
    ) -> TranscriptionResult: ...


class VendorAudioRejected(Exception):
    """The vendor rejected the audio itself as undecodable (maps to HTTP 400)."""


class VendorBadResponse(Exception):
    """The vendor answered 2xx with a body we cannot parse (maps to HTTP 502).

    A success status is not a promise about the payload: a proxy can return
    HTML, a vendor can ship a breaking change. Raising this keeps the answer on
    the frozen error envelope instead of letting a parse error escape as a bare
    500 (JD-3).
    """


#: What a response-shape mismatch looks like coming out of `response.json()`
#: or an adapter's `_to_result`. Deliberately broad: any of them means the body
#: was not the contract we coded against.
BAD_RESPONSE_ERRORS = (ValueError, KeyError, IndexError, AttributeError, TypeError)


def seconds_to_ms(duration_s: float | None) -> int | None:
    """Convert a vendor duration in seconds to milliseconds, preserving None.

    None means the vendor omitted the duration; it must never become 0
    (design Decision 5).
    """
    if duration_s is None:
        return None
    return int(round(duration_s * 1000))
