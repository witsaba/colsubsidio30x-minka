"""FastAPI application for the matcher service (REQ-API-1/2/3/4).

The app owns two pieces of state, both created by the lifespan: a
`MatcherService` and the background refresh task that keeps its catalogue
current. Configuration parsing and catalogue loading both happen at startup, so
an invalid threshold (`ValidationError`) or an unresolvable catalogue
(`CatalogueUnavailableError`) aborts startup and uvicorn exits non-zero -- the
service never serves an empty or misconfigured catalogue, and the compose
healthcheck therefore never passes on a broken deployment.

The refresh task is deliberately *not* on the request path (design D4): it
sleeps a jittered TTL, refreshes in a worker thread, and swaps a fully built
index in one assignment, so `POST /match` never pays for Redis or Supabase and
keeps answering from the last-good catalogue through an outage (REQ-RCC-3).

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

import asyncio
import contextlib
import logging
import random
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

REFRESH_JITTER_FRACTION = 0.1
"""+/-10% of the TTL. Replicas that started together must not refresh together."""

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


def _next_delay(ttl_seconds: float) -> float:
    """Seconds to wait before the next refresh, jittered +/-10% (design D4).

    Without jitter every replica that booted from the same deploy would expire
    its snapshot in the same second and stampede Supabase together; the Redis
    lock would then make all but one of them do nothing useful. The jitter is
    the cheap half of that fix, the lock is the safety net.
    """
    spread = REFRESH_JITTER_FRACTION * ttl_seconds
    return ttl_seconds + random.uniform(-spread, spread)


async def _refresh_loop(service: MatcherService, settings: Settings) -> None:
    """Refresh the catalogue forever, one jittered cycle at a time.

    The refresh itself is synchronous (httpx and redis), so it runs in a worker
    thread: blocking the event loop here would add the whole Supabase round trip
    to the latency of every concurrent `/match`. `service.refresh()` already
    swallows its own failures; the guard below is what keeps an unexpected one
    from ending the loop and leaving the replica silently frozen on a stale
    catalogue for the rest of its life.
    """
    while True:
        await asyncio.sleep(_next_delay(settings.catalogue_cache_ttl_seconds))
        try:
            await asyncio.to_thread(service.refresh)
        except asyncio.CancelledError:
            raise
        except Exception as exc:  # noqa: BLE001 - the loop must outlive a cycle
            logger.warning("catalogue refresh cycle failed: %s", exc)


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Load configuration and catalogue once; fail fast when either is bad."""
    app.state.service = None
    app.state.refresh_task = None
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
    # Started only after the service exists: the loop refreshes a catalogue
    # that is already serving, it never participates in producing the first one.
    refresh_task = asyncio.create_task(_refresh_loop(service, settings))
    app.state.refresh_task = refresh_task
    try:
        yield
    finally:
        # Cancel and await: an abandoned task would keep refreshing a service
        # the app has already dropped, and would log after shutdown.
        refresh_task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await refresh_task
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
