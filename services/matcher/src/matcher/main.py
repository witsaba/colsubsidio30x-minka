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
"""
from __future__ import annotations

import uuid
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI, HTTPException, Request

from matcher.config import Settings
from matcher.schemas import (
    CatalogueEntry,
    CataloguesResponse,
    HealthResponse,
    MatchRequest,
    MatchResponse,
)
from matcher.service import MatcherService, UnknownCatalogueError


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load configuration and catalogue once; fail fast when either is bad."""
    app.state.service = None
    # Both calls may raise: ValidationError (bad env) or
    # CatalogueUnavailableError (missing/unreadable database). Neither is
    # caught -- startup must abort so the process exits non-zero.
    service = MatcherService(Settings())
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
    try:
        decision = service.match(
            payload.catalogue_id, payload.spoken_name, payload.unit
        )
    except UnknownCatalogueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc

    return MatchResponse(
        status=decision.status,
        candidates=[c.__dict__ for c in decision.candidates],
        top_score=decision.top_score,
        margin=decision.margin,
        request_id=str(uuid.uuid4()),
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
