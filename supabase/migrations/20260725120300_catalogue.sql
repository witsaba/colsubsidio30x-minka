-- The normalised catalogue derived from `source` (RF-01, RF-02, RF-03).
--
-- The one structural decision worth stating up front: the theoretical balance
-- does NOT live on `warehouse_products`. It sits in its own table,
-- `warehouse_stock_balances`, so that blind counting (RF-18) is a grant, not a
-- convention. An operator can be given full SELECT on the catalogue and still
-- have no path to the number they are supposed to discover by counting.

-- ---------------------------------------------------------------------------
-- Units of measure
-- ---------------------------------------------------------------------------
-- Four appear in the workbook. `code` is the Oracle UOM token, because that is
-- what the export has to emit; `source_label` is what the spreadsheet says.

create table public.units (
  code           text primary key check (code ~ '^[A-Z]{1,10}$'),
  label_es       text    not null,
  source_label   text    unique,
  kind           text    not null check (kind in ('count', 'mass', 'volume', 'portion')),
  allows_decimal boolean not null default true
);

comment on column public.units.source_label is
  'The literal workbook value (Unidad, Kilogram, Liter, Portion). Used to map source rows onto codes.';

insert into public.units (code, label_es, source_label, kind, allows_decimal) values
  ('UND', 'Unidad',  'Unidad',    'count',   false),
  ('KG',  'Kilogramo','Kilogram', 'mass',    true),
  ('LT',  'Litro',   'Liter',     'volume',  true),
  ('POR', 'Porción', 'Portion',   'portion', true),
  ('CAJA','Caja',    null,        'count',   false);

comment on table public.units is
  'UND/KG/LT/POR come from the workbook. CAJA is added because operators dictate boxes ("dos cajas de tomate") and RF-15 has to resolve that to a stocked unit.';

-- ---------------------------------------------------------------------------
-- Warehouses
-- ---------------------------------------------------------------------------
-- The workbook holds two registries that do NOT reconcile: sheet 1 lists 48
-- warehouse names, and 8 further sheets carry stock under names that mostly do
-- not appear in that list (only "ZOOLOGICO SUMINISTROS" matches outright).
-- Rather than invent a mapping, both registries are loaded and `source_kind`
-- records which is which. `merged_into_warehouse_id` lets an auditor declare the
-- equivalence later without a schema change.

create table public.warehouses (
  id                       uuid primary key default gen_random_uuid(),
  code                     text not null unique check (code ~ '^[A-Z0-9_]+$'),
  name                     text not null,
  source_kind              public.warehouse_source not null,
  source_ordinal           integer,
  source_sheet_name        text,
  merged_into_warehouse_id uuid references public.warehouses (id) on delete set null,
  is_active                boolean     not null default true,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),

  -- A warehouse cannot be its own alias.
  constraint warehouses_no_self_merge check (merged_into_warehouse_id is distinct from id),
  -- Only stock sheets carry a sheet name, and every one of them does.
  constraint warehouses_sheet_name_matches_kind check (
    (source_kind = 'stock_sheet' and source_sheet_name is not null)
    or (source_kind = 'bodegas_list' and source_sheet_name is null)
  )
);

comment on column public.warehouses.code is
  'Stable slug, and the SUBINVENTORY token in the Oracle export.';
comment on column public.warehouses.merged_into_warehouse_id is
  'Set when a human confirms this row is the same physical warehouse as another. Unresolved by design at load time — the workbook does not say.';

create index warehouses_kind_idx  on public.warehouses (source_kind) where is_active;
create index warehouses_merge_idx on public.warehouses (merged_into_warehouse_id)
  where merged_into_warehouse_id is not null;

create trigger warehouses_set_updated_at
  before update on public.warehouses
  for each row execute function extensions.moddatetime (updated_at);

-- ---------------------------------------------------------------------------
-- Products
-- ---------------------------------------------------------------------------
-- Product identity in this workbook is clean and was verified before the schema
-- was written: across all 1,413 stock rows there are 936 distinct normalised
-- names, no name carries two different codes, no code carries two different
-- names, and no name carries two different units. So the normalised name is a
-- sound natural key and the code is a unique-when-present alternate key.

create table public.products (
  id              uuid primary key default gen_random_uuid(),
  sku             text unique,     -- workbook `Nr.Artículo`; null for 148 of 936 products
  name            text not null,   -- workbook `Artículo`, verbatim including accents
  name_normalized text not null unique,
  unit_code       text not null references public.units (code),
  -- RF-04: the auditor may create products; the AI never may.
  is_from_source  boolean     not null default true,
  created_by      uuid        references public.profiles (id) on delete set null,
  is_active       boolean     not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint products_source_has_no_author check (
    (is_from_source and created_by is null) or not is_from_source
  )
);

comment on column public.products.name_normalized is
  'Accent-folded, whitespace-collapsed, upper-cased name. The catalogue''s natural key and the trigram search target.';
comment on column public.products.unit_code is
  'The canonical unit (RF-03). A dictated unit that disagrees with this raises RF-26(b).';

create index products_sku_idx  on public.products (sku) where sku is not null;
create index products_trgm_idx on public.products
  using gin (name_normalized extensions.gin_trgm_ops);

create trigger products_set_updated_at
  before update on public.products
  for each row execute function extensions.moddatetime (updated_at);

-- ---------------------------------------------------------------------------
-- Which products live in which warehouse — operator-visible
-- ---------------------------------------------------------------------------

create table public.warehouse_products (
  id                 uuid primary key default gen_random_uuid(),
  warehouse_id       uuid not null references public.warehouses (id) on delete cascade,
  product_id         uuid not null references public.products (id)   on delete cascade,
  unit_code          text not null references public.units (code),
  source_row_ordinal integer,
  is_active          boolean     not null default true,
  created_at         timestamptz not null default now(),
  unique (warehouse_id, product_id)
);

comment on table public.warehouse_products is
  'The per-warehouse catalogue the tablet loads (RF-11). Deliberately free of quantities so it is safe to hand an operator wholesale.';

create index warehouse_products_warehouse_idx on public.warehouse_products (warehouse_id) where is_active;
create index warehouse_products_product_idx   on public.warehouse_products (product_id);

-- ---------------------------------------------------------------------------
-- Theoretical balances — auditor-visible only
-- ---------------------------------------------------------------------------

create table public.warehouse_stock_balances (
  id              uuid primary key default gen_random_uuid(),
  warehouse_id    uuid not null references public.warehouses (id) on delete cascade,
  product_id      uuid not null references public.products (id)   on delete cascade,
  unit_code       text not null references public.units (code),
  theoretical_qty numeric(14, 4) not null,
  ingest_run_id   uuid references source.ingest_runs (id) on delete set null,
  as_of           timestamptz not null default now(),
  unique (warehouse_id, product_id)
);

comment on table public.warehouse_stock_balances is
  'The `sd` column from the workbook: what the system thinks is on the shelf. RF-18 forbids showing it to an operator, and the RLS on this table is where that is actually enforced.';
comment on column public.warehouse_stock_balances.theoretical_qty is
  'May be negative. Negative balances are a known data defect and RF-26(d) treats them as a finding, so they are stored, not clamped.';

create index stock_balances_warehouse_idx on public.warehouse_stock_balances (warehouse_id);
create index stock_balances_negative_idx  on public.warehouse_stock_balances (warehouse_id)
  where theoretical_qty < 0;

-- ---------------------------------------------------------------------------
-- Learned ranges — auditor-visible only
-- ---------------------------------------------------------------------------
-- RF-03 asks for statistical parameters per product. With a single snapshot
-- there is no history to learn from yet, so this table is populated by a
-- documented seed heuristic now and recomputed from real counts later. `method`
-- records which, so nobody mistakes a bootstrap band for a learned one.

create table public.product_count_ranges (
  id           uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references public.warehouses (id) on delete cascade,
  product_id   uuid not null references public.products (id)   on delete cascade,
  unit_code    text not null references public.units (code),
  expected_min numeric(14, 4) not null,
  expected_max numeric(14, 4) not null,
  sample_size  integer not null default 0,
  method       text    not null default 'bootstrap_from_snapshot',
  computed_at  timestamptz not null default now(),
  unique (warehouse_id, product_id),
  constraint ranges_ordered check (expected_max >= expected_min)
);

comment on column public.product_count_ranges.method is
  'bootstrap_from_snapshot = derived from the single loaded balance, not from history. Swap to a learned method once counts accumulate.';
