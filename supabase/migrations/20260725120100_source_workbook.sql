-- Verbatim landing tables for `BODEGAS Y STOCK.xlsx` (RF-01).
--
-- One ingest run == one upload of one workbook. Rows are never updated in
-- place; a re-upload creates a new run so the derivation that produced today's
-- catalogue stays reproducible.
--
-- Column naming follows the workbook, not English, so a reader can hold the
-- spreadsheet next to the table. `cantidad` is deliberately NOT a quantity: in
-- every sheet it is the printed row ordinal (1..N). The balance lives in `sd`.

create table source.ingest_runs (
  id                uuid primary key default gen_random_uuid(),
  source_filename   text        not null,
  source_sha256     text        not null check (source_sha256 ~ '^[0-9a-f]{64}$'),
  sheet_names       text[]      not null,
  row_counts        jsonb       not null,
  script_version    text        not null,
  ingested_at       timestamptz not null default now(),
  ingested_by       uuid        references auth.users (id) on delete set null,
  is_active         boolean     not null default false,
  notes             text
);

comment on table source.ingest_runs is
  'One row per workbook upload. `source_sha256` is the drift check against the .xlsx.';
comment on column source.ingest_runs.is_active is
  'Exactly one run may be active; the active run is the one the public catalogue was derived from.';

-- Only one run can be the live one. A partial unique index is the cheapest way
-- to say "at most one true" without a trigger.
create unique index ingest_runs_single_active_idx
  on source.ingest_runs ((is_active)) where is_active;

create index ingest_runs_sha_idx on source.ingest_runs (source_sha256);

create table source.workbook_sheets (
  id              uuid primary key default gen_random_uuid(),
  ingest_run_id   uuid    not null references source.ingest_runs (id) on delete cascade,
  sheet_name      text    not null,      -- verbatim, double spaces and all
  sheet_index     integer not null,
  table_slug      text    not null,      -- snake_case slug, matches the SQLite mirror
  raw_header      text,                  -- first header cell as printed (e.g. the 'CANTIDA' typo)
  row_count       integer not null default 0,
  is_stock_sheet  boolean not null,
  unique (ingest_run_id, sheet_name)
);

comment on column source.workbook_sheets.raw_header is
  'Header text exactly as typed in the workbook. Sheet 7 spells it CANTIDA; that typo is evidence, not noise.';

-- Sheet 1: the 48-name warehouse registry.
create table source.bodegas_disponibles (
  id             uuid primary key default gen_random_uuid(),
  ingest_run_id  uuid    not null references source.ingest_runs (id) on delete cascade,
  sheet_id       uuid    not null references source.workbook_sheets (id) on delete cascade,
  row_ordinal    integer not null,       -- the sheet's CANTIDAD column
  bodega         text    not null,       -- verbatim, mixed case and stray spaces preserved
  raw_header     text,
  unique (ingest_run_id, row_ordinal)
);

comment on table source.bodegas_disponibles is
  'Sheet "BODEGAS DISPONIBLES", 48 rows. Contains one true duplicate (cafeteria acuario suministros); it is preserved.';

-- Sheets 2..9: the stock lines, unified. The sheet is carried as a column
-- instead of a table-per-sheet because the network has 48 warehouses and only 8
-- were sampled (RNF-10: grow without redesign).
create table source.stock_rows (
  id             uuid primary key default gen_random_uuid(),
  ingest_run_id  uuid    not null references source.ingest_runs (id) on delete cascade,
  sheet_id       uuid    not null references source.workbook_sheets (id) on delete cascade,
  row_ordinal    integer not null,       -- the sheet's CANTIDAD / CANTIDA column
  nr_articulo    text,                   -- item code; null for 18.4% of rows
  articulo       text,                   -- item description; null on 8 rows
  unidad         text,                   -- Unidad | Kilogram | Liter | Portion | null
  sd             numeric(14, 4),         -- saldo disponible: the theoretical balance
  raw_header     text,
  unique (ingest_run_id, sheet_id, row_ordinal)
);

comment on column source.stock_rows.row_ordinal is
  'The workbook CANTIDAD column. It is a printed row number, not a quantity.';
comment on column source.stock_rows.sd is
  'Saldo disponible: the theoretical balance. 5.59% of rows are negative (RF-26d).';

create index stock_rows_run_idx     on source.stock_rows (ingest_run_id);
create index stock_rows_sheet_idx   on source.stock_rows (sheet_id);
create index stock_rows_code_idx    on source.stock_rows (nr_articulo) where nr_articulo is not null;

-- Defence in depth. `source` is not in the exposed schema list, and the schema
-- grants were already revoked, but RLS-on-with-no-policy means even a future
-- accidental exposure yields zero rows to anon/authenticated.
alter table source.ingest_runs        enable row level security;
alter table source.workbook_sheets    enable row level security;
alter table source.bodegas_disponibles enable row level security;
alter table source.stock_rows         enable row level security;
