"""Read-only catalogue loading (REQ-API-5, design D2).

Promoted from `spikes/matching/catalogue.py` with exactly the two design-D2
edits: the connection is opened through a `mode=ro` URI, and the database path
is a required parameter instead of a module-level default. Everything else --
the stock table list, the `Row` shape, the null-`articulo` skip -- is unchanged.

The whole catalogue is read into memory once at startup, so no connection
outlives the load and the service never writes.
"""
from __future__ import annotations

import logging
import sqlite3
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

from matcher.ports import CatalogueSource, Row as CatalogueRow, Snapshot, SnapshotCache

logger = logging.getLogger("matcher")

SOURCE_REDIS_SNAPSHOT = "redis-snapshot"
SOURCE_REDIS_SNAPSHOT_STALE = "redis-snapshot-stale"
SOURCE_SUPABASE = "supabase"

STOCK_TABLES = [
    "stock_almacen_ayb",
    "stock_almacen_suministros",
    "stock_kiosco_piscigiros_ayb",
    "stock_kiosco_taquilla_ayb",
    "stock_restaurante_fuentes_ayb",
    "stock_restaurante_fuentes_sumin",
    "zoologico",
    "zoologico_suministros",
]


class CatalogueUnavailableError(RuntimeError):
    """The catalogue cannot be loaded: startup must abort, never serve empty."""


@dataclass
class Row:
    table: str
    rowid: int
    articulo: str
    unidad: str | None
    sd: float | None
    nr_articulo: str | None

    @property
    def uid(self) -> str:
        return f"{self.table}#{self.rowid}"


def open_readonly(db_path: Path) -> sqlite3.Connection:
    """Open the catalogue strictly read-only; a missing file is never created."""
    return sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)


def load_catalogue(db_path: Path) -> dict[str, list[Row]]:
    """Load every stock table into memory, or raise `CatalogueUnavailableError`."""
    try:
        con = open_readonly(db_path)
    except sqlite3.Error as exc:
        raise CatalogueUnavailableError(
            f"cannot open catalogue database '{db_path}': {exc}"
        ) from exc

    try:
        cur = con.cursor()
        out: dict[str, list[Row]] = {}
        for t in STOCK_TABLES:
            try:
                cur.execute(
                    f'SELECT rowid, articulo, unidad, sd, nr_articulo FROM "{t}"'
                )
                # fetchall() belongs inside the same guard: sqlite only detects
                # page-level corruption ("database disk image is malformed")
                # while it streams rows, so a fetch-time failure must produce
                # the same contextual error as a plan-time one.
                rows_raw = cur.fetchall()
            except sqlite3.Error as exc:
                raise CatalogueUnavailableError(
                    f"catalogue database '{db_path}' is unusable "
                    f"(table '{t}'): {exc}"
                ) from exc
            rows = []
            for rowid, articulo, unidad, sd, nr_articulo in rows_raw:
                if articulo is None:
                    continue
                rows.append(Row(t, rowid, articulo, unidad, sd, nr_articulo))
            out[t] = rows
        return out
    finally:
        con.close()


@dataclass(frozen=True)
class LoadedCatalogue:
    """The catalogue plus where it came from, for the startup log line."""

    catalogue: dict[str, list[CatalogueRow]]
    source: str


def _group(rows: list[CatalogueRow]) -> dict[str, list[CatalogueRow]]:
    """Rebuild the per-warehouse grouping from a flat snapshot payload."""
    grouped: dict[str, list[CatalogueRow]] = {}
    for row in rows:
        grouped.setdefault(row.warehouse_code, []).append(row)
    return grouped


def _flatten(catalogue: dict[str, list[CatalogueRow]]) -> list[CatalogueRow]:
    return [row for rows in catalogue.values() for row in rows]


def _is_fresh(snapshot: Snapshot, ttl_seconds: int) -> bool:
    """Freshness is judged from `loaded_at`, never from the Redis key expiry."""
    loaded_at = snapshot.loaded_at
    if loaded_at.tzinfo is None:
        loaded_at = loaded_at.replace(tzinfo=UTC)
    return (datetime.now(UTC) - loaded_at).total_seconds() < ttl_seconds


def _cached(cache: SnapshotCache) -> Snapshot | None:
    """Read the cache, tolerating an adapter that fails louder than its port.

    `RedisSnapshotCache` already swallows every `redis.RedisError` into a miss,
    so this guard only catches a cache that breaks its own contract -- but a
    cache is a soft dependency (REQ-RCC-3) and must never abort a startup that
    Supabase could still serve. A snapshot with no rows is treated as a miss:
    an empty catalogue is never a valid result (REQ-CSS-5).
    """
    try:
        snapshot = cache.get()
    except Exception as exc:  # noqa: BLE001 - a cache must never break startup
        logger.warning("catalogue snapshot unreadable, ignoring cache: %s", exc)
        return None
    if snapshot is None or not snapshot.rows:
        return None
    return snapshot


def load_index(
    source: CatalogueSource,
    cache: SnapshotCache,
    ttl_seconds: int,
) -> LoadedCatalogue:
    """Resolve the catalogue at startup through the D5 fallback chain.

    1. a fresh snapshot is used as-is -- **zero** source calls (REQ-RCC-1);
    2. otherwise the source is read and the snapshot written back (best effort);
    3. otherwise a stale-but-parseable snapshot is served with a warning;
    4. otherwise `CatalogueUnavailableError` aborts startup (REQ-CSS-5).
    """
    snapshot = _cached(cache)
    if snapshot is not None and _is_fresh(snapshot, ttl_seconds):
        return LoadedCatalogue(_group(snapshot.rows), SOURCE_REDIS_SNAPSHOT)

    try:
        catalogue = source.load()
    except CatalogueUnavailableError as exc:
        if snapshot is None:
            raise
        logger.warning(
            "catalogue source unavailable, serving the stale snapshot "
            "loaded at %s: %s",
            snapshot.loaded_at,
            exc,
        )
        return LoadedCatalogue(_group(snapshot.rows), SOURCE_REDIS_SNAPSHOT_STALE)

    try:
        cache.put(Snapshot(rows=_flatten(catalogue), loaded_at=datetime.now(UTC)))
    except Exception as exc:  # noqa: BLE001 - the write back is best effort
        logger.warning("catalogue snapshot not cached: %s", exc)
    return LoadedCatalogue(catalogue, SOURCE_SUPABASE)
