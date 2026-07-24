# Bodegas and stock SQLite mirror

`bodegas-y-stock.sqlite` is a committed, derived mirror of
`docs/sources/bodegas-y-stock.xlsx`. The workbook remains the source of truth and
must not be edited by the build process. Python work in this repository uses the
`uv` convention (`pyproject.toml`, `uv.lock`, `uv sync`, and `uv run`).

## Regenerate and validate

```sh
make clean-sqlite
make build-sqlite
make check-sqlite
```

The equivalent direct command is:

```sh
uv run python scripts/build_bodegas_sqlite.py \
  --xlsx docs/sources/bodegas-y-stock.xlsx \
  --out data/bodegas-y-stock.sqlite
```

`--dry-run` parses and reports counts without writing. `--check` exits 0 for a
fresh mirror, 1 for source drift, and 2 when the database or `_meta` row is
missing.

## Schema

The database contains nine snake_case data tables plus `_meta`. The
`bodegas_disponibles` table has `cantidad`, `bodegas`, and `raw_header`; each of
the eight stock tables has `cantidad`, `nr_articulo`, `articulo`, `unidad`, `sd`,
and `raw_header`, except `stock_restaurante_fuentes_sumin`, whose empty source
column is omitted. `_meta` records the source SHA-256, build timestamp, per-table
row counts, and script version. Lookup indexes cover `bodegas`, `nr_articulo`,
and `sd`.

The duplicate `cafeteria acuario suministros` row is preserved verbatim because
the SQLite file mirrors source data rather than deduplicating it. Workbook
`docProps` PII is neither read nor logged.

## Query examples

If the `sqlite3` CLI is unavailable, replace each invocation with an equivalent
`uv run python -c "import sqlite3; ..."` one-liner using the standard library.

```sql
-- List tables.
SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name;

-- Total data rows (1,461).
SELECT SUM(rows) FROM (
  SELECT COUNT(*) rows FROM bodegas_disponibles UNION ALL
  SELECT COUNT(*) FROM stock_almacen_ayb UNION ALL
  SELECT COUNT(*) FROM stock_almacen_suministros UNION ALL
  SELECT COUNT(*) FROM stock_kiosco_piscigiros_ayb UNION ALL
  SELECT COUNT(*) FROM stock_kiosco_taquilla_ayb UNION ALL
  SELECT COUNT(*) FROM stock_restaurante_fuentes_ayb UNION ALL
  SELECT COUNT(*) FROM stock_restaurante_fuentes_sumin UNION ALL
  SELECT COUNT(*) FROM zoologico UNION ALL
  SELECT COUNT(*) FROM zoologico_suministros
);

-- Build provenance.
SELECT * FROM _meta;
```

The PRD percentages use all 1,413 stock rows. Each statement below is a single
query and returns the percentage rounded to two decimals.

```sql
-- Negative balances: 5.59%.
WITH stock AS (
  SELECT sd FROM stock_almacen_ayb UNION ALL SELECT sd FROM stock_almacen_suministros
  UNION ALL SELECT sd FROM stock_kiosco_piscigiros_ayb UNION ALL SELECT sd FROM stock_kiosco_taquilla_ayb
  UNION ALL SELECT sd FROM stock_restaurante_fuentes_ayb UNION ALL SELECT sd FROM stock_restaurante_fuentes_sumin
  UNION ALL SELECT sd FROM zoologico UNION ALL SELECT sd FROM zoologico_suministros
) SELECT ROUND(100.0 * SUM(sd < 0) / COUNT(*), 2) FROM stock;

-- Items without a unique code: 18.40%.
WITH stock AS (
  SELECT nr_articulo FROM stock_almacen_ayb UNION ALL SELECT nr_articulo FROM stock_almacen_suministros
  UNION ALL SELECT nr_articulo FROM stock_kiosco_piscigiros_ayb UNION ALL SELECT nr_articulo FROM stock_kiosco_taquilla_ayb
  UNION ALL SELECT nr_articulo FROM stock_restaurante_fuentes_ayb UNION ALL SELECT nr_articulo FROM stock_restaurante_fuentes_sumin
  UNION ALL SELECT nr_articulo FROM zoologico UNION ALL SELECT nr_articulo FROM zoologico_suministros
) SELECT ROUND(100.0 * SUM(nr_articulo IS NULL) / COUNT(*), 2) FROM stock;

-- Decimal balances: 23.00% (PRD's whole-percent presentation; 22.93% at 2 dp).
WITH stock AS (
  SELECT sd FROM stock_almacen_ayb UNION ALL SELECT sd FROM stock_almacen_suministros
  UNION ALL SELECT sd FROM stock_kiosco_piscigiros_ayb UNION ALL SELECT sd FROM stock_kiosco_taquilla_ayb
  UNION ALL SELECT sd FROM stock_restaurante_fuentes_ayb UNION ALL SELECT sd FROM stock_restaurante_fuentes_sumin
  UNION ALL SELECT sd FROM zoologico UNION ALL SELECT sd FROM zoologico_suministros
) SELECT ROUND(100.0 * SUM(sd != CAST(sd AS INTEGER)) / COUNT(*), 2) FROM stock;
```
