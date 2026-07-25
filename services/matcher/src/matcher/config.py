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

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Matcher configuration, read from the process environment."""

    model_config = SettingsConfigDict(case_sensitive=False, extra="ignore")

    catalogue_db: Path = Path("data/bodegas-y-stock.sqlite")
    """SQLite catalogue, always opened through a `mode=ro` URI."""

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
