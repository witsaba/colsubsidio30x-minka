# Design: Voice Inventory Counter frontend (`/conteo` + `/auditor`)

Change: `voice-counter-frontend` · 2026-07-25 · Store: hybrid (this file + Engram `sdd/voice-counter-frontend/design`)
Sources: proposal (obs #114), explore (obs #113), design contract (obs #110 / scratchpad `design-contract.md` — authoritative for every hex, copy string, and fixture; NOT restated here except where a decision depends on it).

## Technical Approach

One new Astro project at `frontend/`, `output: 'server'` (Node adapter), `@astrojs/preact`, TypeScript strict, Vitest + happy-dom. UI pages are prerendered static shells; only the `/api/*` proxy endpoints run on the server, forwarding to the real STT (`:8001`) and matcher (`:8002`) — the archived Python services are never modified and get no CORS. All interactive logic lives in pure, DOM-free TypeScript modules (reducer, extraction adapter, anomaly engine, API client) wrapped by exactly two Preact hydration roots. Strict TDD targets the pure modules first.

## Key Decisions

**D1**: App at `frontend/` at repo root — invisible to uv/pytest, no fake monorepo tier introduced.

**D2**: Astro server-endpoint proxy to `:8001`/`:8002` — archived specs untouched, no CORS needed.

**D6**: C1 fix — consent screen copy rewritten to state audio is NOT stored, streamed only for transcription.

**D7**: C2 fix — no "Funciona sin señal" claim anywhere in the UI.

**D9**: Authored «Terminar conteo» control on count screen to reach S9 (design gap fix).

**D13 (revised)**: Operator plan cards use REAL catalogue labels ("Restaurante Fuentes · AyB") over real `catalogue_id`. Auditor's bodega under review derives the same label, keeping the narrative coherent.

## Spec Boundaries

Five new capability specs created during this change:

1. **operator-count-flow** — S1–S9 state machine, overlays, blocked state, finish-count, record list.
2. **voice-capture** — MediaRecorder wrapper — mime chain, bitrate, 20 s cap, size guard, local timer, permission fallback.
3. **extraction-adapter** — adapter interface + mock (ITN, multi-split, 4-script fixtures), the Module 2 seam.
4. **service-proxy** — Astro endpoints `POST /api/transcribe`, `POST /api/match`, `GET /api/catalogues` with error-envelope mapping.
5. **auditor-dashboard** — review pane live, close/base shells, modals, export gating, footer legend.

See `openspec/specs/{capability}/spec.md` for full requirement/scenario matrices.

## Testing Strategy

Strict TDD — Vitest + happy-dom. First RED test: extraction adapter (ITN 900-vs-90 case). Pure modules (reducer, adapter, anomaly engine, API client, capture, pipeline) drive test structure. Component tests (ConfirmSheet N cards, SearchSheet input + pick, AuditorReview approve decrements pill).

## Risk Mitigations

- 22:00 deadline: Hard scope cut; auditor close/base are static shells.
- Real STT transcript drift: Keyword-tolerant mock; "Repetir" path.
- 45 s STT worst case: Promise-driven processing state (not the prototype's 1700 ms timer).
- 1 MiB / 413: Low bitrate (28 kbps) + 20 s cap + client-side size check.
- C1/C2 compliance: Blocking fixes, zero engineering cost.

## Open Questions

None blocking. Carried flags: 20 s cap is a `[TEAM]` proposal; S8 exclude + live operator→auditor handoff are stretch goals.
