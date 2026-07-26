```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:193b48fef902e0ec244852ae33ee6aac71d2eb74d733bdc81657e91ebb5b9fc3
verdict: fail
blockers: 1
critical_findings: 2
requirements: 16/17
scenarios: 25/26
test_command: cd frontend && npm test
test_exit_code: 0
test_output_hash: sha256:1a2d79636cf1540cecc010eec731d56ce8b400e8ad965c4b32e021a9293bc8cd
build_command: cd frontend && npm run build
build_exit_code: 0
build_output_hash: sha256:cabfead85bbea1ecdb84aad7d0aa658c448d17fa457dfa2cc51c38b0a293aabf
```

## Verification Report

**Change**: supabase-operational-integration
**Branch/HEAD**: `feat/supabase-operational-integration` @ `091f65d` (15 commits ahead of `main` @ `932ba2c`)
**Mode**: Strict TDD
**Verified independently** — every command below was re-executed by the verifier, not taken from the apply report.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 52 |
| Tasks complete `[x]` | 51 |
| Tasks descoped `[~]` | 1 (6.4 — manual live E2E) |
| Tasks silently incomplete | 0 |

Task count reconciles exactly with `tasks.md` (8+10+9+7+11+7). No checkbox was found marked complete against absent code.

### Build & Tests Execution

**Tests**: PASS — 46 files, 847 passed, 0 failed, exit `0`

```text
cd frontend && npm test
 Test Files  46 passed (46)
      Tests  847 passed (847)
```

Independently confirms the apply report's 847 figure. (Console noise from `ECONNREFUSED :3000` is an intentional network-failure-path test, not a failure.)

**Build**: PASS — exit `0`, 4 static routes prerendered (`/auditor`, `/auditor/base`, `/auditor/cierre`, `/conteo`)

```text
cd frontend && npm run build → Server built in 7.49s, Complete!
```

**Type check**: FAIL — `cd frontend && npm run check` exits **1** with **11 errors**
(`check_output_hash: sha256:eddd8df4ab850753635150f9d47316fd64aa3f245d866c82c0615bb496fc6dc1`)
All 11 are **introduced by this change** — see WARNING-1. This contradicts the apply report.

**Coverage**: not available — no coverage tool configured. Skipped cleanly, not a failure.

### Spec Compliance Matrix

| Requirement | Scenario | Test evidence | Result |
|---|---|---|---|
| REQ-SDA-1 | Key never reaches the client | `tests/server/supabase-client.test.ts` (5) + **build-artifact scan**: `dist/client/` contains zero occurrences of `supabase` | COMPLIANT |
| REQ-SDA-2 | Consent survives reload | `tests/api-routes/consent.test.ts` — inserts granted row, returns persisted id | COMPLIANT |
| REQ-SDA-2 | Write failure blocks advance | `consent-screen.test.tsx` — "does NOT advance while the write is still in flight", "shows a retryable error and stays on S1", "«Reintentar» … advances once it succeeds" | COMPLIANT |
| REQ-SDA-3 | Only assigned plans listed | `tests/api-routes/plans.test.ts` — "a different operator … never the union", "empty list, not a raw plan listing" | COMPLIANT |
| REQ-SDA-4 | Redo is soft-delete plus insert | `records-delete.test.ts` — "marks the row deleted", "never issues a hard delete (RF-21)", "preserves the original quantity" | COMPLIANT |
| REQ-SDA-5 | Unassigned plan write rejected, no DB touch | `records-write.test.ts` — "403 and writes nothing", "refuses before reading count_records at all", "authorizes first … before any lookup"; `authz.test.ts` (7) | COMPLIANT |
| REQ-AV-1 | Out-of-range count flags | `validation.test.ts` | COMPLIANT |
| REQ-AV-1 | In-range count passes | `validation.test.ts` | COMPLIANT |
| REQ-AV-2 | Anomaly survives reload | `records-write.test.ts` — "writes record_anomalies from its OWN verdict, ignoring the client claim"; read back by `auditor-records.test.ts` | COMPLIANT |
| REQ-AV-3 | Response payload is blind | `validation.test.ts` RF-18 block (3) + `anomaly-check.test.ts` route-level + `records-write.test.ts` route-level | COMPLIANT |
| REQ-OE-1 | Batch and lines created | `export.test.ts` — exclusion of soft-deleted and open-anomaly records, contiguous renumbering | COMPLIANT |
| REQ-OE-2 | File content equals persisted lines | `export.test.ts` — "emits a body matching the persisted lines 1:1" | COMPLIANT |
| REQ-OE-2 | Failure is honest | `export.test.ts` — "error and NO csv body when the line insert fails" / "…when the batch insert fails" | COMPLIANT |
| **REQ-OCF-13** | **Records survive reload** | **none — no `GET /api/records`, no restore-on-mount, no test** | **UNTESTED** |
| REQ-OCF-4 | No voice mutation path | `reducer.test.ts`, `count-session.test.tsx` | COMPLIANT |
| REQ-OCF-4 | Redo persists as soft-delete plus new row | `count-session.test.tsx` + `records-delete.test.ts` | COMPLIANT |
| REQ-OCF-8 | Selected plan carries a real catalogue_id | `plans-screen.test.tsx` — "dispatches PLAN_STARTED with the plan, operator, warehouse and catalogue", "refuses to start a plan with no catalogue bound to it" | COMPLIANT |
| REQ-OCF-8 | Only assigned plans are offered | `plans-screen.test.tsx` + `plans.test.ts` | COMPLIANT |
| REQ-OCF-10 | No retention claim survives | `consent-screen.test.tsx` | COMPLIANT |
| REQ-OCF-10 | Acceptance writes consent | `consent-screen.test.tsx` — "writes the consent … and only then dispatches MIC_GRANTED" | COMPLIANT |
| REQ-AUD-3 | Requieren mirada shows only open alerts | `auditor-review.test.tsx` | COMPLIANT |
| REQ-AUD-3 | Operator write appears to auditor | `auditor-review.test.tsx` — "renders the records the loader returned, never a built-in fixture set" | COMPLIANT |
| REQ-AUD-4 | Approve decrements the alert pill | `auditor-review.test.tsx` | COMPLIANT |
| REQ-AUD-4 | Trace survives reload | `auditor-records.test.ts` — "reads back the persisted auditor_actions, oldest first, with the signing name" | COMPLIANT |
| REQ-AUD-5 | Blocked modal buttons act as labelled | `auditor-review.test.tsx` | COMPLIANT |
| REQ-AUD-5 | Gate lifts and export is real | `auditor-review.test.tsx` — "posts the export and hands the returned file to the saver" | COMPLIANT |

**Compliance summary**: **25/26 scenarios compliant**, 1 UNTESTED. **16/17 requirements** satisfied.

### The two non-negotiables — verified directly in source

**REQ-SDA-5 / RF-07 — plan-scope check before any DB write: CONFIRMED.**
`frontend/src/pages/api/records/index.ts` calls `assertPlanAssignment` at line 115, immediately after body decode and before every operational read or write. `resolveProductId` is deliberately placed *after* the guard with an explicit comment, so a refused caller cannot even probe which article codes exist. `frontend/src/lib/server/authz.ts` resolves the assignment before touching operational data. Enforced on both `POST /api/records` and `DELETE /api/records/[id]`, and asserted three ways: "writes nothing", "refuses before reading count_records at all", "never touches count_records while deciding".

**REQ-AV-3 / RF-18 — operator payload blindness: CONFIRMED.**
`frontend/src/lib/server/validation.ts::toOperatorVerdict` is an **explicit allowlist construction** (`type`, `severity`, `title` only), not a `delete` or spread-minus — a new sensitive field must be opted *in*. `detail`, `expectedMin`, `expectedMax`, `theoreticalQty` never cross. Titles are static constants with no interpolation, and `negative_balance` deliberately reuses the neutral `'Cantidad fuera de lo habitual'` string so the title itself cannot bound the system stock. Both operator routes (`/api/anomaly-check` line 78, `/api/records` lines 139 and 177) serialize exclusively through it. The test is genuinely strong: it first asserts the stub really supplied `expectedMax === 30` (so a pass cannot come from the value being absent), then asserts neither the forbidden **keys** nor the forbidden **values** (`'30'`, `'500'`) appear in `JSON.stringify`, plus "carries no numbers in the operator-facing title".

### Service-role key containment — CONFIRMED (stronger than required)

- `_supabase.ts` is imported by exactly 8 files, **all under `frontend/src/pages/api/`** (`consent`, `plans`, `export`, `anomaly-check`, `records/index`, `records/[id]`, `auditor/records`, `auditor/actions`), plus one test. **Zero `.tsx` components.**
- `SUPABASE_SERVICE_ROLE_KEY` appears only in `_supabase.ts`, its test, `docker-compose.yml`, and `.env.example`.
- No `PUBLIC_`-prefixed Supabase secret exists.
- **Built-artifact proof**: `grep -rli "supabase" frontend/dist/client/` returns **nothing** — the client bundle has no Supabase reference at all.
- `lib/identity.ts` does use `PUBLIC_`-prefixed vars, but only for `profiles.id` row identifiers, never credentials — correct and documented.

### `services/` untouched — CONFIRMED

`git diff --stat main..HEAD -- services/` is empty. The change is confined to `frontend/` plus `openspec/` and `docker-compose.yml`.

### The two orchestrator-driven corrections — both real, not superficial

**5.11 export item/counter COALESCE fallback: REAL.**
`itemOf`/`counterOf` in `frontend/src/pages/api/export.ts` (lines 55-68) mirror the live view's `COALESCE(sku, name_normalized)` and `COALESCE(counter_code, upper(replace(full_name,' ','.')))`. Four triangulated tests with *distinct* expected values (`SKU-1`, `ACEITE DE OLIVA 500ML`, `PABLO.RUIZ.GOMEZ`, empty/null), and each asserts against the **persisted `export_lines` row**, not the formatter's return value — so the persistence path is covered too. This genuinely fixes blank item names for the ~18.4% of the catalogue with no SKU.

**6.6/6.7 auditor system-stock + trace read-back: REAL.**
`frontend/src/pages/api/auditor/records.ts` filters `warehouse_stock_balances` on **both** ids and keys the map on the `(warehouse_id, product_id)` pair; the test proves the discrimination with a decoy row (`wh-1` qty 120 vs `wh-9` qty 7 for the same product, asserting 120 wins) — a real negative case, not a happy path. A missing balance yields `null`, explicitly distinguished from a stock of `0`. `auditor_actions` are read back with `.order('created_at', ascending)` and joined to `profiles.full_name`; the test asserts full object equality including the joined name and the ordering. Both have companion "empty list rather than omitted field" tests, so the empty-collection assertions are not orphaned. The apply report's disclosure that `stub-db.ts`'s `order()` was a silent no-op and had to be made to really sort before the ordering test could fail is exactly the right instinct and checks out.

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD Evidence reported | PASS | Two "TDD Cycle Evidence" tables in `apply-progress.md` |
| All tasks have tests | PASS | 23 test files changed; every listed file exists |
| RED confirmed (tests exist) | PASS | All 24 table rows resolve to real files |
| GREEN confirmed (tests pass) | PASS | 847/847 pass on independent execution |
| Triangulation adequate | PASS | Multi-case throughout; no single-case-for-multi-scenario found |
| Safety Net for modified files | PASS | Pre-change counts recorded for every modified file |
| Reported vs actual case counts | WARN | 4 rows drifted (see SUGGESTION-1) — all but one are undercounts from later batches |

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|---|---|---|---|
| Unit (server/pure) | ~200 | 13 | vitest |
| Component (integration) | ~250 | 5 | vitest + testing-library + preact |
| E2E | 0 | 0 | not installed |
| **Total (whole suite)** | **847** | **46** | |

E2E absence is a tooling reality, not a defect — but it is precisely the gap task 6.4 was meant to cover manually.

### Assertion Quality

Audited all 23 changed test files.

- Tautologies (`expect(true).toBe(true)`): **0**
- Lone type-only assertions (`toBeDefined()`, `not.toBeNull()`): **0**
- Smoke-test-only (render + `toBeInTheDocument` with no behavioural assertion): **0**
- CSS-class / implementation-detail assertions: **0**
- `vi.mock()` calls: **0** across all 23 files — every double is injected through a prop or parameter seam
- Orphan empty-collection assertions: **0** — each has a companion non-empty test

**Assertion quality**: All assertions verify real behaviour. This is an unusually clean suite.

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| D1 server-only client | Yes | Proven against the built bundle |
| D2 route-level RF-07 | Yes | Debt named honestly in code |
| D3 blind counting at the boundary | Yes | Allowlist serializer, not UI filtering |
| D4 async anomaly engine | Yes | but leaves 5 type errors in the untouched fixture-engine test (WARNING-1) |
| D5 optimistic records / blocking consent | Yes | `attempted` ref enforces one POST per record |
| D6 soft delete | Yes | `.delete()` proven unused |
| D7 pessimistic auditor writes | Yes | Trace only after 2xx |
| D8 single atomic export route | Yes | No orphan batches |
| D9 live schema as truth | Partial | Verified by the orchestrator, but stale "UNVERIFIED" comments remain in `validation.ts` and `records/index.ts` (SUGGESTION-2) |
| D10 additive demo seed | Yes | Ids recorded in `design.md` |

### Issues Found

**CRITICAL**

- **CRITICAL-1 — REQ-OCF-13 "Records survive reload" is unimplemented and untested.**
  The requirement states: *"reloading `/conteo` mid-count MUST restore the persisted records of the active plan session"*, with the scenario *"the same 3 records render from `count_records`"*. There is **no `GET /api/records`** route, **no `fetchRecords`** in `lib/api/operational.ts`, and **no restore-on-mount** in `CountSession.tsx` — it initialises with `useReducer(sessionReducer, initialSessionState)` and nothing rehydrates it. The traceability table maps REQ-OCF-13 to tasks 3.6/3.7/5.1, but 3.6/3.7 are reducer *write*-side events and 5.1 is the *auditor* route; none restores operator records. All three tasks were genuinely done — the task decomposition simply under-covered the requirement, so this is a traceability defect rather than a false checkbox.
  **The consequence is not cosmetic**: `initialSessionState.screen` is `'permiso'`, so a reload throws the operator back to the consent screen with an empty record list while the rows exist in Supabase. The idempotency key is client-minted (`rec-${at}-${seq}`, `reducer.ts:120`), so re-dictating the same shelf after a reload produces a *new* `client_record_id` and therefore a **duplicate `count_records` row** — double-counted inventory, which is the exact failure class this system exists to prevent.

- **CRITICAL-2 — `nr_articulo` to `products.sku` is an unvalidated assumption with a known ~18% blast radius.**
  `frontend/src/lib/server/products.ts` lines 16-23 state in their own comment that *"the matcher's `nr_articulo` IS that same code is still UNVERIFIED against live data (task 6.4)"*, while also recording that `products.sku` is **null for ~18% of the catalogue**. If the mapping is wrong, or for every SKU-less product, `resolveProductId` returns `null` and `POST /api/records` answers `400 "No encontramos ese artículo en el catálogo"` — **the operator cannot count roughly one in five articles**. No stub test can detect this (the stubs seed the very `sku` they then look up). This is not a code defect — the module fails loudly and is a one-line reconciliation by design — but it is an unretired integration risk, and it is the single strongest reason task 6.4 cannot simply be waved through. `apply-progress.md` lists it under "Remaining named debt" as *"nr_articulo to products.id resolution still missing"*, which understates it: the resolution is **implemented on an unverified assumption**, which reads as done and is therefore easier to forget than something visibly missing.

**WARNING**

- **WARNING-1 — 11 type errors introduced by this change, mis-reported as pre-existing.**
  `cd frontend && npm run check` exits **1** with 11 errors. `apply-progress.md` states *"11 type errors, all pre-existing (verified by stash in the prior batch)"*. That claim is **false**, proven four ways:
  - `git show main:frontend/src/lib/session/types.ts` has **no `unitCode`** on `CountRecord`; this change adds it as a **required** field.
  - `src/fixtures/operatorSeed.ts` (x3), `tests/components/operator/count-screen.test.tsx`, and `tests/components/operator/record-list.test.tsx` are **unmodified by this change** yet now fail with `Property 'unitCode' is missing … but required in type 'CountRecord'`. They compiled cleanly on `main`.
  - `tests/anomaly/fixture-engine.test.ts` (x5) is likewise unmodified and now fails with `Property 'kind' does not exist on type 'Anomaly | Promise<Anomaly | null>'` — a direct consequence of the D4 async widening.
  - The remaining error is `tests/session/reducer.test.ts:65`, same `unitCode` cause.
  Runtime is unaffected (vitest does not type-check; `astro build` does not check test files), so this is not a functional break. But `npm run check` is a red gate today, one error is in a **`src/` file** (`operatorSeed.ts`), and the incorrect "all pre-existing" reassurance would mislead a reviewer reading the PR description. The fix is mechanical: add `unitCode: null` to the three seed/factory literals and await the widened `check()` in the fixture-engine test.

- **WARNING-2 — `frontend/src/pages/api/auditor/records.ts` is binary to git; its 7.2 KB will not render in the PR diff.**
  `balanceKey()` (line 56) embeds a **literal NUL byte (0x00)** as the composite-key separator inside a template literal. Git therefore classifies the file as binary (`Bin 0 -> 7200 bytes` in `git diff --stat`) and `file(1)` reports `data`. The technique is valid JavaScript and a sound collision-proof delimiter, but the cost is that **an entire security-relevant route — the one carrying the auditor's `systemQty` and the RF-32 trail — is invisible to human review on GitHub**, and grep-based tooling silently skips it (it was omitted from my first import scan for exactly this reason). The fix is one token: write the six-character escape sequence (backslash-u-0-0-0-0) instead of the raw byte. Identical runtime value, the file stays text, and the diff becomes reviewable.

- **WARNING-3 — Task 6.4's descope is a legitimate deferral, but its stated rationale overstates what the tests prove.**
  My independent judgment: **the deferral itself is defensible and correctly handled** — the secret is genuinely unobtainable by any agent (Supabase's MCP surface exposes only the publishable key by design), it is marked `[~]` rather than silently `[x]`, the reasoning is written down, and a concrete "Action required before/at deploy" checklist with the exact seeded ids is recorded. That is the right way to descope; I would not block a PR on a credential only the maintainer holds.
  **But reason (1) of the rationale does not hold up.** It claims the properties 6.4 exists to prove *"are already asserted by 847 passing automated tests"*. Those tests run against `createStubDb`, a hand-written stub of the supabase-js surface. They prove the **route logic** is right; they cannot prove the **integration** is right. Concretely unretired by any test: (a) the `nr_articulo`/`sku` mapping of CRITICAL-2; (b) `COUNT_STATUS = { ok: 'confirmed', anomaly: 'flagged' }` in `records/index.ts` lines 52-55, whose own comment admits the live enum *"could not be re-verified"* — task 1.1 confirmed columns exist, not that the `status` check constraint accepts these two values; if it does not, **every count write 500s**; (c) real PostgREST semantics for `.maybeSingle()`, `.in()` with empty arrays, and `insert().select().single()` error shapes. Reasons (2) live schema/seed/RLS verification and (3) the key being unavoidable deployment configuration are both sound.
  Net: keep the descope, but record it as an **explicitly accepted deployment risk with a named owner**, not as "already covered". The first deploy is carrying real, enumerable failure modes — it should be treated as a gated smoke test with a rollback plan, not a formality.

**SUGGESTION**

- **SUGGESTION-1 — TDD evidence table case counts have drifted.** Reported vs actual: `records-delete.test.ts` 9 vs 8 (over-reported), `anomaly-check.test.ts` 6 vs 9, `http-engine.test.ts` 8 vs 9, `auditor/records.test.ts` 8 vs 12 (under-reported, from later batches). Cosmetic; the files and their green status are real.
- **SUGGESTION-2 — Stale "UNVERIFIED" comments.** `validation.ts` lines 29-33 and `records/index.ts` lines 47-51 still say the live schema *"could not be re-verified in this apply session"*. Task 1.1 was later completed by the orchestrator with no deltas. Leaving these in makes real doubt (the `COUNT_STATUS` enum, per WARNING-3) indistinguishable from resolved doubt.
- **SUGGESTION-3 — Engram `apply-progress` metadata is stale.** Observation #159 records HEAD `1c3a84e` and 13 commits; the actual state is `091f65d` and 15 commits. The file twin is current; only the Engram copy lags.
- **SUGGESTION-4 — Task ordering.** `tasks.md` lists 6.6 and 6.7 before 6.5; harmless but reads oddly.

### Verdict

**FAIL** — narrowly, on one requirement.

This is high-quality work: both non-negotiables (RF-07 ordering, RF-18 payload blindness) are correctly implemented at the boundary rather than the renderer and are backed by genuinely adversarial tests; service-role containment is proven against the built bundle; `services/` is untouched; both orchestrator-driven corrections are real and well-tested; and the assertion quality across 23 test files is exemplary (zero tautologies, zero smoke tests, zero mocks).

It fails verification because **REQ-OCF-13's reload-restore half is unimplemented, untested, and can produce duplicate `count_records` rows** — a data-integrity consequence in the system's core domain, not a cosmetic omission. That single gap, plus a red `npm run check` whose 11 errors are misattributed as pre-existing, is what stands between this and a PASS.

**Path to PASS — four concrete items:**

1. Implement REQ-OCF-13 (`GET /api/records?plan=&operator=` plus restore-on-mount in `CountSession`, RED-first) **or** formally amend the spec to defer it with the same rigour as 6.4's descope.
2. Fix the 11 type errors and correct the "all pre-existing" statement in `apply-progress.md`.
3. Replace the literal NUL byte in `auditor/records.ts` line 56 with the escape sequence so the route is reviewable in the PR.
4. Promote CRITICAL-2 (`nr_articulo`/`sku`) and the `COUNT_STATUS` enum question into the pre-deploy checklist alongside 6.4, with a named owner.

Items 2 and 3 are minutes of work. Item 1 is the real decision: implement it, or descope it explicitly and honestly the way 6.4 was.
