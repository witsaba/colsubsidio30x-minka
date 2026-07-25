-- Security hardening. Four defects, found by probing the live schema as an
-- attacker rather than by reading it.
--
-- 1. PRIVILEGE ESCALATION (critical). `handle_new_user` read the application
--    role out of `raw_user_meta_data`. That column is written verbatim by
--    `supabase.auth.signUp({ options: { data } })` — it is client input. Anyone
--    who could sign up could pass {"role":"auditor"} and read every theoretical
--    balance, defeating RF-18 outright. Confirmed exploitable before this fix.
--
-- 2. Deactivating a profile did not revoke plan access: `has_plan_access` never
--    consulted `is_active`, so a disabled operator kept counting.
--
-- 3. An operator could insert a record with `status = 'verified'`, which put it
--    directly into `v_oracle_export_preview` — self-approval that skipped the
--    auditor entirely. They could also write into an already-closed plan.
--
-- 4. `count_records.warehouse_id` was not tied to the plan's warehouse, and
--    `product_id` was not tied to that warehouse's catalogue. An operator could
--    file a count against a warehouse they cannot even read.
--
-- Plus: the SECURITY DEFINER helpers are moved out of the exposed API schema.
-- The earlier note calling that unavoidable was wrong — the linter's own
-- remediation lists it, and it is the right fix.

-- ---------------------------------------------------------------------------
-- A private schema for the access helpers
-- ---------------------------------------------------------------------------
-- PostgREST only exposes the schemas it is configured with (`public`,
-- `graphql_public`). Moving these here removes the /rest/v1/rpc/... endpoints
-- while leaving them fully usable inside RLS policies.
--
-- `alter function ... set schema` preserves the function OID, and policies
-- reference functions by OID, so every existing policy follows automatically.

create schema if not exists private;

revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

alter function public.current_app_role()          set schema private;
alter function public.is_staff()                  set schema private;
alter function public.is_auditor()                set schema private;
alter function public.has_plan_access(uuid)       set schema private;
alter function public.handle_new_user()           set schema private;
alter function public.guard_count_record_update() set schema private;
alter function public.forbid_mutation()           set schema private;

-- The bodies name their callees fully (search_path is pinned to ''), so each
-- one has to be rewritten now that its callees live in `private`.

-- FIX 2: an inactive profile resolves to no role, and therefore to no access.
create or replace function private.current_app_role()
returns public.app_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid()) and p.is_active
$$;

create or replace function private.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() in ('auditor', 'cost_lead'), false)
$$;

create or replace function private.is_auditor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(private.current_app_role() = 'auditor', false)
$$;

-- FIX 2 continued: the assignment alone is no longer enough — the profile
-- behind it must still be active.
create or replace function private.has_plan_access(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select private.is_staff() or exists (
    select 1
    from public.plan_operators po
    join public.profiles pr on pr.id = po.profile_id
    where po.plan_id = p_plan_id
      and po.profile_id = (select auth.uid())
      and pr.is_active
  )
$$;

-- FIX 1: the role is no longer taken from client-controlled metadata. Every
-- new account is an operator; promotion is an explicit auditor action against
-- `profiles`, which has its own policy.
create or replace function private.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, full_name, role)
  values (
    new.id,
    coalesce(nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
             split_part(new.email, '@', 1)),
    'operator'   -- never read from raw_user_meta_data: that is client input
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function private.forbid_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'table %.% is append-only', tg_table_schema, tg_table_name
    using errcode = 'restrict_violation';
end;
$$;

-- FIX 3 continued: status is now part of what an operator may not change. The
-- only transitions left to them are the offline-sync one and discarding.
create or replace function private.guard_count_record_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if private.is_staff() then
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

  if new.status is distinct from old.status
     and new.status not in ('pending_sync', 'recorded', 'discarded')
  then
    raise exception 'only an auditor may set a record to %', new.status
      using errcode = 'restrict_violation';
  end if;

  if old.is_deleted and not new.is_deleted then
    raise exception 'a deleted record cannot be restored'
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

revoke all on function private.handle_new_user()           from public, anon, authenticated;
revoke all on function private.guard_count_record_update() from public, anon, authenticated;
revoke all on function private.forbid_mutation()           from public, anon, authenticated;

revoke all on function private.current_app_role()    from public, anon;
revoke all on function private.is_staff()            from public, anon;
revoke all on function private.is_auditor()          from public, anon;
revoke all on function private.has_plan_access(uuid) from public, anon;

grant execute on function private.current_app_role()    to authenticated;
grant execute on function private.is_staff()            to authenticated;
grant execute on function private.is_auditor()          to authenticated;
grant execute on function private.has_plan_access(uuid) to authenticated;

alter default privileges in schema private revoke execute on functions from public, anon;

-- ---------------------------------------------------------------------------
-- FIX 4: a count must belong to its plan's warehouse and that warehouse's
-- catalogue. Composite foreign keys, so this holds for the service role too —
-- not just for whoever the policy happens to be evaluating.
-- ---------------------------------------------------------------------------

alter table public.audit_plans
  add constraint audit_plans_id_warehouse_key unique (id, warehouse_id);

alter table public.count_records
  add constraint count_records_plan_warehouse_fkey
  foreign key (plan_id, warehouse_id)
  references public.audit_plans (id, warehouse_id) on delete cascade;

-- MATCH SIMPLE (the default): with `product_id` null the constraint does not
-- fire, which is what an unmatched `pending_sync` row needs.
alter table public.count_records
  add constraint count_records_warehouse_product_fkey
  foreign key (warehouse_id, product_id)
  references public.warehouse_products (warehouse_id, product_id) on delete restrict;

-- Same coherence for a recount request and the record it points at.
alter table public.count_records
  add constraint count_records_id_plan_key unique (id, plan_id);

alter table public.recount_requests
  add constraint recount_requests_record_plan_fkey
  foreign key (record_id, plan_id)
  references public.count_records (id, plan_id) on delete cascade;

-- ---------------------------------------------------------------------------
-- FIX 3: no self-verification, and no writing into a closed plan
-- ---------------------------------------------------------------------------

drop policy count_records_insert on public.count_records;

create policy count_records_insert on public.count_records
  for insert to authenticated
  with check (
    counted_by = (select auth.uid())
    and private.has_plan_access(plan_id)
    and (
      private.is_staff()
      or (
        -- An operator files a count; only an auditor blesses one.
        status in ('pending_sync', 'recorded')
        and exists (
          select 1 from public.audit_plans ap
          where ap.id = plan_id and ap.status in ('scheduled', 'active')
        )
      )
    )
  );

drop policy voice_captures_insert on public.voice_captures;

create policy voice_captures_insert on public.voice_captures
  for insert to authenticated
  with check (
    profile_id = (select auth.uid())
    and private.has_plan_access(plan_id)
    and (
      private.is_staff()
      or exists (
        select 1 from public.audit_plans ap
        where ap.id = plan_id and ap.status in ('scheduled', 'active')
      )
    )
  );

drop policy count_exclusions_insert on public.count_exclusions;

create policy count_exclusions_insert on public.count_exclusions
  for insert to authenticated
  with check (
    reported_by = (select auth.uid())
    and private.has_plan_access(plan_id)
    and (
      private.is_staff()
      or exists (
        select 1 from public.audit_plans ap
        where ap.id = plan_id and ap.status in ('scheduled', 'active')
      )
    )
  );
