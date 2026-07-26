# Apply Progress — supabase-operational-integration (batch 1)

**Status**: partial — 33 of 49 tasks complete.
**Mode**: Strict TDD (RED → GREEN verified by execution for every pair).
**Branch / worktree**: `feat/supabase-operational-integration` in
`colsubsidio30x-minka-worktrees/supabase-operational-integration`, branched from `main` @ 932ba2c.
**Delivery**: single PR, `size:exception` pre-accepted by the maintainer.
**Test suite**: `cd frontend && npm test` → **45 files, 784 tests, all passing**
(baseline before this batch: 31 files / 665 tests). `npm run build` succeeds.

## EXACT NEXT TASK: 2.7

Then 2.8 → 2.9 → 2.10 → 3.8 → 3.9 → 5.5 → 5.6 → 5.10 (all component wiring),
then Phase 6. Tasks 1.1 / 1.4 / 1.5 / 6.1 / 6.4 are BLOCKED — see below.

## Blocked (needs an executor with Supabase MCP tools)

The `supabase` MCP server is configured for the project, but its tools
(`list_tables`, `execute_sql`, `get_advisors`, auth admin) were **not present in
this executor's tool set**. Every task requiring live database access is
therefore untouched, and nothing was faked:

| Task | What is needed |
|---|---|
| 1.1 | `list_tables(verbose)` re-verification; confirm whether `v_oracle_export_preview` exists |
| 1.4 | Create demo `auth.users` via the auth admin API, then the matching `profiles` rows |
| 1.5 | Seed one active `audit_plans` row + `plan_operators` |
| 6.1 | RLS audit via `pg_policies` + `get_advisors` |
| 6.4 | Manual end-to-end against the seeded plan |

Consequence: the column names used by the server modules come from
`docs/database/*` plus the design's column list and are **UNVERIFIED against the
live schema**. They are centralised so reconciliation is cheap:
`RANGES_TABLE` / `BALANCES_TABLE` and the column strings in
`lib/server/validation.ts`, `COUNT_STATUS` in `pages/api/records/index.ts`, and
`EXPORT_COLUMNS` in `lib/server/export.ts`.

## Completed

Phase 1: 1.2, 1.3, 1.6, 1.7, 1.8
Phase 2: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
Phase 3: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
Phase 4: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
Phase 5: 5.1, 5.2, 5.3, 5.4, 5.7, 5.8, 5.9
Phase 6: 6.2 (code half: compose + `.env.example` + merge note; the
`redis-catalogue-cache` reconciliation itself must happen at merge)

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|---|---|
| 1.2/1.3 | `tests/server/supabase-client.test.ts` | Unit | N/A (new) | ✅ module absent | ✅ 5/5 | ✅ 5 cases | ➖ clean |
| 1.6/1.7 | `tests/server/db.test.ts` | Unit | N/A (new) | ✅ module absent | ✅ 6/6 | ✅ 6 cases | ➖ clean |
| 1.8 | `tests/api/client.test.ts` | Unit | ✅ 29/29 before | ➖ export only | ✅ 29/29 | ➖ structural | ➖ |
| 2.1/2.2 | `tests/server/authz.test.ts` | Unit | N/A (new) | ✅ module absent | ✅ 7/7 | ✅ 7 cases | ➖ clean |
| 2.3/2.4 | `tests/api-routes/consent.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 6/6 | ✅ 6 cases | ➖ clean |
| 2.5/2.6 | `tests/api-routes/plans.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 6/6 | ✅ 6 cases | ➖ clean |
| 3.1–3.3, 4.7 | `tests/server/records-write.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 11/11 | ✅ 11 cases | ➖ clean |
| 3.4/3.5 | `tests/server/records-delete.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 9/9 | ✅ 9 cases | ➖ clean |
| 3.6/3.7 | `tests/session/reducer.test.ts` | Unit | ✅ 665/665 before | ✅ events absent | ✅ 747/747 | ✅ 6 new cases | ➖ clean |
| 4.1–4.3 | `tests/server/validation.test.ts` | Unit | N/A (new) | ✅ module absent | ✅ 12/12 | ✅ 12 cases | ➖ clean |
| 4.4 | `tests/api-routes/anomaly-check.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 6/6 | ✅ 6 cases | ➖ clean |
| 4.5/4.6 | `tests/anomaly/http-engine.test.ts` | Unit | ✅ 62/62 pipeline+anomaly | ✅ module absent | ✅ 8/8 | ✅ 8 cases | ✅ pipeline classify |
| 5.1/5.2 | `tests/server/auditor-records.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 5/5 | ✅ 5 cases | ➖ clean |
| 5.3/5.4 | `tests/server/auditor-actions.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 9/9 | ✅ 9 cases | ➖ clean |
| 5.7–5.9 | `tests/server/export.test.ts` | Unit + route | N/A (new) | ✅ module absent | ✅ 14/14 | ✅ 14 cases | ➖ clean |
| (2.8 seam) | `tests/api/operational.test.ts` | Unit | N/A (new) | ✅ module absent | ✅ 9/9 | ✅ 9 cases | ➖ clean |

Tests written this batch: 119. All passing. Pure functions created:
`buildExportLines`, `toCsv`, `toOperatorVerdict`, plus the validation rule
predicates.

## Work Unit Evidence

- **Focused test command**: `cd frontend && npx vitest run tests/server tests/api-routes tests/anomaly tests/session` — all green.
- **Runtime harness**: `cd frontend && npm run build` — Astro server build completes with all new routes. A real end-to-end run is BLOCKED on the seed data (1.4/1.5).
- **Secret-leak check (constraint 6)**: `grep -rl supabase dist/client/` returns nothing; no module under `src/components` or `src/lib` imports `pages/api/_supabase`; `lib/server/db.ts` takes the client as an argument and never constructs one.
- **Rollback boundary**: every new file is additive. Reverting the four commits restores `main` behaviour; the only edits to pre-existing files are the `request<T>` export, the `AnomalyEngine.check` widening + `runPipeline` classify block, and the session types/reducer persistence events.

## Deviations from design (all deliberate, none silent)

1. **`AnomalyEngine.check` returns `Anomaly | null | Promise<Anomaly | null>`**, not strictly `Promise<Anomaly | null>` (task 4.6). `FixtureAnomalyEngine` stays a synchronous pure function and its existing rule tests stay green untouched; `runPipeline` awaits either shape. Same swap, no fixture churn.
2. **`POST /api/records` and `POST /api/anomaly-check` require `productId`**, a Supabase `products.id`. The matcher answers with `nr_articulo`, not uuids, so a resolution step (`nr_articulo` → `products.id`) is still MISSING. `createHttpAnomalyEngine` takes a `productIdOf(item)` seam for exactly this. This must be closed before 6.4 can pass and needs the live `products` columns (task 1.1).
3. **`negative_balance` reuses the neutral title** "Cantidad fuera de lo habitual". A title naming the system balance would hand the operator a bound on the theoretical stock — an RF-18 leak. The `type` still distinguishes it, which REQ-AV-3 permits.
4. **Confirmed records now enter `sync`, not `ok`** (design D5). Two pre-existing reducer assertions were updated to the new expected behaviour, with the reason in the test comment.
5. **`record_anomalies` insert failure is logged, not fatal** in `POST /api/records`: the count itself is already durable and losing it because its annotation failed would be worse.
6. **Change artifacts copied into the worktree** — `openspec/changes/supabase-operational-integration/` existed only as untracked files in the main checkout.

## Open questions still open

- `count_records.client_record_id` is USED as the idempotency key (cooperative half implemented: lookup before insert). The unique index itself is unverified — task 6.5.
- The Oracle column layout is the documented one (`subinventory,item,count_qty,uom,counter`); `v_oracle_export_preview`'s existence is unverified — task 6.5.

## Files changed

Created: `frontend/src/pages/api/_supabase.ts`, `anomaly-check.ts`, `consent.ts`,
`plans.ts`, `export.ts`, `records/index.ts`, `records/[id].ts`,
`auditor/records.ts`, `auditor/actions.ts`;
`frontend/src/lib/server/{db,http,authz,validation,export}.ts`;
`frontend/src/lib/anomaly/httpEngine.ts`; `frontend/src/lib/api/operational.ts`;
`frontend/tests/server/*` (8 files incl. `stub-db.ts`),
`frontend/tests/api-routes/{consent,plans,anomaly-check}.test.ts`,
`frontend/tests/anomaly/http-engine.test.ts`, `frontend/tests/api/operational.test.ts`.

Modified: `frontend/package.json` + lockfile (`@supabase/supabase-js` pinned
2.110.8), `frontend/src/lib/api/client.ts`, `frontend/src/lib/anomaly/engine.ts`,
`frontend/src/lib/pipeline.ts`, `frontend/src/lib/session/{types,reducer}.ts`,
`frontend/tests/session/{reducer,no-soft-lock}.test.ts`,
`frontend/.env.example`, `docker-compose.yml`.
