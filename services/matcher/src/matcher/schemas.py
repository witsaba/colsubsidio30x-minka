"""Request/response models for the HTTP surface (REQ-API-1/2/3).

These models are the wire contract and nothing else: they carry no matching
logic. `MatchRequest` holds two guards. A blank or whitespace-only
`spoken_name` is rejected by validation, so the request never reaches the
matcher and can never be answered with a misleading `no_match`. Every string
field also has an upper length bound, because this model is the only place
untrusted text enters the process: an unbounded `spoken_name` would be
buffered, trigram-expanded and scored against every catalogue row. The bounds
are generous next to real dictation (a spoken product name is a handful of
words) and next to the real identifiers (the longest stock table name is 31
characters).
"""
from __future__ import annotations

from pydantic import BaseModel, Field, field_validator


class MatchRequest(BaseModel):
    """One spoken product name to resolve against one stock table."""

    spoken_name: str = Field(max_length=300)
    catalogue_id: str = Field(max_length=100)
    unit: str | None = Field(default=None, max_length=50)

    @field_validator("spoken_name")
    @classmethod
    def _reject_blank(cls, value: str) -> str:
        stripped = value.strip()
        if not stripped:
            raise ValueError("spoken_name must not be blank")
        return stripped


class CandidateOut(BaseModel):
    """One ranked catalogue row. A NULL `unidad` stays null in both fields."""

    nr_articulo: str | None
    articulo: str
    unidad: str | None
    unidad_display: str | None
    score: float


class MatchResponse(BaseModel):
    """The full decision: status, ordered candidates, and the raw signals."""

    status: str
    candidates: list[CandidateOut]
    top_score: float
    margin: float
    request_id: str


class CatalogueEntry(BaseModel):
    """One loadable stock table and its in-memory row count."""

    catalogue_id: str
    rows: int


class CataloguesResponse(BaseModel):
    """The set of `catalogue_id` values `POST /match` will accept."""

    catalogues: list[CatalogueEntry]


class HealthResponse(BaseModel):
    """Healthcheck payload; only served once the catalogue is in memory."""

    status: str
    catalogues: int
    rows: int
