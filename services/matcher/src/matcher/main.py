"""FastAPI application for the matcher service (REQ-API-1/2/3/4).

The app owns exactly one piece of state: a `MatcherService` built during the
lifespan startup. Configuration parsing and catalogue loading both happen
there, so an invalid threshold (`ValidationError`) or an unresolvable catalogue
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

import httpx
import redis
from fastapi import Depends, FastAPI, HTTPException, Request

from matcher.cache import RedisSnapshotCache
from matcher.catalogue import CatalogueUnavailableError
from matcher.config import Settings
from matcher.ports import CatalogueSource, SnapshotCache
from matcher.schemas import (
    CatalogueEntry,
    CataloguesResponse,
    HealthResponse,
    MatchRequest,
    MatchResponse,
)
from matcher.service import MatcherService, UnknownCatalogueError
from matcher.supabase_source import SupabaseCatalogueSource

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


def _build_adapters(settings: Settings) -> tuple[CatalogueSource, SnapshotCache]:
    """Construct the two ports the service composes (design D2).

    Neither client dials anything here: `httpx.Client` and `redis.Redis` both
    connect lazily, so construction cannot fail on a cold network and every
    real I/O failure stays inside the bounded startup retry below. This is also
    the seam the lifespan tests monkeypatch to run the real app over fakes.
    """
    http_client = httpx.Client(timeout=settings.supabase_timeout_seconds)
    source = SupabaseCatalogueSource(
        http_client, settings.supabase_url, settings.supabase_key
    )
    cache = RedisSnapshotCache(
        redis.Redis.from_url(settings.redis_url),
        ttl_seconds=settings.catalogue_cache_ttl_seconds,
        lock_ttl_seconds=settings.catalogue_refresh_lock_ttl_seconds,
    )
    return source, cache


def _load_service_with_retry(settings: Settings) -> MatcherService:
    """Build the service, retrying a bounded number of times.

    Two retry layers, deliberately: this loop absorbs the seconds-long cold
    start race (Supabase or Redis not reachable yet, a transient 5xx), and
    Docker's `restart: unless-stopped` absorbs everything longer once the
    process exits. Exhaustion is always an abort -- the service must never come
    up serving an empty catalogue.
    """
    source, cache = _build_adapters(settings)
    attempts = settings.startup_retries + 1
    for attempt in range(1, attempts + 1):
        try:
            return MatcherService(settings, source, cache)
        except CatalogueUnavailableError as exc:
            if attempt == attempts:
                # Startup aborts (uvicorn exits 3). Leave the reason in the log
                # first: without it the container just disappears silently.
                logger.error("startup aborted after %d attempts: %s", attempts, exc)
                raise
            logger.warning(
                "catalogue unavailable on attempt %d/%d, retrying in %.1fs: %s",
                attempt,
                attempts,
                settings.startup_retry_delay_seconds,
                exc,
            )
            time.sleep(settings.startup_retry_delay_seconds)
    raise AssertionError("unreachable")  # pragma: no cover


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load configuration and catalogue once; fail fast when either is bad."""
    app.state.service = None
    # `Settings()` may raise ValidationError (bad env); it is not caught --
    # bad configuration is permanent, so retrying it would only delay the
    # abort. Only an unavailable catalogue is treated as possibly transient.
    settings = Settings()
    service = _load_service_with_retry(settings)
    loaded = service.catalogues()
    # `source` records which leg of the D5 fallback chain actually served this
    # start: an outage is diagnosable from the log alone, and a replica quietly
    # running on a stale snapshot is visible instead of indistinguishable.
    logger.info(
        "catalogue loaded catalogues=%d rows=%d source=%s",
        len(loaded),
        sum(rows for _, rows in loaded),
        service.source,
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
    """Resolve one spoken product name against one warehouse catalogue."""
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
    """List the loaded warehouse codes with their row counts (REQ-API-2)."""
    return CataloguesResponse(
        catalogues=[
            CatalogueEntry(catalogue_id=code, rows=rows)
            for code, rows in service.catalogues()
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
