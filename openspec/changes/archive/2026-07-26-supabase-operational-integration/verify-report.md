# Verification Report — supabase-operational-integration

**Round**: 3 (second re-verification, fresh context)
**Change**: `supabase-operational-integration`
**Branch/HEAD**: `feat/supabase-operational-integration` @ `d0be25e`
**Mode**: Strict TDD · hybrid artifacts · single-PR (`size:exception` pre-accepted)
**Verdict**: **PASS WITH WARNINGS** — 0 CRITICAL, 5 WARNING, 2 SUGGESTION

Prior round (Engram obs #180) returned FAIL on CRITICAL-1 (auditor approval had no
writer). **CRITICAL-1 is verifiably dead** — proven below by source tracing AND by an
executed end-to-end test, not by trusting the apply report.

---

## 1. Gate Evidence (all re-run by the verifier, not copied from apply)

| Gate | Command | Exit | Result |
|---|---|---|---|
| Tests | `cd frontend && npm test` | **0** | 50 files, **914 passed / 914** |
| Types | `cd frontend && npm run check` | **0** | **0 errors, 0 warnings**, 2 hints |
| Build | `cd frontend && npm run build` | **0** | Complete (server + 4 prerendered routes) |
| RF-18 / D1 | `grep -rli supabase frontend/dist/client/` | — | **clean** (no match) |
| Secret leak | `grep -rl SERVICE_ROLE dist/client/` | — | **clean** |
| Env hygiene | `grep -rn PUBLIC_SUPABASE src/ tests/` | — | clean (only an explanatory comment) |

- `test_output_hash`: `sha256:56b6c92662f948a0498ff991e7dc8270e85f3a622d4a0116ae796aeae3c77fb9`
- `check_output_hash`: `sha256:878e01a38ee8cc020d63b568a37ebf853169ce9b5f92a01479036f39f0a61a9f`
- `build_output_hash`: `sha256:c72d211e3c70e5523edbeec08bd7066f09c5ee2df4a8502f0c7957171e49eae3`

The apply report's claim of 914/914 and 0 errors is **confirmed independently**.
(The `ECONNREFUSED :3000` text in the test log is an intentional proxy-failure test
fixture, not a failure — the run still exits 0.)

---

## 2. Column-Name Fixes (task 6.13) — REAL

Read both files in full.

**Write path** — `frontend/src/pages/api/auditor/actions.ts:116-125`: insert uses
`actor_id` and `reason`. The route's request-body names (`auditorId`, `note`) are
retained as the client wire contract, with an in-file comment explaining the
deliberate divergence. Correct.

**Read path** — `frontend/src/pages/api/auditor/records.ts:140`: selects
`record_id, actor_id, action, reason, created_at`; lines 145/159 key the auditor-name
map on `row.actor_id`; line 157 maps `row.reason` onto the DTO's wire field `note`.
Correct — and this was the extra bug found in the same pass, so the task-6.7 trail
persistence could genuinely never have loaded before this fix.

**`recount_requests`** (task 6.15) — `actions.ts:133-147`: `status: 'requested'`,
free-text column `note` (correctly the opposite of `auditor_actions.reason`), and both
NOT NULL columns `plan_id`/`product_id` sourced from the `count_records` row already
fetched at line 98 (whose select was widened to carry them) — **no second query**, as
the task required.

---

## 3. Approve/Correct Writer (task 6.14) — CORRECT, including the negative case

`actions.ts:46` `SETTLING_ACTIONS = {approve, correct}`; `settleRecord` (58-81):

1. `record_anomalies` UPDATE → `status:'resolved'`, `resolved_by`, `resolved_at`,
   `resolution_note`, filtered `.eq('record_id', id).eq('status','open')`
2. `count_records` UPDATE → `status:'verified'`

Both errors propagate to a 5xx (`actions.ts:153-158`) — a failed settle cannot report
success.

**Negative guard — I located and read the actual tests, not the description.**
`frontend/tests/server/auditor-actions.test.ts`:

- L200-207 `leaves the anomaly OPEN on a rejection` — asserts
  `record_anomalies[0].status === 'open'` **and** `count_records[0].status === 'flagged'`
- L209-216 `leaves the anomaly OPEN when a recount is requested` — same two assertions

These are assertions on **post-state**, not on mock call counts. I also verified the
double is capable of failing them: `frontend/tests/server/stub-db.ts:49-53` applies
**every** accumulated filter (so the `.eq('status','open')` guard is genuinely
exercised) and L90-97 mutates rows in place, so a regression would flip these red.

---

## 4. CRITICAL-1 Causal Chain — CLOSED end to end

Traced through source:

| Step | Location | Effect |
|---|---|---|
| Open anomaly exists | `record_anomalies{record_id, status:'open'}` | — |
| Export collects blockers | `export.ts:23-31 openAnomalyIds` — selects `record_anomalies` `.in(record_id, ids).eq('status','open')` | set contains the record |
| Flag set | `export.ts:118 hasOpenAnomaly: true` | — |
| Filter | `export.ts:49-51 isEligible` → `!isDeleted && !hasOpenAnomaly` | **record dropped** |
| Auditor approves | `actions.ts:153 → settleRecord` | anomaly row → `'resolved'`; record → `'verified'` |
| Re-export | `openAnomalyIds` now matches nothing | `hasOpenAnomaly: false` |
| Filter | `isEligible` → true | **line emitted** |

**Executed proof** (`auditor-actions.test.ts:218-254`): `handleExport` on a stub with an
open anomaly yields **0 CSV data rows**; `handleAuditorAction` `approve` on the same
stub; `handleExport` again yields exactly `['BOD-01,SKU-1,90,KG,CNT-01']`. The reported
bug is dead, demonstrated by runtime behaviour on the real handlers.

---

## 5. Fresh Live-Schema Sweep (round 3)

**Access constraint, stated honestly**: this verifier has Read/Bash only — no Supabase
MCP tooling — and the repository carries **no DDL** for the operational tables
(`docs/database/*.md` is prose; `03_teammate_seed.sql` covers only the catalogue tables:
`units`, `warehouses`, `products`, `warehouse_products`, `warehouse_stock_balances`).
Findings below are therefore **candidates**, deliberately not claimed as certainties.

### Corroboration obtained
`03_teammate_seed.sql:40,46,49` insert `products` rows with `sku = NULL`. This
**independently confirms** tasks 5.11 and 6.10 fixed a real defect, not a hypothetical
one — a null-SKU catalogue is a fact of the seed data.

### WARNING-1 — `lib/server/validation.ts` is the last self-declared UNVERIFIED module (highest residual risk)
Lines 29-32 carry their own admission that the column names were never verified live.
It reads `product_count_ranges` with
`.select('expected_min, expected_max, expected_unit_code').eq('product_id',…).eq('warehouse_id',…)`.
Two unconfirmed assumptions: (a) that `product_count_ranges` is keyed by
**warehouse too** — every doc describes it as per-product statistical bounds derived
from history, and `warehouse_id` on that table is corroborated nowhere; (b) that
`expected_unit_code` exists on it.

**Why this one matters most**: both reads discard the error
(`const { data } = await db…`). A wrong column yields `data: null` → `readRange`
returns `null` → `checkUnit` and `checkRange` both short-circuit → **only
`negative_balance` can ever fire**. Anomaly detection silently degrades to a third of
its rules with no error surfaced anywhere. Same bug class as 6.12/6.13/6.15, but on a
**read** path — which is exactly why none of the write-path fixes would have caught it.

### WARNING-2 — `lib/server/authz.ts:57` selects `audit_plans.catalogue_id`
Error discarded. If the column is absent live, `plan` is `null` and **every operator
write and the resume read** are refused with the misleading `El plan no existe.`
Blast radius is total; introduced by this branch's own commit `c304063`. Partially
mitigated by task 1.5 having seeded a plan described in catalogue terms — inference,
not verification.

### WARNING-3 — systemic error-swallowing on read paths
**19** Supabase read call sites destructure `data` and drop `error`
(`authz.ts` ×2, `validation.ts` ×2, `export.ts` ×5, `records/index.ts` ×4,
`products.ts`, `records/[id].ts`, `auditor/actions.ts`, `plans.ts` ×2,
`auditor/records.ts`). This is the structural reason all three verification rounds found
bugs only on **write** paths: writes capture `error` and return 5xx; reads swallow it
and return empty. Every remaining live-schema read risk is **silent by construction**.

### WARNING-4 — auditor `correct` settles the record but its corrected quantity never reaches Oracle
`AuditorReview.tsx:417` sends `newQuantity`; `actions.ts:121` stores it in
`auditor_actions.new_quantity`; **nothing writes `count_records.quantity`** (grep: zero
matches); `export.ts:114` reads `count_records.quantity`. Net: an auditor corrects
90 → 12, the record renders "Verificado" and becomes export-eligible, and **Oracle
receives 90**.

Classified WARNING, not CRITICAL, on the evidence: no spec scenario asserts it —
REQ-AUD-4's scenarios cover the `auditor_actions` row, the "Verificado" badge, the
alert-pill decrement and reload survival, all of which pass — and REQ-OE-1/OE-2 do not
pin which quantity is exported. `audit_reconciliations`, the schema's designed home for
"la cifra aprobada", is referenced nowhere in the codebase and is explicitly outside this
change's scope. It is nonetheless the most consequential functional gap found this round.

### Candidates I could not retire (no live access)
Enum literals: `count_records.source='voice'`; `record_anomalies.status='open'|'resolved'`
and its `type`/`severity` values; `voice_consents.status='granted'`;
`export_batches.status='generated'` / `format='csv'`; the four `auditor_actions.action`
verbs; `audit_plans.status='active'`. NOT NULL completeness for the `count_records`,
`record_anomalies`, `voice_consents`, `export_batches` and `export_lines` inserts.
Verified-correct already: `count_records.status` ∈ {`recorded`,`flagged`,`verified`} and
`recount_requests.status='requested'`.

---

## 6. services/ and Merge Integrity — CLEAN

| Check | Result |
|---|---|
| `git diff main...HEAD --stat -- services/` | **empty** — services untouched |
| `main` (`0fe1c3a`) ancestor of HEAD | **yes** — branch fully contains main; PR diff is 85 files, +9848 / -450 |
| `catalogues.ts` + `tests/catalogues/` vs main | **empty diff** — main's redis-catalogue-cache version adopted verbatim |
| Branch diff touching redis/catalogue/cache files | **zero** |
| `export const CATALOGUES` | defined **once** |
| Conflict markers in `src/`/`tests/` | **none** |
| Working tree | clean |

No revert, no duplication of `redis-catalogue-cache` work.

---

## 7. Strict TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | PASS | apply-progress carries the cycle table for the 6.13/6.14/6.15 batch |
| Test files exist | PASS | 37 test files; all named RED files present |
| GREEN confirmed by execution | PASS | 914/914 at exit 0 on re-run |
| Triangulation | PASS | 6.14 alone adds positive, negative (×2) and end-to-end cases |
| Safety net | PASS | 36/36 reported pre-change (actions + records + export) |

### Assertion Quality — clean
| Pattern | Found |
|---|---|
| Tautologies (`expect(true).toBe(true)`) | **0** |
| Type-only assertions used alone | **1** across the whole suite |
| Ghost loops over possibly-empty collections | **0** |

The RF-18 blindness tests are genuinely strong, not smoke tests: `validation.test.ts:164-170`
and `anomaly-check.test.ts:75-76` assert on the **serialized** payload with `not.toContain`
for both the key names **and** the literal figures (`'30'`, `'500'`), and
`validation.test.ts:127` asserts `anomaly_evidence` is never touched on an operator path.
REQ-OE-2 is covered by `export.test.ts:190-196` (insert failure → 5xx **and** body free of
`subinventory`).

**Test distribution**: server 130 · components 155 · api-routes 41 · anomaly 23 · session 12 · auditor 12.

---

## 8. Task Completion

**59/60 complete.** The only open item is **6.4** (`[~]`, manual live E2E), deliberately
descoped with documented rationale and a named pre-deploy action — not silently dropped.

### Reassessment of 6.4 after three rounds

My assessment **has** changed — but not toward blocking.

The record: 6 distinct live-schema defects across three rounds (6.12 enum; 6.13 write
column; 6.13 read column; 6.15 ×3), plus two schema-semantics defects (5.11, 6.10). **Zero
were caught by the stub suite**; every one was caught by comparing code against a
`list_tables` dump. That is structural, not bad luck: the stub is defined by the tests, so
tests and code can be consistently wrong together. The 914 assertions prove the **logic**;
they prove nothing about the **names**.

Two things now bound that risk differently:

1. **Write paths — "first deploy is the smoke test" still holds.** Every write site has now
   been read against the live dump at least once. Writes also **fail loudly** (5xx), so a
   residual write bug is a 30-second discovery on first real use.
2. **Read paths — it no longer holds.** They have not had the same treatment and they
   **swallow errors**. `validation.ts` is the clear case: a smoke walkthrough that dictates a
   normal quantity and sees no anomaly **cannot distinguish "correctly clean" from "silently
   blind"**. The rehearsal would pass while anomaly detection is dead.

**Revised requirement for 6.4 (cheap, does not block this PR)**: the post-deploy walkthrough
must add one **negative control** — dictate a quantity deliberately outside
`product_count_ranges` for a seeded product and confirm an anomaly actually fires **and** a
`record_anomalies` row lands. Without that step the walkthrough is not evidence.

---

## 9. Spec Compliance Matrix

| Requirement | Status | Evidence |
|---|---|---|
| REQ-SDA-1 server-only client | PASS | `supabase-client.test.ts`; dist/client grep clean |
| REQ-SDA-2 blocking consent | PASS | `consent.test.ts` (5xx on insert failure) |
| REQ-SDA-3 plan-based selection | PASS | `plans.test.ts` (no raw listing) |
| REQ-SDA-4 voice-creates-only / soft delete | PASS | `records-delete.test.ts` asserts `.delete()` never called |
| REQ-SDA-5 route-level authz (RF-07) | PASS | `authz.test.ts` — refusal precedes any data touch |
| REQ-AV-1 server-side validation | PASS (logic) | `validation.test.ts` — see WARNING-1 on live column names |
| REQ-AV-2 anomalies persisted + resolved | PASS | 4.7 insert + 6.14 resolution, both tested |
| REQ-AV-3 RF-18 blind payload | PASS | serialized-payload assertions incl. literal figures |
| REQ-OE-1 batch + lines, eligibility | PASS | `export.test.ts`; `isEligible` traced |
| REQ-OE-2 no download without persistence | PASS | `export.test.ts:190-196` |
| REQ-OCF-4 / 8 / 10 / 13 | PASS | delete-then-new; plan-based; blocking consent; resume suite |
| REQ-AUD-3 live reads, fixtures retired | PASS | `auditor-records.test.ts` |
| REQ-AUD-4 persisted trace + Verificado | PASS | trail read-back + 6.14 settle; see WARNING-4 on corrected qty |
| REQ-AUD-5 export gate real | PASS | gate behaviour + real batch/download |

---

## 10. Issues

**CRITICAL (0)** — none. Nothing blocks archive or PR.

**WARNING (5)**
1. `validation.ts` live column names unverified **and** failure is silent — anomaly
   detection could degrade to `negative_balance` only, undetectably.
2. `authz.ts` `audit_plans.catalogue_id` unverified; if absent, all writes refused with a
   misleading message.
3. 19 read call sites discard `error` — residual schema drift fails silently by construction.
4. Auditor `correct` settles the record but the corrected quantity never reaches Oracle.
5. Task 6.4 remains open; its "first deploy is the smoke test" justification no longer
   covers the read paths without an added negative control.

**SUGGESTION (2)**
1. Before merge, run one `list_tables(verbose)` diff over the ~8 enum literals and the 5
   insert column sets listed in §5. It costs minutes with tooling the orchestrator already
   has and would retire most of WARNING-1/2 and all the open candidates.
2. Introduce a shared read helper that surfaces `error` (log or 5xx) so future schema drift
   fails loudly instead of degrading silently — the structural fix behind WARNING-3.

---

## Verdict: PASS WITH WARNINGS

The regression that caused the previous FAIL is closed and demonstrated by executed
behaviour. All gates are genuinely green at exit 0, verified first-hand. The 6.13/6.14/6.15
fixes are real, correctly implemented, and correctly guarded on the negative case.
`services/` is untouched and the merge preserved `redis-catalogue-cache` exactly.

No warning above is a spec violation or a broken declared requirement. The residual risk is
concentrated in live-schema facts that **only credentials can retire** and that have been
explicitly and repeatedly named as accepted debt, plus one functional gap no spec scenario
asserts. Blocking on that would not make the code more correct — it would only delay the
credential-dependent check that must happen at deploy regardless.

**Cleared to open the PR.** Carry WARNING-1 and the revised 6.4 negative control into the
deploy checklist, where they are actually actionable.
