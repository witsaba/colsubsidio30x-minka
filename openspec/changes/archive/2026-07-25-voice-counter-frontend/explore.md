# Exploration: Voice Inventory Counter frontend (Astro, `/conteo` + `/auditor`)

Change: `voice-counter-frontend` · Date: 2026-07-25 · Artifact store: hybrid (this file + Engram `sdd/voice-counter-frontend/explore`, obs #113)

## Current State

**No frontend exists.** Verified: zero `package.json` anywhere, no `.astro`/`.ts`/`.js` app code, no root `docker-compose.yml` (only per-service), no `.github/workflows`, no linter/formatter/typechecker. The repo is Python-only (uv + pytest).

**Two shipped, spec-governed FastAPI services on `main`** (both already archived under `openspec/changes/archive/2026-07-25-*`):

### STT — `services/stt`, port 8001
- `POST /transcribe`, multipart field `file` (`services/stt/src/transcribe.py:262-337`).
- 200 body (`transcribe.py:327-337`): `{raw_transcript, is_garbage, stt_confidence, audio_duration_ms, stt_vendor, request_id}`.
- `stt_confidence` and `audio_duration_ms` are genuinely nullable (`services/stt/src/vendors/base.py:15-30`; Groq returns `None` with no segments, `vendors/groq.py:61-75`). **Never coerce null to 0.**
- Upload cap `stt_max_upload_bytes = 1_048_576` (`src/settings.py:61`), enforced *before* the multipart parser by `BodyLimitMiddleware` (`src/body_limit.py:43-96`) — which exists precisely so Starlette never spools audio to disk (RNF-04). The middleware allows `MULTIPART_ENVELOPE_ALLOWANCE = 4096` B of slack (`body_limit.py:36-40`); design to fit inside 1,048,576 B, do not rely on the slack.
- Worst case `stt_total_deadline_s = 45.0` (`src/settings.py:83`), an `asyncio.timeout` around the whole vendor dispatch (`transcribe.py:249,254`). **Do not build UI assuming a bounded ~2 s or ~30 s wait.**
- Errors `{"error":{code,message,request_id}}`: 413 `payload_too_large`, 400 `invalid_audio`, 502 `vendor_timeout` / `vendor_error` (`transcribe.py:279-322`). A missing `file` field is plain FastAPI 422 `{"detail":[...]}`, **not** the service envelope.
- Transcript is VERBATIM — no ITN. "novecientos" stays a word (`openspec/specs/stt-transcription/spec.md:59-67`).
- `GET /health` → `{"status":"ok","vendor":...}`.

### Matcher — `services/matcher`, port 8002
- `POST /match` (`src/matcher/main.py:130-170`), request `{spoken_name (1..300, blank → 422), catalogue_id (≤100), unit (≤50, optional)}` (`src/matcher/schemas.py:19-32`).
- 200 `{status, candidates[{nr_articulo, articulo, unidad, unidad_display, score}], top_score, margin, request_id}` (`schemas.py:35-52`).
- `status ∈ {matched, ambiguous, no_match}` (`src/matcher/decision.py:35`, decided in `decide()` `decision.py:110-138`). **All three must render.**
- Unknown `catalogue_id` → **404** (`main.py:144-150`), never `no_match`.
- `nr_articulo: str | None` (`schemas.py:38`) — ~18.4% of catalogue rows have no code. UI must render a SKU line without a code.
- `UNIT_DISPLAY = {"Kilogram":"kg","Liter":"litros","Unidad":"unidades","Portion":"porciones"}` (`src/matcher/units.py:47-52`); null `unidad` → `unidad_display: None`, never coerced (`decision.py:67-76`). English canonical units must never reach the UI.
- `GET /catalogues` → 8 entries; `GET /health` → `{"status":"ok","catalogues":8,"rows":...}`.
- The 8 real `catalogue_id` values: `stock_almacen_ayb` (271), `stock_almacen_suministros` (297), `stock_kiosco_piscigiros_ayb` (57), `stock_kiosco_taquilla_ayb` (59), `stock_restaurante_fuentes_ayb` (345), `stock_restaurante_fuentes_sumin` (134), `zoologico` (56), `zoologico_suministros` (194).

### Blocking integration fact
**Neither service has CORS. Neither has auth.** Repo-wide `grep -i cors` (excluding `.venv`) → zero hits. A browser cannot call `:8001`/`:8002` cross-origin today.

## Design source

Authoritative visual contract: the Claude design export (`App Conteo por Voz.dc.html`, `Tablero del Auditor - Tablet.dc.html`). These are "DC" prototypes — inline styles only, custom `<x-dc>/<sc-if>/<sc-for>` tags, and a React-like `class Component extends DCLogic`. `support.js` is a **vendored `dc-runtime`** that loads React 18.3.1 + Babel from unpkg and contains zero product content — **do not port it**.

- **No Tailwind, no CSS custom properties, no media queries anywhere.** Every value is a literal inline style. The token layer and every breakpoint must be authored from scratch.
- Operator frame: fixed **390 × 844** (phone). Auditor frame: fixed **1194 × 834** (iPad Pro 11" landscape), rigid 3-column flex (rail 94 + warehouses 286 + rows ~462 + detail 352).
- Brand palette verified against the official colors PNG: **`#0067b1`** (Pantone 2196 C), **`#ffd000`** (Pantone 109 C), **`#575756`** (Cool Gray 11 C). Anomaly orange `#d9631a` / text `#8a4a12` / surface `#fdf1e7`. Success `#2f6b3a` / `#eef6ef`. **There is no red** — destructive actions reuse the anomaly orange.
- Fonts: Manrope 400–800 (UI), JetBrains Mono 400/500 (SKUs, export table), Material Symbols Rounded (ligature icons).

## Decisions taken (binding)

1. **One Astro project, two route areas**: `/conteo` (operator, phone-first) and `/auditor` (dashboard, tablet→desktop). Shared design system + API client. Responsive web, not native.
2. **Audit categories = the 8 real stock tables.** RF-11's bodega→catalogue join key does not exist; state the limitation rather than fake a mapping.
3. **STT is the real service.** The browser genuinely captures audio and calls `services/stt`.
4. **Module 2 does not exist** and is not in scope to build. A swappable, mocked `ExtractionAdapter` sits between real STT and real matcher.
5. **Audio format**: `MediaRecorder.isTypeSupported()` preference chain `audio/ogg;codecs=opus` → `audio/webm;codecs=opus` → browser default. Real OGG on Firefox, WebM/Opus on Chromium; both are accepted by the format-agnostic STT service. The UI surfaces which container was used.
6. **Demo target**: laptop, Chrome, `localhost` — satisfies the `getUserMedia` secure-context requirement with no TLS setup. Expected container: WebM/Opus.
7. **`ambiguous` reuses the manual-search sheet** with adjusted copy. A confident wrong match is worse than asking (PRD §12 risk row).
8. Deadline: **today, Sat 2026-07-25, 22:00 America/Bogota.** Hard.

## Open Questions (resolved during exploration)

1. ~~Duration cap value~~ → proposed 20 s, carried into the spec as a `[TEAM]` proposal.
2. ~~Deploy target~~ → laptop, Chrome, localhost.
3. ~~Catalogue labelling~~ → human-friendly labels over the real `catalogue_id`s.
4. ~~Demo device/browser~~ → Chrome on the demo laptop; expect WebM/Opus.
