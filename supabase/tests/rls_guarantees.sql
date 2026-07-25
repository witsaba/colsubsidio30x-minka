-- Runnable proof of the access guarantees.
--
-- Every check below corresponds to a defect that was actually present during
-- development and was found by probing, not by reading the schema. Run this
-- after any change to policies, roles, or the helper functions:
--
--   psql "$DATABASE_URL" -f supabase/tests/rls_guarantees.sql
--
-- It runs inside a transaction that is rolled back, so it is safe against a
-- loaded database and leaves nothing behind. It raises on the first failure;
-- the closing 'ALL RLS GUARANTEES HOLD' notice means everything passed.
--
-- Requires a seeded database: warehouses 'ZOOLOGICO' and 'ALMACEN_GENERAL'.

begin;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------

insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
                        email_confirmed_at, created_at, updated_at,
                        raw_app_meta_data, raw_user_meta_data)
values
  -- Note the metadata: this account *claims* to be an auditor at signup.
  ('00000000-0000-0000-0000-000000000000', '99999999-9999-9999-9999-999999999999',
   'authenticated', 'authenticated', 'attacker@test.invalid', 'x', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Attacker","role":"auditor"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'operator@test.invalid', 'x', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Test Operator"}'::jsonb),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'auditor@test.invalid', 'x', now(), now(), now(),
   '{}'::jsonb, '{"full_name":"Test Auditor"}'::jsonb);

update public.profiles set role = 'auditor'
where id = '22222222-2222-2222-2222-222222222222';

insert into public.audit_plans (id, code, name, warehouse_id, period_start, period_end, status)
select '33333333-3333-3333-3333-333333333333', 'RLS-TEST', 'RLS test plan',
       id, current_date, current_date, 'active'
from public.warehouses where code = 'ZOOLOGICO';

insert into public.plan_operators (plan_id, profile_id)
values ('33333333-3333-3333-3333-333333333333', '11111111-1111-1111-1111-111111111111');

create temporary table fixture on commit drop as
select (select id from public.warehouses where code = 'ZOOLOGICO')       as own_wh,
       (select id from public.warehouses where code = 'ALMACEN_GENERAL') as foreign_wh,
       (select product_id from public.warehouse_products
        where warehouse_id = (select id from public.warehouses where code = 'ZOOLOGICO')
        limit 1) as own_product,
       (select count(*) from public.warehouse_products) as total_catalogue;
grant select on fixture to authenticated;

-- ---------------------------------------------------------------------------
-- 1. Signup metadata must not confer a role
-- ---------------------------------------------------------------------------
set local role authenticated;
set local request.jwt.claims = '{"sub":"99999999-9999-9999-9999-999999999999","role":"authenticated"}';

do $$
begin
  if private.current_app_role()::text is distinct from 'operator' then
    raise exception 'FAIL: signup metadata granted role %', private.current_app_role();
  end if;
  if (select count(*) from public.warehouse_stock_balances) <> 0 then
    raise exception 'FAIL: self-declared auditor read theoretical stock';
  end if;
  raise notice 'pass 1: signup metadata cannot grant a role';
end $$;

-- ---------------------------------------------------------------------------
-- 2. RF-18 blind counting, and 3. RF-07 plan scope
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
declare n_cat bigint; n_total bigint;
begin
  if (select count(*) from public.warehouse_stock_balances) <> 0 then
    raise exception 'FAIL: operator read warehouse_stock_balances';
  end if;
  if (select count(*) from public.product_count_ranges) <> 0 then
    raise exception 'FAIL: operator read product_count_ranges';
  end if;
  if (select count(*) from public.anomaly_evidence) <> 0 then
    raise exception 'FAIL: operator read anomaly_evidence';
  end if;
  raise notice 'pass 2: RF-18 blind counting holds';

  if (select count(*) from public.audit_plans) <> 1 then
    raise exception 'FAIL: operator does not see exactly their own plan';
  end if;
  select count(*) into n_cat from public.warehouse_products;
  select total_catalogue into n_total from fixture;
  if n_cat = 0 or n_cat >= n_total then
    raise exception 'FAIL: operator catalogue not scoped (% of %)', n_cat, n_total;
  end if;
  raise notice 'pass 3: RF-07 plan scope holds (% of % catalogue rows)', n_cat, n_total;
end $$;

-- ---------------------------------------------------------------------------
-- 4. No self-approval, no warehouse spoofing
-- ---------------------------------------------------------------------------
do $$
begin
  begin
    insert into public.count_records (plan_id, warehouse_id, product_id, quantity,
                                      unit_code, source, status, counted_by)
    select '33333333-3333-3333-3333-333333333333', f.own_wh, f.own_product, 5, 'UND',
           'voice', 'verified', '11111111-1111-1111-1111-111111111111'
    from fixture f;
    raise exception 'FAIL: operator self-verified a record';
  exception when insufficient_privilege or check_violation then null;
  end;

  begin
    insert into public.count_records (plan_id, warehouse_id, product_id, quantity,
                                      unit_code, source, status, counted_by)
    select '33333333-3333-3333-3333-333333333333', f.foreign_wh, f.own_product, 5, 'UND',
           'voice', 'recorded', '11111111-1111-1111-1111-111111111111'
    from fixture f;
    raise exception 'FAIL: operator filed against a foreign warehouse';
  exception when foreign_key_violation or insufficient_privilege then null;
  end;

  raise notice 'pass 4: self-approval and warehouse spoofing blocked';
end $$;

-- ---------------------------------------------------------------------------
-- 5. RF-20 / RF-21 — voice creates only; correction is delete-and-redo
-- ---------------------------------------------------------------------------
do $$
begin
  insert into public.count_records (id, plan_id, warehouse_id, product_id, quantity,
                                    unit_code, source, status, counted_by)
  select '44444444-4444-4444-4444-444444444444',
         '33333333-3333-3333-3333-333333333333', f.own_wh, f.own_product, 12, 'UND',
         'voice', 'recorded', '11111111-1111-1111-1111-111111111111'
  from fixture f;

  begin
    update public.count_records set quantity = 99
    where id = '44444444-4444-4444-4444-444444444444';
    raise exception 'FAIL: operator edited a quantity';
  exception when restrict_violation then null;
  end;

  begin
    update public.count_records set status = 'verified'
    where id = '44444444-4444-4444-4444-444444444444';
    raise exception 'FAIL: operator promoted a record to verified';
  exception when restrict_violation then null;
  end;

  update public.count_records
  set is_deleted = true, deleted_at = now(),
      deleted_by = '11111111-1111-1111-1111-111111111111'
  where id = '44444444-4444-4444-4444-444444444444';

  if not (select is_deleted from public.count_records
          where id = '44444444-4444-4444-4444-444444444444') then
    raise exception 'FAIL: delete-and-redo soft delete did not apply';
  end if;

  raise notice 'pass 5: RF-20/21 voice creates only';
end $$;

-- ---------------------------------------------------------------------------
-- 6. Deactivating a profile revokes access
-- ---------------------------------------------------------------------------
reset role;
update public.profiles set is_active = false
where id = '11111111-1111-1111-1111-111111111111';

set local role authenticated;
set local request.jwt.claims = '{"sub":"11111111-1111-1111-1111-111111111111","role":"authenticated"}';

do $$
begin
  if private.has_plan_access('33333333-3333-3333-3333-333333333333') then
    raise exception 'FAIL: deactivated operator retained plan access';
  end if;
  if (select count(*) from public.audit_plans) <> 0 then
    raise exception 'FAIL: deactivated operator still sees plans';
  end if;
  raise notice 'pass 6: deactivation revokes access';
end $$;

-- ---------------------------------------------------------------------------
-- 7. The auditor can still do their job
-- ---------------------------------------------------------------------------
set local request.jwt.claims = '{"sub":"22222222-2222-2222-2222-222222222222","role":"authenticated"}';

do $$
begin
  if not private.is_auditor() then
    raise exception 'FAIL: auditor role not recognised';
  end if;
  if (select count(*) from public.warehouse_stock_balances) = 0 then
    raise exception 'FAIL: auditor cannot read theoretical stock';
  end if;
  if (select count(*) from public.product_count_ranges) = 0 then
    raise exception 'FAIL: auditor cannot read count ranges';
  end if;
  raise notice 'pass 7: auditor retains full visibility';
end $$;

-- ---------------------------------------------------------------------------
-- 8. The append-only ledger really is, at both layers
-- ---------------------------------------------------------------------------
-- Two independent defences, and they fail differently. For `authenticated`
-- there is no UPDATE or DELETE policy, so RLS makes the statement match zero
-- rows — it does NOT raise, and asserting on an exception here would be a test
-- that passes for the wrong reason. The trigger is what stops a privileged
-- caller, and that one does raise. Both are checked.
do $$
declare affected bigint;
begin
  insert into public.auditor_actions (record_id, action, actor_id, new_quantity, reason)
  values ('44444444-4444-4444-4444-444444444444', 'correct',
          '22222222-2222-2222-2222-222222222222', 4, 'test');

  update public.auditor_actions set reason = 'rewritten'
  where record_id = '44444444-4444-4444-4444-444444444444';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: RLS let an auditor rewrite % trail rows', affected;
  end if;

  delete from public.auditor_actions
  where record_id = '44444444-4444-4444-4444-444444444444';
  get diagnostics affected = row_count;
  if affected <> 0 then
    raise exception 'FAIL: RLS let an auditor delete % trail rows', affected;
  end if;

  raise notice 'pass 8a: RLS gives the trail no UPDATE or DELETE path';
end $$;

reset role;

-- Now as the table owner, where RLS does not apply and only the trigger stands.
do $$
begin
  begin
    update public.auditor_actions set reason = 'rewritten'
    where record_id = '44444444-4444-4444-4444-444444444444';
    raise exception 'FAIL: auditor_actions was mutable by a privileged caller';
  exception when restrict_violation then null;
  end;

  begin
    delete from public.auditor_actions
    where record_id = '44444444-4444-4444-4444-444444444444';
    raise exception 'FAIL: auditor_actions was deletable by a privileged caller';
  exception when restrict_violation then null;
  end;

  raise notice 'pass 8b: the append-only trigger holds even for the owner';
end $$;
do $$ begin raise notice 'ALL RLS GUARANTEES HOLD'; end $$;

rollback;
