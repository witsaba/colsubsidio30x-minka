```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:c30fae3154220c9d231451eaefb52d287e677b5be30af4db7b75eed7fb459326
verdict: pass_with_warnings
blockers: 0
critical_findings: 0
requirements: 8/8
scenarios: 18/18
test_command: cd frontend && npx vitest run
test_exit_code: 0
test_output_hash: sha256:13472debd6c8ed9518cd8b4543db94f5912ea7accedc3848d5176d2b97f7e440
build_command: cd frontend && npx tsc --noEmit
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: integrate-extraction-service
**Version**: N/A (delta specs: extraction-adapter, service-proxy)
**Mode**: Strict TDD
**Worktree**: `colsubsidio30x-minka-worktrees/integrate-extraction-service` @ `5d9b3bd` (5 commits on `origin/main` 64d826f)
**Baseline used**: detached worktree at `origin/main` 64d826f (created and removed by this verification; the main checkout was never touched)

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 14 |
| Tasks complete | 14 |
| Tasks incomplete | 0 |

All 14 checkboxes were re-derived against `git diff origin/main...HEAD`, not trusted from the file.

### Build & Tests Execution

**Build / type-check**: PASSED
```text
cd frontend && npx tsc --noEmit
exit 0 — zero bytes of output
```

**Tests (frontend)**: PASSED — 977 passed, 0 failed, 0 skipped
```text
cd frontend && npx vitest run
Test Files  52 passed (52)
     Tests  977 passed (977)
exit 0
```
Baseline `origin/main`: `Test Files 50 passed (50) / Tests 921 passed (921)`.
Net +2 files, +56 tests, zero deletions, zero regressions.

**Tests (deployment)**: 4 failed, 95 passed, 1 skipped — exit 1
```text
SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... uv run pytest tests/deployment
FAILED test_compose_config.py::TestRenderedContract::test_the_matcher_renders_the_supabase_and_redis_variables
FAILED test_root_compose.py::TestSoleSurface::test_operator_docs_never_point_at_a_service_local_compose
FAILED test_root_compose.py::TestSecretSafeEnvWorkflow::test_no_committed_file_carries_a_credential_shaped_default
FAILED test_setup_env.py::TestNonInteractive::test_carries_the_template_defaults_through
4 failed, 95 passed, 1 skipped
```
The SAME command on clean `origin/main` produces **the identical 4 failures** (`diff` of sorted FAILED/ERROR ids is empty). Verified under three env configurations (bare, `SUPABASE_URL` only, full Supabase env); the failure set is byte-identical between branch and main in all three. **The branch introduces zero new failures.**

**Coverage**: Not available — no `@vitest/coverage-*` provider installed. Skipped, not a failure.

### Spec Compliance Matrix

| Requirement | Scenario | Test (runtime-verified) | Result |
|---|---|---|---|
| REQ-EXT-1 | Shape of an extracted item | `mock-adapter.test.ts > REQ-EXT-1 — item shape > every item has a numeric quantity, string-or-null unit, non-empty spokenName` | COMPLIANT |
| REQ-EXT-1 | Result is a promise | `mock-adapter.test.ts > REQ-EXT-1 — the interface is asynchronous > returns a Promise, so one signature serves the mock and the HTTP adapter` | COMPLIANT |
| REQ-EXT-4 | Resolvable unit passes through | `mock-adapter.test.ts > REQ-EXT-3 ... > yields units [kilos, botellas, cajas]` | COMPLIANT |
| REQ-EXT-4 | Utterance without a unit | `mock-adapter.test.ts > REQ-EXT-4 ... > yields quantity 5, unit null, and keeps the noun in spokenName` | COMPLIANT |
| REQ-EXT-5 | Production default is the HTTP adapter | `count-session.test.tsx > the production default is the real extraction service > calls POST /api/extract with the transcript when no adapter is injected` | COMPLIANT |
| REQ-EXT-5 | Determinism of the mock | `mock-adapter.test.ts > REQ-EXT-5 — deterministic, offline mock > returns deeply equal results for the same transcript` | COMPLIANT |
| REQ-EXT-5 | Swappability | `run-pipeline.test.ts > fan out > 3 extracted items issue 3 match calls carrying the catalogue id and the unit` (stub adapter output reaches `MatchRequest` unchanged) | COMPLIANT |
| REQ-EXT-6 | Successful mapping | `http-adapter.test.ts > successful mapping > maps producto/unidad/cantidad onto spokenName/unit/quantity` + 4-enum `it.each` | COMPLIANT |
| REQ-EXT-6 | Invalid items are dropped | `http-adapter.test.ts > invalid items are dropped, never repaired` — 8 `it.each` cases (0, -1, NaN, non-numeric, missing cantidad, blank producto, missing producto, non-object) | COMPLIANT |
| REQ-EXT-6 | Empty inventory is not a failure | `http-adapter.test.ts > yields [] for an empty validated_inventory` + `fallback.test.ts > does NOT fall back when the primary resolves to []` + `run-pipeline.test.ts > zero extracted items raise UiError("nothing_extracted") and issue no match call` | COMPLIANT |
| REQ-EXT-7 | Timeout falls back | `http-adapter.test.ts > rejects with UiError(aborted) when the abort budget expires` + `fallback.test.ts > falls back on %s — any throw counts` (UiError / TypeError / non-Error) | COMPLIANT |
| REQ-EXT-7 | Upstream 5xx falls back silently | `count-session.test.tsx > falls back to the mock silently when the extractor is unreachable` (asserts mock values reach the matcher AND no degraded copy on screen) | COMPLIANT |
| REQ-PRX-1 | Match round-trip | `proxy.test.ts > POST /api/match forwards to matcher /match` (pre-existing, still green) | COMPLIANT |
| REQ-PRX-1 | Extract round-trip | `proxy.test.ts > POST /api/extract forwards the JSON body verbatim to the extractor /api/v1/extract` — asserts `consensus_status` and `confidence_score` pass through untouched | COMPLIANT |
| REQ-PRX-5 | Default and override | `proxy.test.ts > uses the documented localhost:8003 default for the extractor` + `honours an EXTRACTOR_BASE_URL override, trailing slash included` + `ignores an extractor base smuggled into the extract query string, headers or body` | COMPLIANT |
| REQ-PRX-6 | Slow extraction inside the budget | `proxy.test.ts > extract gets its own 60 s budget` (asserts `AbortSignal.timeout` called with exactly `60_000`, and not `10_000`) + `an extractor answering at 59 s is inside the budget, so its 200 wins` | COMPLIANT (composed — see SUGGESTION 1) |
| REQ-PRX-6 | Timeout maps to the shared envelope | `proxy.test.ts > a thrown fetch on /api/extract becomes 502 proxy_unreachable` — an abort surfaces through the identical `catch` branch in `forward()` | COMPLIANT |
| REQ-PRX-6 | Upstream error passes through | `proxy.test.ts > an extractor 500 keeps its own {detail} body and status` | COMPLIANT |

**Compliance summary**: 18/18 scenarios compliant (8/8 requirements).

Note: the launch brief said "15 delta scenarios"; the retrieved spec deltas actually contain **18** (12 extraction-adapter + 6 service-proxy). All 18 were verified.

### Correctness (Static Evidence)

| Requirement | Status | Notes |
|---|---|---|
| REQ-EXT-1 async seam | Implemented | `adapter.ts` → `extract(raw): Promise<ExtractedItem[]>`; `pipeline.ts:131` awaits. Grep proves zero non-async adapter literals and zero unawaited `.extract(` call sites remain. |
| REQ-EXT-4 unit vocabulary | Implemented | `http.ts` routes `unidad` through `resolveSpokenUnit`, which normalizes + accent-strips. All four enums are in `SPOKEN_UNITS`: `KILOGRAMO→kilogramo`, `UNIDAD→unidad`, `PORCION→porcion` (accent-stripped), `LITRO→litro`. Unknown enum yields `unit: null` and the item is kept. |
| REQ-EXT-5 default flip | Implemented | `CountSession.tsx` module-level `const realExtraction = withFallback(httpExtractionAdapter, mockExtractionAdapter)`; default param is `extraction = realExtraction`. |
| REQ-EXT-6 tolerant mapping | Implemented | `toExtractedItem` drops on non-object, non-string/blank `producto`, non-number/non-finite/`<= 0` `cantidad`. Non-array `validated_inventory` → `[]`. A 2xx body never throws. |
| REQ-EXT-7 fallback | Implemented | `withFallback` catches ANY throw (`catch (cause)`, no type filter), `console.warn`s, replays the same transcript. `[]` returns normally without touching the fallback — the empty case never enters the catch. |
| REQ-PRX-1/5/6 proxy | Implemented | `extract.ts` mirrors `match.ts`; `extractorBase()` is env-only (SSRF guard); `EXTRACT_TIMEOUT_MS = 60_000` on both proxy and client; `prerender = false`. |
| Compose contract | Implemented | `EXTRACTOR_BASE_URL: http://product_identification:8003` on the frontend service, no `depends_on`. |

**Flow integrity (traced in source, `pipeline.ts:117-173`)**: `transcribe` → `is_garbage` guard → `onTranscript(transcript)` fires at line 129, still BEFORE extraction → `await deps.extraction.extract(transcript)` at line 131 → `items.length === 0` throws `nothing_extracted` → `Promise.all` parallel match fan-out → `Promise.all` anomaly classification → buckets recombined `[...anomalies, ...searches, ...confirmables]`. Ordering, concurrency and the bucket rule are unchanged by this change; the only edit in the file is the added `await`. Runtime-confirmed by `run-pipeline.test.ts > queue ordering > the queue is ordered anomalies -> searches -> confirmables (design §7)` and `the extraction order is preserved WITHIN each ordering bucket`.

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| Async interface migration | Yes | Single signature, mock body unchanged apart from `async`. |
| Fallback as a composing adapter | Yes | `fallback.ts` decorator; not inside `http.ts`, not inside `runPipeline`. No circuit breaker, no operator-visible indicator. |
| Tolerant response mapping | Yes | Decimals kept verbatim (`cantidad: 1.5` asserted), never rounded; drops are never repaired. |
| Proxy route + timeout topology | Yes | Mirrors `match.ts`; `client.ts` untouched; client constant lives in `http.ts`. |
| Compose wiring + smoke check | Yes | `scripts/smoke-extract.sh` is executable (`0775`), `set -euo pipefail`, both legs, asserts HTTP 200 AND the presence of `validated_inventory`. |
| `frontend/.env.example` documented | Deviated (accepted) | File does not exist in this repo; defaults documented in the `_upstream.ts` doc comment. Pre-approved in tasks.md Notes. |

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD Evidence reported | Yes | Full "TDD Cycle Evidence" table present in apply-progress (obs #195). |
| All tasks have tests | Yes | 7/7 evidence rows map to test files that exist on disk. |
| RED confirmed (tests exist) | Yes | 7/7 test files verified present. The two deployment assertions were independently re-RED-ed: copied onto main's compose they FAIL, on the branch they PASS. |
| GREEN confirmed (tests pass) | Yes | 176/176 pass across the 7 change-related files; 977/977 for the whole suite. |
| Triangulation adequate | Yes | Independently counted: 4 enum cases + 8 drop cases + 5 error-code cases (http-adapter); 3 throw kinds + per-utterance non-short-circuit (fallback); 2 interface cases (mock-adapter); 10 extract cases (proxy); 3 default-wiring cases (count-session). |
| Safety Net for modified files | Yes | Claim "921/921 baseline" verified exactly: `origin/main` runs 921 passed. Claim "46/46" verified exactly: `tests/components/session` on main runs 46 passed, branch 49. |

**TDD Compliance**: 6/6 checks passed. The apply phase's TDD evidence table is accurate on every claim I could independently re-derive.

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|---|---|---|---|
| Unit | 43 new (`http-adapter` 33, `fallback` 10) | 2 new | vitest |
| Route | 10 new extract cases | 1 modified (`proxy.test.ts`) | vitest |
| Integration | 3 new | 1 modified (`count-session.test.tsx`) | @testing-library + happy-dom |
| Contract (deployment) | 2 new assertions | 2 modified pytest files | pytest |
| Manual/E2E | 2 legs | `scripts/smoke-extract.sh` | curl (host-run, not CI) |
| **Total new** | **~58** | **7** | |

### Changed File Coverage

Coverage analysis skipped — no coverage provider installed (`@vitest/coverage-v8` absent). Not a failure.

### Assertion Quality

No tautologies, no ghost loops, no assertion-without-production-call, no smoke-test-only cases, no mock-heavy files. The `resolves.toEqual([])` assertions in `http-adapter.test.ts` have companion non-empty tests in the same file and are themselves the behaviour REQ-EXT-6 mandates, so they are not orphan empty checks. `expect(fallback.extract).not.toHaveBeenCalled()` is behavioural here, not implementation coupling — whether the fallback fires IS the requirement.

**Assertion quality**: All assertions verify real behaviour. 0 CRITICAL, 0 WARNING.

### Quality Metrics

**Linter**: Not available — no eslint in the project.
**Type Checker**: PASSED — `npx tsc --noEmit`, exit 0, empty output.

### Deviations Recorded by Apply — Adjudicated

1. **`frontend/.env.example` not created** — ACCEPTABLE. The file genuinely does not exist in this repo; defaults now live in the `_upstream.ts` doc comment. The change also corrected a stale `docker-compose.yml` comment that referenced the non-existent file. Net documentation improvement, and pre-approved in tasks.md Notes.
2. **Pipeline test stubs needed `async` beyond plain `await` edits** — ACCEPTABLE. Mechanically required by the interface change and verified correct: every stub became `async` with an unchanged body; no assertion was relaxed.
3. **`count-session.test.tsx` needed a URL-routing `fetch` stub + `resumeStorage: null`** — ACCEPTABLE and well-designed. The router answers only `/api/extract` and throws `TypeError` for every other URL, preserving the harness rule that the suite never reaches the network. `resumeStorage: null` is the correct isolation for tests that end mid-count. See SUGGESTION 3 for a side effect worth knowing.

### Issues Found

**CRITICAL**: None.

**WARNING**:
1. `uv run pytest tests/deployment` exits 1 with 4 failures. Proven **pre-existing**: the identical 4 test ids fail on clean `origin/main` under the same env, and the sorted FAILED/ERROR sets are byte-identical between branch and main in all three env configurations tested. Not a blocker, but the declared task-5.4 command does not literally "pass".
2. Under the *bare* documented command `uv run pytest tests/deployment` (no Supabase env exported), `test_compose_config.py` errors out entirely (27 collection errors) because its `rendered` fixture runs `docker compose config` with an empty env-file while `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` are not in `SECRET_ENV`. Consequence: **one of the two new `EXTRACTOR_BASE_URL` assertions never executes** under the documented command. I verified it separately with the env exported — it passes, and it is genuinely RED against main's compose. Pre-existing fixture fragility (landed with the supabase-operational-integration merge), but it means the documented command under-verifies this change.
3. apply-progress records the main deployment baseline as "5 failed, 94 passed". I measured **4 failed, 95 passed** on a clean `origin/main` worktree under the identical env — i.e. exactly the branch's numbers. The substantive claim ("my change adds zero failures") is correct and in fact stronger than recorded; only the baseline figure is inaccurate. Record defect, not a dishonest task claim.
4. Pre-existing `sessionStorage` test-isolation hazard in `count-session.test.tsx` remains latent: mid-count tests that do not pass `resumeStorage: null` leave a resume context in the shared real `sessionStorage`. **No NEW test is exposed** — all 3 new tests pass `resumeStorage: null` and are declared first in the file, so nothing pollutes them and they pollute nothing. Pre-existing exposure only.

**SUGGESTION**:
1. `proxy.test.ts > an extractor answering at 59 s is inside the budget, so its 200 wins` does not simulate 59 s; it asserts the signal is not pre-aborted and the 200 passes through. The scenario is adequately covered by composition with the sibling test that asserts the budget is exactly `60_000`, and it mirrors the pre-existing 44 s transcribe test, but the name promises more than the assertion delivers.
2. `http-adapter.test.ts:99-103` uses the transcript `'cuatro manojos de cilantro'` while the stubbed wire body carries `cantidad: 3` and the assertion expects `quantity: 3`. Harmless (fetch is stubbed, the transcript is decorative) but it reads as if the adapter parsed the transcript.
3. All 35 pre-existing tests in `count-session.test.tsx` now route through `withFallback` → mock, because the new unconditional `fetch` stub throws for every non-`/api/extract` URL. Behaviour and assertions are unchanged and this incidentally gives the fallback broad implicit coverage, but those tests no longer exercise `MockExtractionAdapter` directly, and each emits a `console.warn`.
4. The local extractor has no working GCP credentials, so every extraction on this machine degrades to the mock **silently**. `scripts/smoke-extract.sh` must be run on the demo host before the presentation — it is the only thing that will reveal this.

### Verdict

**PASS WITH WARNINGS** — 18/18 spec scenarios have passing covering tests, all 14 tasks are genuinely done, the end-to-end flow is intact, and the frontend suite and type-check are clean (977 passed / exit 0, +56 tests over main with zero regressions). The four warnings are pre-existing deployment-suite conditions and record accuracy, none of which block the demo or the archive.
