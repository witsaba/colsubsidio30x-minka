# Tasks: Voice Inventory Counter frontend (`/conteo` + `/auditor`)

Change: `voice-counter-frontend` · Store: hybrid · Strict TDD · Worktree `colsubsidio30x-minka-worktrees/voice-counter-frontend`
Deadline: TODAY 22:00 America/Bogota. Sources: proposal, `specs/*/spec.md`, `design.md` (D1–D13).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~5,300–6,500 (all new `frontend/`, +2 appended ignore lines) |
| Estimated file count | ~58–65 new files, 2 edited |
| 400-line budget risk | High |
| Chained PRs recommended | No (size:exception already accepted) |
| Suggested split | Single PR — greenfield directory, revert = delete |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

The maintainer pre-accepted `size:exception` ("the lines that takes, one single PR"). Do NOT stop for a review-burden decision. Rationale: one greenfield directory, zero coupling to existing Python code, rollback = revert the single PR.

### Suggested Work Units (informational only — NOT separate PRs)

| Unit | Goal | Focused test command | Runtime harness | Rollback boundary |
|------|------|----------------------|-----------------|-------------------|
| 1 | Toolchain + harness (T1–T2) | `cd frontend && npm run build` | `npm run dev` → :4321 | delete `frontend/` |
| 2 | Pure lib (T3–T13) | `npx vitest run tests/` | N/A — DOM-free modules | `src/lib/`, `src/fixtures/`, `tests/` |
| 3 | Operator UI (T14–T20) | `npx vitest run tests/components/` | Chrome localhost, real mic | `src/components/operator/`, `src/pages/conteo.astro` |
| 4 | Auditor UI (T21–T22) | `npx vitest run tests/components/auditor-review.test.tsx` | Chrome localhost `/auditor` | `src/components/auditor/`, `src/pages/auditor/` |
| 5 | Integration (T23–T24) | `npx vitest run` | both services + 4 dictation scripts | whole PR |

## Critical Path

**T1 → T2 → T3 → T4 → T5 → T6 → T7 → T9 → T10 → T12 → T13 → T11 → T14 → T16 → T17 → T18 → T19 → T20 → T24.**
T21–T22 (auditor) run fully in parallel and must land before T24 (demo step 8). Everything else is cuttable.

## Shared-File Ownership (read before fanning out parallel agents)

| File | Sole owner | Rule |
|---|---|---|
| `frontend/package.json`, `astro.config.mjs`, `tsconfig.json` | **T1** | any later dependency add is a request to T1's agent, never a concurrent edit |
| `frontend/vitest.config.ts`, `frontend/tests/setup.ts` | **T2** | global stubs are written once, complete |
| `frontend/src/lib/api/types.ts`, `session/types.ts`, `extraction/adapter.ts`, `anomaly/engine.ts` | **T3** | type surface FROZEN after T3; extensions only via T7 |
| `frontend/src/lib/pipeline.ts` | **T3** (interfaces) then **T13** (body) | strictly sequential, never concurrent |
| `frontend/src/lib/units.ts` | **T5** | T6 and T8 import, never edit |
| `frontend/src/styles/tokens.css`, `global.css` | **T14** | components consume `var(--*)`; NEVER hardcode a hex |
| root `.gitignore`, `.dockerignore` | **T1** | two appended lines only |

## Phase 0 — Toolchain risk retirement (SEQUENTIAL · single agent · timebox 45 min)

- [x] **T1 — Scaffold Astro + Preact + TS strict in a Python-only repo.** *This is the same-day existential risk: validate it NOW, not last.*
  Creates: `frontend/{package.json,astro.config.mjs,tsconfig.json,.env.example,public/favicon.svg}`, `frontend/src/env.d.ts`. Edits: root `.gitignore` (+`frontend/node_modules/`, `frontend/dist/`, `frontend/.astro/`), root `.dockerignore` (+`frontend/`).
  Config: `output:'server'`, node standalone adapter, `integrations:[preact()]`, `extends astro/tsconfigs/strict`, `jsxImportSource: preact`.
  Proof (not a RED test — infrastructure gate): `cd frontend && npm install && npx astro check && npm run build` all exit 0. **If this fails, STOP and escalate — every later task is blocked.**
  Requirements: D1, D2. Deps: none.

- [x] **T2 — Vitest + happy-dom + `@preact/preset-vite` harness.**
  Creates: `frontend/vitest.config.ts` (`environment:'happy-dom'`, `globals:true`, `setupFiles:['tests/setup.ts']`, `include:['tests/**/*.test.{ts,tsx}']`), `frontend/tests/setup.ts` (`vi.stubGlobal('MediaRecorder', FakeMediaRecorder)` with static `isTypeSupported` + `start/stop/ondataavailable`; `navigator.mediaDevices.getUserMedia` mock; `fetch` stub helper returning canned `Response`s).
  Proof: write a throwaway assertion that `document` and `MediaRecorder.isTypeSupported` exist, observe it run under `npx vitest run`, then **delete it**. This is harness validation, NOT a product RED — the first product RED is T4.
  Deps: T1.

## Phase 1 — Type & seam contracts (SEQUENTIAL · timebox 30 min)

- [x] **T3 — Freeze the shared type surface so parallel agents never collide.** Declarations only; no behavior, therefore no RED cycle (verified by `npx astro check` exiting 0).
  Creates: `src/lib/api/types.ts` (`TranscribeResponse`, `ServiceError`, `MatchRequest`, `Candidate`, `MatchResponse`, `CatalogueInfo`, `UiErrorCode`, `UiError` — nullable fields exactly as design §8), `src/lib/extraction/adapter.ts` (`ExtractedItem`, `ExtractionAdapter`), `src/lib/anomaly/engine.ts` (`Anomaly`, `AnomalyEngine`), `src/lib/session/types.ts` (`Screen`, `Overlay`, `SessionState`, `SessionEvent` — the FULL event union from design §6 table, `CountRecord`), `src/lib/pipeline.ts` (`ConfirmableItem`, `QueueEntry`, `PipelineOutcome`, `PipelineDeps` + `runPipeline` stub that throws `new Error('not implemented')`).
  Requirements: REQ-EXT-1, REQ-OCF-1, REQ-OCF-7. Deps: T1.

## Phase 2 — Pure modules (PARALLEL after T3 · disjoint file groups)

Parallel groups: **P-A** = T4→T5→T6 (extraction/units chain) · **P-B** = T7 (reducer) · **P-C** = T9 (api client) · **P-D** = T10 (proxy) · **P-E** = T11 (capture) · **P-F** = T12 (catalogues) · **P-G** = T14→T15 (styles/layouts). T8 joins P-A after T5. T13 joins after T6+T8+T9.

- [x] **T4 — Spanish ITN (`cardinalToNumber`). ⭐ FIRST RED TEST OF THE PROJECT.**
  RED: create `frontend/tests/extraction/itn.test.ts` asserting `cardinalToNumber('novecientos') === 900` **AND** `cardinalToNumber('noventa') === 90` (the 90-vs-900 case that triggers the demo anomaly), plus `'trescientos cinco' === 305`, `'doce' === 12`, `'tres' === 3`, `'cinco' === 5`, `'dos' === 2`. Run `npx vitest run tests/extraction/itn.test.ts` and **observe the failure** (module not found) before writing any implementation.
  GREEN: create `src/lib/extraction/itn.ts`.
  Requirements: REQ-EXT-2. Deps: T3.

- [x] **T5 — Unit vocabulary and dimension map.**
  RED: `tests/units.test.ts` — `dimensionOf('gramos') === 'mass'`, `dimensionOf('litros') === 'volume'`, `dimensionOf('botellas'|'cajas'|'tablas'|'unidades') === 'count'`; vocabulary is bound to the matcher's `UNIT_SYNONYMS` and an unknown word returns `null` (never an invented unit).
  GREEN: `src/lib/units.ts` (+ `displayUnit()` helper: renders `unidad_display` only, returns `null` for null).
  Requirements: REQ-EXT-4, REQ-OCF-7. Deps: T3.

- [x] **T6 — `MockExtractionAdapter` (the Module 2 seam).**
  RED: `tests/extraction/mock-adapter.test.ts` — script 1 `"tres kilos de lechuga batavia, doce botellas de aceite vegetal y dos cajas de tomate chonto"` yields **exactly 3** items with quantities `[3,12,2]`; script 2 `"novecientos gramos de aceite de oliva extra virgen"` → `{quantity:900, unit:'gramos'}`; script 3 `"cinco tablas para picar blancas"` → `[{5,'tablas'}]`; script 4 `"trescientas cinco unidades de gaseosa personal"` → `[{305,'unidades'}]`; an unresolvable unit yields `unit: null`.
  GREEN: `src/lib/extraction/mock.ts` (conjunction/comma split + ITN + unit lookup), `src/fixtures/scripts.ts` (4 scripts + expected extractions, shared by app and tests).
  Requirements: REQ-EXT-1, REQ-EXT-3, REQ-EXT-5. Deps: T4, T5.

- [x] **T7 — Pure `sessionReducer`.**
  RED: `tests/session/reducer.test.ts` — `MIC_REQUESTED` is a no-op unless `consentChecked`; `REC_STARTED` is refused when `blocked(state)` is true, when an overlay is open, or when `requestInFlight`; `blocked()` is DERIVED from `overlay.kind==='anomaly' || records.some(r=>r.state==='anom_open')` and never stored; a `PIPELINE_RESOLVED` queue of 3 confirmables produces ONE combined confirm overlay; `ANOMALY_REDICTATE` pops the queue; `CONFIRM_ACCEPTED` appends N records and bumps `progress`; `CONFIRM_REPEAT` appends none; `COUNT_FINISHED` → `screen:'done'` only when `overlay===null && !requestInFlight`; an unknown event returns the identical state object (reducer is total).
  GREEN: `src/lib/session/reducer.ts`.
  Requirements: REQ-OCF-1, REQ-OCF-3, REQ-OCF-4, REQ-OCF-5, REQ-OCF-9. Deps: T3.

- [x] **T8 — `FixtureAnomalyEngine` (Module 4 seam, two rules only).**
  RED: `tests/anomaly/fixture-engine.test.ts` — `900 gramos` (mass) vs `unidad_display:'litros'` (volume) → `{kind:'unidad'}`; `305 unidades` of gaseosa vs learned range 20–40 → `{kind:'cantidad'}`; **all three script-1 items return `null`** (no false positive: containers are `count`, compatible with everything).
  GREEN: `src/lib/anomaly/fixtureEngine.ts`, `src/fixtures/anomalyRules.ts` (aceite de oliva 2–8 L, gaseosa 20–40 und, lechuga 1,5–6 kg, arroz 3–12 kg, pechuga 12–40 und).
  Requirements: REQ-OCF-5, D11. Deps: T5.

- [x] **T9 — Typed API client + error taxonomy.**
  RED: `tests/api/client.test.ts` with stubbed `fetch` — 413 → `UiError('payload_too_large')`, 400 `invalid_audio`, 502 `vendor_timeout`/`vendor_error`, 422 FastAPI `{detail:[...]}` shape → `validation`, match 404 → `unknown_catalogue` (NEVER `no_match`), thrown fetch → `proxy_unreachable`, `AbortError` → `aborted`; `request_id` is preserved on the error; `stt_confidence:null` and `audio_duration_ms:null` survive as `null` and are never coerced to `0`.
  GREEN: `src/lib/api/client.ts` (`transcribe` timeout 50 000 ms, `match`/`getCatalogues` 10 000 ms).
  Requirements: REQ-PRX-2, REQ-PRX-3, REQ-OCF-7, REQ-VC-6. Deps: T3.

- [x] **T10 — Astro proxy endpoints (no CORS on `services/`).**
  RED: `tests/api/proxy.test.ts` with stubbed `fetch` — upstream 413/400/502 status **and** body pass through untouched; the upstream base always derives from `STT_BASE_URL`/`MATCHER_BASE_URL` and **never** from request data (SSRF guard); a thrown `fetch` produces `502 {"error":{"code":"proxy_unreachable"}}` in the STT envelope shape; the audio body is streamed, never written to disk.
  GREEN: `src/pages/api/{transcribe,match,catalogues}.ts` (`prerender=false`, `AbortSignal.timeout` 50 s / 10 s).
  Requirements: REQ-PRX-1..5, RNF-04. Deps: T1. **Verify no file under `services/` is touched.**

- [x] **T11 — `createRecorder` audio capture.**
  RED: `tests/audio/capture.test.ts` using the T2 `FakeMediaRecorder` + `vi.useFakeTimers()` — mime chain: `ogg;codecs=opus` unsupported + `webm;codecs=opus` supported → constructed with webm, and neither supported → constructed with **no** mimeType option while the result still exposes the recorder's actual `mimeType`; options always carry `audioBitsPerSecond` with `24000 ≤ v ≤ 32000`; advancing 20 000 ms auto-stops without a `pointerup`; a `1_048_577`-byte blob is refused before any request is issued; `onTick` elapsed comes from the local timer and is unaffected by STT nulls.
  GREEN: `src/lib/audio/capture.ts` (constants `MAX_DURATION_MS = 20_000 // [TEAM]`, `AUDIO_BITS_PER_SECOND = 28_000`, `MAX_BLOB_BYTES = 1_048_576` — one named constant each).
  Requirements: REQ-VC-1..4, REQ-VC-6, REQ-VC-8, D10. Deps: T2, T3.

- [x] **T12 — Real catalogues + operator seed.**
  RED: `tests/catalogues.test.ts` — exports exactly the 8 real `catalogue_id`s with their friendly labels; the demo plan card labelled "Cocina Principal" carries `catalogueId:'stock_restaurante_fuentes_ayb'`; every plan's id is one of the 8.
  GREEN: `src/lib/catalogues.ts`, `src/fixtures/operatorSeed.ts` (3 seed rows, progress 45/107).
  Requirements: REQ-OCF-8, D13. Deps: T3.

- [ ] **T13 — `runPipeline` fan-out and recombine.**
  RED: `tests/pipeline.test.ts` with fully stubbed `PipelineDeps` — a 3-item transcript issues **3 parallel** `match` calls; `matched` + clean anomaly check → `confirmable`; `ambiguous` **AND** `no_match` both → `needs_search` carrying the returned candidates; queue ordering is anomalies → searches → confirmables; `is_garbage:true` throws `UiError('garbage')`; 0 extracted items throws `UiError('nothing_extracted')`.
  GREEN: fill in `runPipeline` in `src/lib/pipeline.ts` (replaces the T3 stub).
  Requirements: REQ-OCF-6, REQ-OCF-12, REQ-EXT-1. Deps: T6, T8, T9. **Sequential with T3 on `pipeline.ts`.**

## Phase 3 — Design system (PARALLEL with Phase 2, starts right after T1)

- [x] **T14 — Tokens and global stylesheet.**
  RED: `tests/styles/tokens.test.ts` reads `src/styles/tokens.css` and asserts it declares the contract's custom properties (`--primary:#0067b1`, `--accent:#ffd000`, `--page:#f2f2ef`, `--text:#2f2f2e`, warn `#d9631a`/`#fdf1e7`/`#8a4a12`, success `#2f6b3a`/`#eef6ef`, borders, scrim) and all five keyframes `vpulse vbar vdot vrise trise`, plus a `prefers-reduced-motion: reduce` block.
  GREEN: `src/styles/tokens.css` (keyframes copied **verbatim** from the design contract), `src/styles/global.css` (reset, Manrope/JetBrains Mono stacks, `tabular-nums` on `.qty`, focus-visible).
  Requirements: design §4, D12. Deps: T1. **Sole owner of `src/styles/`.**

- [x] **T15 — Layouts and root route.**
  Creates: `src/layouts/OperatorLayout.astro` (fluid single column, `max-width:430px`, Google Fonts CDN `<link>`), `src/layouts/AuditorLayout.astro` (grid `94px 286px 1fr 352px` at `min-width:1024px`; below that the static notice "Usa una tablet o un computador para la revisión"), `src/pages/index.astro` (`prerender=false`, `Astro.redirect('/conteo', 302)`).
  Proof: `npm run build` succeeds and `/` redirects under `npm run preview`.
  Requirements: design §4, §5, D12. Deps: T14.

## Phase 4 — Operator vertical slice (demoable FIRST — do not start the auditor before T20 in a serial run)

- [x] **T16 — Consent screen with the C1 fix + plans screen. 🔒 COMPLIANCE**
  RED: `tests/components/consent-screen.test.tsx` — the rendered DOM contains **verbatim** `"El audio no se guarda: se transmite para transcribirlo y se descarta al instante. Solo se conserva la transcripción de lo que dictas."`; the string `"12 meses"` appears **nowhere**; the string `"Funciona sin señal"` appears **nowhere** (C2); "Permitir el micrófono" is `disabled` until the checkbox is checked; activating it calls the injected `getUserMedia`; a `NotAllowedError` rejection renders "Sin autorización el conteo se hace escribiendo artículo por artículo. Puedes autorizar más tarde desde tu perfil." and does NOT advance to plans.
  GREEN: `src/components/operator/ConsentScreen.tsx`, `PlansScreen.tsx`.
  Requirements: **REQ-OCF-10 (C1)**, **REQ-OCF-11 (C2)**, REQ-VC-7, REQ-OCF-8, D6, D7. Deps: T7, T12, T14.

- [ ] **T17 — Count screen, mic dock, and the authored «Terminar conteo» control.**
  RED: `tests/components/count-screen.test.tsx` — the footer reads "Conteo ciego: nunca verás el stock del sistema." and **no system/theoretical stock value appears anywhere in the render tree** (REQ-OCF-2); `pointerdown` starts and both `pointerup` **and** `pointerleave` stop recording, with no toggle path (REQ-VC-5); with a record in `anom_open` the mic is inert and the banner reads "Micrófono en pausa hasta resolver el registro señalado."; **«Terminar conteo» exists, dispatches `COUNT_FINISHED`, reaches `screen==='done'`, and is disabled while an overlay is open or a request is in flight** (REQ-OCF-9, the design gap).
  GREEN: `src/components/operator/CountScreen.tsx`, `MicRecorder.tsx`.
  Requirements: REQ-OCF-2, REQ-OCF-5, **REQ-OCF-9**, REQ-VC-5, REQ-VC-8, D9. Deps: T7, T11, T14.

- [ ] **T18 — Processing and confirm sheets.**
  RED: `tests/components/confirm-sheet.test.tsx` — a 3-item queue renders exactly 3 cards; the only buttons are "Repetir" and "Confirmar"; no system stock renders; units come only from `unidad_display` and the strings `"Kilogram"`/`"Liter"`/`"Unidad"`/`"Portion"` appear nowhere; `nr_articulo:null` renders the SKU line without a code; `unidad_display:null` renders no unit text. `tests/components/processing-sheet.test.tsx` — the sheet stays visible until the injected promise resolves (assert with a promise resolved at a controlled tick) and **no fixed 1700 ms timer exists in the real path**; a rejected promise renders the authored retry state.
  GREEN: `src/components/operator/ProcessingSheet.tsx`, `ConfirmSheet.tsx`.
  Requirements: REQ-OCF-3, REQ-OCF-7, REQ-OCF-12. Deps: T7, T14.

- [ ] **T19 — Anomaly and manual-search sheets.**
  RED: `tests/components/search-sheet.test.tsx` — a `no_match` opens the sheet with copy `No encontré “{query}” en esta bodega. ¿Cuál es?`, an `ambiguous` opens the **same** sheet with adjusted copy and the matcher's candidates listed, the real `<input>` re-queries `match()` as the user types, picking a candidate makes the item confirmable, and "Ninguno · volver a dictar" drops the item. `tests/components/anomaly-sheet.test.tsx` — orange flag state, both resolutions ("Eliminar y volver a dictar", "Es correcto · dejar nota al auditor"), and the mic stays blocked until one is chosen.
  GREEN: `src/components/operator/AnomalySheet.tsx`, `SearchSheet.tsx`.
  Requirements: REQ-OCF-5, REQ-OCF-6, D8. Deps: T7, T9, T14.

- [ ] **T20 — `CountSession` island wiring + done screen + `/conteo` route. ⭐ DEMOABLE MILESTONE**
  RED: `tests/components/count-session.test.tsx` — with a stubbed pipeline, the full happy path runs consent → plans → count → record → confirm → 3 records appended → «Terminar conteo» → `screen==='done'`; a `PIPELINE_FAILED` maps to the authored Spanish error banner with retry; an anomaly outcome opens the anomaly overlay and blocks the mic.
  GREEN: `src/components/operator/CountSession.tsx` (owns `useReducer`, fires the real `getUserMedia` at consent, runs `runPipeline`, advances the queue), `DoneScreen.tsx`, `src/pages/conteo.astro` (`prerender=true`, `<CountSession client:load />`).
  Requirements: REQ-OCF-1, REQ-OCF-12, REQ-VC-7, D3, D4. Deps: T13, T16, T17, T18, T19.

## Phase 5 — Auditor dashboard (FULLY PARALLEL with Phase 4 — disjoint files)

- [ ] **T21 — Auditor fixtures + static V2/V3 shells.**
  RED: `tests/fixtures/auditor-seed.test.ts` — exactly 8 seed records with 3 open alerts, each carrying `counted`, `system`, badge state, and an empty trace array.
  GREEN: `src/fixtures/auditorSeed.ts` (8 verbatim records, warehouses, Oracle export rows), `src/pages/auditor/cierre.astro` + `base.astro` (zero-JS shells; the `base` view states the RF-11 bodega→catalogue limitation verbatim).
  Requirements: REQ-AUD-1, REQ-AUD-3. Deps: T14, T15.

- [ ] **T22 — `AuditorReview` island: filters, actions, trace, corrected export gate.**
  RED: `tests/components/auditor-review.test.tsx` — chip "Requieren mirada · 3" filters to exactly the 3 alerted records; "Aprobar registro" flips the badge to "Verificado", **decrements the header pill from "3 alertas abiertas" to "2 alertas abiertas"**, and appends a trace entry with user + time + action; the detail pane shows "Contado" vs "Sistema" (auditor may see stock, C6); with alerts open "Exportar a Oracle" is disabled and shows the blocked modal, where **"Ver los pendientes" navigates to the filtered pending list, "Cancelar" dismisses, and no "Exportar de todos modos" control exists in the DOM**; with zero alerts the export modal "Generar archivo de carga" opens.
  GREEN: `src/components/auditor/{AuditorReview,WarehouseList,RecordList,DetailPane,Modal}.tsx`, `src/pages/auditor/index.astro`.
  Requirements: REQ-AUD-1..5. Deps: T21, T14, T3.

## Phase 6 — Integration and verification

- [ ] **T23 — Run documentation.** `frontend/README.md` + `frontend/.env.example` finalized: how to start STT `:8001` and matcher `:8002`, `STT_BASE_URL`/`MATCHER_BASE_URL`, `npm run dev` → `http://localhost:4321`, and the documented constraint that `getUserMedia` needs a secure context so **the demo must browse on the laptop itself, not a LAN IP**. Deps: T10, T20.

- [ ] **T24 — FINAL end-to-end demo verification (the acceptance bar). ⭐ MUST COMPLETE**
  1. `cd frontend && npx vitest run` — every suite green.
  2. `npm run build && npm run preview`; STT `:8001` and matcher `:8002` both running with real keys and the sqlite catalogue mounted.
  3. Chrome on `localhost`, **real microphone**, walk the proposal's demo narrative end to end: consent (corrected C1 copy visible, "12 meses" absent) → plans → script 1 (3 confirm cards) → script 2 (ITN 900 → `anomaly:unidad`) → script 3 (manual search over **real** matcher candidates) → script 4 (305 → `anomaly:cantidad`) → «Terminar conteo» → S9 → `/auditor` review, approve an alerted record, alert pill decrements.
  4. Confirm every upload is ≤ 1 048 576 bytes, auto-stop fires at 20 s, and `git status` shows **no modified file under `services/`**.
  Requirements: all. Deps: T20, T22, T23.

## STRETCH — cut these first if the clock runs out

The acceptance bar is the 8-step demo narrative in the proposal. Everything below is expendable.

- [ ] **S1 — `ExcludeSheet.tsx` (S8 exclude overlay)** — Vencido/Roto/Descompuesto/Otro. Design-only; actas are out of PRD scope.
- [ ] **S2 — `/auditor/cierre` and `/auditor/base` beyond static shells** — live KPIs, real Oracle `Import Count Sequences` table, conciliación.
- [ ] **S3 — Playwright e2e** — the Vitest component suite plus T24's manual walkthrough is the tonight-level proof.
- [ ] **S4 — `POST /api/records` in-memory operator→auditor handoff** — the auditor runs on seeded fixtures tonight.
- [ ] **S5 — Self-hosted fonts** — the Google Fonts CDN link ships tonight (D12); self-hosting is the documented follow-up.
