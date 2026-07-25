-- Two corrections the database linter surfaced once the schema was live.
--
-- 1. Every `for all` write policy was also a SELECT policy, so each read
--    evaluated both it and the intended read policy. Splitting them into
--    insert/update/delete leaves exactly one policy per (role, action) and
--    states the intent more precisely: these roles write, that role reads.
--
-- 2. A handful of foreign keys had no covering index. Only the ones on
--    high-cardinality columns are added — indexing `unit_code` against a
--    five-row lookup table would cost writes and buy nothing.

-- ---------------------------------------------------------------------------
-- 1. One policy per (role, action)
-- ---------------------------------------------------------------------------

drop policy units_write                 on public.units;
drop policy warehouses_write            on public.warehouses;
drop policy products_write              on public.products;
drop policy warehouse_products_write    on public.warehouse_products;
drop policy stock_balances_write        on public.warehouse_stock_balances;
drop policy count_ranges_write          on public.product_count_ranges;
drop policy profiles_write_auditor      on public.profiles;
drop policy audit_plans_write           on public.audit_plans;
drop policy plan_operators_write        on public.plan_operators;
drop policy record_anomalies_write      on public.record_anomalies;
drop policy recount_requests_write      on public.recount_requests;
drop policy recount_requests_operator_progress on public.recount_requests;

-- Catalogue: read stays open to any signed-in user, writes are the auditor's.
create policy units_insert on public.units
  for insert to authenticated with check (public.is_auditor());
create policy units_update on public.units
  for update to authenticated using (public.is_auditor()) with check (public.is_auditor());
create policy units_delete on public.units
  for delete to authenticated using (public.is_auditor());

create policy warehouses_insert on public.warehouses
  for insert to authenticated with check (public.is_auditor());
create policy warehouses_update on public.warehouses
  for update to authenticated using (public.is_auditor()) with check (public.is_auditor());
create policy warehouses_delete on public.warehouses
  for delete to authenticated using (public.is_auditor());

-- RF-04: product creation is an auditor act. There is deliberately no policy
-- that would let the voice pipeline insert here.
create policy products_insert on public.products
  for insert to authenticated with check (public.is_auditor());
create policy products_update on public.products
  for update to authenticated using (public.is_auditor()) with check (public.is_auditor());
create policy products_delete on public.products
  for delete to authenticated using (public.is_auditor());

create policy warehouse_products_insert on public.warehouse_products
  for insert to authenticated with check (public.is_auditor());
create policy warehouse_products_update on public.warehouse_products
  for update to authenticated using (public.is_auditor()) with check (public.is_auditor());
create policy warehouse_products_delete on public.warehouse_products
  for delete to authenticated using (public.is_auditor());

-- RF-18: the SELECT policy on these two stays staff-only and now stands alone.
create policy stock_balances_insert on public.warehouse_stock_balances
  for insert to authenticated with check (public.is_auditor());
create policy stock_balances_update on public.warehouse_stock_balances
  for update to authenticated using (public.is_auditor()) with check (public.is_auditor());
create policy stock_balances_delete on public.warehouse_stock_balances
  for delete to authenticated using (public.is_auditor());

create policy count_ranges_insert on public.product_count_ranges
  for insert to authenticated with check (public.is_auditor());
create policy count_ranges_update on public.product_count_ranges
  for update to authenticated using (public.is_auditor()) with check (public.is_auditor());
create policy count_ranges_delete on public.product_count_ranges
  for delete to authenticated using (public.is_auditor());

create policy profiles_insert on public.profiles
  for insert to authenticated with check (public.is_auditor());
create policy profiles_update on public.profiles
  for update to authenticated using (public.is_auditor()) with check (public.is_auditor());
create policy profiles_delete on public.profiles
  for delete to authenticated using (public.is_auditor());

create policy audit_plans_insert on public.audit_plans
  for insert to authenticated with check (public.is_staff());
create policy audit_plans_update on public.audit_plans
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy audit_plans_delete on public.audit_plans
  for delete to authenticated using (public.is_staff());

create policy plan_operators_insert on public.plan_operators
  for insert to authenticated with check (public.is_staff());
create policy plan_operators_update on public.plan_operators
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy plan_operators_delete on public.plan_operators
  for delete to authenticated using (public.is_staff());

create policy record_anomalies_insert on public.record_anomalies
  for insert to authenticated with check (public.is_staff());
create policy record_anomalies_update on public.record_anomalies
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy record_anomalies_delete on public.record_anomalies
  for delete to authenticated using (public.is_staff());

create policy recount_requests_insert on public.recount_requests
  for insert to authenticated with check (public.is_staff());

-- Merged: staff manage the request, and the operator it was assigned to may
-- move it along. Previously these were two overlapping UPDATE policies.
create policy recount_requests_update on public.recount_requests
  for update to authenticated
  using (public.is_staff() or assigned_to = (select auth.uid()))
  with check (public.is_staff() or assigned_to = (select auth.uid()));

create policy recount_requests_delete on public.recount_requests
  for delete to authenticated using (public.is_staff());

-- ---------------------------------------------------------------------------
-- 2. Covering indexes for the foreign keys that will actually be traversed
-- ---------------------------------------------------------------------------
-- Skipped on purpose: every `unit_code` FK (the referenced table has five rows,
-- so a sequential scan is cheaper than the index), and the `created_by` /
-- `closed_by` / `assigned_by` audit columns, which are read one row at a time
-- by primary key and never filtered on.

create index count_records_warehouse_idx  on public.count_records (warehouse_id);
create index stock_balances_product_idx   on public.warehouse_stock_balances (product_id);
create index count_ranges_product_idx     on public.product_count_ranges (product_id);
create index recount_requests_record_idx  on public.recount_requests (record_id);
create index count_exclusions_product_idx on public.count_exclusions (product_id)
  where product_id is not null;
create index source_bodegas_sheet_idx     on source.bodegas_disponibles (sheet_id);
