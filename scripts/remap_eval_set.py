#!/usr/bin/env python3
"""Remap the eval set from SQLite identities to Supabase warehouse identities.

**One-shot, offline data migration.** It reads only local files -- never the
network -- and is run by hand once, in the commit that cuts the eval suite over
to the Supabase-derived catalogue (task 6.3 of
`openspec/changes/redis-catalogue-cache/tasks.md`). Its *output* is what CI
guards: `services/matcher/tests/eval/test_eval_accuracy.py::TestEvalSetProvenance`
pins the case count, the sha256, and the resolvability of every `gold_uid`, so a
silently wrong remap fails the build.

The legacy eval set keys every case on the SQLite `table` name plus the gold
row's `rowid`. Both die with the SQLite catalogue, so each case is rewritten to:

    table      -> catalogue_id  (a `warehouses.code`)
    gold_rowid -> gold_uid      (a `warehouse_products.id` UUID)

Three inputs are needed, and the SQLite file is one of them: the `rowid` is only
interpretable against the database that issued it, and the SKU it carries is the
join key into the snapshot. `data/bodegas-y-stock.sqlite` is untracked local
data, so this script cannot be re-run from a clean checkout -- which is exactly
why its output is checked in and hash-pinned instead.

Two traps this script exists to make explicit:

1. **`table -> code` is not `upper()`.** Seven of the eight tables map by
   uppercasing, but `zoologico_suministros` is `ZOOLOGICO_SUMINISTROS_2` in
   Supabase (a load-time code collision). A naive `upper()` silently drops that
   warehouse's 193 rows and quietly deflates coverage, so the mapping is written
   out in full and asserted by a test.
2. **The row counts differ, but the row SETS do not.** Supabase holds 1,405
   `warehouse_products`; the 8 SQLite stock tables hold 1,413 `rowid`s (the
   often-quoted 1,461 also counts the 48-row `bodegas_disponibles` lookup, which
   was never catalogue data). Measured (WU-6): the gap is exactly **8
   spreadsheet header rows** with `articulo IS NULL`, one per stock table, which
   the SQLite loader always discarded. None of them was ever a gold row, so
   **zero eval cases were dropped -- all 624 survived** (345 variants resolved
   by `nr_articulo`, 85 by exact `articulo` text, 0 unmappable). The earlier
   theory that ~56 rows were lost to `products.name_normalized` UNIQUE deduping
   upstream was investigated and is WRONG; do not reintroduce it.

   The drop path below is kept anyway: it is the guard that would make a future
   export which really does lose rows fail loudly instead of silently deflating
   coverage. An unresolvable case is DROPPED and counted -- never given an
   invented target.

Gold rows are resolved by `nr_articulo` (SKU) first and by exact `articulo`
text second, per design D7. A resolved case takes its `gold_articulo` from the
snapshot row, since that row is by definition the gold answer.

Usage (from the repository root)::

    uv run python scripts/remap_eval_set.py            # rewrites the eval set
    uv run python scripts/remap_eval_set.py --dry-run  # report only
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import Counter
from pathlib import Path

DEFAULT_EVAL = Path("services/matcher/tests/data/eval_set.json")
DEFAULT_SNAPSHOT = Path("services/matcher/tests/data/catalogue_snapshot.json")
DEFAULT_SQLITE = Path("data/bodegas-y-stock.sqlite")

TABLE_TO_WAREHOUSE_CODE: dict[str, str] = {
    "stock_almacen_ayb": "STOCK_ALMACEN_AYB",
    "stock_almacen_suministros": "STOCK_ALMACEN_SUMINISTROS",
    "stock_kiosco_piscigiros_ayb": "STOCK_KIOSCO_PISCIGIROS_AYB",
    "stock_kiosco_taquilla_ayb": "STOCK_KIOSCO_TAQUILLA_AYB",
    "stock_restaurante_fuentes_ayb": "STOCK_RESTAURANTE_FUENTES_AYB",
    "stock_restaurante_fuentes_sumin": "STOCK_RESTAURANTE_FUENTES_SUMIN",
    "zoologico": "ZOOLOGICO",
    # NOT `upper()`: the Supabase load collided on `ZOOLOGICO_SUMINISTROS`.
    "zoologico_suministros": "ZOOLOGICO_SUMINISTROS_2",
}

EXIT_OK = 0
EXIT_BAD_INPUT = 1


def read_snapshot_rows(path: Path) -> list[dict]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if payload.get("schema_version") != 1:
        raise ValueError(f"{path} is not a v1 snapshot")
    return payload["rows"]


def read_legacy_rows(path: Path) -> dict[tuple[str, int], dict]:
    """`(table, rowid) -> {nr_articulo, articulo}` from the retired SQLite."""
    legacy: dict[tuple[str, int], dict] = {}
    with sqlite3.connect(f"file:{path}?mode=ro", uri=True) as connection:
        for table in TABLE_TO_WAREHOUSE_CODE:
            for rowid, nr_articulo, articulo in connection.execute(
                f"SELECT rowid, nr_articulo, articulo FROM {table}"  # noqa: S608
            ):
                legacy[(table, rowid)] = {
                    "nr_articulo": nr_articulo,
                    "articulo": articulo,
                }
    return legacy


def index_by(rows: list[dict], field: str) -> dict[tuple[str, str], list[dict]]:
    index: dict[tuple[str, str], list[dict]] = {}
    for row in rows:
        value = row[field]
        if value is None:
            continue
        index.setdefault((row["warehouse_code"], value), []).append(row)
    return index


def resolve_gold(
    case: dict,
    legacy: dict[tuple[str, int], dict],
    by_sku: dict[tuple[str, str], list[dict]],
    by_name: dict[tuple[str, str], list[dict]],
) -> tuple[dict | None, str]:
    """Return `(snapshot_row, reason)`; `row is None` means the case is dropped."""
    code = TABLE_TO_WAREHOUSE_CODE[case["table"]]
    legacy_row = legacy.get((case["table"], case["gold_rowid"]))
    if legacy_row is None:
        return None, "gold rowid absent from the legacy database"

    sku = legacy_row["nr_articulo"]
    if sku is not None:
        matches = by_sku.get((code, sku), [])
        if len(matches) == 1:
            return matches[0], "sku"
        if len(matches) > 1:
            return None, "sku is not unique in the warehouse"

    matches = by_name.get((code, legacy_row["articulo"]), [])
    if len(matches) == 1:
        return matches[0], "articulo"
    if len(matches) > 1:
        return None, "articulo is not unique in the warehouse"
    return None, "no Supabase row carries this sku or articulo"


def remap(cases: list[dict], legacy: dict, rows: list[dict]) -> tuple[list[dict], Counter, int]:
    by_sku = index_by(rows, "nr_articulo")
    by_name = index_by(rows, "articulo")

    kept: list[dict] = []
    dropped: Counter = Counter()
    renamed = 0

    for case in cases:
        remapped = dict(case)
        remapped["catalogue_id"] = TABLE_TO_WAREHOUSE_CODE[remapped.pop("table")]

        if case["type"] == "variant":
            row, reason = resolve_gold(case, legacy, by_sku, by_name)
            if row is None:
                dropped[reason] += 1
                continue
            remapped.pop("gold_rowid")
            remapped["gold_uid"] = row["uid"]
            if row["articulo"] != case["gold_articulo"]:
                renamed += 1
            remapped["gold_articulo"] = row["articulo"]

        kept.append(remapped)

    return kept, dropped, renamed


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="remap_eval_set")
    parser.add_argument("--eval", type=Path, default=DEFAULT_EVAL)
    parser.add_argument("--snapshot", type=Path, default=DEFAULT_SNAPSHOT)
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_SQLITE)
    parser.add_argument("--dry-run", action="store_true", help="report without writing")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    for path in (args.eval, args.snapshot, args.sqlite):
        if not path.exists():
            print(f"ERROR: missing input {path}", file=sys.stderr)
            return EXIT_BAD_INPUT

    cases = json.loads(args.eval.read_text(encoding="utf-8"))
    if any("table" not in case for case in cases):
        print(f"ERROR: {args.eval} is already remapped", file=sys.stderr)
        return EXIT_BAD_INPUT

    rows = read_snapshot_rows(args.snapshot)
    legacy = read_legacy_rows(args.sqlite)
    kept, dropped, renamed = remap(cases, legacy, rows)

    before = Counter(case["type"] for case in cases)
    after = Counter(case["type"] for case in kept)
    print(f"cases {len(cases)} -> {len(kept)}")
    for case_type in sorted(before):
        print(f"  {case_type:24s} {before[case_type]:3d} -> {after[case_type]:3d}")
    print(f"gold_articulo rewritten from the snapshot row: {renamed}")
    for reason, count in dropped.most_common():
        print(f"  dropped {count:3d}: {reason}")

    if args.dry_run:
        return EXIT_OK

    args.eval.write_text(
        json.dumps(kept, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return EXIT_OK


if __name__ == "__main__":
    raise SystemExit(main())
