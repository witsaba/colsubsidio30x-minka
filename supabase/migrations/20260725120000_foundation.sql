-- Foundation: extensions, enum vocabulary, and the `source` schema container.
--
-- Everything downstream depends on this file. It installs only extensions that
-- are actually used: `unaccent` + `pg_trgm` back the colloquial-name catalogue
-- search (RF-15/RF-16), `moddatetime` keeps `updated_at` honest without a
-- hand-written trigger per table.

create extension if not exists unaccent with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists moddatetime with schema extensions;

-- ---------------------------------------------------------------------------
-- Enum vocabulary
-- ---------------------------------------------------------------------------

-- Who a person is inside the tool. `cost_lead` assigns plans, `auditor` closes
-- them, `operator` counts. Anything not an operator is treated as staff.
create type public.app_role as enum ('auditor', 'cost_lead', 'operator');

-- Where a warehouse row came from. The workbook carries two disjoint registries
-- (a 48-name list sheet and 8 stock sheets) whose names do not reconcile
-- automatically, so provenance is a first-class column rather than a guess.
create type public.warehouse_source as enum ('bodegas_list', 'stock_sheet');

create type public.plan_status as enum (
  'draft', 'scheduled', 'active', 'closed', 'cancelled'
);

create type public.assignment_status as enum (
  'scheduled', 'in_progress', 'completed'
);

-- How a count record came to exist. Voice is the happy path; `manual_search` is
-- the RF-16 fallback; `auditor` covers RF-04/CU-07 corrections.
create type public.record_source as enum ('voice', 'manual_search', 'auditor');

-- `pending_sync` exists because the tablet captures offline (RNF-08).
create type public.record_status as enum (
  'pending_sync', 'recorded', 'flagged', 'verified', 'discarded'
);

-- RF-26 validation checks, one variant each.
create type public.anomaly_type as enum (
  'unit_mismatch',        -- (b) grams dictated for a litre item
  'atypical_quantity',    -- (c) outside the learned range
  'negative_balance',     -- (d) theoretical balance is or goes negative
  'not_in_warehouse',     -- (a) product absent from this warehouse catalogue
  'no_catalogue_match'    -- nothing matched; operator was routed to search
);

-- RF-27 keeps warnings and errors distinct. Anomalies are warnings.
create type public.anomaly_severity as enum ('warning', 'error');

create type public.anomaly_status as enum ('open', 'resolved', 'dismissed');

create type public.auditor_action_kind as enum (
  'approve', 'correct', 'reject', 'request_recount'
);

create type public.recount_status as enum ('requested', 'in_progress', 'done', 'cancelled');

-- CU-10: what is seen but deliberately not counted.
create type public.exclusion_reason as enum ('expired', 'broken', 'spoiled', 'other');

-- Ley 1581 de 2012 lifecycle for the voice authorisation.
create type public.consent_status as enum ('granted', 'denied', 'revoked');

create type public.export_status as enum ('draft', 'generated', 'downloaded', 'void');

-- ---------------------------------------------------------------------------
-- `source` schema: the workbook, loaded verbatim
-- ---------------------------------------------------------------------------
-- Kept out of `public` on purpose. It is never exposed through PostgREST; the
-- normalised `public` catalogue is derived from it and is what the front end
-- reads. Keeping the raw rows lets any derivation be re-run or audited without
-- going back to the .xlsx.

create schema if not exists source;

revoke all on schema source from anon, authenticated;
grant usage on schema source to service_role;

alter default privileges in schema source revoke all on tables from anon, authenticated;
