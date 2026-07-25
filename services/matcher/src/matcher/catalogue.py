"""Read-only catalogue loading (REQ-API-5, design D2).

Promoted from `spikes/matching/catalogue.py` with exactly the two design-D2
edits: the connection is opened through a `mode=ro` URI, and the database path
is a required parameter instead of a module-level default. Everything else --
the stock table list, the `Row` shape, the null-`articulo` skip -- is unchanged.

The whole catalogue is read into memory once at startup, so no connection
outlives the load and the service never writes.
"""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path

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
