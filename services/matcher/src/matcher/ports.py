"""Catalogue row, snapshot, and the two ports `MatcherService` composes (D2).

The catalogue arrives from a `CatalogueSource` (Supabase over PostgREST) and is
cached as a `Snapshot` behind a `SnapshotCache` (Redis). Both are structural
`Protocol`s, following the `RowLike` precedent in `scoring.py` -- the repo uses
Protocols and direct construction, never an ABC hierarchy or a DI container.

`Row` deliberately carries no stock quantity. The former SQLite row's `sd` is
gone: stock is RF-18 data, it was never a matching prior (REQ-ENG-2), and under
REQ-CSS-4 it is now never even loaded.

Design refinement over D2, which places `Row` in `catalogue.py`: the legacy
SQLite `Row` still lives there until the cutover work unit, and two classes
cannot share a name. These types therefore land here now; `catalogue.py`
re-exports them at cutover, so the public `matcher.catalogue.Row` import path
D2 specifies is preserved with no rename churn.

The Protocols are `runtime_checkable` so conformance is an assertable fact
rather than a comment -- the concrete adapters check themselves against these
ports in their own suites.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable


@dataclass(frozen=True)
class Row:
    """One active `warehouse_products` link, flattened for matching."""

    warehouse_code: str
    uid: str
    articulo: str
    unidad: str | None
    nr_articulo: str | None


@dataclass(frozen=True)
class Snapshot:
    """A whole catalogue as loaded at one instant, flat and ungrouped."""

    rows: list[Row]
    loaded_at: datetime


@runtime_checkable
class CatalogueSource(Protocol):
    """The authoritative catalogue, read at startup and refresh time only."""

    def load(self) -> dict[str, list[Row]]:
        """Return rows grouped by warehouse code.

        Raises `CatalogueUnavailableError` when no catalogue can be produced;
        an empty catalogue is never a valid result (REQ-CSS-5).
        """
        ...


@runtime_checkable
class SnapshotCache(Protocol):
    """Best-effort snapshot storage plus the cross-replica refresh lock.

    Every method is a soft dependency of the service: a cache failure degrades
    to a source read, and never propagates to `POST /match` (REQ-RCC-3).
    """

    def get(self) -> Snapshot | None:
        """The cached snapshot, or `None` on miss, parse, version or I/O error."""
        ...

    def put(self, snapshot: Snapshot) -> None:
        """Store the snapshot. Best effort -- never raises (REQ-RCC-1)."""
        ...

    def try_acquire_refresh_lock(self, ttl_seconds: int) -> bool:
        """Claim the right to refresh from the source (REQ-RCC-4)."""
        ...

    def release_refresh_lock(self) -> None:
        """Release the refresh lock. Best effort -- never raises."""
        ...
