# Tasks: Supabase Operational Integration

Test command for every RED/GREEN pair: `cd frontend && npm test`.
Strict TDD: the RED task must fail for the stated reason before its GREEN task.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 2,600–3,400 (≈14 new source files, ≈12 new test files, 10 modified) |
| 400-line budget risk | High |
| Chained PRs recommended | No (pre-waived by maintainer) |
| Suggested split | Single PR; work units below are review-reading order, not separate PRs |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

Note: absent the pre-accepted `size:exception`, this would split into 4 chained PRs (units 1–4 below).

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | Client + Db seam + seed data | PR 1 | `cd frontend && npm test -- tests/server` | MCP `execute_sql` seed verify + `GET /api/plans` | `pages/api/_supabase.ts`, `lib/server/db.ts`, seed rows |
| 2 | Consent + plans + records write/delete | PR 2 | `cd frontend && npm test -- tests/api-routes tests/session` | Operator flow S1→count→delete in browser | `api/consent.ts`, `api/plans.ts`, `api/records/*`, reducer events |
| 3 | Anomaly validation (RF-18 blind payload) | PR 3 | `cd frontend && npm test -- tests/server/validation tests/anomaly` | Dictate out-of-range qty, inspect network payload | `api/anomaly-check.ts`, `lib/server/validation.ts`, `httpAnomalyEngine` |
| 4 | Auditor reads/writes + Oracle export + RLS audit | PR 4 | `cd frontend && npm test -- tests/components/auditor tests/server/export` | Auditor approve → export CSV download | `api/auditor/*`, `api/export.ts`, `lib/server/export.ts` |

## Phase 1: Foundation (D1, D9, D10)

- [x] 1.1 Re-verify live schema via MCP `list_tables(verbose)` for the 11 tables in the task brief; confirm whether `v_oracle_export_preview` exists. Record deltas; stop and report if any column named in Phase 3–5 is missing. **DONE (orchestrator, 2026-07-25)**: no deltas, all columns present; `v_oracle_export_preview` confirmed absent — see design.md Open Questions.
- [x] 1.2 RED `frontend/tests/server/supabase-client.test.ts`: `supabase()` throws when `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` are absent, and no `PUBLIC_`-prefixed env name is read.
- [x] 1.3 GREEN pin `@supabase/supabase-js` in `frontend/package.json` (exact version, lockfile committed); create `frontend/src/pages/api/_supabase.ts` with lazy per-process singleton reading `process.env` (mirror `_upstream.ts`).
- [x] 1.4 Seed identities (blocks every FK-bearing write): `profiles.id` FKs `auth.users.id`, so create 3 demo users (2 operator, 1 auditor) via Supabase admin API / `auth.admin.createUser`, then insert matching `profiles` rows (`role`, `counter_code`, `is_active`) with those uuids via MCP `execute_sql`. Do not insert `profiles` alone — the FK will reject it. **DONE (orchestrator, 2026-07-25)**: 3 `auth.users` + `profiles` rows created via MCP `execute_sql` (GoTrue seed pattern). UUIDs in design.md appendix.
- [x] 1.5 Seed one `audit_plans` row (`status='active'`, real `warehouse_id`) plus `plan_operators` rows linking it to the two demo operator profiles. Additive SQL via MCP, not a migration. Record uuids in `openspec/changes/supabase-operational-integration/design.md` appendix. **DONE (orchestrator, 2026-07-25)**: `PLAN-DEMO-001` against `STOCK_RESTAURANTE_FUENTES_AYB` (344 products), 2 `plan_operators` rows. UUIDs in design.md appendix.
- [x] 1.6 RED `frontend/tests/server/db.test.ts`: a stub `Db` satisfies the interface used by routes (`from().select/insert/update/eq/single`).
- [x] 1.7 GREEN `frontend/src/lib/server/db.ts` — `Db` interface + `supabaseDb()` adapter over the D1 client.
- [x] 1.8 GREEN export `request<T>` from `frontend/src/lib/api/client.ts` (no behavior change; existing `tests/api/client.test.ts` must stay green).

## Phase 2: Consent and plan scoping (REQ-SDA-2, REQ-SDA-3, REQ-SDA-5, D2)

- [x] 2.1 RED `frontend/tests/server/authz.test.ts`: `assertPlanAssignment(db, planId, operatorId)` rejects when `plan_operators` has no row, and the rejection happens before any `count_records` access (stub records a call log).
- [x] 2.2 GREEN `frontend/src/lib/server/authz.ts` querying `plan_operators` by `plan_id` + `profile_id`, also asserting `audit_plans.status = 'active'`.
- [x] 2.3 RED `frontend/tests/api-routes/consent.test.ts`: `POST /api/consent` inserts `voice_consents` (`profile_id`, `status='granted'`, `policy_version`, `user_agent`) and returns 5xx (not 2xx) when the insert fails.
- [x] 2.4 GREEN `frontend/src/pages/api/consent.ts` (`prerender = false`), thin handler over `Db`.
- [x] 2.5 RED `frontend/tests/api-routes/plans.test.ts`: `GET /api/plans?operator=` returns only plans joined through `plan_operators` for that operator; an operator with no assignments gets `[]`, never a raw plan listing (RF-11).
- [x] 2.6 GREEN `frontend/src/pages/api/plans.ts`.
- [x] 2.7 RED extend `frontend/tests/components/operator/consent-screen.test.tsx`: acceptance does not advance until the injected persist fn resolves; on rejection an error/retry is shown and the screen stays (S1 blocking, D5).
- [x] 2.8 GREEN wire `ConsentScreen.tsx` + `CountSession.tsx` to dispatch `MIC_GRANTED` only after `POST /api/consent` resolves; add `postConsent`/`fetchPlans` to `frontend/src/lib/api/operational.ts`.
- [x] 2.9 RED extend `frontend/tests/components/operator/plans-screen.test.tsx`: renders fetched plans from an injected fetcher, with loading and error states; selection stores `planId` + `operatorId`.
- [x] 2.10 GREEN update `PlansScreen.tsx`; add `planId`/`operatorId` to `frontend/src/lib/session/types.ts` and the selection reducer case.

## Phase 3: Count records (REQ-SDA-4, D5, D6)

- [x] 3.1 RED `frontend/tests/server/records-write.test.ts`: `POST /api/records` calls `assertPlanAssignment` first and returns 403 with zero DB writes for an unassigned plan (RF-07 guard).
- [x] 3.2 RED same file: a repeated body with the same `clientRecordId` produces one row — the insert targets `count_records.client_record_id` (unique) and a duplicate is resolved to the existing row, not a second insert.
- [x] 3.3 GREEN `frontend/src/pages/api/records/index.ts` inserting `count_records` (`plan_id`, `warehouse_id`, `product_id`, `quantity`, `unit_code`, `source='voice'`, `status`, `dictated_text`, `counted_by`, `client_record_id`) with server-side re-validation (Phase 4 module injected).
- [x] 3.4 RED `frontend/tests/server/records-delete.test.ts`: `DELETE /api/records/[id]` issues an UPDATE setting `is_deleted=true`, `deleted_at`, `deleted_by`, `delete_reason` — and never a `.delete()` call (RF-21).
- [x] 3.5 GREEN `frontend/src/pages/api/records/[id].ts`.
- [x] 3.6 RED extend `frontend/tests/session/reducer.test.ts`: new records start in `sync`; `RECORD_PERSISTED` flips to `ok`/`anom_noted` and stores the server id; `RECORD_PERSIST_FAILED` keeps `sync` and sets an error.
- [x] 3.7 GREEN add both events to `frontend/src/lib/session/{types,reducer}.ts`.
- [x] 3.8 RED extend `frontend/tests/components/session/count-session.test.tsx`: confirm fires the injected persist fn optimistically; redo after delete issues a soft-delete then a NEW create, never an update.
- [x] 3.9 GREEN wire `CountSession.tsx` persistence seams (props defaulted to `operational.ts` fns).

## Phase 4: Anomaly validation and RF-18 blindness (REQ-AV-1/2/3, D3, D4)

- [x] 4.1 RED `frontend/tests/server/validation.test.ts`: quantity outside stubbed `product_count_ranges.expected_min/max` yields `atypical_quantity`; in-range yields `null`; unit mismatch vs `units` yields `unit_mismatch`.
- [x] 4.2 RED same file (RF-18 guard): the serialized operator response contains only `{verdict, anomaly:{type,severity,title}}` — assert `theoretical_qty`, `system_qty`, `expected_min`, `expected_max`, `sd` and `warehouse_stock_balances` keys are absent from `JSON.stringify` of the payload, even though the stub supplies them.
- [x] 4.3 GREEN `frontend/src/lib/server/validation.ts` reading `product_count_ranges` + `warehouse_stock_balances`, returning an internal verdict plus an explicit allowlist serializer. Never join `anomaly_evidence` into any operator path.
- [x] 4.4 GREEN `frontend/src/pages/api/anomaly-check.ts` using the allowlist serializer.
- [x] 4.5 RED `frontend/tests/anomaly/http-engine.test.ts`: `httpAnomalyEngine.check` resolves the verdict from an injected fetch stub; on network failure it degrades per spec (no thrown pipeline break).
- [x] 4.6 GREEN widen `AnomalyEngine.check` to `Promise<Anomaly | null>` in `frontend/src/lib/anomaly/engine.ts`, wrap `fixtureEngine.ts`, await in `frontend/src/lib/pipeline.ts`; keep `tests/pipeline/*` and `tests/anomaly/fixture-engine.test.ts` green.
- [x] 4.7 GREEN persist `record_anomalies` (`record_id`, `type`, `severity`, `title`, `detail`, `expected_unit_code`) inside `POST /api/records` from the server re-validation, never from the client verdict.

## Phase 5: Auditor and Oracle export (REQ-AUD-3/4/5, REQ-OE-1/2, D7, D8)

- [x] 5.1 RED `frontend/tests/server/auditor-records.test.ts`: `GET /api/auditor/records` excludes `is_deleted = true` rows and joins `record_anomalies` for badges.
- [x] 5.2 GREEN `frontend/src/pages/api/auditor/records.ts`.
- [x] 5.3 RED `frontend/tests/server/auditor-actions.test.ts`: `POST /api/auditor/actions` inserts one append-only `auditor_actions` row per action (`approve|correct|reject|request_recount`) with `previous_/new_quantity` and `previous_/new_unit_code`; it never UPDATEs an existing action row.
- [x] 5.4 GREEN `frontend/src/pages/api/auditor/actions.ts`.
- [ ] 5.5 RED extend `frontend/tests/components/auditor/auditor-review.test.tsx`: fetch-on-mount with loading and error states; a trace entry appears only after the injected action fn resolves 2xx (pessimistic, D7).
- [ ] 5.6 GREEN update `AuditorReview.tsx`; move types from `frontend/src/fixtures/auditorSeed.ts` to `frontend/src/lib/auditor/types.ts`, keeping fixture data test-only (`tests/fixtures/auditor-seed.test.ts` must stay green).
- [x] 5.7 RED `frontend/tests/server/export.test.ts`: `buildExportLines` emits one line per eligible record (non-deleted, no `record_anomalies` with `status='open'`), numbered from 1, with columns `subinventory,item,count_qty,uom,counter` in Oracle Import Count Sequences order.
- [x] 5.8 RED same file: when the `export_lines` insert fails, the response is an error and no CSV body is returned (REQ-OE-2 — no download without a persisted batch).
- [x] 5.9 GREEN `frontend/src/lib/server/export.ts` + `frontend/src/pages/api/export.ts` — insert `export_batches` (`code`, `plan_id`, `status`, `format`, `record_count`, `open_anomaly_count`, `generated_by`, `checksum`) then `export_lines`, respond `text/csv` attachment with the batch id header.
- [ ] 5.10 GREEN wire the auditor export button to the real download; keep the existing blocked-modal gate behavior.
- [x] 5.11 **NEW (orchestrator, 2026-07-25)** RED extend `frontend/tests/server/export.test.ts` (or the route test): a record whose `products.sku` is `null` still gets a non-empty `item` (falls back to `products.name_normalized`), and a record whose `profiles.counter_code` is `null` gets `counter` = the profile's `full_name` uppercased with spaces replaced by `.` — matching `v_oracle_export_preview`'s `COALESCE(sku, name_normalized)` / `COALESCE(counter_code, upper(replace(full_name,' ','.')))` exactly (confirmed via `pg_get_viewdef` against the live view, orchestrator). Then GREEN: fix the `item`/`counter` computation in `frontend/src/pages/api/export.ts` (currently `product.sku ?? ''` and `profile.counter_code ?? null`, which silently blanks 18.4% of the real catalogue — products with no SKU, per learnings obs #129). Real bug, not a style nit — real Colsubsidio export data would ship rows with an empty item name today without this fix. **DONE**: `itemOf`/`counterOf` helpers added, 4 new RED-then-GREEN tests, 18/18 passing.

## Phase 6: Verification and cleanup

- [x] 6.1 RLS audit (verification only, no schema redesign): query `pg_policies` for the 8 operational tables and run MCP `get_advisors`. Checklist per obs #129 — UPDATE policies have both SELECT and `WITH CHECK`; `TO authenticated` paired with an ownership predicate; no `for all` double-evaluation on SELECT; privileges revoked from `PUBLIC`, not just `anon`; helper functions in a non-exposed schema; views `security_invoker`. Document findings in the change folder; fix only genuine gaps. **DONE (orchestrator, 2026-07-25) — no genuine gaps found:**
  - All UPDATE policies (`audit_plans`, `count_records`, `plan_operators`, `profiles`, `record_anomalies`, `warehouse_stock_balances`) carry both `qual` (USING) and `with_check`. ✓
  - Every `authenticated` policy pairs with a real predicate (`private.is_staff()`, `private.is_auditor()`, `private.has_plan_access(id)`, or `col = auth.uid()`) — none is a bare `TO authenticated` with an unconditional `true`. ✓
  - Two `FOR ALL` policies exist (`anomaly_evidence_staff_only`, `export_batches_auditor`); neither table has a second, separate SELECT policy, so there is no double-evaluation-on-SELECT hazard from obs #129's gotcha. ✓
  - `private.is_staff()`/`is_auditor()`/`has_plan_access()` ACLs: `postgres=X`, `authenticated=X`, `service_role=X` only — no `PUBLIC` grant. ✓ Helper functions live in `private` (non-`public`, not PostgREST-exposed). ✓
  - All 6 `public` views (`v_current_voice_consent`, `v_plan_progress`, `v_operator_anomalies`, `v_warehouse_catalogue`, `v_auditor_review`, `v_oracle_export_preview`) have `security_invoker=true`. ✓
  - `source.*` tables (`bodegas_disponibles`, `ingest_runs`, `stock_rows`, `workbook_sheets`) show as `get_advisors` INFO findings ("RLS enabled, no policies") — this is intentional deny-all, matching the original design intent (source data, nobody should read it directly); not a gap.
  - `get_advisors` WARN: leaked-password-protection disabled — not applicable, this change has no real password-based login (named technical debt, see D2).
  - Net: the pre-existing RLS hardening (from the archived `feat/supabase-backend` security pass) holds up under this checklist. RLS stays correctly configured as defense-in-depth for whenever real auth lands; no code change required by this task.
- [x] 6.2 (code half; reconciliation with redis-catalogue-cache deferred to merge) Reconcile Supabase env var names with `redis-catalogue-cache` in `docker-compose.yml` / `.env.example`; assert no `PUBLIC_`-prefixed Supabase secret anywhere (`rg PUBLIC_SUPABASE frontend/`).
- [ ] 6.3 Full suite green: `cd frontend && npm test`, plus `npm run build` for the Astro routes.
- [ ] 6.4 Manual end-to-end against the seeded plan: consent → plan select → dictate → anomaly → confirm → delete/redo → auditor approve → export CSV. Verify rows landed in `voice_consents`, `count_records`, `record_anomalies`, `auditor_actions`, `export_batches`, `export_lines` via MCP `execute_sql`.
- [x] 6.5 Update `openspec/changes/supabase-operational-integration/design.md` open questions: mark `client_record_id` resolved as the idempotency key; record the verified export column layout (or the `v_oracle_export_preview` absence). **DONE (orchestrator, 2026-07-25)**: both open questions checked off with resolutions in design.md.

## Requirement traceability

| Requirement | Tasks |
|---|---|
| REQ-SDA-1 | 1.2, 1.3, 6.2 |
| REQ-SDA-2 | 2.3, 2.4, 2.7, 2.8 |
| REQ-SDA-3 / REQ-OCF-8 | 2.5, 2.6, 2.9, 2.10 |
| REQ-SDA-4 / REQ-OCF-4 | 3.1–3.5, 3.8, 3.9 |
| REQ-SDA-5 (RF-07) | 2.1, 2.2, 3.1 |
| REQ-AV-1 | 4.1, 4.3 |
| REQ-AV-2 | 4.7, 5.1 |
| REQ-AV-3 (RF-18) | 4.2, 4.3, 4.4 |
| REQ-OE-1 | 5.7, 5.9 |
| REQ-OE-2 | 5.8, 5.9, 5.10 |
| REQ-OCF-13 | 3.6, 3.7, 5.1 |
| REQ-AUD-3/4/5 | 5.1–5.6, 5.10 |
| Seeding prerequisite | 1.4, 1.5 |
| RLS defense-in-depth | 6.1 |

## Parallelism

Sequential spine: Phase 1 → 2 → 3 → 4.7 → 5 → 6.
Parallel-safe once Phase 1 completes: 2.x (consent/plans) ∥ 4.1–4.6 (validation module) ∥ 5.7–5.9 (export formatting) — all three depend only on `Db` + stubs.
Hard blockers: 1.4/1.5 gate every DB-write task and all of Phase 6.4; 4.3 gates 3.3 (server re-validation is injected into the records route); 3.3 gates 5.1.
