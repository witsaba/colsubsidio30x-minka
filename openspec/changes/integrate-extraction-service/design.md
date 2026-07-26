# Design: Integrate Real Extraction Service

## Technical Approach

Make `ExtractionAdapter` async, add an HTTP adapter that calls a new same-origin proxy route (`/api/extract` → `product_identification:8003/api/v1/extract`), and compose it with the existing mock via a `withFallback` decorator so any extract failure degrades per-utterance to the deterministic mock. Copies the proven match/transcribe proxy pattern verbatim; reuses `request()` from `lib/api/client.ts` for error taxonomy and timeout composition.

## Architecture Decisions

### Decision: Async interface migration

**Choice**: `extract(rawTranscript: string): Promise<ExtractedItem[]>`; `pipeline.ts:131` becomes `const items = await deps.extraction.extract(transcript);`. Mock's method becomes `async` (body unchanged — sync compute, promise wrapper).
**Alternatives considered**: union return `ExtractedItem[] | Promise<...>` (rejected: pushes `Promise.resolve()` juggling into the pipeline); a parallel `AsyncExtractionAdapter` (rejected: two seams for one swap point).
**Rationale**: `await` on a plain value is a no-op, so one signature serves both adapters. Ordering is untouched: `onTranscript` still fires on the line before extract; match fan-out, anomaly classification, and the anomalies→searches→confirmables bucket order are unchanged. Interface doc note: determinism becomes a mock-only guarantee (spec delta REQ-EXT-1).

### Decision: Fallback as a composing adapter

**Choice**: `frontend/src/lib/extraction/fallback.ts` exports `withFallback(primary, fallback): ExtractionAdapter` — try primary; on ANY throw, `console.warn` and run fallback with the same transcript. `CountSession.tsx` defines module-level `const realExtraction = withFallback(httpExtractionAdapter, mockExtractionAdapter)` and flips the default param to it.
**Alternatives considered**: try/catch inside the HTTP adapter (rejected: untestable in isolation, couples HTTP to mock); fallback inside `runPipeline` (rejected: pipeline deliberately never catches/rewraps errors); circuit breaker (rejected: MVP, per-utterance retry is the wanted demo behavior).
**Rationale**: Isolated unit testing, one-line rollback (default back to `mockExtractionAdapter`), no operator-visible degraded indicator (orchestrator decision). NOT triggered by `[]` — an empty list is a legitimate upstream verdict and surfaces as `nothing_extracted` ("repite") as today.

### Decision: Tolerant response mapping

**Choice**: `frontend/src/lib/extraction/http.ts` — `HttpExtractionAdapter` posts `{transcription}` via `request<ExtractionResponse>('/api/extract', ..., EXTRACT_TIMEOUT_MS)`. Mapping per item: `spokenName = producto` (trimmed, non-empty), `quantity = cantidad` (finite, > 0, decimals kept verbatim — meeting flagged decimal ambiguity; never round), `unit = resolveSpokenUnit(unidad.toLowerCase())` (all four enum values are `SPOKEN_UNITS` members; unknown → `null`, item kept). Invalid items dropped; missing/non-array `validated_inventory` → `[]`. Never throw on a 2xx body. Throws only when `request()` throws (non-2xx, timeout, abort, network) — that is what arms the fallback.
**Alternatives considered**: strict zod-style validation throwing on drift (rejected: shape drift would burn the demo instead of degrading); hand-rolled enum map (rejected: `resolveSpokenUnit` already normalizes and null-guards); mapping envelope drift to a thrown `vendor_error` to force mock fallback (rejected: fallback then second-guesses a genuine 200).
**Rationale**: The real service canonicalizes names/units (accepted behavior change); the frontend's job is to never crash on it. `consensus_status`/`confidence_score` are read by nobody (MVP).

### Decision: Proxy route and timeout topology

**Choice**: `frontend/src/pages/api/extract.ts` mirrors `match.ts` line-for-line: `forward(`${extractorBase()}/api/v1/extract`, ...)` with `contentTypeOf`, `streamBody`, `prerender = false`. `_upstream.ts` gains `EXTRACTOR_BASE_DEFAULT = 'http://localhost:8003'`, `extractorBase()` (env `EXTRACTOR_BASE_URL`, SSRF guard REQ-PRX-5), `EXTRACT_TIMEOUT_MS = 60_000`. Client-side `EXTRACT_TIMEOUT_MS = 60_000` lives in `http.ts` (its only consumer), importing `request` from `client.ts` — `client.ts` unchanged.
**Alternatives considered**: browser → `:8003` direct (service ships CORS `*`) — rejected: breaks the same-origin architecture and REQ-PRX-1; reuse `MATCH_TIMEOUT_MS` (rejected: 10s is tuned for sqlite lookup; dual Gemini has NO upstream timeout, the proxy signal is the only backstop); client budget > proxy budget (rejected: transcribe precedent is equal 50s/50s; the equal-budget abort race is benign here because both `aborted` and the proxy's 502 `proxy_unreachable` throw `UiError` and arm the mock fallback).
**Rationale**: Upstream `{detail}` errors (400/500) pass through untouched; `decodeError()`'s status fallback maps them (500 → `vendor_error`) — no client taxonomy change.

### Decision: Compose wiring and smoke check

**Choice**: add `EXTRACTOR_BASE_URL: http://product_identification:8003` to the frontend service env. NO `depends_on` (compose header rule: services independent; matcher/redis soft-dep precedent). New `scripts/smoke-extract.sh` (bash, `set -euo pipefail`): curl `POST :8003/api/v1/extract` with a sample transcription (expects 200 + `validated_inventory`), then `POST :4321/api/extract` for the proxy path — validates GCP creds on the demo host.
**Alternatives considered**: extend `smoke-compose.sh` (rejected: it is health-only by design); Makefile target (rejected: repo has none, `scripts/` is precedent).

## Data Flow

    CountSession → runPipeline → withFallback.extract(transcript)
      ├─ HttpExtractionAdapter ─ POST /api/extract (client 60s)
      │    └─ Astro proxy (60s AbortSignal) ─ POST product_identification:8003/api/v1/extract
      │         └─ validated_inventory[{producto,unidad,cantidad}] → ExtractedItem[]
      └─ on throw → MockExtractionAdapter (same transcript)
    → N parallel match() → anomalies → queue (all unchanged)

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `frontend/src/lib/extraction/http.ts` | Create | `HttpExtractionAdapter`, mapping, `EXTRACT_TIMEOUT_MS`, singleton export |
| `frontend/src/lib/extraction/fallback.ts` | Create | `withFallback` decorator |
| `frontend/src/pages/api/extract.ts` | Create | Proxy route, mirrors `match.ts` |
| `frontend/src/lib/extraction/adapter.ts` | Modify | Promise signature + determinism doc note |
| `frontend/src/lib/extraction/mock.ts` | Modify | `async extract` |
| `frontend/src/lib/pipeline.ts` | Modify | `await` at line 131 |
| `frontend/src/pages/api/_upstream.ts` | Modify | `extractorBase()`, `EXTRACTOR_BASE_DEFAULT`, `EXTRACT_TIMEOUT_MS` |
| `frontend/src/components/operator/CountSession.tsx` | Modify | Default `extraction = realExtraction` composition |
| `docker-compose.yml` | Modify | Frontend `EXTRACTOR_BASE_URL` env line |
| `frontend/.env.example` | Modify | Document `EXTRACTOR_BASE_URL=http://localhost:8003` |
| `scripts/smoke-extract.sh` | Create | Pre-demo end-to-end curl check |
| `tests/deployment/test_root_compose.py`, `test_compose_config.py` | Modify | Assert the new env line |
| `frontend/tests/extraction/http-adapter.test.ts`, `fallback.test.ts` | Create | See Testing Strategy |
| `frontend/tests/{extraction/mock-adapter,pipeline/run-pipeline,pipeline/on-transcript,api-routes/proxy}.test.ts` | Modify | Mechanical awaits; extract route cases |

## Interfaces / Contracts

```ts
export interface ExtractionAdapter {
  extract(rawTranscript: string): Promise<ExtractedItem[]>;
}
export function withFallback(primary: ExtractionAdapter, fallback: ExtractionAdapter): ExtractionAdapter;
// Wire (upstream): { validated_inventory: Array<{ producto: string; unidad: string; cantidad: number }> }
```

## Testing Strategy

Strict TDD. `cd frontend && npx vitest run` and `uv run pytest tests/deployment`.

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `http.ts`: URL/body, enum→unit mapping (all 4 + unknown→null), decimal `cantidad` kept, invalid items dropped, `[]` on envelope drift, `UiError` on non-2xx/timeout | `vi.stubGlobal('fetch', ...)` per `client.test.ts` pattern |
| Unit | `fallback.ts`: primary success passthrough; fallback on throw (same transcript); no fallback on `[]`; fallback throw propagates | Stub adapters |
| Route | `extract.ts`: verbatim forward, timeout signal, `{detail}` passthrough, 502 on thrown fetch, env override/default, `prerender=false` | Extend `api-routes/proxy.test.ts` (add `EXTRACTOR_BASE_URL` to `ENV_KEYS`) |
| Regression | Async migration: existing extraction/pipeline/count-session tests | Mechanical `await` edits; stub adapters become async |
| Deployment | Compose contract env assertions | Extend both pytest files |
| Manual/E2E | Real Gemini call on demo host | `scripts/smoke-extract.sh` |

## Threat Matrix

N/A — no shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The only routing concern (SSRF) is already governed by REQ-PRX-5: target URL derived from env only, covered by a planned route test.

## Migration / Rollout

No data migration. Rollback: flip the `CountSession.tsx` default back to `mockExtractionAdapter` — one line; route and adapter stay inert.

## Open Questions

- None blocking. Follow-up (recorded in proposal): server-side Vertex timeout in `product_identification`.
