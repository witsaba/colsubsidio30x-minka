"""FastAPI application for the matcher service (REQ-API-1/2/3/4).

The app owns exactly one piece of state: a `MatcherService` built during the
lifespan startup. Configuration parsing and catalogue loading both happen
there, so an invalid threshold (`ValidationError`) or an unreadable database
(`CatalogueUnavailableError`) aborts startup and uvicorn exits non-zero -- the
service never serves an empty or misconfigured catalogue, and the compose
healthcheck therefore never passes on a broken deployment.

Routes are deliberately thin: they translate between the wire models in
`schemas.py` and `MatcherService`, and they map `UnknownCatalogueError` to a
404. An unknown `catalogue_id` is a client error, never a `no_match`.

Logging is the operational surface: startup, startup failure, every decision
and every rejected `catalogue_id` leave a line on the `matcher` logger, all
correlatable through `request_id`. PRIVACY (Ley 1581): `spoken_name` and any
other transcript text must NEVER be logged, at any level -- the dictated text
is personal data, the log is telemetry. `tests/api/test_logging.py` enforces
this.
"""
from __future__ import annotations

import logging
import time
import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI, HTTPException, Request

from matcher.catalogue import CatalogueUnavailableError
from matcher.config import Settings
from matcher.schemas import (
    CatalogueEntry,
    CataloguesResponse,
    HealthResponse,
    MatchRequest,
    MatchResponse,
)
from matcher.service import MatcherService, UnknownCatalogueError

LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"

logger = logging.getLogger("matcher")


def configure_logging() -> None:
    """Give the `matcher` logger one stdout handler, exactly once.

    Deliberately scoped to this logger: uvicorn configures its own loggers and
    fighting it (`basicConfig`, root handlers, `dictConfig`) is what produces
    duplicated or swallowed lines in a container.
    """
    logger.setLevel(logging.INFO)
    if logger.handlers:
        return
    handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter(LOG_FORMAT))
    logger.addHandler(handler)


configure_logging()


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load configuration and catalogue once; fail fast when either is bad."""
    app.state.service = None
    # `Settings()` may raise ValidationError (bad env); it is not caught --
    # a misconfigured process must abort rather than serve wrong decisions.
    settings = Settings()
    try:
        service = MatcherService(settings)
    except CatalogueUnavailableError as exc:
        # Startup aborts (uvicorn exits 3). Leave the reason in the log first:
        # without it the container just disappears with no explanation.
        logger.error("startup aborted: %s", exc)
        raise
    loaded = service.catalogues()
    logger.info(
        "catalogue loaded catalogues=%d rows=%d db=%s",
        len(loaded),
        sum(rows for _, rows in loaded),
        settings.catalogue_db,
    )
    app.state.service = service
    try:
        yield
    finally:
        app.state.service = None


app = FastAPI(
    title="Minka product matcher",
    version="0.1.0",
    lifespan=lifespan,
)


def get_service(request: Request) -> MatcherService:
    """The service built at startup; present for every served request."""
    return request.app.state.service


@app.post("/match", response_model=MatchResponse)
def match(
    payload: MatchRequest,
    service: MatcherService = Depends(get_service),
) -> MatchResponse:
    """Resolve one spoken product name against one stock table."""
    # Minted here so the 404 path below is correlatable too, not only the
    # answered request that carries it back in the response body.
    request_id = str(uuid.uuid4())
    started = time.perf_counter()
    try:
        decision = service.match(
            payload.catalogue_id, payload.spoken_name, payload.unit
        )
    except UnknownCatalogueError as exc:
        logger.warning(
            "match rejected request_id=%s catalogue_id=%s reason=unknown_catalogue",
            request_id,
            payload.catalogue_id,
        )
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    latency_ms = (time.perf_counter() - started) * 1000.0

    # NEVER add `spoken_name` (or any candidate `articulo`) to this line.
    logger.info(
        "match request_id=%s catalogue_id=%s status=%s top_score=%.4f "
        "candidates=%d latency_ms=%.1f",
        request_id,
        payload.catalogue_id,
        decision.status,
        decision.top_score,
        len(decision.candidates),
        latency_ms,
    )
    return MatchResponse(
        status=decision.status,
        candidates=[c.__dict__ for c in decision.candidates],
        top_score=decision.top_score,
        margin=decision.margin,
        request_id=request_id,
    )


@app.get("/catalogues", response_model=CataloguesResponse)
def catalogues(
    service: MatcherService = Depends(get_service),
) -> CataloguesResponse:
    """List the loadable `catalogue_id` values with their row counts."""
    return CataloguesResponse(
        catalogues=[
            CatalogueEntry(catalogue_id=table, rows=rows)
            for table, rows in service.catalogues()
        ]
    )


@app.get("/health", response_model=HealthResponse)
def health(service: MatcherService = Depends(get_service)) -> HealthResponse:
    """Healthcheck; reachable only after the catalogue loaded successfully."""
    loaded = service.catalogues()
    return HealthResponse(
        status="ok",
        catalogues=len(loaded),
        rows=sum(rows for _, rows in loaded),
    )
