# Proposal: Voice Inventory Counter frontend (`/conteo` + `/auditor`)

Change: `voice-counter-frontend` · Date: 2026-07-25 · Deadline: **today 22:00 America/Bogota** (hard)

## Intent

The product has two shipped, spec-governed backend services (STT `:8001`, matcher `:8002`) and zero frontend — nothing an operator or auditor can touch, and nothing to demo tonight. This change builds the demoable web frontend: a phone-first operator counting flow (`/conteo`) with **real** microphone capture, **real** STT transcription and **real** SKU matching, plus a tablet-first auditor dashboard (`/auditor`), faithfully porting the authoritative design contract while fixing its two compliance-breaking claims (C1 audio-retention copy, C2 offline claim). Extraction/consensus (Module 2) and anomaly detection (Module 4) do not exist and are mocked behind an explicit, swappable seam.

## Scope

### In Scope

| Deliverable | PRD trace |
| --- | --- |
| Operator S1 consent screen with **rewritten retention copy (C1)** — audio is streamed for transcription and NOT stored; real `getUserMedia` fired at "Permitir el micrófono" so denial routes to the designed fallback | RF-22, Ley 1581, RNF-04 |
| Operator S2 plans (static, design fixtures) | RF-06, RF-07, RF-11 (visual) |
| Operator S3 count: push-to-talk mic, record list, blind counting, preventive-block UI, **authored "Terminar conteo" control (design gap)**, empty state | RF-12, RF-18, RF-19, RF-28, CU-03 |
| Real audio capture: `isTypeSupported()` chain ogg/opus → webm/opus → default; explicit 24–32 kbps `audioBitsPerSecond`; **20 s hard client-side cap (`[TEAM]` proposal — RF-13 value never ratified)**; pre-upload check against the 1 MiB STT ceiling | RF-12, RF-13, RNF-12 |
| S4 processing overlay driven by the real request promise — credible for the full **45 s** STT worst case, never the prototype's 1700 ms timer; STT error envelope → designed error states (authored; none exist in the design) | RNF-02, RNF-11 |
| Mocked `ExtractionAdapter` seam: deterministic es-CO ITN (novecientos → 900), conjunction multi-item split, fixture-tuned to the 4 demo scripts | RF-14, RF-17 (mocked RF-23/24), CU-04 |
| Real matcher integration: all three statuses render; `ambiguous` + `no_match` reuse the S7 manual-search sheet (**with a real `<input>` — design gap**); nullable `nr_articulo`, `unidad`/`unidad_display`, `stt_confidence`, `audio_duration_ms` honored (never coerced; elapsed time from a local timer) | RF-15, RF-16, QA-05, QA-10 |
| S5 confirm (multi-item cards, Repetir/Confirmar), S6 anomaly overlays with **two fixture-scoped demo rules** (unit vs `unidad_display`; quantity range fixture — NOT Module 4), S8 exclude (stretch; design-only, PRD lists actas out of scope), S9 done | RF-33, RF-21, RF-26–RF-29 (mocked), CU-05, CU-06 |
| Auditor V1 review live (selection, filters, approve/correct/recount as local state, export gate) seeded with the design's 8 verbatim records; V2 `close` / V3 `base` static shells; **fixed `blocked` modal wiring (design gap: inverted buttons)** — primary "Ver los pendientes" navigates, secondary "Cancelar" dismisses, "Exportar de todos modos" dropped (strict gate is the honest behavior) | RF-08, RF-09 (partial), RF-30–RF-32 (visual) |
| Audit categories = the 8 real matcher stock tables with human-friendly labels over real `catalogue_id`, and the RF-11 bodega→catalogue limitation MUST be stated, not faked. | RF-11 (limited) |
| Astro server-endpoint proxy to `:8001`/`:8002` — no CORS added to the archived services | RNF-05 (posture) |
| Design tokens as CSS custom properties from the design contract; **C2 fixed**: no "Funciona sin señal" claim, `sync` state at most "pending upload" in-session | — |
| Vitest + happy-dom test suite under strict TDD (first RED: extraction adapter, 900 fixture) | QA-03, QA-04 (unit layer) |

### Out of Scope

Auth/login · Excel upload + characterisation (RF-01/02/03) · user management (RF-05) · product creation (RF-04) · **real** anomaly detection / Module 4 (RF-25–RF-27 logic) · **real** extraction/ITN/consensus / Module 2 (RF-23/RF-24) · offline sync (RNF-08 — removed from product) · a real Oracle export file (RF-30 is a visual mock) · warehouse-section mapping · per-operator statistics (RF-10) · recount mechanics (§13.4) · i18n · native app.

### Explicit Non-Goals

- No changes of any kind to `services/stt` or `services/matcher` (both archived).
- No persistence layer; operator records live in island state (in-memory `POST /api/records` handoff to the auditor is a stretch, not the acceptance bar).
- No accessibility remediation beyond semantic HTML this slice (gaps documented in exploration).

## Capabilities

### New Capabilities
- `operator-count-flow`: S1–S9 state machine, overlays, blocked state, finish-count, record list.
- `voice-capture`: MediaRecorder wrapper — mime chain, bitrate, 20 s cap, size guard, local timer, permission fallback.
- `extraction-adapter`: adapter interface + mock (ITN, multi-split, 4-script fixtures), the Module 2 seam.
- `service-proxy`: Astro endpoints `POST /api/transcribe`, `POST /api/match`, `GET /api/catalogues` with error-envelope mapping.
- `auditor-dashboard`: review pane live, close/base shells, modals, export gating, footer legend.

### Modified Capabilities
None — `stt-transcription` and matcher specs are untouched.

## Approach

- **Stack**: one Astro project (`frontend/`), `output: 'server'`, `@astrojs/preact`, Vitest + happy-dom. Demo: laptop + Chrome + `localhost` (secure context satisfied).
- **Routes**: `/conteo` (operator), `/auditor` (review), `/auditor/cierre`, `/auditor/base` (static), `/api/*` (proxy).
- **Island boundary**: static `.astro` for shells, nav rail, headers, legends, KPI cards, tables; islands only for `MicRecorder`, `CountSession`, `AuditorReview`.
- **Layout**: `src/styles/tokens.css` (design-contract tokens as CSS variables; fonts via the design's Google Fonts URL), `src/lib/{audio,extraction,api}`, `src/fixtures/` (4 dictation scripts, auditor seed records, anomaly rules), `src/pages/api/*` (proxy), `tests/`.
- **Adapter seam**: `ExtractionAdapter.extract(transcript) → {quantity, unit|null, spokenName}[]`; mock matches on keywords (real STT transcripts vary), maps directly onto `MatchRequest`.
- Flow: mic → real STT (verbatim transcript, no ITN) → mock extraction → real matcher → confirm/anomaly/search → record list.

## Demo Narrative (acceptance bar, 22:00)

1. `/conteo` → S1 consent (corrected copy) → check → mic permission granted live.
2. S2 → "Iniciar conteo" (Restaurante Fuentes · AyB label over a real catalogue).
3. Hold mic, dictate script 1 *"tres kilos de lechuga batavia, doce botellas de aceite vegetal y dos cajas de tomate chonto"* → real STT → processing → 3 confirm cards → Confirmar → 3 records.
4. Script 2 *"novecientos gramos de aceite de oliva extra virgen"* → ITN 900 → `anomaly:unidad` → resolve.
5. Script 3 *"cinco tablas para picar blancas"* → matcher non-match → S7 manual search with real candidates → select.
6. Script 4 *"trescientas cinco unidades de gaseosa personal"* → `anomaly:cantidad` → note to auditor.
7. "Terminar conteo" → S9 done.
8. `/auditor` review: seeded records incl. the two alerts → select → detail → "Aprobar registro" → alert pill decrements; export gate visible.

## Risks

| Risk | L | Mitigation |
| --- | --- | --- |
| 22:00 deadline | High | Scope above is the cut; auditor close/base are shells; exclude overlay and live operator→auditor handoff are stretch. Validate JS toolchain install FIRST, not last. |
| Real STT transcript deviates from scripts | Med | Keyword-tolerant mock extraction; "Repetir" path; recorded video fallback (PRD §12). |
| 45 s STT worst case on stage | Med | Promise-driven processing state with rotating copy; abort/retry on 502. |
| 1 MiB / 413 on long dictation | Low | Low bitrate + 20 s cap + client-side pre-upload size check. |
| C1 consent copy ships wrong | — | Blocking fix, in scope, zero cost; verified in success criteria. |
| 20 s cap unratified (`[TEAM]`) | Low | Flagged in spec as proposal; single constant to change. |

## Rollback Plan

Everything lands as a new `frontend/` directory plus this change folder in a single PR (`size:exception` pre-accepted). Revert the PR; no service, spec, or Python file is touched.

## Dependencies

- `services/stt` on `:8001` and `services/matcher` on `:8002` running locally.
- Node.js + npm on the demo laptop; Google Fonts CDN reachable (or self-host fallback).

## Success Criteria

- The 8-step demo narrative completes end-to-end on Chrome/localhost with real mic → real STT → real matcher.
- Consent screen states audio is NOT stored (C1); no offline claim anywhere (C2).
- All three matcher statuses render; null `nr_articulo`/`unidad`/`stt_confidence`/`audio_duration_ms` never render as 0, "failed", or English units.
- Recording auto-stops at 20 s; uploads never exceed 1,048,576 bytes client-side.
- Processing state remains coherent through a forced 45 s delay.
- "Terminar conteo" reaches S9; auditor `blocked` modal buttons act as labelled.
- Vitest suite green, with the extraction-adapter 900 fixture written RED-first.
- No file under `services/` modified.
