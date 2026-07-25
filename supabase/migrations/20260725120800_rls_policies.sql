-- Row Level Security.
--
-- Two invariants drive every policy here:
--   RF-07  an operator reaches a plan only through an assignment row;
--   RF-18  an operator has no path, direct or joined, to a theoretical quantity.
--
-- The tool has no anonymous surface at all, so `anon` is revoked outright
-- rather than merely policied away.

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere in public
-- ---------------------------------------------------------------------------

alter table public.units                    enable row level security;
alter table public.warehouses               enable row level security;
alter table public.products                 enable row level security;
alter table public.warehouse_products       enable row level security;
alter table public.warehouse_stock_balances enable row level security;
alter table public.product_count_ranges     enable row level security;
alter table public.profiles                 enable row level security;
alter table public.voice_consents           enable row level security;
alter table public.audit_plans              enable row level security;
alter table public.plan_operators           enable row level security;
alter table public.voice_captures           enable row level security;
alter table public.count_records            enable row level security;
alter table public.count_exclusions         enable row level security;
alter table public.record_anomalies         enable row level security;
alter table public.anomaly_evidence         enable row level security;
alter table public.auditor_actions          enable row level security;
alter table public.recount_requests         enable row level security;
alter table public.export_batches           enable row level security;
alter table public.export_lines             enable row level security;

revoke all on all tables    in schema public from anon;
revoke all on all functions in schema public from anon;

-- And keep it revoked for whatever the next migration adds.
alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on functions from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ---------------------------------------------------------------------------
-- Reference data: readable by any signed-in user, written by auditors
-- ---------------------------------------------------------------------------

create policy units_read on public.units
  for select to authenticated using (true);
create policy units_write on public.units
  for all to authenticated using (public.is_auditor()) with check (public.is_auditor());

create policy warehouses_read on public.warehouses
  for select to authenticated using (true);
create policy warehouses_write on public.warehouses
  for all to authenticated using (public.is_auditor()) with check (public.is_auditor());

-- RF-04: only a human auditor creates products. There is no policy that lets
-- any other role insert here, which is the enforcement point for "the AI never
-- creates products" — the pipeline runs as an operator or as the service role,
-- and the service role is explicitly out of the anomaly-creation path for this
-- table by convention documented in supabase/README.md.
create policy products_read on public.products
  for select to authenticated using (true);
create policy products_write on public.products
  for all to authenticated using (public.is_auditor()) with check (public.is_auditor());

-- ---------------------------------------------------------------------------
-- Per-warehouse catalogue: scoped to what the user is actually counting
-- ---------------------------------------------------------------------------

create policy warehouse_products_read on public.warehouse_products
  for select to authenticated
  using (
    public.is_staff()
    or exists (
      select 1
      from public.plan_operators po
      join public.audit_plans ap on ap.id = po.plan_id
      where po.profile_id = (select auth.uid())
        and ap.warehouse_id = warehouse_products.warehouse_id
    )
  );

create policy warehouse_products_write on public.warehouse_products
  for all to authenticated using (public.is_auditor()) with check (public.is_auditor());

-- RF-18 lives here. No operator-facing policy exists, and none should be added.
create policy stock_balances_staff_only on public.warehouse_stock_balances
  for select to authenticated using (public.is_staff());
create policy stock_balances_write on public.warehouse_stock_balances
  for all to authenticated using (public.is_auditor()) with check (public.is_auditor());

create policy count_ranges_staff_only on public.product_count_ranges
  for select to authenticated using (public.is_staff());
create policy count_ranges_write on public.product_count_ranges
  for all to authenticated using (public.is_auditor()) with check (public.is_auditor());

-- ---------------------------------------------------------------------------
-- Identity
-- ---------------------------------------------------------------------------

create policy profiles_read_self_or_staff on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_staff());

-- Deliberately not "update own": role is a column on this table, so a
-- self-update policy would be a self-promotion policy. RF-05 makes user
-- management an auditor responsibility.
create policy profiles_write_auditor on public.profiles
  for all to authenticated using (public.is_auditor()) with check (public.is_auditor());

create policy voice_consents_read on public.voice_consents
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_staff());

-- Consent is given by the person it concerns and nobody else.
create policy voice_consents_insert_self on public.voice_consents
  for insert to authenticated
  with check (profile_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Plans
-- ---------------------------------------------------------------------------

create policy audit_plans_read on public.audit_plans
  for select to authenticated using (public.has_plan_access(id));

create policy audit_plans_write on public.audit_plans
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy plan_operators_read on public.plan_operators
  for select to authenticated
  using (profile_id = (select auth.uid()) or public.is_staff());

create policy plan_operators_write on public.plan_operators
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- ---------------------------------------------------------------------------
-- Capture and counting
-- ---------------------------------------------------------------------------

create policy voice_captures_read on public.voice_captures
  for select to authenticated
  using (public.is_staff() or (profile_id = (select auth.uid()) and public.has_plan_access(plan_id)));

create policy voice_captures_insert on public.voice_captures
  for insert to authenticated
  with check (profile_id = (select auth.uid()) and public.has_plan_access(plan_id));

-- The whole plan's records, not just the caller's: the tablet shows "registros
-- de esta bodega" and two operators can share a warehouse.
create policy count_records_read on public.count_records
  for select to authenticated using (public.has_plan_access(plan_id));

create policy count_records_insert on public.count_records
  for insert to authenticated
  with check (counted_by = (select auth.uid()) and public.has_plan_access(plan_id));

-- An operator may touch only their own row, and the trigger below narrows that
-- further to the soft-delete columns (RF-20, RF-21).
create policy count_records_update on public.count_records
  for update to authenticated
  using (public.is_staff() or (counted_by = (select auth.uid()) and public.has_plan_access(plan_id)))
  with check (public.is_staff() or (counted_by = (select auth.uid()) and public.has_plan_access(plan_id)));

-- No DELETE policy anywhere: a count is retired by `is_deleted`, never removed.

create policy count_exclusions_read on public.count_exclusions
  for select to authenticated using (public.has_plan_access(plan_id));

create policy count_exclusions_insert on public.count_exclusions
  for insert to authenticated
  with check (reported_by = (select auth.uid()) and public.has_plan_access(plan_id));

-- ---------------------------------------------------------------------------
-- Findings and decisions
-- ---------------------------------------------------------------------------

create policy record_anomalies_read on public.record_anomalies
  for select to authenticated
  using (
    exists (
      select 1 from public.count_records cr
      where cr.id = record_anomalies.record_id and public.has_plan_access(cr.plan_id)
    )
  );

create policy record_anomalies_write on public.record_anomalies
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- No operator-facing policy. This is the RF-18 sibling of stock_balances.
create policy anomaly_evidence_staff_only on public.anomaly_evidence
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

-- Operators can see what was decided about their own counts (RF-09 in-office
-- flow), but only an auditor writes a decision.
create policy auditor_actions_read on public.auditor_actions
  for select to authenticated
  using (
    exists (
      select 1 from public.count_records cr
      where cr.id = auditor_actions.record_id and public.has_plan_access(cr.plan_id)
    )
  );

create policy auditor_actions_insert on public.auditor_actions
  for insert to authenticated
  with check (public.is_auditor() and actor_id = (select auth.uid()));

create policy recount_requests_read on public.recount_requests
  for select to authenticated
  using (public.is_staff() or assigned_to = (select auth.uid()) or public.has_plan_access(plan_id));

create policy recount_requests_write on public.recount_requests
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

create policy recount_requests_operator_progress on public.recount_requests
  for update to authenticated
  using (assigned_to = (select auth.uid()))
  with check (assigned_to = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Export: auditors only, at every verb
-- ---------------------------------------------------------------------------

create policy export_batches_auditor on public.export_batches
  for all to authenticated using (public.is_auditor()) with check (public.is_auditor());

create policy export_lines_read on public.export_lines
  for select to authenticated using (public.is_auditor());
create policy export_lines_insert on public.export_lines
  for insert to authenticated with check (public.is_auditor());

-- ---------------------------------------------------------------------------
-- RF-20 / RF-21 enforcement
-- ---------------------------------------------------------------------------
-- The UPDATE policy establishes *whose* row it is. This trigger establishes
-- *what* may change: for a non-staff caller, only the soft-delete columns. It
-- is what makes "voice never edits" true even against a hand-rolled client.

create function public.guard_count_record_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if public.is_staff() then
    return new;
  end if;

  if new.quantity      is distinct from old.quantity
     or new.unit_code  is distinct from old.unit_code
     or new.product_id is distinct from old.product_id
     or new.plan_id    is distinct from old.plan_id
     or new.counted_by is distinct from old.counted_by
     or new.source     is distinct from old.source
  then
    raise exception 'a counted record cannot be edited; delete it and dictate again'
      using errcode = 'restrict_violation';
  end if;

  -- Un-deleting would resurrect a record the operator already retired.
  if old.is_deleted and not new.is_deleted then
    raise exception 'a deleted record cannot be restored'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger count_records_guard_update
  before update on public.count_records
  for each row execute function public.guard_count_record_update();
