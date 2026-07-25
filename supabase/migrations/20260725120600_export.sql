-- Close and export to Oracle My Inventory (RF-30, RF-31, CU-09).
--
-- RNF-09 is the constraint that shapes this: there is no ERP integration. The
-- tool emits a file. So the export is materialised into rows — one per line of
-- the eventual Import Count Sequences file — and frozen, because "what did we
-- hand Oracle on the 31st" must stay answerable after the catalogue moves on.

create table public.export_batches (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique,
  plan_id        uuid references public.audit_plans (id) on delete set null,
  status         public.export_status not null default 'draft',
  format         text not null default 'oracle_import_count_sequences',
  record_count   integer not null default 0 check (record_count >= 0),
  -- The gate the mockup calls "cierre con candado": the file is not generated
  -- while an anomaly is still open. Recorded rather than merely enforced, so an
  -- override is visible instead of invisible.
  open_anomaly_count integer not null default 0 check (open_anomaly_count >= 0),
  forced         boolean not null default false,
  generated_by   uuid references public.profiles (id) on delete set null,
  generated_at   timestamptz,
  downloaded_at  timestamptz,
  checksum       text,
  notes          text,
  created_at     timestamptz not null default now(),

  constraint export_batches_generation_consistent check (
    (status in ('draft', 'void') and generated_at is null)
    or (status in ('generated', 'downloaded') and generated_at is not null)
  ),
  -- A clean export is one with nothing open. Anything else has to be flagged
  -- as forced, which is what makes the override auditable.
  constraint export_batches_lock_respected check (
    open_anomaly_count = 0 or forced
  )
);

comment on table public.export_batches is
  'One generated Oracle load file. `forced` is the audit trail for overriding the open-anomaly lock.';

create index export_batches_plan_idx on public.export_batches (plan_id, created_at desc);

-- Frozen line items. `subinventory`, `item`, `uom` and `counter` are text
-- snapshots rather than joins: the file that went to Oracle must remain
-- byte-reproducible even if a warehouse is later renamed or merged.
create table public.export_lines (
  id           uuid primary key default gen_random_uuid(),
  batch_id     uuid not null references public.export_batches (id) on delete cascade,
  line_number  integer not null check (line_number > 0),
  subinventory text not null,
  item         text not null,
  count_qty    numeric(14, 4) not null,
  uom          text not null,
  counter      text not null,
  record_id    uuid references public.count_records (id) on delete set null,
  unique (batch_id, line_number)
);

comment on table public.export_lines is
  'Frozen Import Count Sequences rows. Text snapshots, not joins: a reprint must reproduce the original file.';

create index export_lines_batch_idx  on public.export_lines (batch_id, line_number);
create index export_lines_record_idx on public.export_lines (record_id);

create trigger export_lines_append_only
  before update or delete on public.export_lines
  for each row execute function public.forbid_mutation();
