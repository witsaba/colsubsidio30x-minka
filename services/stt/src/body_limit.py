"""Body-size guard that runs before Starlette can spool an upload to disk.

Starlette 0.47.3 does not apply `max_part_size` to *file* parts: those stream
straight into a `SpooledTemporaryFile`, which flushes to a real inode the
moment the part exceeds `MultiPartParser.spool_max_size`. That happens inside
form parsing - before any route code, and therefore before the service's own
`STT_MAX_UPLOAD_BYTES` check ever runs. A 1 MiB + 1 upload wrote audio to the
filesystem (JD-1, RNF-04, REQ-PRV-1).

Two things close it, and both are needed:

1. `BodyLimitMiddleware` sits in front of the application and enforces the cap
   on the raw ASGI body - first on `Content-Length`, then on the streamed
   chunks for bodies that declare none. Everything it counts stays in memory;
   nothing over the limit is ever forwarded to the form parser.
2. `MultiPartParser.spool_max_size` is raised to the largest body the guard
   admits, so a part inside an *admitted* body cannot reach the spool
   threshold either. The multipart envelope allowance below is what makes an
   exactly-at-the-cap clip acceptable, and it is exactly what would otherwise
   let a part slip past a 1 MiB spool.
"""

from collections.abc import Awaitable, Callable
from typing import Any
from uuid import uuid4

from fastapi import FastAPI
from starlette.formparsers import MultiPartParser

from src.transcribe import error_response

Message = dict[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]

#: Room for the multipart envelope (boundary lines, part headers, trailer) on
#: top of the audio payload itself, so a clip of exactly `STT_MAX_UPLOAD_BYTES`
#: still fits. 4 KiB is far more than any real envelope needs; the route keeps
#: enforcing the exact cap on the decoded audio.
MULTIPART_ENVELOPE_ALLOWANCE = 4096


class BodyLimitMiddleware:
    """Reject a request body larger than `max_body_bytes` without buffering it.

    Pure ASGI on purpose: `BaseHTTPMiddleware` would hand the body to Starlette
    machinery we are trying to stay in front of.
    """

    def __init__(self, app: Any, max_body_bytes: int) -> None:
        self.app = app
        self.max_body_bytes = max_body_bytes

    async def __call__(self, scope: Message, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        declared = _declared_content_length(scope)
        if declared is not None and declared > self.max_body_bytes:
            await self._reject(scope, receive, send)
            return

        chunks: list[bytes] = []
        total = 0
        more_body = True
        while more_body:
            message = await receive()
            if message["type"] != "http.request":
                # http.disconnect: the client is gone, there is nothing to serve.
                return
            body = message.get("body", b"")
            total += len(body)
            if total > self.max_body_bytes:
                # Drop what we hold before answering: the oversized bytes never
                # reach the form parser, and they do not linger either.
                chunks.clear()
                await self._reject(scope, receive, send)
                return
            if body:
                chunks.append(body)
            more_body = bool(message.get("more_body", False))

        body = b"".join(chunks)
        chunks.clear()
        await self.app(scope, _replay(body), send)

    async def _reject(self, scope: Message, receive: Receive, send: Send) -> None:
        response = error_response(
            413,
            "payload_too_large",
            f"upload exceeds STT_MAX_UPLOAD_BYTES ({self.max_body_bytes} bytes "
            "including the multipart envelope)",
            str(uuid4()),
        )
        await response(scope, receive, send)


def _declared_content_length(scope: Message) -> int | None:
    for name, value in scope.get("headers", []):
        if name == b"content-length":
            try:
                return int(value)
            except ValueError:
                return None
    return None


def _replay(body: bytes) -> Receive:
    """Hand the buffered body to the application as a single ASGI message."""
    delivered = False

    async def receive() -> Message:
        nonlocal delivered
        if not delivered:
            delivered = True
            return {"type": "http.request", "body": body, "more_body": False}
        return {"type": "http.disconnect"}

    return receive


def install_body_limit(app: FastAPI, max_upload_bytes: int) -> int:
    """Put the guard in front of `app` and align Starlette's spool with it.

    The spool threshold is only ever raised, never lowered: another application
    instance built earlier in the same process may still rely on its own,
    larger limit. Memory stays bounded per instance by that instance's guard.
    """
    limit = max_upload_bytes + MULTIPART_ENVELOPE_ALLOWANCE
    MultiPartParser.spool_max_size = max(MultiPartParser.spool_max_size, limit)
    app.add_middleware(BodyLimitMiddleware, max_body_bytes=limit)
    return limit
