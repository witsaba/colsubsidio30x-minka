# Voice Inventory Counter — web frontend

Astro + Preact frontend for the Colsubsidio hospitality physical-count tool.
One project, two route areas:

| Route | Who | Device target |
|---|---|---|
| `/conteo` | Operator (the person responsible for the warehouse) | Phone-first, designed at 390×844 |
| `/auditor` | Auditor / costing lead | Tablet 1194×834, scales up to desktop |

`/` redirects to `/conteo`.

---

## Quick start

Three processes. **All three must be running for a real end-to-end demo.**

### 1. STT service — port 8001

Speech-to-text. Requires a vendor API key.

```bash
# from the repo root
cd services/stt
cp .env.example .env      # then edit .env and set DEEPGRAM_API_KEY=...
docker compose up -d
curl -s localhost:8001/health     # {"status":"ok","vendor":"deepgram"}
```

`services/stt/.env` is gitignored — never commit a key.
Deepgram is the default and primary vendor (`STT_VENDOR=deepgram`). ElevenLabs is
**backup-only** and is rejected as primary at boot by design (RNF-04 zero-retention);
Groq is the third fallback layer.

Without a valid key the service either fails to boot or returns `502 vendor_error`
on every clip. The UI handles that error path correctly, but you will get no transcript.

### 2. Matcher service — port 8002

Product matching against the warehouse catalogue. No key needed.

```bash
# from the repo root
cd services/matcher
docker compose up -d
curl -s localhost:8002/health     # {"status":"ok","catalogues":8,"rows":1405}
```

### 3. This app — port 4321

```bash
cd frontend
cp .env.example .env      # defaults already point at localhost:8001/8002
npm install
npm run dev               # http://localhost:4321
```

---

## ⚠️ Browse on the laptop itself, not a LAN IP

`getUserMedia` — the browser API that opens the microphone — **only works in a secure
context**: HTTPS, or `localhost`. If you open the app from another device via
`http://192.168.x.x:4321`, the microphone will silently fail to open and the whole
voice flow is dead.

For the demo: run the browser on the same machine as `npm run dev` and use
`http://localhost:4321`. Demoing from a separate tablet would require HTTPS
(a self-signed cert or a tunnel) and is not set up.

---

## Audio format

The recorder picks the first container the browser actually supports:

1. `audio/ogg;codecs=opus` — Firefox
2. `audio/webm;codecs=opus` — Chrome / Edge / Chromium (the usual outcome)
3. browser default — the `mimeType` key is omitted entirely rather than passed as
   `undefined`, because some engines throw `NotSupportedError` on the latter

The container that was actually used is read back off the live recorder and surfaced
in the UI, so there is no ambiguity about what got sent. The STT service is
format-agnostic — it forwards the container and content type verbatim, and Deepgram
accepts both — so either branch works.

**Chrome will produce WebM, not OGG.** That is expected, not a bug.

Two hard constraints the recorder enforces client-side:

- **1 MiB upload ceiling**, including the multipart envelope. `audioBitsPerSecond` is
  pinned low (24–32 kbps) rather than left unset, because some Chromium builds default
  Opus to ~128 kbps and would blow the budget in about 65 seconds. Oversized clips are
  refused before upload rather than letting the server's 413 be the first signal.
- **20 s hard auto-stop.** RF-13 requires a cap; the PRD never set a value. This one is
  a `[TEAM]` proposal, not a client-ratified number, and lives in a single constant
  (`MAX_DURATION_MS` in `src/lib/audio/capture.ts`) so ratifying it is a one-line change.

---

## Why the `/api/*` proxy exists

Neither Python service sets CORS headers, and neither has authentication. A browser
therefore cannot call `:8001`/`:8002` cross-origin at all.

Rather than modify two shipped, spec-governed, already-archived services, this app
proxies them through same-origin Astro server endpoints:

| Route | Upstream |
|---|---|
| `POST /api/transcribe` | STT `POST /transcribe` (multipart, field `file`) |
| `POST /api/match` | Matcher `POST /match` |
| `GET /api/catalogues` | Matcher `GET /catalogues` |

Upstream status codes and error bodies are passed through **verbatim** — the client's
error taxonomy depends on that. Upstream base URLs come only from `STT_BASE_URL` /
`MATCHER_BASE_URL`; nothing from the request can influence the target, so there is no
SSRF surface. Audio is streamed through and never buffered to disk (RNF-04).

This is why the app runs in `output: 'server'` mode and needs a Node process — it is
not a static site.

---

## Timeouts

The STT worst case is genuinely **45 seconds** (`STT_TOTAL_DEADLINE_S`: 30 s vendor
timeout + retry + failover across up to three vendors). Client and proxy budgets are
set to 50 s so they outlast it. Do not "optimise" these down to 30 s — a slow primary
vendor would then look like a client bug.

Matching, by contrast, has a p95 of about 1.8 ms and gets a 10 s budget.

---

## What is real and what is mocked

| Layer | Status |
|---|---|
| Audio capture | **Real** — MediaRecorder in the browser |
| Speech-to-text | **Real** — `services/stt`, Deepgram primary |
| Product matching | **Real** — `services/matcher`, 8 catalogues, 1405 rows |
| Extraction `{qty, unit, name}` + ITN + multi-item split | **Mocked** — Module 2 does not exist |
| Anomaly detection | **Mocked** — Module 4 does not exist; two fixture rules |
| Operator → auditor handoff | **Mocked** — the auditor runs on seeded fixtures |

The two mocks sit behind single injected interfaces (`ExtractionAdapter`,
`AnomalyEngine`), so swapping in real services later is a composition-root change,
not a rewrite.

### The catalogue caveat (RF-11)

The PRD's audit plans are bound to a *bodega*, and there are 48 of them. The matcher
serves **8 stock tables**, and there is no join key between the two. Rather than invent
a mapping, the plan-selection screen offers the 8 real catalogues as audit categories
with human-readable Spanish labels. State this plainly if asked — it is a known gap,
not a bug.

---

## Tests

```bash
cd frontend
npx vitest run        # unit + component suite
npx astro check       # typecheck
npm run build         # production build
```

`MediaRecorder`, `getUserMedia` and `fetch` do not exist in happy-dom and are stubbed
in `tests/setup.ts`.

---

## Layout

```
frontend/
├── src/
│   ├── components/
│   │   ├── auditor/          AuditorReview island + panes
│   │   └── operator/         consent, plans, count, mic dock, overlay sheets
│   ├── fixtures/             demo scripts, seeds, anomaly rules, auditor data
│   ├── layouts/              OperatorLayout, AuditorLayout
│   ├── lib/
│   │   ├── anomaly/          engine interface + fixture implementation
│   │   ├── api/              wire types + typed client + error taxonomy
│   │   ├── audio/            capture, mime chain, size + duration guards
│   │   ├── extraction/       ITN, mock adapter (the Module 2 seam)
│   │   ├── session/          pure reducer + state machine types
│   │   ├── catalogues.ts     the 8 real catalogues and their labels
│   │   ├── pipeline.ts       transcribe → extract → match fan-out → recombine
│   │   └── units.ts          spoken-unit vocabulary + dimension map
│   ├── pages/
│   │   ├── api/              server-only proxy endpoints
│   │   ├── auditor/          auditor routes
│   │   └── conteo/           operator route
│   └── styles/               tokens.css, global.css
└── tests/                    mirrors src/
```

---

## Product rules the UI must not break

These are requirements, not preferences. Several have dedicated tests.

- **Blind counting (RF-18).** No operator screen — including the confirmation sheet —
  may ever show theoretical or system stock. The auditor *may* see it; that restriction
  binds the operator only.
- **Voice creates only (RF-20).** Voice never edits and never deletes. Correction is
  delete-then-redictate, by touch (RF-21).
- **Confirmation is yes/no (RF-33).** «Repetir» or «Confirmar», and it reveals no prior stock.
- **Anomalies block preventively (RF-28)** but never cut an in-flight recording (RF-29).
- **Audio is never stored (RNF-04).** The consent screen says so, and it is true: audio is
  streamed for transcription and discarded. Only the transcription is retained.
  *(The original design mockup claimed 12-month retention. That was wrong and was corrected.)*
- **No offline mode.** RNF-08 was removed from the product. The app must not claim or
  imply it works without a network.
- **Units render only from `unidad_display`.** The catalogue stores English canonical
  units (`Kilogram`, `Liter`) and the operator must never see them. A null unit renders
  as absent — never coerced to "unidades".
- **A null `nr_articulo` is normal** (~18% of catalogue rows). Render the line without a code.
- **All three match statuses are real states.** `matched` → confirm; `ambiguous` and
  `no_match` → the manual-search sheet. A confident wrong match is worse than asking.
