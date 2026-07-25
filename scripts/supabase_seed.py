"""Derive the Supabase catalogue from `BODEGAS Y STOCK.xlsx`.

Reads the workbook (through the parsing rules already established in
`build_bodegas_sqlite.py`, so the SQLite mirror and Postgres cannot disagree)
and emits idempotent SQL for:

  source.ingest_runs / workbook_sheets / bodegas_disponibles / stock_rows
  public.warehouses / products / warehouse_products
  public.warehouse_stock_balances / product_count_ranges

The emitted SQL is safe to re-run: every insert is keyed and every conflict is
resolved. Nothing here talks to the network; the caller applies the SQL.

Two rules the derivation refuses to break:

  * It never invents a mapping. The workbook's warehouse-name sheet and its
    stock sheets use different naming and cannot be reconciled automatically, so
    both registries are loaded and `source_kind` records which is which.
  * It never guesses past a contradiction. A name carrying two codes, or two
    units, stops the load instead of picking one.
"""
from __future__ import annotations

import argparse
import json
import re
import sys
import unicodedata
from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Iterable

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_bodegas_sqlite import (  # noqa: E402
    SHEET_CONFIG,
    compute_sha256,
    load_xlsx,
    snake_case,
)

SEED_VERSION = "1.0.0"
SOURCE_FILENAME = "BODEGAS Y STOCK.xlsx"
BODEGAS_SHEET = "BODEGAS DISPONIBLES"

# The four labels the workbook actually uses, mapped onto the `units` table.
UNIT_BY_SOURCE_LABEL = {
    "Unidad": "UND",
    "Kilogram": "KG",
    "Liter": "LT",
    "Portion": "POR",
}
DEFAULT_UNIT = "UND"


class DerivationError(RuntimeError):
    """The workbook says something the catalogue cannot represent."""


# ---------------------------------------------------------------------------
# Normalisation
# ---------------------------------------------------------------------------

def normalize_name(raw: Any) -> str | None:
    """Accent-fold, collapse whitespace, upper-case. `None` for blanks.

    Mirrors `public.normalize_product_name()` so a name typed into the search
    box folds exactly like a name loaded from the workbook.
    """
    if raw is None:
        return None
    text = str(raw).replace("\xa0", " ")
    decomposed = unicodedata.normalize("NFKD", text)
    stripped = "".join(ch for ch in decomposed if not unicodedata.combining(ch))
    collapsed = re.sub(r"\s+", " ", stripped).strip().upper()
    return collapsed or None


def warehouse_code(name: str) -> str:
    """Uppercase slug. Also the SUBINVENTORY token in the Oracle export."""
    folded = normalize_name(name) or "BODEGA"
    slug = re.sub(r"[^A-Z0-9]+", "_", folded).strip("_")
    return slug or "BODEGA"


def assign_unique_codes(names: Iterable[str]) -> list[str]:
    """Slug every name, suffixing repeats.

    The workbook lists 'cafeteria acuario suministros' twice. Both rows are real
    rows of the source and both are kept; only the code has to differ.
    """
    seen: dict[str, int] = {}
    out: list[str] = []
    for name in names:
        base = warehouse_code(name)
        seen[base] = seen.get(base, 0) + 1
        out.append(base if seen[base] == 1 else f"{base}_{seen[base]}")
    return out


def unit_code(source_label: Any) -> str:
    """Map a workbook unit label onto a `units.code`."""
    if source_label is None or str(source_label).strip() == "":
        return DEFAULT_UNIT
    label = str(source_label).strip()
    if label not in UNIT_BY_SOURCE_LABEL:
        raise DerivationError(f"unknown unit {label!r}; add it to units before loading")
    return UNIT_BY_SOURCE_LABEL[label]


# ---------------------------------------------------------------------------
# Records
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class StockRow:
    sheet_name: str
    row_ordinal: int
    nr_articulo: str | None
    articulo: str | None
    unidad: str | None
    sd: float | None


@dataclass
class Product:
    name: str
    name_normalized: str
    sku: str | None
    unit_code: str


@dataclass(frozen=True)
class Balance:
    sheet_name: str
    name_normalized: str
    unit_code: str
    theoretical_qty: Decimal
    is_imputed: bool


def build_products(rows: Iterable[StockRow]) -> list[Product]:
    """Collapse stock rows into one product per normalised name.

    Verified against the current workbook before this was written: 936 distinct
    names, none carrying two codes and none carrying two units. The conflict
    branches below exist for the next upload, not this one.
    """
    by_name: dict[str, Product] = {}
    for row in rows:
        normalized = normalize_name(row.articulo)
        if normalized is None:
            continue  # 8 rows have no description; there is nothing to catalogue

        code = (row.nr_articulo or "").strip() or None
        unit = unit_code(row.unidad)
        existing = by_name.get(normalized)

        if existing is None:
            by_name[normalized] = Product(
                name=str(row.articulo).strip(),
                name_normalized=normalized,
                sku=code,
                unit_code=unit,
            )
            continue

        if code is not None and existing.sku is not None and code != existing.sku:
            raise DerivationError(
                f"conflicting sku for {normalized!r}: {existing.sku!r} vs {code!r}"
            )
        if existing.sku is None:
            existing.sku = code

        if unit != existing.unit_code:
            raise DerivationError(
                f"conflicting unit for {normalized!r}: "
                f"{existing.unit_code!r} vs {unit!r}"
            )

    return list(by_name.values())


def build_balances(rows: Iterable[StockRow]) -> list[Balance]:
    """One theoretical balance per (sheet, product).

    A blank `sd` becomes 0 and is marked imputed rather than dropped: the item is
    stocked in that warehouse, and omitting it would remove it from the operator's
    catalogue for a reason that has nothing to do with the operator.
    """
    out: list[Balance] = []
    seen: set[tuple[str, str]] = set()
    for row in rows:
        normalized = normalize_name(row.articulo)
        if normalized is None:
            continue
        key = (row.sheet_name, normalized)
        if key in seen:
            continue
        seen.add(key)
        imputed = row.sd is None
        out.append(
            Balance(
                sheet_name=row.sheet_name,
                name_normalized=normalized,
                unit_code=unit_code(row.unidad),
                theoretical_qty=Decimal("0") if imputed else Decimal(str(row.sd)),
                is_imputed=imputed,
            )
        )
    return out


def bootstrap_range(qty: float | Decimal) -> tuple[Decimal, Decimal]:
    """A provisional expected band around a single snapshot value (RF-03).

    One snapshot is not a history, so this is a bracket, not a learned range:
    half to double the value. `product_count_ranges.method` records that it is a
    bootstrap so nobody mistakes it for evidence. Once real counts accumulate,
    recompute and flip the method.

    A balance at or below zero yields no usable lower bound — a shelf holding
    "-2" tells you the system is wrong, not what the operator will find — so the
    band opens at zero and only the ceiling is derived.
    """
    value = Decimal(str(qty))
    if value <= 0:
        return Decimal("0"), max(abs(value) * 2, Decimal("10")).quantize(Decimal("0.0001"))
    return (value / 2).quantize(Decimal("0.0001")), (value * 2).quantize(Decimal("0.0001"))


# ---------------------------------------------------------------------------
# SQL emission
# ---------------------------------------------------------------------------

def sql_literal(value: Any) -> str:
    """Render a Python value as a Postgres literal."""
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float, Decimal)):
        return str(value)
    return "'" + str(value).replace("'", "''") + "'"


def _values(rows: Iterable[Iterable[Any]]) -> str:
    return ",\n  ".join("(" + ", ".join(sql_literal(v) for v in row) + ")" for row in rows)


def read_workbook(xlsx_path: Path) -> tuple[list[tuple[int, str]], list[StockRow], dict[str, str]]:
    """Return (bodegas rows, stock rows, per-sheet raw header)."""
    frames = load_xlsx(xlsx_path)
    slug_to_sheet = {snake_case(name): name for name in SHEET_CONFIG}
    raw_headers = {name: cfg["raw_header"] for name, cfg in SHEET_CONFIG.items()}

    bodegas: list[tuple[int, str]] = []
    stock: list[StockRow] = []

    for slug, frame in frames.items():
        sheet_name = slug_to_sheet[slug]
        if sheet_name == BODEGAS_SHEET:
            for position, record in enumerate(frame.to_dict("records"), start=1):
                name = _clean(record.get("bodegas"))
                if name is None:
                    continue
                ordinal = record.get("cantidad")
                bodegas.append(
                    (position if _is_missing(ordinal) else int(ordinal), name)
                )
            continue

        for position, record in enumerate(frame.to_dict("records"), start=1):
            ordinal = record.get("cantidad")
            sd = record.get("sd")
            stock.append(
                StockRow(
                    sheet_name=sheet_name,
                    # Fall back to the reading order when the printed ordinal is
                    # blank; the row still has to be uniquely addressable.
                    row_ordinal=position if _is_missing(ordinal) else int(ordinal),
                    nr_articulo=_clean(record.get("nr_articulo")),
                    articulo=_clean(record.get("articulo")),
                    unidad=_clean(record.get("unidad")),
                    sd=None if _is_missing(sd) else float(sd),
                )
            )
    return bodegas, stock, raw_headers


def _is_missing(value: Any) -> bool:
    """pandas hands back NaN for a blank cell; treat it as the null it is."""
    return value is None or (isinstance(value, float) and value != value)


def _clean(value: Any) -> str | None:
    if _is_missing(value):
        return None
    text = str(value).replace("\xa0", " ").strip()
    return text or None


def _chunks(rows: list, size: int) -> Iterable[list]:
    for start in range(0, len(rows), size):
        yield rows[start:start + size]


def emit_statements(xlsx_path: Path, chunk_size: int = 400) -> list[str]:
    """The load, as independently runnable statements.

    Split rather than concatenated because the transport that applies these has a
    payload ceiling, and because a statement that can be re-run on its own is a
    statement that can be resumed after a failure. Every one is idempotent, so
    re-running the whole list is a no-op on an already-loaded database.

    The division of labour: Python carries the raw rows up and is the only thing
    that validates product identity; the derived catalogue is then built inside
    Postgres from `source.stock_rows`, which is already there. Nothing large
    crosses the wire twice.
    """
    bodegas, stock_rows, raw_headers = read_workbook(xlsx_path)
    sha = compute_sha256(xlsx_path)

    stock_sheet_names = sorted({r.sheet_name for r in stock_rows})
    products = sorted(build_products(stock_rows), key=lambda p: p.name_normalized)

    bodega_codes = assign_unique_codes([name for _, name in bodegas])
    sheet_codes = assign_unique_codes(stock_sheet_names)
    taken = set(bodega_codes)
    for i, code in enumerate(sheet_codes):
        candidate, n = code, 1
        while candidate in taken:
            n += 1
            candidate = f"{code}_{n}"
        sheet_codes[i] = candidate
        taken.add(candidate)

    row_counts = {snake_case(BODEGAS_SHEET): len(bodegas)}
    for name in stock_sheet_names:
        row_counts[snake_case(name)] = sum(1 for r in stock_rows if r.sheet_name == name)

    active = "(select id from source.ingest_runs where is_active)"
    out: list[str] = []

    # 1. Provenance. Re-running the same workbook reuses its run row.
    sheet_array = "array[" + ", ".join(sql_literal(n) for n in SHEET_CONFIG) + "]::text[]"
    out.append(f"""
update source.ingest_runs set is_active = false
where is_active and source_sha256 <> {sql_literal(sha)};

insert into source.ingest_runs
  (source_filename, source_sha256, sheet_names, row_counts, script_version, is_active)
select {sql_literal(SOURCE_FILENAME)}, {sql_literal(sha)}, {sheet_array},
       {sql_literal(json.dumps(row_counts, sort_keys=True))}::jsonb,
       {sql_literal(SEED_VERSION)}, true
where not exists (
  select 1 from source.ingest_runs where source_sha256 = {sql_literal(sha)}
);

update source.ingest_runs set is_active = true where source_sha256 = {sql_literal(sha)};
""".strip())

    # 2. Sheets.
    sheet_rows = [
        (name, index, snake_case(name), raw_headers[name],
         row_counts.get(snake_case(name), 0), name != BODEGAS_SHEET)
        for index, name in enumerate(SHEET_CONFIG)
    ]
    out.append(f"""
insert into source.workbook_sheets
  (ingest_run_id, sheet_name, sheet_index, table_slug, raw_header, row_count, is_stock_sheet)
select {active}, v.sheet_name, v.sheet_index, v.table_slug, v.raw_header,
       v.row_count, v.is_stock_sheet
from (values
  {_values(sheet_rows)}
) as v(sheet_name, sheet_index, table_slug, raw_header, row_count, is_stock_sheet)
on conflict (ingest_run_id, sheet_name) do nothing;
""".strip())

    # 3. Sheet 1, verbatim.
    out.append(f"""
insert into source.bodegas_disponibles (ingest_run_id, sheet_id, row_ordinal, bodega, raw_header)
select s.ingest_run_id, s.id, v.row_ordinal, v.bodega, s.raw_header
from source.workbook_sheets s
join (values
  {_values(list(bodegas))}
) as v(row_ordinal, bodega) on true
where s.ingest_run_id = {active} and s.sheet_name = {sql_literal(BODEGAS_SHEET)}
on conflict (ingest_run_id, row_ordinal) do nothing;
""".strip())

    # 4. Sheets 2..9, verbatim, chunked.
    stock_values = [
        (r.sheet_name, r.row_ordinal, r.nr_articulo, r.articulo, r.unidad, r.sd)
        for r in stock_rows
    ]
    for chunk in _chunks(stock_values, chunk_size):
        out.append(f"""
insert into source.stock_rows
  (ingest_run_id, sheet_id, row_ordinal, nr_articulo, articulo, unidad, sd, raw_header)
select s.ingest_run_id, s.id, v.row_ordinal, v.nr_articulo, v.articulo, v.unidad,
       v.sd::numeric, s.raw_header
from (values
  {_values(chunk)}
) as v(sheet_name, row_ordinal, nr_articulo, articulo, unidad, sd)
join source.workbook_sheets s
  on s.ingest_run_id = {active} and s.sheet_name = v.sheet_name
on conflict (ingest_run_id, sheet_id, row_ordinal) do nothing;
""".strip())

    # 5. Warehouses: both registries, unreconciled by design.
    warehouse_values = [
        (code, name, "bodegas_list", ordinal, None)
        for code, (ordinal, name) in zip(bodega_codes, bodegas)
    ] + [
        (code, name, "stock_sheet", None, name)
        for code, name in zip(sheet_codes, stock_sheet_names)
    ]
    for chunk in _chunks(warehouse_values, chunk_size):
        out.append(f"""
insert into public.warehouses (code, name, source_kind, source_ordinal, source_sheet_name)
select v.code, v.name, v.source_kind::public.warehouse_source, v.source_ordinal,
       v.source_sheet_name
from (values
  {_values(chunk)}
) as v(code, name, source_kind, source_ordinal, source_sheet_name)
on conflict (code) do update
  set name = excluded.name,
      source_kind = excluded.source_kind,
      source_ordinal = excluded.source_ordinal,
      source_sheet_name = excluded.source_sheet_name;
""".strip())

    # 6. Products, derived in place from the rows already uploaded.
    #
    #    build_products() ran above and would have raised on a name carrying two
    #    codes or two units, so by the time this statement is emitted the
    #    aggregates below are known to be collapsing sets of size one. Deriving
    #    in SQL rather than shipping 936 literals keeps the payload small and
    #    keeps a single definition of the catalogue.
    out.append(f"""
insert into public.products (sku, name, name_normalized, unit_code)
select min(sr.nr_articulo),
       min(sr.articulo),
       public.normalize_product_name(sr.articulo),
       coalesce(min(u.code), {sql_literal(DEFAULT_UNIT)})
from source.stock_rows sr
left join public.units u on u.source_label = sr.unidad
where sr.ingest_run_id = {active}
  and sr.articulo is not null
group by public.normalize_product_name(sr.articulo)
on conflict (name_normalized) do update
  set sku       = coalesce(excluded.sku, public.products.sku),
      name      = excluded.name,
      unit_code = excluded.unit_code;
""".strip())
    # `products` is unused as a payload now, but building it is the validation.
    assert products is not None

    # 7. Derive the catalogue in place from the rows already uploaded.
    #    `distinct on` keeps the first printed row when a sheet lists a name
    #    twice; the raw duplicate stays in source.stock_rows either way.
    derivation_cte = f"""
with rows as (
  select distinct on (s.sheet_name, public.normalize_product_name(sr.articulo))
         s.sheet_name,
         public.normalize_product_name(sr.articulo) as name_normalized,
         coalesce(u.code, {sql_literal(DEFAULT_UNIT)}) as unit_code,
         coalesce(sr.sd, 0) as theoretical_qty
  from source.stock_rows sr
  join source.workbook_sheets s on s.id = sr.sheet_id
  left join public.units u on u.source_label = sr.unidad
  where sr.ingest_run_id = {active}
    and sr.articulo is not null
    and s.is_stock_sheet
  order by s.sheet_name, public.normalize_product_name(sr.articulo), sr.row_ordinal
)"""

    out.append(f"""
{derivation_cte}
insert into public.warehouse_products (warehouse_id, product_id, unit_code)
select w.id, p.id, r.unit_code
from rows r
join public.warehouses w on w.source_sheet_name = r.sheet_name
join public.products   p on p.name_normalized  = r.name_normalized
on conflict (warehouse_id, product_id) do update set unit_code = excluded.unit_code;
""".strip())

    out.append(f"""
{derivation_cte}
insert into public.warehouse_stock_balances
  (warehouse_id, product_id, unit_code, theoretical_qty, ingest_run_id)
select w.id, p.id, r.unit_code, r.theoretical_qty, {active}
from rows r
join public.warehouses w on w.source_sheet_name = r.sheet_name
join public.products   p on p.name_normalized  = r.name_normalized
on conflict (warehouse_id, product_id) do update
  set theoretical_qty = excluded.theoretical_qty,
      unit_code       = excluded.unit_code,
      ingest_run_id   = excluded.ingest_run_id,
      as_of           = now();
""".strip())

    # RF-03. The band mirrors bootstrap_range(): half-to-double above zero, and
    # zero-to-a-floor when the snapshot is non-positive.
    out.append(f"""
{derivation_cte}
insert into public.product_count_ranges
  (warehouse_id, product_id, unit_code, expected_min, expected_max, sample_size, method)
select w.id, p.id, r.unit_code,
       case when r.theoretical_qty <= 0 then 0 else round(r.theoretical_qty / 2, 4) end,
       case when r.theoretical_qty <= 0 then greatest(abs(r.theoretical_qty) * 2, 10)
            else round(r.theoretical_qty * 2, 4) end,
       1,
       'bootstrap_from_snapshot'
from rows r
join public.warehouses w on w.source_sheet_name = r.sheet_name
join public.products   p on p.name_normalized  = r.name_normalized
on conflict (warehouse_id, product_id) do update
  set expected_min = excluded.expected_min,
      expected_max = excluded.expected_max,
      unit_code    = excluded.unit_code,
      method       = excluded.method,
      computed_at  = now();
""".strip())

    out.append("""
update public.audit_plans ap
set expected_item_count = sub.n
from (
  select warehouse_id, count(*) as n
  from public.warehouse_products where is_active group by warehouse_id
) sub
where sub.warehouse_id = ap.warehouse_id and ap.status in ('draft', 'scheduled');
""".strip())

    return out


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(prog="supabase_seed")
    parser.add_argument("--xlsx", type=Path, default=Path("docs/sources/bodegas-y-stock.xlsx"))
    parser.add_argument("--out-dir", type=Path, default=Path("supabase/seed"))
    parser.add_argument(
        "--chunk-size", type=int, default=400,
        help="rows per INSERT; lower it if the transport rejects the payload",
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    statements = emit_statements(args.xlsx, chunk_size=args.chunk_size)

    args.out_dir.mkdir(parents=True, exist_ok=True)
    for stale in sorted(args.out_dir.glob("[0-9][0-9][0-9]_*.sql")):
        stale.unlink()

    total = 0
    for index, statement in enumerate(statements, start=1):
        path = args.out_dir / f"{index:03d}_load.sql"
        path.write_text(statement + "\n", encoding="utf-8")
        total += len(statement)

    print(f"wrote {len(statements)} statements to {args.out_dir} ({total:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
