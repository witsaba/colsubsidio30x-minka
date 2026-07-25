```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:d3f36dd13913b04f7b4d9d665dffb2f750293026
verdict: pass-with-warnings
blockers: 0
critical_findings: 1
requirements: 35/35
scenarios: 41/41
test_command: cd frontend && npx vitest run
test_exit_code: 0
test_output_hash: sha256:0e1eeceb84b59e31bca3bb2f28aeb3466a051677428a68c78b784df0b3c11267
build_command: cd frontend && npm run build
build_exit_code: 0
build_output_hash: sha256:fde5befe2d3221d49fdbe3d9c1745edd4394c95ddc3f10352bbfd09835ccf05a
typecheck_command: cd frontend && npx astro check
typecheck_exit_code: 0
typecheck_output_hash: sha256:251fbacf918bd1e9e0916981ee62c5139d02c5b6d05a4695fe8b7780383ba991
```

## Verification Report

**Change**: `voice-counter-frontend`
**Mode**: Strict TDD
**Worktree**: `colsubsidio30x-minka-worktrees/voice-counter-frontend` @ `d3f36dd` (24 commits ahead of `main`)
**Verified**: 2026-07-25

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total (core) | 24 |
| Tasks complete | 23 (T1–T23) |
| Tasks incomplete | 1 (**T24**, manual end-to-end demo walkthrough) |
| Stretch S1–S5 | 5 open, deliberately cut |

### Build & Tests Execution

**Tests**: 657 passed / 0 failed / 0 skipped — 28 files, exit 0.
**Build**: `[build] Complete!` exit 0.
**Type check**: `Result (79 files): 0 errors, 0 warnings, 0 hints` exit 0.
**Coverage**: skipped — no coverage tool configured in `vitest.config.ts` (informational, not a failure).

Independently re-executed by this phase; all three corroborate the orchestrator's figures.

### Spec Compliance Matrix

All 35 requirements / 41 scenarios have at least one covering test that passed at runtime.

#### voice-capture — 8 requirements, 9 scenarios

| Req | Implementation | Covering tests | Verdict |
|---|---|---|---|
| REQ-VC-1 container chain | `lib/audio/capture.ts` `MIME_PREFERENCE_CHAIN` | `audio/capture.test.ts` ×5 — ogg branch, webm fallback, no-mimeType branch, **actual** vs requested mimeType, exact chain order | satisfied |
| REQ-VC-2 explicit bitrate | `capture.ts` `AUDIO_BITS_PER_SECOND` | ×3 — both construction branches + override stays explicit | satisfied |
| REQ-VC-3 20 s cap `[TEAM]` | `capture.ts:25` `MAX_DURATION_MS = 20_000`, single constant | ×4 — fake-timer auto-stop, **still recording one tick before the cap**, caller override | satisfied |
| REQ-VC-4 size guard | `capture.ts` `exceedsSizeLimit` / `MAX_BLOB_BYTES` | ×5 boundary pair (1 048 576 accept / 1 048 577 refuse) + `count-session` asserts `transcribe` **not** called | satisfied |
| REQ-VC-5 push-to-talk | `capture.ts` handlers, `MicDock.tsx` | ×14 — pointerleave≡pointerup, no-toggle, stray pointerup ignored, single stop | satisfied |
| REQ-VC-6 local timer | `capture.ts` timer, `MicDock` `formatElapsed` | ×7 — "reports durationMs from the local timer, never from any STT field" | satisfied |
| REQ-VC-7 permission at consent | `ConsentScreen.tsx` | ×9 — `NotAllowedError`→fallback, getUserMedia not called while unchecked | satisfied |
| REQ-VC-8 never interrupted | `reducer.ts`, `capture.ts` | `reducer.test.ts:386` "an anomaly arriving mid-recording does not terminate the recording" asserts `recording === true`; `:377` RF-29 block-does-not-cut; `capture.test.ts:250` device level | satisfied |

#### extraction-adapter — 5 requirements, 8 scenarios

| Req | Implementation | Covering tests | Verdict |
|---|---|---|---|
| REQ-EXT-1 interface | `lib/extraction/{adapter,mock}.ts` | `mock-adapter.test.ts` ×25 | satisfied |
| REQ-EXT-2 ITN 90 vs 900 | `lib/extraction/itn.ts` | `itn.test.ts` ×31 — `novecientos`→900 **and** `noventa`→90 asserted explicitly | satisfied |
| REQ-EXT-3 multi-item split | `mock.ts` | script 1 → exactly 3 items `[3,12,2]` with names | satisfied |
| REQ-EXT-4 unit vocabulary | `lib/units.ts` | `units.test.ts` ×30 — `cajas` passes through, unknown → `null`, never invented | satisfied |
| REQ-EXT-5 mock behind one swap point | `CountSession.tsx:76` `extraction = mockExtractionAdapter` | determinism ×2 + composition root is the sole call site | satisfied |

#### service-proxy — 5 requirements, 6 scenarios

| Req | Implementation | Covering tests | Verdict |
|---|---|---|---|
| REQ-PRX-1 same-origin | `pages/api/{transcribe,match,catalogues}.ts`, `_upstream.ts` | `api-routes/proxy.test.ts` ×4 | satisfied |
| REQ-PRX-2 faithful errors | `_upstream.ts`, `lib/api/client.ts` | ×10 proxy + ×15 client — 413/400/502×2/422 (both shapes)/404; **404 never rewritten to `no_match`** asserted twice; `request_id` preserved. Live-corroborated: unknown catalogue → 404, blank `spoken_name` → 422 | satisfied |
| REQ-PRX-3 >45 s budget | `AbortSignal.timeout` 50 s transcribe / 10 s match | ×4 — 44 s upstream still returns 200 | satisfied |
| REQ-PRX-4 streamed, no disk | `transcribe.ts`, `_upstream.ts` | ×4 — body stream forwarded, no fs call, **and both files import no fs API at all** | satisfied |
| REQ-PRX-5 env upstreams | `_upstream.ts` | ×3 incl. SSRF: "ignores upstream hints smuggled in the query string, headers or body" | satisfied |

#### operator-count-flow — 12 requirements, 12 scenarios

| Req | Implementation | Covering tests | Verdict |
|---|---|---|---|
| REQ-OCF-1 state machine | `lib/session/{types,reducer}.ts`, `CountSession.tsx` | `reducer.test.ts` ×60 (total reducer, identity on no-op) | satisfied (see WARNING-3) |
| REQ-OCF-2 blind counting | whole `/conteo` tree | ×5 across CountScreen, PlansScreen, RecordList, ConfirmSheet, CountSession-integration | satisfied |
| REQ-OCF-3 yes/no confirm | `ConfirmSheet.tsx` | "the decision is yes/no ONLY" asserts the **exact** button list `['Repetir','Confirmar']` — an added third control fails | satisfied |
| REQ-OCF-4 voice creates only | `reducer.ts`, `RecordList.tsx` | ×3 — "offers no edit control at all", 3 dictations → 3 appended records, delete is a touch control | satisfied |
| REQ-OCF-5 anomaly + block | `AnomalySheet.tsx`, `MicDock.tsx`, `reducer.ts` `blocked()` | ×13 — mic inert while flagged, banner verbatim, sheet undismissable, both resolutions unblock | satisfied |
| REQ-OCF-6 status routing | `lib/pipeline.ts`, `SearchSheet.tsx` | ×7 — ambiguous **and** no_match → needs_search; anomaly engine not consulted for either | satisfied |
| REQ-OCF-7 unit/SKU nulls | `ConfirmSheet`, `RecordList`, `AnomalySheet`, `SearchSheet`, `client.ts` | ×12 — `unidad_display` only, English canonicals absent with `unidad:'Kilogram'` riding along, null → absent, `Sin código` | satisfied |
| REQ-OCF-8 real catalogues | `lib/catalogues.ts`, `PlansScreen.tsx` | ×15+×5 — 8 real ids, real id rendered verbatim, RF-11 note, `PLAN_STARTED` carries the real id | satisfied (see WARNING-2) |
| REQ-OCF-9 Terminar conteo | `CountScreen.tsx` | ×6 — exists, dispatches, disabled on overlay/in-flight, **reaches `done` through the real reducer** | satisfied |
| REQ-OCF-10 C1 consent copy | `ConsentScreen.tsx:73-75` | ×4 + source grep | satisfied |
| REQ-OCF-11 C2 no offline | all operator screens + layouts + shells | ×6 + layouts ×3 + shells ×2 + source grep | satisfied |
| REQ-OCF-12 promise-driven S4 | `ProcessingSheet.tsx`, `pipeline.ts` | ×10 — "stays visible until the injected promise resolves — not on a timer", "survives the 45 s STT worst case", "the real path contains no 1700 ms timer" | satisfied |

#### auditor-dashboard — 5 requirements, 6 scenarios

| Req | Implementation | Covering tests | Verdict |
|---|---|---|---|
| REQ-AUD-1 three views | `AuditorRail.astro`, `pages/auditor/{index,cierre,base}.astro` | `auditor-shells.test.ts` ×34 — real `href`s, all three header titles pinned verbatim | satisfied |
| REQ-AUD-2 Contado vs Sistema | `DetailPane.tsx` | ×5 — 900 g / 4 L pair, "Sin diferencia" | satisfied |
| REQ-AUD-3 chips + badges | `auditor/RecordList.tsx` | ×6 — "Requieren mirada · 3" filters to exactly 3, Verificados starts empty, per-record badges | satisfied |
| REQ-AUD-4 trace | `AuditorReview.tsx` | ×5 — approve → Verificado + pill 3→2 + trace; **Pedir reconteo does not verify** | satisfied |
| REQ-AUD-5 export gate | `AuditorReview.tsx`, `Modal.tsx` | ×6 — "NO control claims to export" (regex `/exportar/i` over the modal), "Ver los pendientes" navigates+filters, "Cancelar" dismisses, gate lifts at zero | satisfied |

**Compliance summary**: 41/41 scenarios compliant.

### Compliance Fixes — independently grep-verified, not taken on report

| Check | Command | Result |
|---|---|---|
| C1 `"12 meses"` in `frontend/src/` | `grep -rn "12 meses" src/` | **0 hits** |
| C1 `/el audio se guarda/i` in `src/` | `grep -rni "el audio se guarda" src/` | **0 hits** |
| C1 mandated copy present verbatim | `ConsentScreen.tsx:73-75` (string concatenation resolves to the exact REQ-OCF-10 sentence) | present |
| C2 `"Funciona sin señal"` in `src/` | `grep -rn` | **0 hits** |
| C2 offline/sync claims | `grep -rniE "offline\|sin señal\|sin conexi\|sincroniz" src/` | 4 hits, **all code comments documenting the removal** or `mock.ts` meaning "no network". Zero user-facing copy. |
| Built output | `grep -rl` over `frontend/dist/` | `"12 meses"` absent, `"Funciona sin señal"` absent, English canonicals absent |

### Null-Handling — verified end to end

| Rule | Evidence |
|---|---|
| No coercion of `stt_confidence` / `audio_duration_ms` / `nr_articulo` / `unidad` / `unidad_display` | Repo-wide grep for `?? 0`, `\|\| 0`, `?? ''`, `Number(` against those fields: **the single hit is `SearchSheet.tsx:135` `option.nr_articulo ?? 'sin-codigo'` used as a React `key=`, never rendered**. Safe. |
| `unidad_display` is the only unit source | `grep -rnP "\.unidad\b(?!_display)" src/components/ src/lib/` → **zero reads of the English field anywhere** |
| English canonicals never reach the UI | `Kilogram`/`Liter`/`Portion` appear in `src/` only in `units.ts` comments and one `api/types.ts` doc-comment; absent from `dist/`. Asserted in ConfirmSheet, RecordList, AnomalySheet, SearchSheet and CountSession with the English value deliberately present in the fixture. |
| Nulls preserved at the client boundary | `client.test.ts` — "preserves `stt_confidence: null` instead of coercing it to 0", "preserves `audio_duration_ms: null`", "a 0 confidence is a real value and is not read as garbage" |

### Assertion Quality Audit

| Pattern | Result |
|---|---|
| Tautologies (`expect(true).toBe(true)`) | **0** |
| Assertions without a production call | 0 |
| Ghost loops over possibly-empty collections | 0 — the four `getAllBy…().map()` sites feed `toEqual([...])` with a fixed expected array, so an empty collection fails |
| `toEqual([])` / `toHaveLength(0)` without companion | 16 sites, all with discriminating companions. `operator-css.test.ts:75` and `tokens.test.ts:139` are collect-violations-assert-none, and `operator-css.test.ts:64` is an explicit **self-guard** (`expect(emitted.size).toBeGreaterThan(20)`) so the scanner cannot silently pass on an empty scan. |
| Smoke-test-only (render + presence, no behaviour) | none material; every component suite asserts copy, callbacks or DOM absence |
| Implementation-detail coupling | `tokens.test.ts` (89) and `operator-css.test.ts` (16) assert CSS source text. Acceptable here — the design contract specifies exact hexes and keyframes, so these are **contract** tests, not incidental coupling. |

**Two weak spots found** (see WARNING-4, WARNING-5). Otherwise: assertions verify real behaviour.

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | ✅ | Cycle tables present in every apply-progress observation (#120–#136) |
| All tasks have tests | ✅ | 28 test files; every T4–T22 names its RED file |
| RED confirmed (test files exist) | ✅ | 28/28 present on disk |
| GREEN confirmed (tests pass now) | ✅ | 657/657 re-executed by this phase |
| Triangulation | ✅ | 657 tests / 41 scenarios ≈ 16:1; parameterised `it.each` used for error taxonomy, mime chain, record states |
| Safety net on modified shared files | ✅ | `pipeline.ts` T3→T13→T20(onTranscript) sequenced; obs #136 records 105 passing on the pre-existing pipeline+session suites before extending |

### Test Layer Distribution

| Layer | Tests | Files |
|---|---|---|
| Unit (pure modules, no DOM) | ~330 | 13 |
| Integration (`@testing-library/preact` render) | ~155 | 9 |
| Source-contract (CSS / `.astro` text assertions) | ~172 | 6 |
| E2E (browser) | **0** | 0 — Playwright is stretch S3, cut |
| **Total** | **657** | **28** |

`.astro` files cannot be transformed by the T2-frozen `vitest.config.ts`, so page/layout/shell suites assert whitespace-collapsed source text. That is a known, documented harness constraint — it verifies authored markup, not rendered output.

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| D1 `frontend/` placement | ✅ | invisible to uv/pytest |
| D2 proxy over CORS | ✅ | `git diff main...HEAD -- services` → **0 files**; no CORS token added anywhere in the diff (all matches are prose explaining its absence) |
| D3 two islands | ✅ | `CountSession`, `AuditorReview` |
| D5 pure reducer | ✅ | DOM-free, total, identity on no-op |
| D6 C1 fix | ✅ | verbatim |
| D7 C2 fix | ✅ | verbatim |
| D8 ambiguous+no_match one sheet | ✅ | mode frozen at open |
| D9 authored «Terminar conteo» | ✅ | |
| D10 20 s / 28 kbps / 1 MiB pre-check | ✅ | constants in `capture.ts` |
| D11 fixture anomaly engine behind seam | ✅ | injected in `CountSession` |
| D12 Google Fonts CDN | ✅ | accepted tradeoff, documented in both layouts |
| **D13 «Cocina Principal» plan label** | ❌ | **deviated** — see WARNING-2 |

### Cross-Agent Integration Seams (nine parallel agents, one worktree)

| Seam | Finding |
|---|---|
| `CountSession` composition root | ✅ correct — `extraction = mockExtractionAdapter`, `anomalies = fixtureAnomalyEngine`, `transcribe/match` real, defaults overridable. Single swap point as REQ-EXT-5 requires. |
| `PIPELINE_TRANSCRIPT` producer | ✅ present — `CountSession.tsx:114` `onTranscript` → `dispatch({type:'PIPELINE_TRANSCRIPT'})`; covered by 6 tests + the integration test that gates `match` and asserts the transcript is on screen while in flight |
| Operator CSS coverage | ✅ complete — `operator-css.test.ts` scans **all** `src/components/operator/*.tsx`, which includes every sheet (`Sheet`, `Confirm`, `Anomaly`, `Search`, `Processing`). Interpolated `record--{state}` variants asserted explicitly. |
| **Auditor CSS coverage** | ⚠️ **no equivalent guard** — see WARNING-1 |
| Props declared but never wired | `ConfirmSheet.onExclude` — optional, never passed by `CountSession`; the ghost link only renders when provided, and that conditional is tested. Deliberate and safe. |
| Dead/unreachable branches | `overlay.kind === 'exclude'` — see WARNING-3 |
| Duplicated source of truth | `OPERATOR_SEED_PROGRESS` vs `reducer.ts:34` — see SUGGESTION-1 |
| Live catalogue endpoint | `getCatalogues()` is proxied and tested but **consumed by no component** — see SUGGESTION-2 |
| Dead exports | 47 exported symbols unreferenced outside their own file; ~40 are `XxxProps` interfaces and local type aliases (idiomatic). Genuinely unused values: `api/types.ts ServiceError`, `session/types.ts ExcludeReason`/`BlockedPredicate`, `capture.ts PushToTalkHandlers`, `_upstream.ts STT_BASE_DEFAULT`/`MATCHER_BASE_DEFAULT`, most of `auditorSeed.ts`'s exported type aliases. Cosmetic. |

### Issues Found

#### CRITICAL

**CRITICAL-1 — T24 is not done.** `tasks.md:180` `- [ ] **T24 — FINAL end-to-end demo verification (the acceptance bar). ⭐ MUST COMPLETE**`. No real microphone, real STT, real Chrome walkthrough has been performed. This is the acceptance bar the proposal itself defines, and it is externally blocked: the STT service on `:8001` is **not reachable** (a live `POST /api/transcribe` returns `502 proxy_unreachable`, meaning the fetch threw, i.e. nothing is listening), and no Deepgram key is provisioned.

This is a **completeness** gap, not a code defect. Every automated proxy for T24 is green. It cannot be closed by code — only by provisioning the key, starting `:8001`, and walking the demo.

#### WARNING

**WARNING-1 — the auditor half has no CSS-orphan guard.** `tests/styles/operator-css.test.ts:22` hardcodes `src/components/operator`. Nothing performs the equivalent check for `src/components/auditor/*.tsx` against the `<style is:global>` block in `pages/auditor/index.astro`. Running that check manually now finds two orphans: `.detail` (`DetailPane.tsx:30`) and `.compare__cell` (`DetailPane.tsx:36,41`) have no rule — only their `__`-suffixed children and the `--system` variant do. **Both are benign today**: `.detail` is a grouping div inside `.review__detalle`, which supplies the layout, and `.compare__cell` is a bare grid child of `.compare` (`grid-template-columns: 1fr 1fr`). Nothing renders unstyled. The defect is the missing guard, not the current pixels.

**WARNING-2 — design decision D13 is not implemented in the shipped UI, and the two demo halves disagree on the bodega name.** D13 (design.md:287, 336) says the operator plan card reads "Cocina Principal" over `catalogueId: 'stock_restaurante_fuentes_ayb'`. `src/fixtures/operatorSeed.ts:28` does carry `label: 'Cocina Principal'` — but `OPERATOR_PLANS` is imported **only by `tests/catalogues/catalogues.test.ts`**. The shipped `PlansScreen.tsx:33` renders `CATALOGUES` from `lib/catalogues.ts`, whose label is **"Restaurante Fuentes · AyB"**. Meanwhile `auditorSeed.ts:314` names the selected warehouse **"Cocina Principal"** and REQ-AUD-1 pins the header "Cocina Principal · revisión". So the demo's operator half counts *Restaurante Fuentes · AyB* and its auditor half reviews *Cocina Principal*. `PlansScreen`'s own doc-comment argues the real label is more honest, which is defensible — but it was decided by a different agent than the one who wrote D13 and the one who wrote the fixture, and no one reconciled the three. Does not break REQ-OCF-8 (which requires only human-friendly labels over real ids), hence WARNING not CRITICAL.

**WARNING-3 — the reducer can enter an overlay that has no UI.** `reducer.ts:311` `EXCLUDE_OPENED` → `overlay: {kind:'exclude'}`, and `CountSession.tsx` renders **nothing** for that kind (grep: zero occurrences of `exclude`). Because `overlay !== null`, the mic guard would block recording and «Terminar conteo» would be disabled — a soft-lock with no visible surface. **Currently unreachable**: no component dispatches any `EXCLUDE_*` event, and `ConfirmSheet.onExclude` is never passed. The risk is latent: wiring `onExclude` later without shipping `ExcludeSheet` (stretch S1) soft-locks the count screen. The reducer branch should be removed or the sheet shipped, not left half-wired.

**WARNING-4 — `formatDuration` is exported and rendered but has zero tests.** `DoneScreen.tsx:24`. `data-testid="done-duration"` is rendered at `DoneScreen.tsx:80`, and no test asserts its value anywhere — the S9 test asserts only the *label* `'Tiempo total'`. Its sibling pure helper `formatElapsed` in `MicDock.tsx` has 5 dedicated cases, so the omission looks accidental rather than deliberate. Low product risk (the hour branch is unreachable in a ~5 min demo; `formatDuration(0)` → `"0 min"`), but it is a rendered value with no covering assertion.

**WARNING-5 — `resolvedAlerts` is only ever asserted at zero.** `DoneScreen.tsx:37`; the only assertion is `count-session.test.tsx:552` `expect(...'done-alerts').textContent).toBe('0')`. No test drives an anomaly through «Es correcto · dejar nota al auditor» and then «Terminar conteo» to prove the counter reaches 1. The predicate half *is* proven independently (`reducer.test.ts:414` asserts `records[0].anomaly` is stamped by `ANOMALY_KEEP_NOTED`), so a wholly broken counter is unlikely — but the DoneScreen half has no non-zero companion, the exact pattern the assertion-quality rule flags.

**WARNING-6 — the diff is ~2.6× the forecast.** `sdd-tasks` forecast 5,300–6,500 changed lines; actual is **17,160 authored additions** (excluding `package-lock.json`), 0 deletions — about 43× the 400-line review budget. `size:exception` was pre-accepted by the maintainer so this is **not a blocker**, but the reviewer should know the true magnitude before opening the PR.

#### SUGGESTION

**SUGGESTION-1 — two sources of truth for the seeded progress.** `fixtures/operatorSeed.ts:53` `OPERATOR_SEED_PROGRESS = {counted:45,total:107}` is duplicated as a literal at `lib/session/reducer.ts:34`; the reducer does not import the fixture. Editing the fixture would leave the app unchanged while its test still passed. Relatedly, `OPERATOR_SEED_RECORDS` — whose own comment says "so S3 never opens on an empty list" — is **unused**; `initialSessionState.records` is `[]`, so the count screen *does* open empty. Cosmetic consequence: the progress bar reads 45/107 with zero records listed.

**SUGGESTION-2 — `GET /api/catalogues` is proxied and tested but never consumed.** `client.ts:267` `getCatalogues` has no `src/` caller; `PlansScreen` uses the hardcoded `CATALOGUES` list. That list already drifted once — commit `d3f36dd` "correct catalogue row counts to the live service values" is exactly that class of bug. Fetching at runtime (or a CI assertion against the live service) would close it permanently.

**SUGGESTION-3 — minor dead exports.** `ServiceError`, `ExcludeReason`, `BlockedPredicate`, `PushToTalkHandlers`, `STT_BASE_DEFAULT`, `MATCHER_BASE_DEFAULT`, and several `auditorSeed.ts` type aliases are unreferenced. Harmless; tidy up post-demo.

### Demo Readiness (proposal's 8-step narrative)

**Blocking environmental fact: STT `:8001` is down and unkeyed.** A live `POST /api/transcribe` returns `502 proxy_unreachable`, which means the proxy's `fetch` threw — nothing is listening. The matcher `:8002` **is** live and correct (8 real catalogues; `lechuga batavia` → `LECHUGA BATAVIA`, `nr_articulo 5087`, `unidad_display "kg"`, score 1.0).

| Step | Works tonight? | Notes |
|---|---|---|
| 1 · consent (C1 copy) | ✅ | real `getUserMedia` prompt on tap |
| 2 · plans over real catalogues | ✅ | 8 real ids + RF-11 note. Card reads "Restaurante Fuentes · AyB" (WARNING-2) |
| 3 · script 1 → 3 confirm cards | ❌ **blocked on STT** | mic records, size guard passes, then the red banner «No hay conexión con el servidor. Intenta otra vez.» |
| 4 · script 2 → ITN 900 → unit anomaly | ❌ blocked on STT | |
| 5 · script 3 → manual search | ❌ blocked on STT | the sheet is only reachable through the pipeline |
| 6 · script 4 → quantity anomaly | ❌ blocked on STT | |
| 7 · «Terminar conteo» → S9 | ⚠️ partial | reachable, but with 0 records: "0 registros", 45/107, 0 alerts |
| 8 · `/auditor` review, approve, pill decrements | ✅ | fully working on seeded fixtures |

**There is no in-app fallback.** `pages/conteo/index.astro:22` mounts `<CountSession client:load />` with **no props**, so every seam defaults to the real implementation. The `transcribe` seam exists and is injectable, but nothing in the shipped route exercises it — a transcript cannot be faked from the browser. If the key does not arrive, the proposal's video fallback is the only mitigation.

**Bottom line: the entire voice half of the demo is gated on one credential.** The frontend is ready; the environment is not.

### Known-Accepted Tradeoffs (not defects)

1. Auditor below 1024px shows a static "use a tablet" notice instead of a collapsed grid — authored, documented in `AuditorLayout.astro:10-13`, tested.
2. Google Fonts CDN dependency — D12, documented in both layouts, self-hosting is stretch S5.
3. Auditor runs on seeded fixtures; the live operator→auditor handoff is stretch S4 and was not built.
4. `ProcessingSheet` ships the honest «Transcribiendo y buscando en el catálogo…»; the design's «Verificando con tres modelos…» exists only behind the explicit `mockConsensus` flag, because Module 2 consensus does not exist.
5. The 20 s cap is `[TEAM]`-unratified — one named constant `MAX_DURATION_MS`, changing it is a one-line edit.
6. RF-11: no bodega→catalogue join key exists, so audit categories are the 8 real stock tables, not the 48 bodegas — stated verbatim in `PlansScreen` and `/auditor/base`.
7. No E2E/browser tests (stretch S3); `.astro` pages are verified by source-text assertions because the frozen `vitest.config.ts` has no Astro transform.
8. Stretch S1–S5 cut by plan.

### Verdict

**PASS WITH WARNINGS.**

The contract is met: 35/35 requirements and 41/41 scenarios have passing covering tests, tests/build/type-check are all green and independently re-executed, both compliance fixes (C1, C2) are real in source and in `dist/`, the null-handling rules hold end to end with zero coercion, and `services/` is provably untouched with no CORS anywhere. Implementation quality is high and the tests are substantive, not decorative.

The single CRITICAL is **T24**, the manual end-to-end walkthrough, which is blocked on a Deepgram key rather than on code. Six WARNINGs are quality and integration-seam issues; none blocks the demo. Ranked pre-22:00 list below.

### Ranked Fix List Before 22:00

| # | Item | Effort | Why now |
|---|---|---|---|
| 1 | **Provision the Deepgram key and start STT `:8001`**, then run T24 | external | The only thing standing between this build and the demo. 5 of 8 demo steps depend on it. |
| 2 | Decide the **bodega label** (WARNING-2): either set `stock_restaurante_fuentes_ayb`'s label to "Cocina Principal" in `lib/catalogues.ts`, or rename the auditor's `w-cocina`. One-line either way | 2 min | The name visibly changes between the demo's two halves |
| 3 | Delete the unreachable `EXCLUDE_*` reducer branch (WARNING-3) | 5 min | Removes a latent soft-lock; purely subtractive |
| 4 | Nothing else | — | WARNING-1/4/5/6 and all SUGGESTIONs are post-demo cleanup |

Items 2 and 3 are optional polish. **Only item 1 is required**, and it is not a code change.

---

## Post-Verify Resolution (appended by the orchestrator)

Both optional items from the ranked list were applied strict-TDD after the report
was written. The CRITICAL remains open and is not a code change.

| # | Item | Outcome |
|---|---|---|
| 1 | Deepgram key + STT `:8001` + T24 walkthrough | **STILL OPEN.** `services/stt/.env` does not exist, so the service cannot boot. Requires the user; the walkthrough needs a real microphone and cannot be automated. |
| 2 | WARNING-2 — bodega label drift between the demo's two halves | **FIXED** — `f0831b2`, one name across both halves, plus `DEMO_CATALOGUE_ID` pinned to a real matcher table |
| 3 | WARNING-3 — unreachable `EXCLUDE_*` branch / latent soft-lock | **FIXED** — `0339cb0`, removed rather than completed |

### How WARNING-3 was closed

RED first: `frontend/tests/session/no-soft-lock.test.ts` explores the reducer from
the initial state over every declared event and asserts that no reachable state
blocks the mic *and* disables «Terminar conteo» with no sheet on screen. It failed
on the event-alphabet guard (`EXCLUDE_OPENED`, `EXCLUDE_REASON_PICKED`,
`EXCLUDE_CONFIRMED`, `EXCLUDE_DISMISSED` declared but unexplored). The four events,
the `exclude` overlay variant and `ExcludeReason` were then deleted from the frozen
`session/types.ts`, along with the four reducer cases and the now-unused `canOverlay`
helper. The suite is green.

The test is drift-proof in both directions: the event alphabet is scraped out of
`session/types.ts` and the rendered overlay kinds out of `CountSession.tsx`, so
reintroducing an overlay without a sheet fails here rather than in front of the client.

### Re-verified after both fixes

| Check | Result |
|---|---|
| `npx vitest run` | **662 passed / 30 files**, 0 failed |
| `npx astro check` | **0 errors**, 0 warnings, 0 hints (81 files) |
| `npm run build` | exit 0, server + 4 prerendered routes |
| matcher `/health` | `{"status":"ok","catalogues":8,"rows":1405}` |
| `/conteo`, `/auditor` | HTTP 200 |
| `POST /api/match` through the real proxy | `status:"ambiguous"`, real `nr_articulo` `"7293"`, real `unidad_display` `"litros"` |
| `git diff --name-only main...HEAD -- services` | 0 files |

The proxy → real-matcher path is therefore proven against live data. The only
unproven hop in the whole pipeline is transcription, which is what the key unblocks.
