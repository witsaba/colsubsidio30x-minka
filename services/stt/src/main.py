"""Application factory.

One shared `httpx.AsyncClient` is created in the lifespan and reused for every
vendor call, so connections are pooled instead of rebuilt per request.
"""

from contextlib import asynccontextmanager
from uuid import uuid4

import httpx
from fastapi import FastAPI
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.formparsers import MultiPartException

from src.body_limit import install_body_limit
from src.logging_setup import configure_logging
from src.settings import Settings
from src.transcribe import error_response, router


def create_app() -> FastAPI:
    # Settings() raises here, at import/boot time, when the ACTIVE vendor's key
    # is missing or STT_VENDOR is unknown (REQ-VND-3, REQ-VND-5).
    settings = Settings()
    configure_logging(settings.log_level)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with httpx.AsyncClient(timeout=settings.stt_vendor_timeout_s) as client:
            app.state.http_client = client
            yield

    app = FastAPI(title="Minka STT service", version="0.1.0", lifespan=lifespan)
    app.state.settings = settings
    app.include_router(router)

    # Must be the outermost guard: it answers 413 before the multipart parser
    # can spool an oversized upload to disk (JD-1, RNF-04).
    install_body_limit(app, settings.stt_max_upload_bytes)

    @app.exception_handler(StarletteHTTPException)
    async def http_exception_handler(request, exc: StarletteHTTPException):
        """Keep every error on the frozen envelope.

        FastAPI turns a multipart parse failure into a generic 400; when its
        cause is Starlette's part-size limit the honest answer is 413, which is
        the same answer our own `STT_MAX_UPLOAD_BYTES` check gives
        (design Decision 6 keeps both limits at 1 MiB).
        """
        if isinstance(exc.__cause__, MultiPartException):
            return error_response(
                413, "payload_too_large", "upload exceeds the part size limit", str(uuid4())
            )
        return error_response(
            exc.status_code, "http_error", str(exc.detail), str(uuid4())
        )

    return app


app = create_app()
