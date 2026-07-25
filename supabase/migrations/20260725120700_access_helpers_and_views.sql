-- Access helpers, catalogue search, and the read models the two front ends use.

-- ---------------------------------------------------------------------------
-- Access helpers
-- ---------------------------------------------------------------------------
-- All SECURITY DEFINER with an empty search_path. Definer rights are not a
-- convenience here: `current_app_role()` reads public.profiles, and the policy
-- on public.profiles calls `current_app_role()`. Without definer rights that is
-- infinite recursion, which Postgres reports as a confusing depth error rather
-- than a permission one.

create function public.current_app_role()
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

create function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() in ('auditor', 'cost_lead'), false)
$$;

create function public.is_auditor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_app_role() = 'auditor', false)
$$;

-- RF-07 in one function. Staff see every plan; an operator sees a plan only
-- through an explicit assignment row.
create function public.has_plan_access(p_plan_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_staff() or exists (
    select 1
    from public.plan_operators po
    where po.plan_id = p_plan_id
      and po.profile_id = (select auth.uid())
  )
$$;

comment on function public.has_plan_access(uuid) is
  'RF-07. The single source of truth for "may this user touch this plan".';

-- Normalisation shared by the loader and by search, so a name typed in the UI
-- and a name loaded from the workbook fold the same way.
-- STABLE rather than IMMUTABLE: unaccent() depends on a text-search dictionary,
-- so it is only stable within a statement. That rules this function out of an
-- index expression, which is fine — the stored `name_normalized` column is what
-- the trigram index covers.
create function public.normalize_product_name(p_name text)
returns text
language sql
stable
set search_path = ''
as $$
  select upper(btrim(regexp_replace(extensions.unaccent(coalesce(p_name, '')), '\s+', ' ', 'g')))
$$;

-- ---------------------------------------------------------------------------
-- Catalogue search (RF-15, RF-16)
-- ---------------------------------------------------------------------------
-- The "tabla para picar blanca" → TABLA ACRILICA PICAR BLANCO 50X38CM FB case.
-- Trigram similarity over the accent-folded name, scoped to one warehouse so a
-- match can never come from a warehouse the operator is not counting.

create function public.search_warehouse_catalogue(
  p_warehouse_id uuid,
  p_query        text,
  p_limit        integer default 10,
  p_threshold    real    default 0.15
)
returns table (
  product_id uuid,
  sku        text,
  name       text,
  unit_code  text,
  similarity real
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,
    p.sku,
    p.name,
    wp.unit_code,
    extensions.similarity(p.name_normalized, public.normalize_product_name(p_query)) as similarity
  from public.warehouse_products wp
  join public.products p on p.id = wp.product_id
  where wp.warehouse_id = p_warehouse_id
    and wp.is_active
    and p.is_active
    and extensions.similarity(p.name_normalized, public.normalize_product_name(p_query)) >= p_threshold
  order by similarity desc, p.name
  limit greatest(1, least(coalesce(p_limit, 10), 50));
$$;

comment on function public.search_warehouse_catalogue(uuid, text, integer, real) is
  'RF-16 manual fallback. SECURITY INVOKER on purpose: RLS on warehouse_products still applies, so an unassigned warehouse returns nothing.';

-- ---------------------------------------------------------------------------
-- Read models
-- ---------------------------------------------------------------------------
-- Every view is security_invoker so RLS is evaluated as the caller. That is
-- what lets the same view be safe for both roles instead of needing two.

-- The tablet's catalogue. No quantity column exists anywhere in this view, so
-- RF-18 holds even if a policy is later loosened by mistake.
create view public.v_warehouse_catalogue
with (security_invoker = true) as
select
  wp.warehouse_id,
  w.code as warehouse_code,
  w.name as warehouse_name,
  p.id   as product_id,
  p.sku,
  p.name as product_name,
  p.name_normalized,
  wp.unit_code,
  u.label_es as unit_label
from public.warehouse_products wp
join public.warehouses w on w.id = wp.warehouse_id
join public.products   p on p.id = wp.product_id
join public.units      u on u.code = wp.unit_code
where wp.is_active and p.is_active and w.is_active;

comment on view public.v_warehouse_catalogue is
  'Blind-count safe catalogue (RF-18): carries no theoretical quantity by construction.';

-- Plan header for both apps: how far along, and how many alerts are open.
create view public.v_plan_progress
with (security_invoker = true) as
select
  ap.id as plan_id,
  ap.code,
  ap.name,
  ap.status,
  ap.warehouse_id,
  w.code as warehouse_code,
  w.name as warehouse_name,
  ap.expected_item_count,
  count(distinct cr.product_id) filter (where not cr.is_deleted) as counted_item_count,
  count(cr.id) filter (where not cr.is_deleted)                  as record_count,
  count(distinct ra.id) filter (where ra.status = 'open')        as open_anomaly_count,
  max(cr.counted_at)                                             as last_counted_at
from public.audit_plans ap
join public.warehouses w on w.id = ap.warehouse_id
left join public.count_records cr on cr.plan_id = ap.id
left join public.record_anomalies ra on ra.record_id = cr.id and not cr.is_deleted
group by ap.id, ap.code, ap.name, ap.status, ap.warehouse_id, w.code, w.name, ap.expected_item_count;

-- What the operator sees about their own flagged record. `system_qty` is
-- absent: the operator is told the expected band, never the theoretical figure.
create view public.v_operator_anomalies
with (security_invoker = true) as
select
  ra.id as anomaly_id,
  ra.record_id,
  cr.plan_id,
  cr.counted_by,
  ra.type,
  ra.severity,
  ra.status,
  ra.title,
  ra.detail,
  ra.expected_unit_code,
  ra.expected_min,
  ra.expected_max,
  ra.detected_at,
  p.name as product_name,
  p.sku,
  cr.quantity,
  cr.unit_code
from public.record_anomalies ra
join public.count_records cr on cr.id = ra.record_id
left join public.products p on p.id = cr.product_id
where not cr.is_deleted;

comment on view public.v_operator_anomalies is
  'Operator-facing alert payload. Omits record_anomalies.system_qty so RF-18 survives the anomaly screen.';

-- The auditor's review grid: counted next to theoretical, with the trace.
create view public.v_auditor_review
with (security_invoker = true) as
select
  cr.id as record_id,
  cr.plan_id,
  ap.code as plan_code,
  cr.warehouse_id,
  w.code  as warehouse_code,
  w.name  as warehouse_name,
  cr.product_id,
  p.sku,
  p.name  as product_name,
  cr.quantity      as counted_qty,
  cr.unit_code     as counted_unit,
  sb.theoretical_qty,
  sb.unit_code     as theoretical_unit,
  case
    when sb.theoretical_qty is null then null
    when sb.unit_code is distinct from cr.unit_code then null
    else cr.quantity - sb.theoretical_qty
  end as difference,
  cr.status,
  cr.source,
  cr.dictated_text,
  cr.counted_at,
  prof.full_name   as counted_by_name,
  prof.counter_code,
  vc.transcript,
  vc.models_total,
  vc.models_agreed,
  (select count(*) from public.record_anomalies ra
    where ra.record_id = cr.id and ra.status = 'open') as open_anomaly_count
from public.count_records cr
join public.audit_plans ap on ap.id = cr.plan_id
join public.warehouses  w  on w.id  = cr.warehouse_id
left join public.products p on p.id = cr.product_id
left join public.warehouse_stock_balances sb
       on sb.warehouse_id = cr.warehouse_id and sb.product_id = cr.product_id
left join public.profiles prof on prof.id = cr.counted_by
left join public.voice_captures vc on vc.id = cr.capture_id
where not cr.is_deleted;

comment on view public.v_auditor_review is
  'Auditor grid. Joins warehouse_stock_balances, so RLS on that table is what keeps an operator from reading it — the view itself is invoker-rights.';

-- `difference` is deliberately null when the units disagree: 900 g against a
-- 4 L balance has no meaningful arithmetic answer, and that is the RF-26(b)
-- finding, not a number to display.

-- The Oracle file, shaped but not yet frozen. Materialising it into
-- export_lines is what freezes it.
create view public.v_oracle_export_preview
with (security_invoker = true) as
select
  cr.plan_id,
  w.code                                as subinventory,
  coalesce(p.sku, p.name_normalized)    as item,
  cr.quantity                           as count_qty,
  cr.unit_code                          as uom,
  coalesce(prof.counter_code, upper(replace(prof.full_name, ' ', '.'))) as counter,
  cr.id                                 as record_id,
  cr.counted_at
from public.count_records cr
join public.warehouses w  on w.id = cr.warehouse_id
join public.products   p  on p.id = cr.product_id
left join public.profiles prof on prof.id = cr.counted_by
where not cr.is_deleted
  and cr.status in ('recorded', 'verified');
