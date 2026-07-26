# Apply Progress — supabase-operational-integration

**Status**: partial — **55 of 56 tasks complete** (49 original + 5.11, 6.6, 6.7,
6.8, 6.9, 6.10, 6.11 added by the orchestrator). The single remaining task is
**6.4**, and it is BLOCKED on credentials this executor does not have (see below).

> **Update 2026-07-25, batch "verify remediation" (tasks 6.8 – 6.11)** — the four
> findings `sdd-verify` raised (obs #180, `verify-report.md`) are CLOSED, and the
> exit criterion this batch was given is met **on all three gates, each re-run by
> this executor rather than taken from a prior report**:
>
> | Gate | Command | Result |
> |---|---|---|
> | Tests | `cd frontend && npm test` | **50 files, 906 passed, 0 failed** |
> | Types | `cd frontend && npm run check` | **0 errors, 0 warnings** (was 11 errors) |
> | Build | `cd frontend && npm run build` | **exit 0**, 4 static routes prerendered |
>
> Plus the RF-18/D1 containment re-check: `grep -rli supabase frontend/dist/client/`
> returns **nothing** — the client bundle still has zero Supabase references after
> the new route and the new `sessionStorage` code.
>
> - **6.8** the literal NUL in `auditor/records.ts` is gone; the route now renders
>   as 191 text insertions in `git diff main..HEAD` instead of `Bin 0 -> 7200`.
> - **6.9** **the prior batch's claim that the 11 type errors were "all
>   pre-existing" was WRONG, and the correction is recorded here rather than
>   quietly dropped.** `verify` proved it via `git stash`: `CountRecord.unitCode`
>   was added as REQUIRED by this change, and the D4 widening broke the
>   fixture-engine test. Fixed at the DESIGN level, not by patching tests:
>   `AnomalyEngine.check` is now uniformly `Promise<Anomaly | null>` (the union
>   was itself the defect). The narrowing surfaced 4 further errors the union had
>   hidden in the pipeline test doubles.
> - **6.10 (CRITICAL)** `resolveProductId` no longer depends on `products.sku`
>   alone, so the ~18.4% of the catalogue with no SKU can be counted. Wired end to
>   end — the resolver fix alone would have been dead code without `articulo`
>   travelling from `CountSession` through both routes.
> - **6.11 (CRITICAL)** REQ-OCF-13 is implemented: `GET /api/records`, a pure
>   resume module, `SESSION_RESUMED`, and a mount-time restore. See the deviation
>   note in `tasks.md` 6.11 — the task said "call it on mount", but the plan scope
>   itself does not survive a reload, so `sessionStorage` had to carry four ids.
>
> **Remaining named debt is unchanged and still real**: 6.4's live walkthrough, and
> the `COUNT_STATUS` enum question (WARNING-3(b)) — no stub can prove the live
> `status` check constraint accepts `'confirmed'`/`'flagged'`. Both belong in the
> pre-deploy checklist with a named owner.

> **Update 2026-07-25, batch "auditor gaps" (tasks 6.6 + 6.7)** — the two gaps
> named as deviations 8 and 9 below are now CLOSED. `GET /api/auditor/records`
> joins `warehouse_stock_balances` on the `(warehouse_id, product_id)` pair and
> returns `systemQty`/`systemUnitCode`, and it reads `auditor_actions` back
> (ordered by `created_at`, signed with `profiles.full_name`) so the RF-32 trace
> survives a reload. `AuditorReview.tsx` needed no change: it already rendered
> `record.trace`, and the `[]` lived in the mapper. `stub-db.ts`'s `order()` was
> a no-op and now really sorts, so the ordering assertion can fail.
> RF-18 is untouched: the operator allowlist serializer was not modified, and the
> auditor route is explicitly exempt (design contract C6).
> Deviations 8 and 9 are kept below verbatim as the historical record of what was
> broken and why. `time` and `consensus` are STILL `SYSTEM_UNKNOWN` — those two
> genuinely have no column.

**Mode**: Strict TDD (RED → GREEN verified by execution for every pair).
**Branch / worktree**: `feat/supabase-operational-integration` in
`colsubsidio30x-minka-worktrees/supabase-operational-integration`, from `main` @ 932ba2c.
**Delivery**: single PR, `size:exception` pre-accepted by the maintainer.
**Test suite**: `cd frontend && npm test` → **50 files, 906 tests, all passing**.
`npm run build` succeeds (all Astro routes + 4 prerendered pages).
`npm run check` → **0 errors**.

> ~~`npm run check` reports 11 type errors, all pre-existing — verified by
> stashing this batch and re-running.~~ **RETRACTED.** This statement was false;
> `sdd-verify` disproved it with `git stash` (see the 6.8–6.11 update above). All
> 11 were introduced by this change and are now fixed under task 6.9. It is left
> struck through rather than deleted because a reviewer who read the earlier
> version deserves to see the correction, not a silent edit.

## EXACT NEXT TASK: 6.4 — and it needs the orchestrator, not another executor

Everything else is done and committed. 6.4 requires live database access and it
is unavailable in this executor's environment for two independent reasons:

1. **No Supabase MCP tools.** `.mcp.json` configures the `supabase` HTTP MCP
   server for project `blvdxsoaopcvtzawvgbt`, and its usage instructions are
   injected into this session — but `execute_sql`, `list_tables`, `get_advisors`
   and the auth admin tools are **not present in this executor's tool set**.
   (Same blocker as batch 1; the orchestrator has them, this sub-agent does not.)
2. **No Supabase credentials on the machine.** The dev server cannot be pointed
   at the live project either: the repo's `.env` carries only STT/matcher
   secrets (`DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY`, `GROQ_API_KEY`, `GROQ`/
   `STT_*`/`MATCH_*` tuning). It defines **no `SUPABASE_URL` and no
   `SUPABASE_SERVICE_ROLE_KEY`**, and neither is in the process environment.
   `frontend/.env.example` documents both as placeholders only.

Nothing was faked and nothing was marked done that was not run. 6.4 stays
`- [ ]` in `tasks.md`.

### What 6.4 still has to prove (unchanged from the task text)

Route-level walkthrough with `curl`/`fetch` against `npm run dev`, then
`execute_sql` confirmation that rows landed:

    consent -> plans -> records write -> anomaly-check -> delete + redo
            -> auditor records read -> auditor action write -> export CSV

- demo operator `11111111-1111-4111-8111-111111111111` (OP.001)
- demo auditor `33333333-3333-4333-8333-333333333333`
- demo plan `44444444-4444-4444-8444-444444444444` (PLAN-DEMO-001),
  warehouse `28f1c715-4c42-4920-bf4b-6127e40ce11f` (STOCK_RESTAURANTE_FUENTES_AYB,
  344 products) — pick a real `product_id`/`unit_code` from `warehouse_products`
- `GET /api/plans?operator=<random uuid>` must answer `[]` (RF-07/RF-11)
- **the single most important assertion**: the `/api/anomaly-check` response body
  contains no `theoretical_qty`, `system_qty`, `expected_min`, `expected_max`,
  `sd`, nor any other derivable system quantity (RF-18)
- rows land in `voice_consents`, `count_records`, `record_anomalies` (if an
  anomaly fires), `auditor_actions`, `export_batches`, `export_lines`
- the downloaded CSV is non-empty and its `item`/`counter` columns are populated
- clean up only the test rows created, by their own generated ids; never the
  `1111…/2222…/3333…/4444…` seed identities

### RF-18 status without 6.4

Proven at the unit/route layer, NOT end to end. `tests/server/validation.test.ts`
+ `tests/api-routes/anomaly-check.test.ts` (21 tests, green) assert that
`JSON.stringify` of the operator payload contains none of `theoretical_qty`,
`system_qty`, `expected_min`, `expected_max`, `sd` or
`warehouse_stock_balances` **even though the stub supplies all of them** — the
allowlist serializer is the only path out. What is missing is the live proof that
the real `product_count_ranges` / `warehouse_stock_balances` rows travel that
same path. That is exactly what 6.4 exists to establish.

## Completed

Phase 1: 1.1*, 1.2, 1.3, 1.4*, 1.5*, 1.6, 1.7, 1.8
Phase 2: 2.1 – 2.10
Phase 3: 3.1 – 3.9
Phase 4: 4.1 – 4.7
Phase 5: 5.1 – 5.11
Phase 6: 6.1*, 6.2 (code half; `redis-catalogue-cache` reconciliation deferred to
merge), 6.3, 6.5*

`*` = executed by the orchestrator with live MCP access (1.1 schema re-verify,
1.4/1.5 demo seed, 6.1 RLS audit, 6.5 design open questions, plus the 5.11
`export.ts` item/counter fallback fix).

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | Triangulate | Refactor |
|---|---|---|---|---|---|---|---|
| 1.2/1.3 | `tests/server/supabase-client.test.ts` | Unit | N/A (new) | ✅ module absent | ✅ 5/5 | ✅ 5 cases | ➖ clean |
| 1.6/1.7 | `tests/server/db.test.ts` | Unit | N/A (new) | ✅ module absent | ✅ 6/6 | ✅ 6 cases | ➖ clean |
| 1.8 | `tests/api/client.test.ts` | Unit | ✅ 29/29 before | ➖ export only | ✅ 29/29 | ➖ structural | ➖ |
| 2.1/2.2 | `tests/server/authz.test.ts` | Unit | N/A (new) | ✅ module absent | ✅ 7/7 | ✅ 7 cases | ➖ clean |
| 2.3/2.4 | `tests/api-routes/consent.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 6/6 | ✅ 6 cases | ➖ clean |
| 2.5/2.6 | `tests/api-routes/plans.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 6/6 | ✅ 6 cases | ➖ clean |
| 2.7/2.8 | `tests/components/operator/consent-screen.test.tsx` | Component | ✅ green before | ✅ blocking absent | ✅ passed | ✅ multi-case | ➖ clean |
| 2.9/2.10 | `tests/components/operator/plans-screen.test.tsx` | Component | ✅ green before | ✅ fetch absent | ✅ passed | ✅ multi-case | ➖ clean |
| 3.1–3.3, 4.7 | `tests/server/records-write.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 11/11 | ✅ 11 cases | ➖ clean |
| 3.4/3.5 | `tests/server/records-delete.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 9/9 | ✅ 9 cases | ➖ clean |
| 3.6/3.7 | `tests/session/reducer.test.ts` | Unit | ✅ 665/665 before | ✅ events absent | ✅ 747/747 | ✅ 6 new cases | ➖ clean |
| 3.8/3.9 | `tests/components/session/count-session.test.tsx` | Component | ✅ green before | ✅ seams absent | ✅ passed | ✅ multi-case | ➖ clean |
| 4.1–4.3 | `tests/server/validation.test.ts` | Unit | N/A (new) | ✅ module absent | ✅ 12/12 | ✅ 12 cases | ➖ clean |
| 4.4 | `tests/api-routes/anomaly-check.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 6/6 | ✅ 6 cases | ➖ clean |
| 4.5/4.6 | `tests/anomaly/http-engine.test.ts` | Unit | ✅ 62/62 before | ✅ module absent | ✅ 8/8 | ✅ 8 cases | ✅ pipeline classify |
| 5.1/5.2 | `tests/server/auditor-records.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 5/5 | ✅ 5 cases | ➖ clean |
| 5.3/5.4 | `tests/server/auditor-actions.test.ts` | Unit (route) | N/A (new) | ✅ route absent | ✅ 9/9 | ✅ 9 cases | ➖ clean |
| **5.5/5.6** | `tests/components/auditor/auditor-review.test.tsx` | Component | ✅ 26/26 before | ✅ 17 failing first | ✅ 30/30 | ✅ 8 new cases | ✅ types extracted |
| **5.5/5.6** | `tests/auditor/records.test.ts` | Unit (pure) | N/A (new) | ✅ module absent | ✅ 8/8 | ✅ 8 cases | ➖ clean |
| 5.7–5.9 | `tests/server/export.test.ts` | Unit + route | N/A (new) | ✅ module absent | ✅ 14/14 | ✅ 14 cases | ➖ clean |
| **5.10** | `tests/api/operational.test.ts` + `auditor-review.test.tsx` | Unit + Component | ✅ 9/9 before | ✅ `downloadExport` absent | ✅ 13/13 | ✅ 8 cases | ➖ clean |
| 5.11 | `tests/server/export.test.ts` | Unit | ✅ 14/14 before | ✅ 4 failing first | ✅ 18/18 | ✅ 4 cases | ✅ `itemOf`/`counterOf` |
| (2.8 seam) | `tests/api/operational.test.ts` | Unit | N/A (new) | ✅ module absent | ✅ 9/9 | ✅ 9 cases | ➖ clean |

**Batch 3 (this one)**: 20 tests written across 3 files; 17 of them observed
failing before any production code was written (`npx vitest run tests/auditor
tests/api/operational.test.ts tests/components/auditor` → `17 failed | 30
passed`), then all green. Suite total 784 → 839.

Pure functions created this batch: `toAuditorRecord` / `toAuditorRecords`,
`displayQuantity`, `alertOf`, `paramFromUrl`, `parseQuantity`, plus `badgeOf` /
`diffOf` / `isOpenAlert` / `openAlertCount` relocated intact to
`lib/auditor/types.ts`.

## Work Unit Evidence

- **Focused test command**: `cd frontend && npx vitest run tests/auditor
  tests/api/operational.test.ts tests/components/auditor` → 3 files, 55 tests,
  all passing.
- **Full suite**: `cd frontend && npm test` → 46 files, 839 tests, all passing.
- **Runtime harness**: `cd frontend && npm run build` → Astro server build
  completes, 4 static pages prerendered including `/auditor`. The real
  end-to-end HTTP walkthrough is task 6.4 and is BLOCKED (above).
- **Secret-leak check (constraint 6)**: `grep -rl supabase dist/client/` returns
  nothing after this batch's build. `AuditorReview.tsx` imports only
  `lib/api/operational` (same-origin `/api/*`), never `pages/api/_supabase`.
- **Type check**: 11 errors before this batch, 11 after — zero introduced.
- **Rollback boundary**: this batch is one commit (`4e511e4`). Reverting it
  restores the fixture-driven auditor island and the no-op export modal; nothing
  else in the change depends on `lib/auditor/*`.

## Deviations from design (all deliberate, none silent)

1. **`AnomalyEngine.check` returns `Anomaly | null | Promise<Anomaly | null>`**,
   not strictly `Promise<...>` (task 4.6). `FixtureAnomalyEngine` stays
   synchronous and its rule tests stay green untouched; `runPipeline` awaits
   either shape.
2. **`POST /api/records` and `POST /api/anomaly-check` require a `products.id`.**
   The matcher answers with `nr_articulo`, so a resolution step is still needed;
   `createHttpAnomalyEngine` takes a `productIdOf(item)` seam for it. Must be
   closed before 6.4 can pass.
3. **`negative_balance` reuses the neutral title** "Cantidad fuera de lo
   habitual". A title naming the system balance would hand the operator a bound
   on the theoretical stock — an RF-18 leak. The `type` still distinguishes it.
4. **Confirmed records enter `sync`, not `ok`** (design D5). Two pre-existing
   reducer assertions were updated with the reason in the test comment.
5. **`record_anomalies` insert failure is logged, not fatal** in `POST
   /api/records`: the count is already durable and losing it because its
   annotation failed would be worse.
6. **Task 5.6 moved the pure helpers too, not only the types.** `badgeOf`,
   `diffOf`, `isOpenAlert` and `openAlertCount` went to `lib/auditor/types.ts`
   alongside the interfaces, because leaving them in `src/fixtures/` would have
   forced every auditor component to keep importing the fixture module — the
   exact coupling the task exists to remove. `auditorSeed.ts` re-exports all of
   them, so `tests/fixtures/auditor-seed.test.ts` is untouched and green.
7. **The auditor island no longer sources its bodega pane or auditor name.**
   `AuditorReview` now imports zero fixtures; `warehouses`, `auditorName` and
   `eyebrow` are props, passed from `pages/auditor/index.astro` (which may
   legitimately import the seed). No route lists a plan's warehouses or names the
   signed-in auditor yet, and defaulting them inside the island would have hidden
   that.
8. **`GET /api/auditor/records` sends no theoretical stock, no counted-at
   timestamp and no model consensus**, so `toAuditorRecord` maps `system`, `time`
   and `consensus` to `SYSTEM_UNKNOWN` (`—`) and `diffOf` gained a first branch
   answering "Sistema sin dato". Rendering `0` there would have invented a stock;
   rendering blank would have hidden that one exists. REQ-AUD-2's side-by-side
   comparison is therefore only half-live — the pane renders both cells, but the
   Sistema cell has no source until a route joins `anomaly_evidence` or
   `warehouse_stock_balances` for the auditor. Named, not silently papered over.
9. **REQ-AUD-4 "the trace survives reload" is not met.** `auditor_actions` rows
   are written (pessimistically, and the write is what gates the on-screen
   entry), but no route reads them back, so `toAuditorRecord` seeds `trace: []`.
   The scenario needs a `GET` over `auditor_actions`, which is not in tasks.md.
10. **`/auditor` reads its plan and auditor from the URL** (`?plan=&auditor=`),
    because the page is prerendered and there is no session. With neither
    present the island renders "Falta el plan…" instead of fetching with an
    empty id.

## Open questions

Both original open questions were resolved by the orchestrator (design.md).
Remaining, and all deferred by design rather than discovered late: the operator
identity is client-supplied (named technical debt, D2); the `nr_articulo` →
`products.id` resolution of deviation 2; and deviations 8 and 9 above.

## TDD Cycle Evidence — batch "auditor gaps" (6.6, 6.7)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 6.6 | `tests/server/auditor-records.test.ts` | Integration (route + stub Db) | ✅ 5/5 before | ✅ Written | ✅ Passed | ✅ 2 cases (balance present in the record's own bodega vs. absent) | ✅ `balanceKey` extracted |
| 6.6 | `tests/auditor/records.test.ts` | Unit (pure mapper) | ✅ 8/8 before | ✅ Written | ✅ Passed | ✅ 2 cases ("Diferencia" vs "Sin diferencia") | ✅ `systemMeasure` extracted |
| 6.7 | `tests/server/auditor-records.test.ts` | Integration (route + stub Db) | ✅ 5/5 before | ✅ Written | ✅ Passed | ✅ 2 cases (two out-of-order actions vs. an untouched record) | ✅ `order()` made real in the stub |
| 6.7 | `tests/auditor/records.test.ts` | Unit (pure mapper) | ✅ 8/8 before | ✅ Written | ✅ Passed | ✅ 2 cases (named signer + reason vs. unnamed signer, no reason) | ✅ `toTraceEntry`/`displayTime` extracted |

RED was observed by execution: **8 failing** before any production change
(`expected undefined to be 120`, `expected [] to equal [correct, approve]`, …),
0 failing after. Pure functions added: `balanceKey`, `numberOrNull`,
`systemMeasure`, `toTraceEntry`, `displayTime`. Zero mocks in either file.

### Work Unit Evidence — batch "auditor gaps"

| Evidence | Value |
|---|---|
| Focused test command and result | `npx vitest run tests/server/auditor-records.test.ts tests/auditor/records.test.ts` → 21/21 passing (8 of them new). Full `npm test` → 46 files, 847 tests, all passing (was 839). |
| Runtime harness | **N/A for this batch, deferred to 6.4.** Both changes are DB-shaped reads and the runtime proof is exactly the live end-to-end run that 6.4 blocks on (no `SUPABASE_SERVICE_ROLE_KEY`). `npm run build` succeeds, so the route compiles and `/auditor` still prerenders. |
| Rollback boundary | Revert commit `ec7adbf`. It touches only `src/pages/api/auditor/records.ts`, `src/lib/auditor/{records,types}.ts`, the `AuditorRecordDto` block in `src/lib/api/operational.ts`, and the two test files plus `tests/server/stub-db.ts`. No operator path, no schema, no migration, nothing under `services/`. |

### Deviation from the task text (6.6)

The task names the response fields `system_qty` / `system_unit_code`. They are
serialized as **`systemQty` / `systemUnitCode`**, matching the route's existing
`unitCode` / `nrArticulo` / `countedBy` convention. Renaming just these two to
snake_case would have made the payload speak two languages at once.

### One thing 6.7 chose, and why

The trail is served by **extending `GET /api/auditor/records`**, not by a new
`GET /api/auditor/actions`. The dashboard already makes exactly one call per
plan, the trail is strictly per record, and a second endpoint would have meant
either N+1 calls or a second fan-out join for identical data. The task left the
shape to the executor's judgement.

## Files changed (this batch)

Created: `frontend/src/lib/auditor/types.ts`, `frontend/src/lib/auditor/records.ts`,
`frontend/tests/auditor/records.test.ts`.

Modified: `frontend/src/components/auditor/AuditorReview.tsx` (fetch on mount,
loading/error/no-plan states, pessimistic action writes, real export),
`frontend/src/components/auditor/{DetailPane,RecordList,WarehouseList}.tsx`
(import from `lib/auditor/types`), `frontend/src/fixtures/auditorSeed.ts` (types
and helpers re-exported, data kept), `frontend/src/lib/api/operational.ts`
(`downloadExport`, `saveExportFile`, `ExportDownload`),
`frontend/src/pages/auditor/index.astro` (passes warehouses/name/eyebrow),
`frontend/tests/components/auditor/auditor-review.test.tsx`,
`frontend/tests/api/operational.test.ts`,
`frontend/tests/demo/warehouse-label-coherence.test.tsx`,
`openspec/changes/supabase-operational-integration/tasks.md`.

## Files changed (earlier batches, unchanged)

Created: `frontend/src/pages/api/_supabase.ts`, `anomaly-check.ts`, `consent.ts`,
`plans.ts`, `export.ts`, `records/index.ts`, `records/[id].ts`,
`auditor/records.ts`, `auditor/actions.ts`;
`frontend/src/lib/server/{db,http,authz,validation,export}.ts`;
`frontend/src/lib/anomaly/httpEngine.ts`; `frontend/src/lib/api/operational.ts`;
`frontend/tests/server/*` (8 files incl. `stub-db.ts`),
`frontend/tests/api-routes/{consent,plans,anomaly-check}.test.ts`,
`frontend/tests/anomaly/http-engine.test.ts`, `frontend/tests/api/operational.test.ts`.

Modified: `frontend/package.json` + lockfile (`@supabase/supabase-js` 2.110.8),
`frontend/src/lib/api/client.ts`, `frontend/src/lib/anomaly/engine.ts`,
`frontend/src/lib/pipeline.ts`, `frontend/src/lib/session/{types,reducer}.ts`,
`frontend/src/components/operator/{CountSession,ConsentScreen,PlansScreen}.tsx`,
`frontend/tests/session/{reducer,no-soft-lock}.test.ts`,
`frontend/.env.example`, `docker-compose.yml`.

## TDD Cycle Evidence — batch "verify remediation" (6.8 – 6.11)

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 6.8 | `tests/server/auditor-records.test.ts` (existing) | Unit | 9/9 before | N/A — byte fix, no behaviour | 9/9 after | N/A | N/A |
| 6.9 | `tests/anomaly/fixture-engine.test.ts` (approval) | Unit | 76/76 session + 88 anomaly before | `npm run check` = 11 errors | 0 errors, 861/861 | Existing 15 cases preserved verbatim | Union collapsed to a single promise type |
| 6.10 | `tests/server/products.test.ts` (new) | Unit | N/A (new file) | 6 failed / 6 passed | 12/12 | 12 cases: sku hit, name hit, accent fold, spoken fallback, precedence, no match, blank, no identity | `findByColumn` extracted; `normalizeProductName` exported pure |
| 6.10 | `tests/server/records-write.test.ts` | Unit | 18/18 before | 1 failed | 21/21 | sku-less 201 + unresolvable 400 | — |
| 6.11 | `tests/server/records-read.test.ts` (new) | Unit | N/A (new file) | 13 failed (`handleListRecords` undefined) | 14/14 | 14 cases incl. RF-07 403, RF-21 exclusion, cross-operator isolation, RF-18 leak scan | Blindness moved into the `select` projection |
| 6.11 | `tests/session/resume.test.ts` (new) | Unit | N/A (new file) | suite unresolvable | 12/12 | 12 cases incl. corrupt / partial / cleared storage | Pure module, zero mocks |
| 6.11 | `tests/session/reducer.test.ts` | Unit | 76/76 before | 6 failed | 88/88 with `no-soft-lock` | 8 cases incl. late-resume no-op and empty restore | — |
| 6.11 | `tests/components/session/count-session-resume.test.tsx` (new) | Integration | N/A (new file) | 7 failed / 3 passed | 11/11 | 11 cases incl. 3 refusal paths (no storage, fetch fails, mic denied) | — |

### Test Summary
- **Total tests written this batch**: 59 (906 total, up from 847)
- **Total tests passing**: 906/906
- **Layers used**: Unit (48), Integration (11), E2E (0 — not installed)
- **Approval tests** (refactoring): 15 (the fixture-engine rule cases, preserved
  through the D4 async narrowing — their assertions are byte-identical, only the
  `await` moved)
- **Pure functions created**: 4 (`normalizeProductName`, `readResumeContext`,
  `writeResumeContext`, `toCountRecord`)
- **`vi.mock()` calls**: 0 — every double is still a prop or parameter seam

### Work Unit Evidence — batch "verify remediation"

| Evidence | Value |
|---|---|
| Focused test command and result | `cd frontend && npm test` → 50 files, **906 passed**, 0 failed, exit 0 |
| Type gate | `cd frontend && npm run check` → **0 errors, 0 warnings**, exit 0 |
| Runtime harness | `cd frontend && npm run build` → exit 0, 4 static routes prerendered; plus `grep -rli supabase frontend/dist/client/` → **empty** (service-role containment re-proved against the built bundle). A live HTTP walkthrough remains task 6.4 and is still credential-blocked. |
| Rollback boundary | 4 commits, one per task, each independently revertable: `auditor/records.ts` byte (6.8); the anomaly-seam type narrowing + `unitCode` literals (6.9); `lib/server/products.ts` + the `articulo` wiring (6.10); `handleListRecords` + `lib/session/resume.ts` + `SESSION_RESUMED` + the two `CountSession` effects (6.11). Reverting 6.11 alone restores the previous no-resume behaviour without touching 6.8–6.10. |

### Update 2026-07-25, orchestrator — `COUNT_STATUS` enum risk CLOSED

The remaining named debt this batch called out — "no stub can prove the live `status` check constraint accepts `'confirmed'`/`'flagged'`" — is resolved, not deferred. The orchestrator already had the real `record_status` enum from a direct `list_tables(verbose)` query against `blvdxsoaopcvtzawvgbt` earlier in this session: `pending_sync | recorded | flagged | verified | discarded`. **`'confirmed'` was never a valid member** — every successful (non-anomaly) count write would have hit the check constraint and 500'd in production, the exact failure this task's own comment warned about. Fixed directly: `COUNT_STATUS.ok` changed from `'confirmed'` to `'recorded'` (the column's own default, matching RF-20's "voice inserts only" success state); the three hardcoded `'confirmed'` fixture literals in `records-read.test.ts`/`auditor-records.test.ts` updated to match. Re-ran all three gates after the fix: `npm test` → 906/906, `npm run check` → 0 errors, both unchanged from the pre-fix state (the tests were consistent among themselves, just consistently wrong against the live enum — exactly why this needed a human/orchestrator with real schema access, not another stub-level test). `flagged` (the anomaly branch) was already correct.
