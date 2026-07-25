-- Anomalies, the auditor's decisions, and recount requests
-- (RF-25..RF-29, RF-08, RF-09, RF-32, RNF-13).

-- ---------------------------------------------------------------------------
-- Anomalies
-- ---------------------------------------------------------------------------
-- Written by the asynchronous validator, not by the tablet: RF-25 requires the
-- check to run on an event trigger so the operator can keep recording. The
-- expected values are denormalised onto the row on purpose — the operator has
-- to be told "this is normally 20 to 40" without being granted read access to
-- product_count_ranges, which would leak theoretical stock by inference.
--
-- This table is operator-readable, so it holds nothing an operator may not see.
-- The theoretical figure captured at detection time lives next door in
-- `anomaly_evidence`, which is auditor-only. Splitting the table is what makes
-- RF-18 a grant rather than a promise about which columns a view selects.

create table public.record_anomalies (
  id                uuid primary key default gen_random_uuid(),
  record_id         uuid not null references public.count_records (id) on delete cascade,
  type              public.anomaly_type not null,
  severity          public.anomaly_severity not null default 'warning',
  status            public.anomaly_status   not null default 'open',
  title             text not null,
  detail            text,
  expected_unit_code text references public.units (code),
  expected_min      numeric(14, 4),
  expected_max      numeric(14, 4),
  detected_at       timestamptz not null default now(),
  resolved_by       uuid references public.profiles (id) on delete set null,
  resolved_at       timestamptz,
  resolution_note   text,

  constraint record_anomalies_resolution_consistent check (
    (status = 'open' and resolved_at is null)
    or (status <> 'open' and resolved_at is not null)
  )
);

comment on table public.record_anomalies is
  'One finding per failed RF-26 check. Operator-readable, so it carries no theoretical quantity. Kept for the life of the record: RNF-13 wants a persistent log, so resolution flips a status rather than deleting.';

-- Auditor-only companion. Same lifetime as the anomaly, different audience.
create table public.anomaly_evidence (
  anomaly_id        uuid primary key references public.record_anomalies (id) on delete cascade,
  system_qty        numeric(14, 4),
  system_unit_code  text references public.units (code),
  detail            jsonb not null default '{}'::jsonb,
  created_at        timestamptz not null default now()
);

comment on table public.anomaly_evidence is
  'Theoretical figures behind a finding. Auditor-only (RF-18): never joined into an operator-facing read.';

create index record_anomalies_record_idx on public.record_anomalies (record_id);
create index record_anomalies_open_idx   on public.record_anomalies (status, detected_at desc)
  where status = 'open';

-- The tablet's preventive block (RF-28) asks one question: does this operator
-- have anything open in this plan? An index that answers it directly beats a
-- scan on every microphone press.
create index record_anomalies_open_by_record_idx
  on public.record_anomalies (record_id) where status = 'open';

-- ---------------------------------------------------------------------------
-- Auditor decisions
-- ---------------------------------------------------------------------------
-- RF-32 and the mockup's promise that "every action is signed with user, time
-- and reason". Append-only: a correction records both the previous and the new
-- value, and the original count_record is never rewritten.

create table public.auditor_actions (
  id                uuid primary key default gen_random_uuid(),
  record_id         uuid not null references public.count_records (id) on delete cascade,
  anomaly_id        uuid references public.record_anomalies (id) on delete set null,
  action            public.auditor_action_kind not null,
  actor_id          uuid not null references public.profiles (id) on delete restrict,
  previous_quantity numeric(14, 4),
  new_quantity      numeric(14, 4),
  previous_unit_code text references public.units (code),
  new_unit_code      text references public.units (code),
  reason            text,
  created_at        timestamptz not null default now(),

  -- A correction that does not say what it changed is not a trail.
  constraint auditor_actions_correction_has_values check (
    action <> 'correct'
    or (new_quantity is not null or new_unit_code is not null)
  ),
  constraint auditor_actions_rejection_has_reason check (
    action not in ('reject', 'request_recount')
    or nullif(btrim(coalesce(reason, '')), '') is not null
  )
);

comment on table public.auditor_actions is
  'Append-only decision log. Nothing here is ever updated or deleted; a reversal is another row.';

create index auditor_actions_record_idx on public.auditor_actions (record_id, created_at desc);
create index auditor_actions_actor_idx  on public.auditor_actions (actor_id, created_at desc);

-- Enforce append-only at the table, not at the policy: a future service-role
-- script must not be able to quietly rewrite history either.
create function public.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'table %.% is append-only', tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

create trigger auditor_actions_append_only
  before update or delete on public.auditor_actions
  for each row execute function public.forbid_mutation();

create trigger voice_consents_append_only
  before update or delete on public.voice_consents
  for each row execute function public.forbid_mutation();

-- ---------------------------------------------------------------------------
-- Recount requests
-- ---------------------------------------------------------------------------
-- The mockup's "Pedir reconteo": one article goes back to the operator as a
-- pinpoint task, not a repeat of all 107 lines.

create table public.recount_requests (
  id            uuid primary key default gen_random_uuid(),
  record_id     uuid not null references public.count_records (id) on delete cascade,
  plan_id       uuid not null references public.audit_plans (id)   on delete cascade,
  product_id    uuid not null references public.products (id)      on delete restrict,
  status        public.recount_status not null default 'requested',
  requested_by  uuid not null references public.profiles (id) on delete restrict,
  assigned_to   uuid references public.profiles (id) on delete set null,
  note          text,
  requested_at  timestamptz not null default now(),
  resolved_at   timestamptz,
  -- The record produced by the redo, once it exists.
  resolved_by_record_id uuid references public.count_records (id) on delete set null,

  constraint recount_requests_resolution_consistent check (
    (status in ('requested', 'in_progress') and resolved_at is null)
    or (status in ('done', 'cancelled') and resolved_at is not null)
  )
);

create index recount_requests_plan_idx     on public.recount_requests (plan_id, status);
create index recount_requests_assignee_idx on public.recount_requests (assigned_to, status)
  where assigned_to is not null;
