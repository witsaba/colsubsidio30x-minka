```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:06d1faad303e3389296ee513a773b886ba73f991f2cfb1a3f796d62504e06d8b
verdict: fail
blockers: 1
critical_findings: 1
requirements: 16/17
scenarios: 25/26
test_command: cd frontend && npm test
test_exit_code: 0
test_output_hash: sha256:b474310c3d84a1952bd34bc54ba82b3d8ce604bf447625a73459cc8dc3852730
build_command: cd frontend && npm run build
build_exit_code: 0
build_output_hash: sha256:705ff1d9060712a82a6b70c4da6ddf0d687be4a1e477f9ef5004797ccddc98bd
typecheck_command: cd frontend && npm run check
typecheck_exit_code: 0
typecheck_output_hash: sha256:042cd8fba1ef8fda93aa4d9626a5bb565d1eb0fdbe0eab43a45cf7d2dbbb39e1
```

## Verification Report (RE-VERIFICATION — supersedes obs #180)

**Change**: supabase-operational-integration
**Branch**: `feat/supabase-operational-integration` @ `7112221`, 23 commits ahead of merge-base `932ba2c`
**Worktree**: `colsubsidio30x-minka-worktrees/supabase-operational-integration`
**Mode**: Strict TDD
**Scope of this pass**: independent re-execution of all three gates + verification of the five
remediation claims (6.8–6.12) + a fresh sweep for live-schema-dependent defects.

---

### Completeness

| Metric | Value |
|--------|-------|
| Task lines | 57 |
| Complete `[x]` | 56 |
| Partial `[~]` | 1 (6.4 — live E2E, credential-blocked, formally descoped) |
| Unstarted `[ ]` | 0 |

`apply-progress.md` header still reads "55 of 56"; tasks.md now carries 57 lines after 6.12. Cosmetic drift only.

---

### Build & Tests Execution — all three re-run by this verifier, nothing inherited

| Gate | Command | Exit | Result |
|---|---|---|---|
| Tests | `cd frontend && npm test` | **0** | **50 files, 906 passed, 0 failed** |
| Types | `cd frontend && npm run check` | **0** | **0 errors, 0 warnings**, 2 hints (`toThrowError` deprecation) |
| Build | `cd frontend && npm run build` | **0** | 4 static routes prerendered, server built |

All three are genuinely clean. The prior pass's 11 type errors are gone (verified by
execution, not by report). One piece of stderr noise in the test log: several
`ECONNREFUSED ::1:3000` aggregate errors. These are component tests exercising a real
relative `fetch` under jsdom's default origin; the connection refusal IS the failure path
under test, so they do not fail the suite — but the suite would behave differently if a dev
server were listening on port 3000. Noted, not blocking.

---

### Remediation verification — the five claims from obs #180

| # | Claim | Verdict | Evidence |
|---|---|---|---|
| 6.8 | NUL byte removed from `auditor/records.ts` | **CONFIRMED** | `git show HEAD:...auditor/records.ts \| file -` → `JavaScript source, Unicode text, UTF-8 text`. `git diff --stat` vs merge-base shows **191 text insertions**, not `Bin`. Zero binary files in the whole branch diff (`git diff --numstat` has no `-  -` rows). |
| 6.9 | 11 type errors fixed at the design level (D4) | **CONFIRMED** | `npm run check` exit 0. `AnomalyEngine.check` is uniformly `Promise<Anomaly \| null>`; the union is gone. |
| 6.10 | `resolveProductId` name fallback, wired end to end | **CONFIRMED — not dead code** | See "Product resolution" below. |
| 6.11 | REQ-OCF-13 session resume | **CONFIRMED — real, tested, RF-18-clean** | See "REQ-OCF-13" below. |
| 6.12 | `COUNT_STATUS.ok = 'recorded'` | **CONFIRMED — and independently corroborated in-repo** | See "COUNT_STATUS" below. |

#### REQ-OCF-13 — session resume is real

Three pieces, all present and exercised:

- `GET /api/records` (`handleListRecords`, `src/pages/api/records/index.ts:225`). `assertPlanAssignment`
  runs FIRST (line 234), before any `count_records` access — a read is authorised exactly like a write.
  Soft-deleted rows excluded (`.eq('is_deleted', false)`, RF-21). Returns `client_record_id` as `id`
  plus the server uuid as `serverId`, which is the whole point: a resumed session reuses the
  idempotency key instead of minting a new one.
- **RF-18 boundary CONFIRMED by projection**: line 257 selects `record_id, type, severity, title`
  from `record_anomalies` — `detail` and `expected_unit_code` are never named, so there is no field
  to forget to strip. `tests/server/records-read.test.ts:229-261` is a no-false-pass test: it seeds
  `expected_min: 20 / expected_max: 40 / theoretical_qty: 500`, first asserts the stub really holds
  `detail === 'expected 20-40, got 7'`, then asserts the serialised response contains none of
  `expected_min`, `expectedMin`, `expected_max`, `theoretical`, `systemQty`, `detail`, `'500'`, `'40'`.
- **`sessionStorage` carries exactly four ids, and nothing else.** `src/lib/session/resume.ts:100-108`
  writes an explicit projection (not a spread) of `catalogueId`, `planId`, `operatorId`, `warehouseId`.
  `tests/session/resume.test.ts:98` asserts the stored key set by **exact equality** against those four
  names — no quantity, no theoretical figure, no count can reach storage. Every storage failure mode
  (absent / corrupt / partial / blocked) collapses to `null`.
- `CountSession.tsx:161-195` mount effect: one attempt per mount (`resumeAttempted` ref), re-acquires
  the mic BEFORE resuming, and returns without dispatching on ANY failure — staying on consent rather
  than resuming an empty list, which would recreate the double-write. `SESSION_RESUMED`
  (`reducer.ts:219`) is accepted only from `screen === 'permiso'` and advances `recordSeq` past the
  restored ids. Added to the `no-soft-lock.test.ts` event alphabet (line 111).

Coverage: 14 route tests + 12 pure resume tests + 11 component tests + 6 reducer cases.

#### Product resolution — the fallback is reachable, not just present

`src/lib/server/products.ts:84`: explicit uuid → `sku` → `normalizeProductName(articulo || spokenName)`
against `name_normalized`, `limit(1)` (not `maybeSingle()`, which PostgREST errors on duplicate
normalized names). Failure contract unchanged: `null`, never a throw.

**Wired on BOTH server paths** — the previous report's specific warning is answered:

- write path: `CountSession.tsx:311-313` passes `articulo: record.articulo` → `CreateRecordInput.articulo`
  (`operational.ts:86`) → `createRecord` sends the whole input object → `readInput`
  (`records/index.ts:80`) → `resolveProductId`. The "some identity required" guard at line 87 accepts
  the name alone.
- anomaly path: `httpEngine.ts:85,101` sends `articulo: item.picked.articulo` → `readCountFacts`
  (`anomaly-check.ts:45`) → `resolveProductId` (line 73). Same relaxed guard at line 50.

12 resolver tests including "resolves a sku-less product when the caller carries no nr_articulo at
all", "folds accents and case the way the catalogue stored the name", and "queries name_normalized,
not name".

#### COUNT_STATUS — corroborated by a second, non-circular witness

`records/index.ts:55-58` is now `{ ok: 'recorded', anomaly: 'flagged' }`. `'confirmed'` survives
only inside the explanatory comment (grep of `src/` + `tests/` finds no other occurrence).

Beyond taking the orchestrator's enum as given, this verifier found **independent in-repo
corroboration**: `design.md:98` records the live `v_oracle_export_preview` definition captured via
`pg_get_viewdef` against the same project —

```
WHERE NOT cr.is_deleted AND cr.status = ANY (ARRAY['recorded','verified']);
```

The live view itself names `recorded` and `verified` as `count_records.status` members and does not
name `confirmed`. Two independent live reads agree. This fix is sound.

---

### Non-negotiables — re-confirmed

| Invariant | Status | Evidence |
|---|---|---|
| RF-07 route-level plan scoping | ✅ | `assertPlanAssignment` first on POST, DELETE and the new GET; `resolveProductId` deliberately after it so a refused caller cannot probe the catalogue. |
| RF-18 operator blindness | ✅ | `toOperatorVerdict` is an explicit allowlist; the new read route is blind by projection. |
| Service-role containment | ✅ | 9 real importers of `_supabase.ts`, all `pages/api/*` + 1 test. `lib/identity.ts` and `lib/server/db.ts` only MENTION it in comments. `grep -rli supabase frontend/dist/client/` → empty; `SERVICE_ROLE` → empty. |
| No `PUBLIC_SUPABASE*` secret | ✅ | Only a comment in `_supabase.ts`. |
| `services/` untouched | ✅ | `git diff --stat $(git merge-base main HEAD)..HEAD -- services/` is empty. (A plain `main..HEAD` diff is misleading — see WARNING-2.) |
| RF-21 soft delete only | ✅ | The ONLY `.update()` / `.delete()` / `.upsert()` / `.rpc()` call in all of `src/` is the soft delete at `records/[id].ts:50`. |

### Assertion quality (Strict TDD Step 5f) — batch 6.8–6.12

| File | Tests | Assertions | Tautologies | `vi.mock()` | Lone type-only |
|---|---|---|---|---|---|
| `tests/server/products.test.ts` | 12 | 15 | 0 | 0 | 0 |
| `tests/server/records-read.test.ts` | 14 | 18 | 0 | 0 | 0 |
| `tests/session/resume.test.ts` | 12 | 14 | 0 | 0 | 0 |
| `tests/components/session/count-session-resume.test.tsx` | 11 | 13 | 0 | 0 | 0 |
| `tests/server/records-write.test.ts` | 19 | 37 | 0 | 0 | 0 |

**Assertion quality**: ✅ All assertions verify real behaviour. Zero mocks — every seam is a prop or
parameter. TDD Cycle Evidence tables present in `apply-progress.md` for all three batches
(lines 143, 252, 324).

---

## CRITICAL-1 (NEW) — auditor approval never persists, and approved records are silently dropped from the Oracle export

**This is the same defect class as the previous pass's CRITICAL-1: a read path whose writer does not exist.**

`src/lib/auditor/records.ts:127` decides the "Verificado" badge from persisted state:

```ts
verified: dto.status === VERIFIED,   // VERIFIED = 'verified'
```

and `alertOf` (line 42) counts an alert only while `anomaly.status === 'open'`.

**No code path in the entire `src/` tree ever writes `count_records.status = 'verified'`, and none ever
moves `record_anomalies.status` off `'open'`.** Exhaustively verified: the only mutation of an existing
row anywhere in `src/` is the soft delete at `records/[id].ts:50`. `POST /api/auditor/actions` inserts
an `auditor_actions` row (and, for `request_recount`, a `recount_requests` row) and stops there.

Three consequences, all confirmed in source:

1. **REQ-AUD-4's "Approving an alerted record MUST mark it 'Verificado' and decrement the open-alert
   count" is session-local only.** `AuditorReview.tsx` `sign()` flips `verified` inside `setLoad(...)`
   — in-memory React state. On reload the record comes back with `status = 'flagged'` and an anomaly
   still `open`, so the badge reverts and the header pill re-increments. Task 6.7 made the *trace*
   survive; the *verdict* does not. "Requieren mirada" can therefore never be emptied across reloads.
2. **The Oracle export silently omits exactly the records the auditor just approved.** In-session the
   gate lifts (`openAlerts === 0`), the auditor clicks "Generar y descargar", and `POST /api/export`
   re-reads the truth from the database: `openAnomalyIds` (`export.ts:23-31`) queries
   `record_anomalies` where `status = 'open'`, still finds those rows, sets `hasOpenAnomaly: true`
   (line 118), and `buildExportLines` filters them out (`lib/server/export.ts:49`). The CSV is
   truncated with **no error**, and `export_batches.record_count` is written from the truncated
   `lines.length` (line 131), so the database corroborates the truncated file. Nobody sees the loss
   until the warehouse notices missing lines in Oracle.
3. Net effect: **any record that ever carried an anomaly is permanently unexportable.**

**Why the 906-test suite cannot catch it**: `tests/auditor/records.test.ts:169` seeds
`dto({ status: 'verified' })` directly and asserts the mapper handles it. The mapper does. The test
proves the reader works while no writer exists — the same structural blind spot that hid
`COUNT_STATUS = 'confirmed'`.

**Classification note**: like the previous REQ-OCF-13 finding, this is a *decomposition* defect, not a
false checkbox — no task ever asked for the status write. REQ-AUD-4/REQ-AUD-5 are MODIFIED
requirements OF THIS CHANGE and `records.ts:127` is code authored by this change, so it is in scope.

**Smallest correct fix**: in `handleAuditorAction`, after the `auditor_actions` insert succeeds, for
`action === 'approve'` also `update` the record's open `record_anomalies` rows to a resolved status and
set `count_records.status = 'verified'` (a member of the live enum, and the value
`v_oracle_export_preview` already treats as exportable alongside `recorded`). RED first: a test
asserting that after an approve, a subsequent `handleExport` INCLUDES the previously-flagged record.
Both writes need their live enum values confirmed (see WARNING-3).

---

## WARNING-1 — the `name_normalized` fallback rests on an unverified normalization rule

`normalizeProductName` (`products.ts:53`) does NFD + strip the U+0300-U+036F combining range + collapse whitespace +
uppercase, preserving punctuation. The real seed (`docs/database/03_teammate_seed.sql`) confirms the
punctuation and case halves exactly — `'caf. Velas suministros'` → `'CAF. VELAS SUMINISTROS'`,
`'ARAGAN MEDIANO 51 CMS C/PALO 1.50'` unchanged.

**What no sample in the repo proves is the diacritic half.** Every seeded name is already unaccented.
If the ingest's `name_normalized` only upper-cases and does NOT fold accents, then for every Spanish
catalogue name containing `Á É Í Ó Ú Ñ` (AZÚCAR, PIÑA, JAMÓN, MAÍZ, ATÚN, LIMÓN, PLÁTANO…) the JS side
produces `AZUCAR` while the column holds `AZÚCAR`, and the 6.10 fallback silently never matches —
leaving exactly those sku-less products still uncountable. The stub suite cannot detect this because
every test seeds `name_normalized` with the value it then looks up.

**One query settles it** (for the orchestrator, who has live access):
`select name, name_normalized from products where name ~ '[áéíóúÁÉÍÓÚñÑ]' limit 10;`

## WARNING-2 — the branch is 26 commits behind `main` and will NOT merge cleanly

`main` has advanced from `932ba2c` to `0fe1c3a` (the whole `redis-catalogue-cache` line merged). A
read-only `git merge-tree --write-tree main HEAD` reports **two real content conflicts**:

- `frontend/tests/components/operator/plans-screen.test.tsx`
- `frontend/tests/session/no-soft-lock.test.ts`

and `main` now contains `4d3697f fix(frontend)!: speak the warehouse-code catalogue vocabulary` — a
BREAKING frontend change to exactly the catalogue vocabulary this branch's `catalogueId` plumbing and
`CATALOGUES[0]` test fixtures depend on.

Consequence for routing: **the 906/906 green measured here describes the stale base, not what would
land on main.** All three gates must be re-run after the rebase/merge, before the PR is considered
verified. (Also note any plain `git diff main..HEAD` is now misleading — use the merge-base.)

## WARNING-3 — nine live-schema literals still unverified (the same class as `'confirmed'`)

Task 6.12 is proof this class is *present*, not theoretical. Every literal below is a value or column
this code writes/expects that no stub can validate. Ranked by blast radius, for the orchestrator to
check against project `blvdxsoaopcvtzawvgbt`:

| # | Literal | Where | If wrong |
|---|---|---|---|
| 1 | `record_anomalies.type` ∈ `unit_mismatch`, `atypical_quantity`, `negative_balance` | `validation.ts:209,216,224` | **Amplified**: the insert failure at `records/index.ts:181` is only `console.error`'d, so the count row is written `status='flagged'` while NO anomaly row exists — the auditor never sees the flag AND the export happily ships the record. `docs/database/DATABASE_ARCHITECTURE.md:217` names the vocabulary `'invalid_unit'`, not `'unit_mismatch'` (that doc is a stale/aspirational design — its `count_records.status` list is flatly wrong vs the live enum — but the naming divergence is a real signal). |
| 2 | `record_anomalies.severity` ∈ `warning`, `error` | `validation.ts` | Same silent-loss path as #1. |
| 3 | `record_anomalies.status = 'open'` | `records/index.ts:111`, read by `export.ts:29` | Export eligibility and the auditor badge both hinge on it. |
| 4 | `count_records.source = 'voice'` | `records/index.ts:159` | Every count write 500s (the `'confirmed'` failure mode again). |
| 5 | `auditor_actions.action` ∈ `approve`, `correct`, `reject`, `request_recount` | `actions.ts:66` | Every auditor action 500s. |
| 6 | `export_batches.status = 'generated'`, `format = 'csv'` | `export.ts:129-130` | Export 500s after the CSV is already built. |
| 7 | `recount_requests.status = 'open'` + columns `record_id, requested_by, status, reason` | `actions.ts:83-88` | "Pedir reconteo" 500s. This table was not in task 1.1's verified set. |
| 8 | `voice_consents.status = 'granted'` | `consent.ts:36` | S1 consent blocks the whole flow (REQ-SDA-2 makes it blocking by design). |
| 9 | `count_records.status = 'verified'` + a resolved value for `record_anomalies.status` | needed by CRITICAL-1's fix | Blocks the fix. |

**Resolved by this pass, no action needed**: `products.name` and `products.sku` both exist —
independently confirmed from already-merged, live-running code, `main`'s
`services/matcher/src/matcher/supabase_source.py:46` (`products!inner(name,sku)`). `units.code` and
`units.label_es` exist — confirmed by `docs/database/03_teammate_seed.sql:6-11`.

## WARNING-4 — task 6.4's descope: keep it, but harden it. The rationale has weakened, not strengthened.

Re-judged as asked. The **deferral itself remains correct**: `SUPABASE_SERVICE_ROLE_KEY` is
structurally unobtainable by any agent (Supabase MCP exposes only the publishable key by design), it
is unavoidable production configuration regardless, and the task is honestly marked `[~]` with a
recorded decision. Blocking a PR on a secret only the maintainer holds would be theatre.

But the **stated rationale is now demonstrably weaker than when it was written**, and the conclusion
should move with the evidence:

- Rationale (1) — "the properties 6.4 exists to prove are already asserted by 847 tests" — was already
  wrong for integration concerns, and 6.12 has now *proved* it wrong by counterexample: a bug that
  would have 500'd **every single count write in production** sat under 906 green tests, and was found
  only by a human/orchestrator with live schema access.
- The premise in this re-verification's brief — that the two bugs 6.4 was implicitly covering are now
  fixed by other means — holds for those two, but **CRITICAL-1 above is a third**, and it is precisely
  a 6.4-shaped finding: 6.4's own script is "auditor approve → export CSV", which surfaces the silent
  truncation in about sixty seconds. WARNING-3 lists nine more.
- "First deploy IS the smoke test" is true but incomplete: a first deploy at Colsubsidio with
  CRITICAL-1 unfixed does not fail loudly, it hands the warehouse a short file.

**Revised recommendation**: keep the descope; upgrade the pre-deploy item from a prose paragraph to a
**hard gate with a named owner and an explicit checklist** — the WARNING-3 table row by row, then the
6.4 walkthrough, with an agreed rollback if any row fails. Do not let it enter the PR as
"already covered".

---

### Suggestions

- **S1 — `tasks.md` itself now contains a literal NUL byte.** Offset 20172, **line 111** — inside the
  text of task 6.8, in the phrase "Replace the raw byte with the `<NUL>` escape". Introduced by
  `4b37ef6`, the very commit that added the task instructing removal of a NUL byte. `file(1)` reports
  `data`; POSIX `grep` returns nothing on this file (this verifier hit it three times before
  diagnosing it). **Impact is narrower than the 6.8 case**: git still diffs it as text (150
  insertions) because the byte sits past git's 8 KB binary-sniff window, and ripgrep reads it fine —
  so the PR diff is unaffected. Same one-token fix.
- **S2 — `resolveProductId` does not filter `products.is_active`**, while the matcher does
  (`products.is_active=eq.true`). Combined with `limit(1)` and no ordering, a count can be attributed
  to a retired catalogue row when an active and an inactive product share a normalized name.
- **S3 — stale doubt comment.** `products.ts:13-23` still declares the `nr_articulo` ↔ `sku` mapping
  "UNVERIFIED against live data (task 6.4)" directly above the fallback that was added precisely to
  survive that uncertainty. Real doubt and stale doubt now read identically.
- **S4 — traceability drift.** The table still maps `REQ-OCF-13 → 3.6, 3.7, 5.1`. The implementing
  task is 6.11; 5.1 is the auditor route. This mis-mapping is what let the requirement go unimplemented
  for 15 commits.
- **S5 — `apply-progress.md` header says "55 of 56 tasks"**; tasks.md now carries 57 (56 `[x]` + 1 `[~]`).
- **S6 — `handleListRecords` maps every non-`flagged` status to `'ok'`** (`records/index.ts:297`),
  including `verified`, `discarded` and `pending_sync`. Harmless while only this app writes the column;
  worth an explicit map once CRITICAL-1 introduces `verified`.
- **S7 — test-suite port coupling.** Several component tests reach a real relative `fetch` under
  jsdom's `localhost:3000` origin and depend on the connection being refused. Inject the seam or stub
  `fetch` so the suite does not depend on nothing listening on that port.

---

### Spec compliance matrix

| Requirement | Scenario | Covering test | Result |
|---|---|---|---|
| REQ-SDA-1 | Key never reaches the client | `tests/server/supabase-client.test.ts` + `grep dist/client` | ✅ COMPLIANT |
| REQ-SDA-2 | Consent survives reload / write failure blocks advance | `tests/api-routes/consent.test.ts`, `consent-screen.test.tsx` | ✅ COMPLIANT |
| REQ-SDA-3 | Only assigned plans listed | `tests/api-routes/plans.test.ts` | ✅ COMPLIANT |
| REQ-SDA-4 | Redo is soft-delete plus insert | `tests/server/records-delete.test.ts`, `count-session.test.tsx` | ✅ COMPLIANT |
| REQ-SDA-5 | Unassigned plan write rejected | `tests/server/records-write.test.ts`, `authz.test.ts` | ✅ COMPLIANT |
| REQ-AV-1 | Out-of-range flags / in-range passes | `tests/server/validation.test.ts` | ✅ COMPLIANT |
| REQ-AV-2 | Anomaly survives reload | `tests/server/records-write.test.ts`, `records-read.test.ts` | ✅ COMPLIANT |
| REQ-AV-3 | Response payload is blind | `validation.test.ts`, `records-read.test.ts:229` | ✅ COMPLIANT |
| REQ-OE-1 | Batch and lines created | `tests/server/export.test.ts` | ⚠️ PARTIAL — correct for clean records; approved-then-flagged records are permanently excluded (CRITICAL-1) |
| REQ-OE-2 | File equals lines / failure is honest | `tests/server/export.test.ts` | ✅ COMPLIANT |
| REQ-OCF-4 | No voice mutation / redo semantics | `count-session.test.tsx`, `records-delete.test.ts` | ✅ COMPLIANT |
| REQ-OCF-8 | Real catalogue_id / only assigned plans | `plans-screen.test.tsx`, `plans.test.ts` | ✅ COMPLIANT |
| REQ-OCF-10 | Consent copy + acceptance writes consent | `consent-screen.test.tsx` | ✅ COMPLIANT |
| **REQ-OCF-13** | **Records survive reload** | `records-read.test.ts`, `resume.test.ts`, `count-session-resume.test.tsx` | **✅ COMPLIANT (was the prior CRITICAL-1)** |
| REQ-AUD-3 | Filters and badges / operator write appears | `auditor-records.test.ts`, `auditor/records.test.ts` | ✅ COMPLIANT |
| REQ-AUD-4 | Approve decrements pill | `auditor-review.test.tsx` | ⚠️ PARTIAL — passes in-session; the "Verificado" state does not survive reload (CRITICAL-1) |
| REQ-AUD-4 | Trace survives reload | `auditor-records.test.ts` (task 6.7) | ✅ COMPLIANT |
| REQ-AUD-5 | Blocked modal / gate lifts and export is real | `auditor-review.test.tsx`, `export.test.ts` | ⚠️ PARTIAL — the gate lifts and a real batch is produced, but the file omits the approved records (CRITICAL-1) |

**Compliance summary**: 25/26 scenarios pass as written; 3 scenarios pass only because they are
asserted in-session, and the requirement text behind them ("MUST mark it 'Verificado'") is not durably
satisfied.

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| D1 server-only client | ✅ | Build-artifact proof. |
| D2 request identity, route re-checks | ✅ | `identity.ts` is comment-only w.r.t. `_supabase`. |
| D4 `AnomalyEngine.check: Promise<Anomaly \| null>` | ✅ | The union is gone (6.9) — this is the design, restored. |
| D5 optimistic persistence | ✅ | Effect driven off record state; restored records are settled so never re-written. |
| D6 soft delete only | ✅ | Only `.update()` in `src/`. |
| D7 pessimistic trace append | ✅ | `sign()` writes before appending. |
| D8 export column layout | ✅ | Matches `v_oracle_export_preview` incl. both COALESCE fallbacks (5.11). |
| 6.11 deviation (`sessionStorage` for plan scope) | ✅ Accepted | The task said "call `fetchRecords` on mount", but `CountSession` learns `planId` only from `PLAN_STARTED`, which a reload destroys. The deviation is necessary, documented, and the stored projection is four ids asserted by exact key-set equality. |

---

### Issues Found

**CRITICAL (1)**
1. Auditor approval never persists (`count_records.status='verified'` and `record_anomalies.status`
   have no writer), so approved records are silently omitted from the Oracle CSV and the "Verificado"
   badge evaporates on reload.

**WARNING (4)**
1. `name_normalized` diacritic-folding assumption unverified — accented sku-less products may still be uncountable.
2. Branch 26 commits behind `main`; 2 real merge conflicts; `main` carries a BREAKING frontend catalogue-vocabulary change. Current green evidence does not describe the merged result.
3. Nine live-schema literals unverified; `record_anomalies.type` is the highest risk because its insert failure is only logged.
4. 6.4 descope: keep, but promote to a hard pre-deploy gate with a named owner and the WARNING-3 checklist; retire the "already covered by tests" rationale.

**SUGGESTION (7)**
S1 NUL byte in `tasks.md:111` · S2 no `is_active` filter in `resolveProductId` · S3 stale UNVERIFIED
comment · S4 traceability still maps REQ-OCF-13 to 3.6/3.7/5.1 · S5 apply-progress task count stale ·
S6 non-`flagged` status collapses to `ok` · S7 tests depend on port 3000 being closed.

---

### Verdict

**FAIL (narrow)** — every one of the five remediation claims is genuine and all three gates are
independently clean (906/906, 0 type errors, build 0), but a new CRITICAL of the same structural class
was found: an auditor's approval has no writer, so the Oracle export silently ships without the
records the auditor just approved. That is the deliverable's payload, and it fails silently.

**Do not open the PR to `main` yet.** Two things must happen first, in this order:
1. Fix CRITICAL-1 (RED-first: assert that after an approve, `handleExport` INCLUDES the previously
   flagged record), with the two enum values from WARNING-3 row 9 confirmed live.
2. Rebase or merge onto `0fe1c3a`, resolve the two test conflicts, and re-run all three gates — the
   evidence in this report is against a base that no longer exists on `main`.

Then WARNING-3 and WARNING-4 become the pre-deploy checklist, with a named owner.
