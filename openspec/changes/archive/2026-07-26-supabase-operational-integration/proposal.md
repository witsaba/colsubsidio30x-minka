# Proposal: Supabase Operational Integration

## Intent

The live Supabase project has a full, seeded operational schema with zero application traffic: consent, count records, anomalies, auditor actions, and Oracle exports exist only as in-memory reducer state and hardcoded fixtures, lost on reload. Wire the existing `/conteo` and `/auditor` UIs to the operational tables so an audit persists end-to-end (RF-08/09/11/19/21/25-28/30-32, S1 consent).

## Scope

### In Scope

- Server-side Supabase client factory (service-role key, server-only env) + Astro API routes, mirroring the `frontend/src/pages/api/_upstream.ts` proxy pattern.
- S1 consent write → `voice_consents`.
- Plan-based selection: read `audit_plans`/`plan_operators` instead of raw warehouse/catalogue listing (fixes the RF-11 flow error flagged in PRD §6.1).
- Count record writes → `count_records`; delete-and-redo as `is_deleted` + new row (RF-20/21).
- Anomaly persistence → `record_anomalies`, validated against real `product_count_ranges`/`warehouse_stock_balances` (RF-25/26/27); operator receives only the verdict, never the theoretical balance (RF-18 blind counting).
- Auditor dashboard reads real `count_records`/`record_anomalies` (replacing 8 fixtures); approve/correct/recount + `TraceEntry` trail write to `auditor_actions` (RF-08/09/32).
- Oracle export: real `export_batches`/`export_lines` rows + downloadable file (RF-30/31).
- RLS policy re-verification against supabase / supabase-postgres-best-practices checklists (UPDATE needs SELECT + WITH CHECK, ownership predicates, no user_metadata in policies).

### Out of Scope

- Catalogue read migration (matcher SQLite → Supabase+Redis) — owned by concurrent `redis-catalogue-cache`.
- Real Supabase Auth / login UI — named technical debt (see Approach).
- RF-01/02/04/05/06 CRUD UIs (Excel upload, product creation, user management, plan creation) — no UI surface exists today; explicit follow-up change.
- RF-23/24 three-model consensus / wiring real `product_identification` — pre-existing mock gap, separate change.
- Re-seeding/migrating catalogue data (already live: 936 products, 56 warehouses).

## Capabilities

### New Capabilities

- `supabase-data-access`: server-side Supabase client + operational API routes (consent, plans, records, auditor actions).
- `anomaly-validation`: server-side count validation and `record_anomalies` persistence.
- `oracle-export`: export batch generation and file download.

### Modified Capabilities

- `operator-count-flow`: consent persisted, plan-based selection, records persisted with redo semantics.
- `auditor-dashboard`: real data reads, persisted auditor actions and audit trail.

## Approach

Hybrid access pattern (decided): Astro API routes use a server-side service-role client; key never reaches the browser. Applied RLS policies stay enabled as defense-in-depth but are NOT the enforcement layer (no real `auth.uid()` session exists) — RF-07 plan scoping is enforced in route logic. Real Supabase Auth mapped to `profiles` is recorded technical debt. Frontend-only change; strict TDD (`cd frontend && npm test`). Single PR, `size:exception` pre-accepted.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `frontend/package.json` | Modified | Add pinned `@supabase/supabase-js` |
| `frontend/src/pages/api/` | New | Operational routes + shared Supabase client module |
| `frontend/src/components/operator/CountSession.tsx`, `lib/session/*` | Modified | Persistence side-effects, plan selection |
| `frontend/src/components/auditor/AuditorReview.tsx`, `fixtures/*` | Modified | Real reads/writes; fixtures retired |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Client-bootstrap collision with `redis-catalogue-cache` (env vars, factory location) | Med | One shared client module + agreed env names; coordinate at design time |
| Service-role key exposure | Low | Server-only env (never `PUBLIC_`); routes broker all access |
| RLS inert without auth → BOLA in routes | Med | App-level plan-scoping checks + RLS audit task |
| Fixture removal breaks existing frontend tests | Med | TDD-first test rewrite before wiring |

## Rollback Plan

Revert the single PR. No schema changes are made; writes are additive rows in operational tables and can be left or truncated without affecting the seeded catalogue.

## Dependencies

- Live Supabase project credentials (URL + service-role key) available to the frontend server runtime.
- Coordination with `redis-catalogue-cache` on the shared Supabase client bootstrap.

## Success Criteria

- [ ] Consent, count records, anomalies, auditor actions, and export batches persist and survive reload.
- [ ] Operator sees only assigned plans; theoretical balance never reaches the operator UI.
- [ ] "Exportar a Oracle" downloads a real file matching `export_lines`.
- [ ] `cd frontend && npm test` green; RLS checklist audit completed and documented.
