-- Audit plans, voice captures, and count records (RF-06..RF-21, RF-33).

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------
-- RF-06: exactly one warehouse per plan. That is a column, not a join table,
-- precisely so it cannot drift into many.

create table public.audit_plans (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  name                text not null,
  warehouse_id        uuid not null references public.warehouses (id) on delete restrict,
  period_start        date not null,
  period_end          date not null,
  scheduled_start_at  timestamptz,
  status              public.plan_status not null default 'draft',
  expected_item_count integer not null default 0 check (expected_item_count >= 0),
  created_by          uuid references public.profiles (id) on delete set null,
  closed_by           uuid references public.profiles (id) on delete set null,
  closed_at           timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint audit_plans_period_ordered check (period_end >= period_start),
  -- A closed plan must say who closed it and when; an open one must not pretend.
  constraint audit_plans_closure_consistent check (
    (status = 'closed' and closed_at is not null)
    or (status <> 'closed' and closed_at is null)
  )
);

create index audit_plans_warehouse_idx on public.audit_plans (warehouse_id);
create index audit_plans_status_idx    on public.audit_plans (status, scheduled_start_at);

create trigger audit_plans_set_updated_at
  before update on public.audit_plans
  for each row execute function extensions.moddatetime (updated_at);

-- RF-07: the assignment table is the whole access rule. If there is no row
-- here, the operator has no path to the plan, its catalogue, or its records.
create table public.plan_operators (
  id          uuid primary key default gen_random_uuid(),
  plan_id     uuid not null references public.audit_plans (id) on delete cascade,
  profile_id  uuid not null references public.profiles (id)    on delete cascade,
  status      public.assignment_status not null default 'scheduled',
  assigned_by uuid references public.profiles (id) on delete set null,
  assigned_at timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,
  unique (plan_id, profile_id)
);

create index plan_operators_profile_idx on public.plan_operators (profile_id);

-- ---------------------------------------------------------------------------
-- Voice captures
-- ---------------------------------------------------------------------------
-- One push-to-talk gesture. RNF-04 is absolute: there is no audio column here
-- and no storage bucket behind it. What survives is the transcript and the
-- consensus evidence, which is what the auditor's trace panel actually shows.

create table public.voice_captures (
  id                uuid primary key default gen_random_uuid(),
  plan_id           uuid not null references public.audit_plans (id) on delete cascade,
  profile_id        uuid not null references public.profiles (id)    on delete restrict,
  transcript        text,
  duration_ms       integer check (duration_ms > 0),
  -- RF-23/RF-24: three models run, and the record only counts when they agree.
  models_total      integer not null default 0 check (models_total >= 0),
  models_agreed     integer not null default 0 check (models_agreed >= 0),
  vendor_results    jsonb   not null default '[]'::jsonb,
  captured_at       timestamptz not null default now(),
  synced_at         timestamptz,
  -- Idempotency key minted on the tablet so an offline replay cannot duplicate
  -- a capture when the network comes back (RNF-08).
  client_capture_id text unique,
  created_at        timestamptz not null default now(),

  constraint voice_captures_consensus_bounded check (models_agreed <= models_total)
);

comment on table public.voice_captures is
  'A single push-to-talk gesture. No audio is persisted (RNF-04); only the transcript and per-model results.';
comment on column public.voice_captures.client_capture_id is
  'Client-minted idempotency key. Offline capture replays hit the unique index instead of duplicating.';

create index voice_captures_plan_idx    on public.voice_captures (plan_id, captured_at desc);
create index voice_captures_profile_idx on public.voice_captures (profile_id, captured_at desc);

-- ---------------------------------------------------------------------------
-- Count records
-- ---------------------------------------------------------------------------
-- RF-14: one audio holding three items becomes three rows here, all pointing at
-- the same capture. RF-20/RF-21: voice only ever inserts. A correction is a soft
-- delete plus a fresh insert, which is why `is_deleted` exists instead of an
-- UPDATE path for quantity.

create table public.count_records (
  id               uuid primary key default gen_random_uuid(),
  plan_id          uuid not null references public.audit_plans (id) on delete cascade,
  warehouse_id     uuid not null references public.warehouses (id)  on delete restrict,
  product_id       uuid references public.products (id) on delete restrict,
  capture_id       uuid references public.voice_captures (id) on delete set null,
  quantity         numeric(14, 4) not null check (quantity >= 0),
  unit_code        text not null references public.units (code),
  source           public.record_source not null default 'voice',
  status           public.record_status not null default 'recorded',
  -- What the operator actually said, kept per record so a three-item audio
  -- still explains each of its three rows on its own.
  dictated_text    text,
  counted_by       uuid not null references public.profiles (id) on delete restrict,
  counted_at       timestamptz not null default now(),
  synced_at        timestamptz,
  client_record_id text unique,
  is_deleted       boolean not null default false,
  deleted_at       timestamptz,
  deleted_by       uuid references public.profiles (id) on delete set null,
  delete_reason    text,
  created_at       timestamptz not null default now(),

  constraint count_records_delete_consistent check (
    (is_deleted and deleted_at is not null) or (not is_deleted and deleted_at is null)
  ),
  -- A record with no product is only legitimate while it is still unmatched.
  constraint count_records_product_required check (
    product_id is not null or status in ('pending_sync', 'discarded')
  )
);

comment on table public.count_records is
  'One counted line. Voice inserts only (RF-20); correction is delete-and-redo (RF-21), so quantity is never updated in place.';
comment on column public.count_records.quantity is
  'What the operator counted. The theoretical figure lives in warehouse_stock_balances and is never joined into an operator-facing read.';

create index count_records_plan_idx     on public.count_records (plan_id, counted_at desc) where not is_deleted;
create index count_records_product_idx  on public.count_records (product_id) where not is_deleted;
create index count_records_operator_idx on public.count_records (counted_by, counted_at desc);
create index count_records_capture_idx  on public.count_records (capture_id);
create index count_records_status_idx   on public.count_records (plan_id, status) where not is_deleted;

-- One live count per product per plan. A redo must soft-delete the old row
-- first, which is exactly the RF-21 flow.
create unique index count_records_one_live_per_product_idx
  on public.count_records (plan_id, product_id)
  where not is_deleted and product_id is not null;

-- ---------------------------------------------------------------------------
-- Exclusions
-- ---------------------------------------------------------------------------
-- CU-10: expired or broken goods are seen but not counted. They are not stock,
-- so they never become a count_record; they leave a note for the auditor and the
-- physical item follows the ERP write-off procedure.

create table public.count_exclusions (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.audit_plans (id) on delete cascade,
  product_id      uuid references public.products (id) on delete set null,
  raw_description text,
  reason          public.exclusion_reason not null,
  note            text,
  reported_by     uuid not null references public.profiles (id) on delete restrict,
  reported_at     timestamptz not null default now(),

  -- Something has to identify the excluded item.
  constraint count_exclusions_identified check (
    product_id is not null or nullif(btrim(coalesce(raw_description, '')), '') is not null
  )
);

create index count_exclusions_plan_idx on public.count_exclusions (plan_id, reported_at desc);
