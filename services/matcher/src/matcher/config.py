"""Environment configuration (REQ-ENG-4, REQ-API-4).

Every tunable of the matching engine lives here so that changing a threshold is
an environment change, never a rebuild. Values are validated eagerly: the
service constructs `Settings` during startup, so an invalid value aborts the
process instead of silently falling back to a default and serving wrong
decisions at request time.

`MATCH_TSR_MARGIN` is an independent knob, deliberately not folded into
`MATCH_AMBIGUITY_MARGIN`. Its 0.08 default is derived by symmetry with the
trigram margin from a crowding sample of n=10 and is flagged for
re-measurement on real dictation.
"""
from __future__ import annotations

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Matcher configuration, read from the process environment."""

    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore")

    supabase_url: str
    """PostgREST base URL. Required: no default can be correct, and a missing
    one is a permanent misconfiguration that must abort startup, not retry."""

    supabase_key: str
    """The Supabase **secret key** (the service-role equivalent in the new
    Supabase API-key scheme, value `sb_secret_...`), sent as `apikey` and as a
    bearer token. Never logged and never included in an exception message
    (REQ-API-8). `SUPABASE_KEY` is the in-container name only: the root
    docker-compose maps the host's canonical `SUPABASE_SECRET_KEY` into it.

    It is NOT least-privilege: the secret key bypasses RLS and has full database
    access. A least-privilege alternative was investigated and is not available
    today -- the `anon` role holds no `GRANT` on any catalogue table (PostgREST
    answers HTTP 401 `42501`), every read policy targets `authenticated`, and
    `warehouse_products_read` further requires `private.is_staff()`.

    Stock isolation is therefore enforced by the **service**, not by this
    credential (REQ-CSS-4): the source never constructs a
    `warehouse_stock_balances` query, and `Row`/`Snapshot` carry no stock field,
    so nothing about stock can reach the index or Redis. Do not read this key as
    a boundary; it is capable of reading anything the schema holds.
    """

    supabase_timeout_seconds: float = Field(default=10.0, gt=0)
    """Per-request timeout for the catalogue read."""

    redis_url: str = "redis://localhost:6379/0"
    """Snapshot cache. A *soft* dependency: unreachable Redis only costs a
    Supabase read at startup and never affects `POST /match` (REQ-RCC-3)."""

    catalogue_cache_ttl_seconds: int = Field(default=10_800, ge=60)
    """Snapshot freshness window, and the base of the jittered refresh period.
    Floored at a minute: a tiny TTL turns the cache into a Supabase hammer."""

    catalogue_refresh_lock_ttl_seconds: int = Field(default=60, ge=1)
    """Expiry of the cross-replica `SET NX PX` refresh lock (design D4)."""

    match_accept_score: float = Field(default=0.50, ge=0.0, le=1.0)
    """Below this raw trigram similarity the decision is `no_match`."""

    match_ambiguity_margin: float = Field(default=0.08, ge=0.0, le=1.0)
    """Trigram top1-top2 margin below which the field is `ambiguous`; also the
    width of the unit re-rank band."""

    match_tsr_margin: float = Field(default=0.08, ge=0.0, le=1.0)
    """token_set_ratio crowding margin over the top-5 candidates."""

    match_max_candidates: int = Field(default=5, ge=1)
    """Ranking and response depth."""

    match_unit_rerank: bool = True
    """When false the secondary unit re-rank is disabled entirely."""

    startup_retries: int = Field(default=3, ge=0)
    """Extra catalogue-load attempts before startup aborts.

    A cold start can race the catalogue volume (not mounted yet, file mid-copy).
    Three extra attempts absorb that race; 0 opts out and leaves all retrying to
    Docker's `restart: unless-stopped`.
    """

    startup_retry_delay_seconds: float = Field(default=2.0, ge=0)
    """Wait between catalogue-load attempts, in seconds."""

    @field_validator("supabase_url")
    @classmethod
    def _normalize_url(cls, value: str) -> str:
        """Reject a blank URL and strip the trailing slash exactly once.

        Compose interpolates `${SUPABASE_URL:-}`, so an unset variable arrives
        as an empty string rather than as a missing one; without this it would
        pass validation and fail much later as an unroutable request.
        """
        url = value.strip().rstrip("/")
        if not url:
            raise ValueError("SUPABASE_URL must not be empty")
        return url

    @field_validator("supabase_key", "redis_url")
    @classmethod
    def _require_non_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("must not be empty")
        return stripped
