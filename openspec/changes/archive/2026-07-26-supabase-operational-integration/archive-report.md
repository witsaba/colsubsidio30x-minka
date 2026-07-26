# Archive Report: supabase-operational-integration

**Change**: supabase-operational-integration (wire the operator/auditor frontend to the live Supabase operational schema)
**Archived**: 2026-07-26
**Merge commit**: `64d826f` (main)
**PR**: #19, 34 commits, `feat/supabase-operational-integration` → `main`

## SDD Cycle Summary

explore → propose → spec → design → tasks → apply (strict TDD, 63 tasks across 6 phases) →
verify ×3 rounds (FAIL → PASS WITH WARNINGS → additional CRITICALs found and fixed by the
orchestrator directly) → PR #19 merged.

### Artifact Chain (Engram observation IDs)

| Phase | Artifact | Observation ID |
|---|---|---|
| Explore | `sdd/supabase-operational-integration/explore` | #153 |
| Proposal | `sdd/supabase-operational-integration/proposal` | #154 |
| Spec | `sdd/supabase-operational-integration/spec` | #155 |
| Design | `sdd/supabase-operational-integration/design` | #156 |
| Tasks | `sdd/supabase-operational-integration/tasks` | #157 |
| Apply progress (many upserts across 7 batches) | `sdd/supabase-operational-integration/apply-progress` | #159 |
| Verify report (3 rounds, upserted) | `sdd/supabase-operational-integration/verify-report` | #180 |
| Seed data + RLS audit decision | (config) `Demo identity + plan seeded...` | #161 |
| Ship-without-6.4 decision | (decision) | #176 |
| PR opened | (decision) | #186 |

## Origin

Started from a direct user ask to validate that the front, the PRD, and the Supabase database
were properly aligned. Investigation found a **fully-built, fully-populated Supabase schema**
(23 tables, real seed data — 936 products, 56 warehouses, 1405 balances) sitting live on project
`blvdxsoaopcvtzawvgbt`, entirely disconnected from the shipped `voice-counter-frontend`: every
operator/auditor screen ran on local reducer state or hardcoded fixtures, with zero persistence.
The schema had been built on an earlier archived branch (`feat/supabase-backend`, PR #9, closed
without merging) and never reconnected.

## Delivered

- PR #19 merged to `main` at `64d826f`, 34 commits, 85 files changed, +9,951/-450.
- Final suite: `cd frontend && npm test` → **921/921 passing**. `npm run check` → **0 type errors**.
- `npm run build` → clean, 4 static routes prerendered.
- Consent (`voice_consents`), plan-scoped selection (`audit_plans`/`plan_operators`, replacing
  raw catalogue listing per RF-11), count-record writes with idempotency and soft-delete/redo
  (`count_records`), server-side blind anomaly validation (`record_anomalies`,
  `product_count_ranges`, `warehouse_stock_balances` — RF-18 enforced by an allowlist serializer
  at the API boundary), a real auditor dashboard (system-stock comparison, persisted audit trail
  via `auditor_actions`, approve/correct/reject/recount), and real Oracle export generation
  (`export_batches`/`export_lines`).
- Demo data seeded directly against the live project: 3 identities (2 operators, 1 auditor via
  `auth.users` + `profiles`) and one active `audit_plans` row against a real warehouse
  (`STOCK_RESTAURANTE_FUENTES_AYB`), since every operational write has a hard FK to `profiles`.
- Access pattern: Hybrid (server-side Supabase client via new Astro API routes, mirroring the
  existing `stt`/`matcher` proxy pattern; RLS stays enabled as defense-in-depth; RF-07 plan-scope
  enforcement lives in route logic since there is no real auth session). Real Supabase Auth is
  named technical debt, not built here.

## Explicitly out of scope

- The matcher's catalogue read path (SQLite → Supabase + Redis) — owned by the concurrent
  `redis-catalogue-cache` change (merged separately, PR #17/#18, folded into `main` before this
  branch merged; this branch merged `origin/main` mid-flight to pick it up cleanly).
- RF-01/02/04/05/06 CRUD UIs (Excel upload, product creation, user/plan management) — no existing
  UI surface for these.
- Module 2 three-model consensus wiring — pre-existing, unrelated gap (`product_identification`
  is dual-model and not wired into the frontend at all).

## Task completion: 62 of 63 (98.4%)

Task **6.4** (live HTTP walkthrough against the seeded demo plan, with database verification via
`execute_sql`) is deliberately descoped, not silently dropped — full rationale recorded in the
archived `tasks.md`. It needs `SUPABASE_SERVICE_ROLE_KEY`, which is not retrievable via the
Supabase MCP tools (deliberately publishable-key-only) and was not present anywhere in this
session's context, including a full team-call transcript checked explicitly for it.

**Post-deploy action required**: set `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` in the root
`.env`, then run the 6.4 walkthrough once against the seeded demo plan (ids in the archived
`design.md`'s appendix) — including a **negative control** (dictate a quantity deliberately
outside `product_count_ranges` and confirm an anomaly actually fires and a `record_anomalies`
row lands). The negative control matters specifically because of the bug class below: schema
mismatches on read paths fail silently, not loudly, so a walkthrough that only exercises the
happy path cannot distinguish "correctly clean" from "silently blind."

## Six live-schema defects found and fixed after the original apply pass

The single most important thing to carry forward from this change: **three independent
`sdd-verify` rounds, plus the orchestrator's own direct schema audits, found six real,
live-blocking bugs that the automated test suite could not catch**, because its stub database
double originally ignored the exact column names a query selected — a test fixture could invent
any column name and stay green forever. Fixed along the way (`stub-db.ts` now records and can
assert against the real `.select()` column list, closing that blind spot for future work):

1. `COUNT_STATUS.ok = 'confirmed'` — not a member of the live `record_status` enum
   (`pending_sync | recorded | flagged | verified | discarded`). Every successful count write
   would have 500'd in production.
2. `frontend/src/lib/server/authz.ts` selected `audit_plans.catalogue_id` — that column does not
   exist live. PostgREST errors the whole query on an unknown column; the error was discarded, so
   every plan lookup would fail, refusing 100% of operator writes and reads.
3. `frontend/src/pages/api/plans.ts` (`GET /api/plans`, the actual route the operator hits right
   after consent) had the **identical** bug, independently — would have broken the front door of
   the whole feature even with (2) fixed.
4. `frontend/src/lib/server/validation.ts` selected `product_count_ranges.expected_unit_code` —
   the real column is `unit_code`. Would have silently disabled 2 of 3 anomaly-detection types
   (`atypical_quantity`, `unit_mismatch`) in production; only `negative_balance` would ever fire.
5. Auditor approval had **no writer at all** — approving a flagged record never resolved its
   `record_anomalies` row nor updated `count_records.status`, so `POST /api/export`'s eligibility
   check would permanently and silently drop it from every future export, with no error anywhere.
6. `auditor_actions`/`recount_requests` inserts used wrong column names
   (`auditor_id`/`note` vs. the real `actor_id`/`reason`, and the reverse mistake on
   `recount_requests`), and the latter was also missing two NOT NULL columns entirely.

All six were fixed under strict TDD (RED confirmed failing for the stated reason before every
GREEN), with column names verified directly against the live project via Supabase MCP
(`list_tables(verbose)`, `execute_sql`, `get_advisors`) rather than assumed from documentation.

## RLS audit (task 6.1)

No genuine gaps found against the checklist from prior learnings (obs #129): every UPDATE policy
carries both `qual` and `with_check`; every `authenticated` policy pairs with a real predicate;
no harmful `FOR ALL`/SELECT double-evaluation; helper functions (`private.is_staff()` etc.) have
no `PUBLIC` grant and live in a non-exposed schema; all 6 public views use `security_invoker`.
The pre-existing hardening from the archived `feat/supabase-backend` security pass holds up.
RLS remains correctly configured as defense-in-depth for whenever real auth lands.

## Merge coordination with redis-catalogue-cache

This branch merged `origin/main` mid-development to pick up the concurrently-shipped
`redis-catalogue-cache` change, which included a breaking catalogue-id vocabulary change
(lowercase SQLite table names → uppercase `warehouses.code`). Two real test conflicts were
resolved (preferring this branch's superseding plan-based test suite over the pre-plan
raw-catalogue-listing tests `main` still carried), and every catalogue-id literal this branch
owned was updated to the new vocabulary. `services/` was untouched throughout this change.

## Learnings that survive future work in this codebase

- **Never trust a stub double that doesn't validate column names.** The single largest source of
  escaped defects in this change was exactly that gap — now closed in `stub-db.ts`, but worth
  remembering as a pattern when writing new server-side test infrastructure.
- **`list_tables()` only enumerates tables, not views.** An earlier pass in this same change
  wrongly reported `v_oracle_export_preview` absent for this reason; a direct `pg_get_viewdef`
  query found it and exposed a real fallback-logic bug in the export route as a bonus.
- **PostgREST errors the whole query on an unknown column in a `.select()` list**, and discarding
  the error (`const { data } = await db...`) turns that into a silent `null`/`[]` rather than a
  loud failure — the exact shape every one of the six defects above took.
- Demo/test identities for a schema with `profiles.id` FK'd to `auth.users.id` need a real
  `auth.users` row first — the documented Supabase seed pattern (`id, email, raw_user_meta_data`
  only, no password, not login-capable) is sufficient and does not require the full admin API.
