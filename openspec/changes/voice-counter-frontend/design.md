# Design: Voice Inventory Counter frontend (`/conteo` + `/auditor`)

Change: `voice-counter-frontend` · 2026-07-25 · Store: hybrid (this file + Engram `sdd/voice-counter-frontend/design`)
Sources: proposal (obs #114), explore (obs #113), design contract (obs #110 / scratchpad `design-contract.md` — authoritative for every hex, copy string, and fixture; NOT restated here except where a decision depends on it).

## Technical Approach

One new Astro project at `frontend/`, `output: 'server'` (Node adapter), `@astrojs/preact`, TypeScript strict, Vitest + happy-dom. UI pages are prerendered static shells; only the `/api/*` proxy endpoints run on the server, forwarding to the real STT (`:8001`) and matcher (`:8002`) — the archived Python services are never modified and get no CORS. All interactive logic lives in pure, DOM-free TypeScript modules (reducer, extraction adapter, anomaly engine, API client) wrapped by exactly two Preact hydration roots. Strict TDD targets the pure modules first.

## 1. Repo placement — `frontend/`

**Choice: `frontend/` at repo root** (matches proposal). Why it is safe:

- uv workspace membership is explicit (`[tool.uv.workspace] members = ["services/matcher"]` in root `pyproject.toml`) — a sibling directory with no `pyproject.toml` is invisible to uv.
- pytest is pinned to `testpaths = ["services/matcher/tests"]`; `benchmarks/pytest.ini` is self-contained. No Python collector will descend into `frontend/`.
- The matcher Docker build context is the repo root, so `.dockerignore` (root) MUST gain a `frontend/` line or `node_modules` balloons every image build.

**File edits outside `frontend/`** (the only two):

- `.gitignore` — append:
  ```
  # Frontend (Astro)
  frontend/node_modules/
  frontend/dist/
  frontend/.astro/
  ```
- `.dockerignore` — append `frontend/`.

Rejected: `apps/web/` (introduces a monorepo tier that doesn't exist — there is exactly one app); inside `services/` (that namespace means "archived spec-governed Python service"; mixing toolchains there invites accidental spec reopening).

## 2. Project layout (every file an implementer creates)

```
frontend/
├── package.json                 # scripts: dev, build, preview, test, test:watch
├── astro.config.mjs             # output:'server', adapter node standalone, integrations:[preact()]
├── tsconfig.json                # extends astro/tsconfigs/strict; jsxImportSource preact
├── vitest.config.ts             # environment:'happy-dom', globals:true, setupFiles
├── .env.example                 # STT_BASE_URL, MATCHER_BASE_URL
├── public/favicon.svg
├── src/
│   ├── env.d.ts
│   ├── styles/
│   │   ├── tokens.css           # ALL custom properties + 5 keyframes (design contract §1, verbatim)
│   │   └── global.css           # reset, font stacks, scrollbar rules, focus-visible
│   ├── layouts/
│   │   ├── OperatorLayout.astro # phone-first shell, imports styles + Google Fonts link
│   │   └── AuditorLayout.astro  # tablet shell: nav rail (static), header slot
│   ├── pages/
│   │   ├── index.astro          # 302 → /conteo (prerender=false, Astro.redirect)
│   │   ├── conteo.astro         # prerender=true; mounts <CountSession client:load />
│   │   ├── auditor/
│   │   │   ├── index.astro      # prerender=true; mounts <AuditorReview client:load />
│   │   │   ├── cierre.astro     # prerender=true; static V2 shell (KPIs, export table, conciliación)
│   │   │   └── base.astro       # prerender=true; static V3 shell (file card, ranges, team)
│   │   └── api/
│   │       ├── transcribe.ts    # POST — proxy to STT /transcribe (prerender=false)
│   │       ├── match.ts         # POST — proxy to matcher /match
│   │       └── catalogues.ts    # GET  — proxy to matcher /catalogues
│   ├── components/              # Preact .tsx — children of the two islands, NOT islands themselves
│   │   ├── operator/
│   │   │   ├── CountSession.tsx     # ISLAND root: owns useReducer(sessionReducer), renders screens
│   │   │   ├── ConsentScreen.tsx    # S1 (corrected C1 copy lives here)
│   │   │   ├── PlansScreen.tsx      # S2
│   │   │   ├── CountScreen.tsx      # S3: header, record list, mic dock, Terminar conteo
│   │   │   ├── MicRecorder.tsx      # pointer events, waveform, timer; calls useAudioCapture
│   │   │   ├── ProcessingSheet.tsx  # S4
│   │   │   ├── ConfirmSheet.tsx     # S5 (N item cards)
│   │   │   ├── AnomalySheet.tsx     # S6
│   │   │   ├── SearchSheet.tsx      # S7 (real <input>; serves no_match AND ambiguous)
│   │   │   ├── ExcludeSheet.tsx     # S8 (stretch)
│   │   │   └── DoneScreen.tsx       # S9
│   │   └── auditor/
│   │       ├── AuditorReview.tsx    # ISLAND root: selection, filters, actions, modals, export gate
│   │       ├── WarehouseList.tsx / RecordList.tsx / DetailPane.tsx / Modal.tsx
│   ├── lib/
│   │   ├── session/
│   │   │   ├── types.ts             # SessionState, SessionEvent, CountRecord, PendingItem
│   │   │   └── reducer.ts           # sessionReducer — PURE, first-class TDD target
│   │   ├── audio/
│   │   │   └── capture.ts           # createRecorder(): mime chain, bitrate, 20s cap, size guard, timer
│   │   ├── extraction/
│   │   │   ├── adapter.ts           # ExtractionAdapter interface (the Module 2 seam)
│   │   │   ├── mock.ts              # MockExtractionAdapter: ITN table, conjunction split
│   │   │   └── itn.ts               # cardinalToNumber(es-CO words → number)
│   │   ├── anomaly/
│   │   │   ├── engine.ts            # AnomalyEngine interface (the Module 4 seam)
│   │   │   └── fixtureEngine.ts     # FixtureAnomalyEngine: unit-dimension + learned-range rules
│   │   ├── api/
│   │   │   ├── types.ts             # wire contracts (section 8)
│   │   │   └── client.ts            # transcribe(), match(), getCatalogues() + error mapping
│   │   ├── pipeline.ts              # runPipeline(): capture → STT → extract → match → outcome
│   │   ├── units.ts                 # spoken-unit → dimension map; display helpers
│   │   └── catalogues.ts            # the 8 real ids + labels + demo plan mapping
│   └── fixtures/
│       ├── scripts.ts               # 4 dictation scripts + expected extractions (design contract §2)
│       ├── operatorSeed.ts          # 3 seed record rows
│       ├── auditorSeed.ts           # 8 verbatim auditor records + warehouses + export rows
│       └── anomalyRules.ts          # learned ranges (design contract §3 "Rangos aprendidos")
└── tests/                           # mirrors src/lib + component tests
    ├── setup.ts                     # vi.stubGlobal for MediaRecorder/getUserMedia/fetch helpers
    ├── extraction/{itn,mock-adapter}.test.ts
    ├── session/reducer.test.ts
    ├── anomaly/fixture-engine.test.ts
    ├── api/client.test.ts
    ├── audio/capture.test.ts
    ├── pipeline.test.ts
    └── components/{confirm-sheet,search-sheet,auditor-review}.test.tsx
```

## 3. Route map

| Route | Render | Notes |
|---|---|---|
| `/` | server (`prerender=false`) | `Astro.redirect('/conteo', 302)` |
| `/conteo` | **prerendered** static shell | whole S1–S9 flow is island state, not sub-routes (single-session flow; no deep-linking requirement) |
| `/auditor` | prerendered | V1 review island |
| `/auditor/cierre`, `/auditor/base` | prerendered | zero-JS static shells |
| `/api/transcribe` | server | POST multipart passthrough → `STT_BASE_URL/transcribe` |
| `/api/match` | server | POST JSON → `MATCHER_BASE_URL/match` |
| `/api/catalogues` | server | GET → `MATCHER_BASE_URL/catalogues` |

With `output:'server'`, `prerender` defaults to `false`; every UI page explicitly sets `export const prerender = true`.

Proxy behavior (identical pattern in all three endpoints): fixed upstream base from env (never from the request — no SSRF surface); stream request body through; return upstream status + JSON body untouched (the client owns error mapping); `AbortSignal.timeout(50_000)` on transcribe (> STT's 45 s deadline so the service's own 502 arrives first), `10_000` on match/catalogues; fetch failure → `502 {"error":{"code":"proxy_unreachable","message":...}}` in the STT envelope shape.

## 4. Design tokens & responsive strategy

`src/styles/tokens.css` declares every color in design contract §1 as `--*` custom properties under `:root`, using the contract's exact token names and hex values (single source; components never hardcode hex). Plus:

- Typography scale: `--font-ui: Manrope, system-ui, sans-serif`, `--font-mono: 'JetBrains Mono', monospace`; roles as utility classes (`.h1` 27px/800/-.02em, `.eyebrow` 10.5–12px/800/uppercase/.12em, `.qty` tabular-nums 800, `.mono-meta` 10.5–11.5px).
- Radii `--r-pill:99px --r-btn:14px --r-card:16px --r-modal:24px --r-sheet:28px 28px 42px 42px`; shadows and control heights (primary 54px, etc.) per contract §1.
- The five keyframes `vpulse vbar vdot vrise trise` copied **verbatim** from contract §1, plus `@media (prefers-reduced-motion: reduce)` disabling them.
- **Fonts: keep the design's single Google Fonts CDN `<link>`** (exact URL in contract §1) in both layouts, with `font-display:swap` (in URL). Tradeoff: zero setup time tonight vs a CDN dependency on the demo network; system-ui fallback stacks keep the app legible if the CDN is unreachable. Self-hosting is the documented follow-up, not tonight.
- **Breakpoints (authored from scratch — the design has none):**
  - Operator: fluid single column, `max-width: 430px; margin-inline:auto`, phone-first at 390×844; no media query needed — it simply centers on desktop. Mic dock `position:sticky; bottom:0`.
  - Auditor: CSS grid `grid-template-columns: 94px 286px 1fr 352px; height:100dvh` at `min-width:1024px` (covers the 1194×834 design frame) scaling to desktop via the fluid `1fr` center; below 1024px a static notice "Usa una tablet o un computador para la revisión" replaces the grid (auditor phones are out of scope tonight).

## 5. Island boundaries

| Component | Mode | Justification |
|---|---|---|
| `CountSession` | Preact island, `client:load` on `/conteo` | Owns the entire operator state machine; must hydrate immediately (consent gate is the first interaction). |
| `MicRecorder` | Preact **component inside** `CountSession` (not a separate island) | It dispatches into the session reducer; a second hydration root would force cross-island state plumbing for zero benefit. It stays an independently testable module (`components/operator/MicRecorder.tsx` + `lib/audio/capture.ts`). |
| `AuditorReview` | Preact island, `client:load` on `/auditor` | Selection/filters/modals/export gate are one connected local-state tree. |
| Everything else (`layouts`, nav rail, headers, legends, `cierre`, `base`, KPI cards, static tables) | static `.astro`, zero JS | No interactivity; keeps payload small and deadline safe. |

## 6. Operator state machine (pure reducer — first-class TDD target)

`src/lib/session/reducer.ts` — `sessionReducer(state: SessionState, event: SessionEvent): SessionState`. No DOM, no fetch, no timers: side effects (getUserMedia, pipeline) run in `CountSession` and feed results back as events.

```ts
type Screen = 'permiso' | 'plans' | 'count' | 'done';
type Overlay =
  | { kind: 'processing'; transcript: string | null }
  | { kind: 'confirm'; transcript: string; items: ConfirmableItem[] }
  | { kind: 'anomaly'; item: ConfirmableItem; anomaly: Anomaly; queue: QueueEntry[] }
  | { kind: 'search'; item: ExtractedItem; candidates: Candidate[]; query: string; queue: QueueEntry[] }
  | { kind: 'exclude'; reason: ExcludeReason | null }
  | null;

interface SessionState {
  screen: Screen;
  overlay: Overlay;
  consentChecked: boolean;                       // S1 checkbox
  micPermission: 'unknown' | 'granted' | 'denied';
  recording: boolean;
  requestInFlight: boolean;                      // pipeline promise pending
  records: CountRecord[];                        // newest first
  progress: { counted: number; total: number };  // seed 45/107
  error: UiError | null;                         // banner on count screen
}
```

Events and transitions (guards in brackets; anything not listed is a no-op — the reducer MUST be total):

| From | Event | Guard | To |
|---|---|---|---|
| permiso | `CONSENT_TOGGLED` | — | toggles `consentChecked` |
| permiso | `MIC_REQUESTED` | `consentChecked` | (effect: real `getUserMedia`) |
| permiso | `MIC_GRANTED` | — | `micPermission='granted'`, screen→plans |
| permiso | `MIC_DENIED` | — | `micPermission='denied'` + designed fallback note stays on permiso |
| plans | `PLAN_STARTED{catalogueId}` | — | screen→count |
| count | `REC_STARTED` | `!blocked(state) && overlay===null && !requestInFlight && micPermission==='granted'` | `recording=true` |
| count | `REC_STOPPED{audio}` | `recording` | `recording=false, requestInFlight=true`, overlay→processing (effect: `runPipeline`) |
| count | `REC_REJECTED{reason:'too_large'|'too_short'}` | — | `error` set, no upload |
| count | `PIPELINE_TRANSCRIPT{raw}` | — | overlay.processing.transcript = raw (progressive reveal) |
| count | `PIPELINE_RESOLVED{outcome}` | — | `requestInFlight=false`; route: first `anomaly` entry → overlay anomaly; else first `needs_search` → overlay search; else overlay confirm |
| count | `PIPELINE_FAILED{error}` | — | `requestInFlight=false`, overlay=null, `error` set (413/400/502/proxy mapping §8) |
| confirm | `CONFIRM_ACCEPTED` | — | append records (state `ok`), progress+len, overlay=null |
| confirm | `CONFIRM_REPEAT` | — | overlay=null (discard) |
| confirm | `EXCLUDE_OPENED` / exclude `EXCLUDE_*` | — | S8 sub-flow (stretch) |
| anomaly | `ANOMALY_REDICTATE` | — | drop item, advance queue (next queue entry or confirm/null) |
| anomaly | `ANOMALY_KEEP_NOTED` | — | append record with `state:'anom_noted'` + note flag, advance queue |
| search | `SEARCH_QUERY_CHANGED{q}` / `SEARCH_RESULTS{candidates}` | — | update overlay (effect: `match()` re-query) |
| search | `SEARCH_PICKED{candidate}` | — | item becomes confirmable with picked SKU, advance queue |
| search | `SEARCH_DISMISSED` | — | drop item, advance queue |
| count | `COUNT_FINISHED` | `overlay===null && !requestInFlight` | screen→done («Terminar conteo», authored control) |
| done | `BACK_TO_PLANS` | — | screen→plans, session summary frozen |

`blocked(state)` is **derived**, never stored: `overlay?.kind === 'anomaly' || records.some(r => r.state === 'anom_open')`. While blocked the mic guard fails and CountScreen shows the pause banner (contract §2 S3). Queue semantics: a pipeline outcome with N items produces `queue: QueueEntry[]` (anomalies first, then searches, then confirmables); each resolution event pops the queue; when the queue holds only confirmables they render as ONE combined confirm sheet — this is how multi-item scripts recombine.

## 7. Pipeline (concrete signatures)

```ts
// lib/audio/capture.ts
interface CapturedAudio { blob: Blob; mimeType: string; durationMs: number } // durationMs = LOCAL timer
interface RecorderHandle { start(): void; stop(): Promise<CapturedAudio>; onTick(cb: (elapsedMs: number) => void): void }
function createRecorder(stream: MediaStream, opts?: { maxDurationMs?: number /* 20_000 [TEAM] */,
  audioBitsPerSecond?: number /* 28_000 */ }): RecorderHandle
// mime chain via MediaRecorder.isTypeSupported: 'audio/ogg;codecs=opus' → 'audio/webm;codecs=opus' → undefined
// auto-stop at maxDurationMs; caller rejects blobs > 1_048_576 bytes BEFORE upload (REC_REJECTED)

// lib/extraction/adapter.ts  — the Module 2 seam
interface ExtractedItem { quantity: number; unit: string | null; spokenName: string }
interface ExtractionAdapter { extract(rawTranscript: string): ExtractedItem[] }

// lib/anomaly/engine.ts — the Module 4 seam
interface Anomaly { kind: 'unidad' | 'cantidad'; title: string; reason: string; hint: string }
interface AnomalyEngine { check(item: ConfirmableItem): Anomaly | null }

// lib/pipeline.ts
interface ConfirmableItem { extracted: ExtractedItem; match: MatchResponse; picked: Candidate } // picked = candidates[0] or search pick
type QueueEntry =
  | { kind: 'anomaly'; item: ConfirmableItem; anomaly: Anomaly }
  | { kind: 'needs_search'; item: ExtractedItem; candidates: Candidate[] } // ambiguous AND no_match land here
  | { kind: 'confirmable'; item: ConfirmableItem };
interface PipelineOutcome { transcript: string; queue: QueueEntry[] }
interface PipelineDeps { transcribe: typeof transcribe; extraction: ExtractionAdapter;
  match: typeof match; anomalies: AnomalyEngine }
async function runPipeline(audio: CapturedAudio, catalogueId: string, deps: PipelineDeps): Promise<PipelineOutcome>
```

Flow: `transcribe(audio)` → if `is_garbage` throw `UiError('garbage')` → `extraction.extract(raw_transcript)` (0 items → `UiError('nothing_extracted')`) → `Promise.all(items.map(i => match({spoken_name: i.spokenName, catalogue_id, unit: i.unit ?? undefined})))` — N items fan out to N parallel match calls — → per item: `matched` → run `anomalies.check` → `anomaly` entry or `confirmable`; `ambiguous` OR `no_match` → `needs_search` with returned candidates (may be empty → SearchSheet issues live `match()` re-queries as the user types). Queue ordering: anomalies, then searches, then confirmables (reducer §6 consumes it).

## 8. Typed API client (`lib/api/types.ts`, `lib/api/client.ts`)

```ts
// STT — mirrors services/stt/src/transcribe.py:327-337
interface TranscribeResponse { raw_transcript: string; is_garbage: boolean;
  stt_confidence: number | null; audio_duration_ms: number | null;
  stt_vendor: string; request_id: string }
interface ServiceError { error: { code: string; message: string; request_id?: string } }

// Matcher — mirrors services/matcher/src/matcher/schemas.py
interface MatchRequest { spoken_name: string; catalogue_id: string; unit?: string }
interface Candidate { nr_articulo: string | null; articulo: string;
  unidad: string | null; unidad_display: string | null; score: number }
interface MatchResponse { status: 'matched' | 'ambiguous' | 'no_match';
  candidates: Candidate[]; top_score: number; margin: number; request_id: string }
interface CatalogueInfo { catalogue_id: string; rows: number }

// Client
type UiErrorCode = 'payload_too_large' | 'invalid_audio' | 'vendor_timeout' | 'vendor_error'
  | 'validation' | 'unknown_catalogue' | 'proxy_unreachable' | 'aborted' | 'garbage' | 'nothing_extracted';
class UiError extends Error { constructor(readonly code: UiErrorCode, readonly requestId?: string) }
async function transcribe(audio: CapturedAudio, opts?: { signal?: AbortSignal }): Promise<TranscribeResponse>
  // POST /api/transcribe multipart field 'file'; AbortSignal.timeout(50_000)
async function match(req: MatchRequest, opts?: { signal?: AbortSignal }): Promise<MatchResponse>   // timeout 10_000
async function getCatalogues(): Promise<CatalogueInfo[]>
```

Error mapping (client throws `UiError`; UI copy authored — none exists in the design): 413→`payload_too_large` "El audio quedó muy largo. Dicta de nuevo, más corto." · 400 `invalid_audio`→"No se pudo leer el audio. Intenta de nuevo." · 502 `vendor_timeout`/`vendor_error`→"La transcripción está tardando. Reintentar." (retry button re-dictates) · 422 (FastAPI `{detail:[...]}` shape, NOT the envelope)→`validation` · 404 on match→`unknown_catalogue` (config bug — surface literally) · fetch/`AbortError`→`proxy_unreachable`/`aborted`. Nullability rules (success criteria): `stt_confidence`/`audio_duration_ms` null → omit, never 0/"failed"; elapsed time ALWAYS from the local timer; `nr_articulo` null → SKU line without code; `unidad_display` null → unit omitted; raw English `unidad` never rendered.

## 9. Mocked anomaly engine (`FixtureAnomalyEngine`)

Deterministic, fixture-driven, two rules only — explicitly NOT Module 4:

1. **Unit-dimension mismatch (RF-26(b))**: `lib/units.ts` maps spoken units and `unidad_display` to dimensions — `{gramos,kilos,kg} → mass`, `{litros,mililitros} → volume`, `{unidades,botellas,cajas,tablas,porciones,und} → count`. Rule fires ONLY on `mass ↔ volume` conflict (containers like "botellas/cajas" are counts and compatible with anything — prevents false positives on demo script 1). `900 gramos` vs an oil matched with `unidad_display:'litros'` → `anomaly:'unidad'` with the contract's verbatim title/reason/hint.
2. **Out-of-range quantity (RF-26(c))**: `fixtures/anomalyRules.ts` exports `learnedRanges: {nameKeyword: string; unit: string; min: number; max: number}[]` seeded from the contract's "Rangos aprendidos" list (aceite de oliva 2–8 L, gaseosa 20–40 und, lechuga 1,5–6 kg, arroz 3–12 kg, pechuga 12–40 und). Keyword match against `picked.articulo` (lowercased contains); qty outside range → `anomaly:'cantidad'` (`305` vs 20–40 fires).

Swap point: `AnomalyEngine` is constructor-injected into `runPipeline` via `PipelineDeps`. A future Module 4 ships as `HttpAnomalyEngine implements AnomalyEngine` calling its service; zero call-site changes. Same pattern for `MockExtractionAdapter` → future Module 2 client.

## 10. Catalogues (`lib/catalogues.ts`)

| `catalogue_id` | Rows | UI label |
|---|---|---|
| `stock_restaurante_fuentes_ayb` | 345 | Restaurante Fuentes · AyB |
| `stock_almacen_suministros` | 297 | Almacén · Suministros |
| `stock_almacen_ayb` | 271 | Almacén · AyB |
| `zoologico_suministros` | 194 | Zoológico · Suministros |
| `stock_restaurante_fuentes_sumin` | 134 | Restaurante Fuentes · Suministros |
| `stock_kiosco_taquilla_ayb` | 59 | Kiosco Taquilla · AyB |
| `stock_kiosco_piscigiros_ayb` | 57 | Kiosco Piscigiros · AyB |
| `zoologico` | 56 | Zoológico · AyB |

**Operator plan cards are named by the REAL catalogue labels** (D13, revised during apply) — the active card reads "Restaurante Fuentes · AyB" over `catalogueId: 'stock_restaurante_fuentes_ayb'` (largest food catalogue → best match odds for the demo scripts); a small mono sub-line shows the real `catalogue_id` for honesty. The auditor's bodega under review derives the same label from `DEMO_CATALOGUE_ID`, so one name runs through the whole demo. **RF-11 limitation (state verbatim in demo + auditor `base` view):** the bodega→catalogue join key does not exist in the source workbook, so audit categories are the 8 real stock tables, not the 48 bodegas.

## 11. Testing architecture (strict TDD)

- `vitest.config.ts`: `environment:'happy-dom'`, `globals:true`, `setupFiles:['tests/setup.ts']`, `include:['tests/**/*.test.{ts,tsx}']`, preact preset via `@preact/preset-vite`.
- `tests/setup.ts`: `vi.stubGlobal('MediaRecorder', FakeMediaRecorder)` (class with `isTypeSupported` static, `start/stop/ondataavailable`), `vi.stubGlobal('navigator', {...navigator, mediaDevices:{getUserMedia: vi.fn()}})`; `fetch` stubbed per-test with `vi.stubGlobal('fetch', ...)` returning canned `Response`s (pipeline/client tests never hit the network).
- Fixtures live in `src/fixtures/` (shared by app and tests — the demo IS the test data).

**FIRST RED TEST** — `tests/extraction/itn.test.ts`:

```ts
test('"novecientos gramos de aceite de oliva extra virgen" → qty 900, unit gramos', () => {
  const items = new MockExtractionAdapter().extract('novecientos gramos de aceite de oliva extra virgen');
  expect(items).toHaveLength(1);
  expect(items[0].quantity).toBe(900);   // the 90-vs-900 case
  expect(items[0].unit).toBe('gramos');
});
```

TDD cycle order (each RED before its implementation): 1. ITN + mock adapter (script 2, then script 1 multi-split, scripts 3–4) → 2. `sessionReducer` (consent gate → mic guards → blocked derivation → queue advance → finish) → 3. `units.ts` dimensions + `FixtureAnomalyEngine` (both fixtures fire; script 1 does NOT fire) → 4. API client error taxonomy + nullability → 5. `runPipeline` fan-out/recombine with stubbed deps → 6. `capture.ts` (20 s auto-stop, size rejection, mime chain) → 7. component tests (ConfirmSheet N cards, SearchSheet input + pick, AuditorReview approve decrements pill, blocked-modal button wiring) → 8. proxy endpoints (handler functions unit-tested with mocked `fetch`).

## 12. Running it

```bash
# terminal 1+2 — real services (repo root)
uv run uvicorn services.stt...   # :8001 — needs its OWN vendor keys (GROQ_API_KEY etc. per services/stt/.env)
uv run uvicorn matcher.main:app --port 8002   # catalogue sqlite mounted per its README
# terminal 3
cd frontend && cp .env.example .env && npm install && npm run dev   # http://localhost:4321
```

`.env`: `STT_BASE_URL=http://localhost:8001`, `MATCHER_BASE_URL=http://localhost:8002` (read server-side only, never exposed to the client). `getUserMedia` requires a secure context — `localhost` qualifies; accessing the dev server via LAN IP will silently lack mic access (documented demo constraint: browse on the laptop itself). `npm run test` = vitest run; `npm run build && npm run preview` for the demo build.

## 13. Decisions

| # | Decision | Rejected | Why |
|---|---|---|---|
| D1 | App at `frontend/`; only root `.gitignore`/`.dockerignore` touched | `apps/web`, under `services/` | Invisible to uv/pytest; no fake monorepo tier; `services/` means archived Python specs (§1) |
| D2 | Astro server-endpoint proxy; UI pages `prerender=true` | CORS on services; full SSR | Archived specs untouched; unauthenticated services stay off the browser surface; static pages are free speed |
| D3 | Two islands only; `MicRecorder` nested inside `CountSession` | 3+ islands | Cross-island state plumbing costs more than it isolates; MicRecorder stays independently testable as a module |
| D4 | Operator flow = island state on one route | route-per-screen | No deep-link requirement; reducer stays the single source of truth; fastest to test |
| D5 | Pure `sessionReducer` with derived `blocked` | component state, XState | DOM-free unit tests first (strict TDD); no new dependency tonight |
| D6 | **C1 fix**: consent "Cuánto se conserva" copy rewritten — audio streamed for transcription, NOT stored; only the transcription is retained | keep design copy | Design copy violates RNF-04, contradicts the auditor legend, misstates a Ley 1581 disclosure |
| D7 | **C2 fix**: no "Funciona sin señal" claim anywhere; `sync` record state = in-session "pending upload" only | offline banner/sync engine | RNF-08 removed from product; implying offline is dishonest |
| D8 | `ambiguous` AND `no_match` both route to the S7 search sheet (with a real `<input>`, authored) | auto-accept top ambiguous candidate | A confident wrong match is worse than asking (PRD §12); the design never drew `ambiguous` |
| D9 | Authored «Terminar conteo» secondary button in the mic dock, guarded by `overlay===null && !requestInFlight` | debug chips / auto-finish | The design has NO path to S9; a count you cannot end is undemoable |
| D10 | 20 s hard cap + 28 kbps + client-side 1 MiB pre-check, all constants in `capture.ts` | server 413 as the signal | RF-13 value unratified (`[TEAM]`); one constant to change; 413 should never be the first feedback |
| D11 | Anomaly mock: mass↔volume rule + keyword learned-ranges, injected via `AnomalyEngine` seam | generic anomaly heuristics | Deterministic for the 4 scripts; zero false positives on script 1; honest Module 4 swap point |
| D12 | Google Fonts CDN link kept; self-host is follow-up | self-host tonight | Zero setup under deadline; fallback stacks degrade gracefully (§4) |
| D13 (revised) | Plan cards: REAL catalogue labels ("Restaurante Fuentes · AyB") over real `catalogue_id`, real id visible in mono sub-line; the auditor's reviewed bodega derives its name from `DEMO_CATALOGUE_ID` | fake bodega mapping; illustrative labels ("Cocina Principal") that made the demo's two halves disagree | RF-11 join key does not exist; one source of bodega names (`lib/catalogues.ts`) keeps the narrative coherent AND honest (§10) |

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, or executable-file classification boundary. HTTP proxy hardening is handled by design (§3): fixed env-derived upstream bases (no user-controlled URLs → no SSRF), body passthrough with upstream status preserved, bounded timeouts. RED tests for the proxy handlers (cycle 8, §11) cover: upstream 413/400/502 passthrough, fetch failure → `proxy_unreachable`, and that upstream base never derives from request data.

## Migration / Rollout

No migration. Single PR (`size:exception` pre-accepted), all-new `frontend/` + two appended ignore lines. Rollback = revert the PR; no Python file touched.

## Open Questions

- [ ] None blocking. Carried flags: 20 s cap is a `[TEAM]` proposal (D10); S8 exclude + live operator→auditor handoff are stretch (proposal scope).
