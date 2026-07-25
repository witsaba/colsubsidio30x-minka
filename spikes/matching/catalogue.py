"""Load the Minka bodegas-y-stock catalogue into plain Python structures."""
from __future__ import annotations

import sqlite3
from dataclasses import dataclass, field
from pathlib import Path

DB_PATH = Path(__file__).resolve().parents[2] / "data" / "bodegas-y-stock.sqlite"

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


def load_catalogue(db_path: Path = DB_PATH) -> dict[str, list[Row]]:
    con = sqlite3.connect(str(db_path))
    cur = con.cursor()
    out: dict[str, list[Row]] = {}
    for t in STOCK_TABLES:
        cur.execute(f'SELECT rowid, articulo, unidad, sd, nr_articulo FROM "{t}"')
        rows = []
        for rowid, articulo, unidad, sd, nr_articulo in cur.fetchall():
            if articulo is None:
                continue
            rows.append(Row(t, rowid, articulo, unidad, sd, nr_articulo))
        out[t] = rows
    con.close()
    return out


if __name__ == "__main__":
    cat = load_catalogue()
    for t, rows in cat.items():
        print(t, len(rows))
