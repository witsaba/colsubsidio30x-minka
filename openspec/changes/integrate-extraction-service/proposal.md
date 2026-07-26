# Proposal: Integrate Real Extraction Service

## Intent

The agreed flow (PRD §6.1 step 4; 25 Jul meeting: "sí o sí se necesitaría integrar el módulo") is audio → STT → extraction (Gemini dual-consensus) → match → confirm. Today `frontend/src/lib/pipeline.ts` only ever calls `MockExtractionAdapter`; the real `product_identification` service (`:8003`) is deployed but unreachable from the flow. Demo is tomorrow morning — wire the real service end to end with the smallest change.

## Scope

### In Scope
- Migrate `ExtractionAdapter.extract()` to `Promise<ExtractedItem[]>`; `pipeline.ts` awaits it; mock becomes async and stays as explicit fallback/test double.
- New Astro proxy route `frontend/src/pages/api/extract.ts` mirroring `match.ts`; `extractorBase()`/`EXTRACTOR_BASE_URL` in `_upstream.ts`; `EXTRACT_TIMEOUT_MS = 60_000` (proxy `AbortSignal` + client timeout — generous like STT because the service has NO server-side timeout).
- New HTTP adapter `frontend/src/lib/extraction/http.ts` mapping `ExtractionResponse.validated_inventory: ProductItem{producto, unidad (4-value enum), cantidad}` → `ExtractedItem{quantity, unit, spokenName}` (lowercased enum values are valid SPOKEN_UNITS).
- Fallback-on-error: if the extract call fails or times out, the pipeline falls back to the mock adapter for that utterance — the demo never dead-ends.
- `CountSession.tsx` default flips to the HTTP adapter.
- `docker-compose.yml` frontend env: `EXTRACTOR_BASE_URL: http://product_identification:8003`.
- Update ~20+ synchronous `.extract()` call sites in frontend tests to await.

### Out of Scope
- `product_identification` internals; adding a server-side Vertex timeout is a recorded follow-up unless it is a one-line settings change.
- Unit-mismatch validation at confirm — already covered by anomaly-validation REQ-AV-1 (`unit_mismatch`); no change needed.
- New error codes / Spanish copy — existing `UiErrorCode` set covers all failure modes.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `extraction-adapter`: REQ-EXT-1 signature becomes async; REQ-EXT-5 reframed — real HTTP adapter is the default, deterministic mock is the explicit fallback/test double (including fallback-on-error). Spec-delta note: the LLM canonicalizes `producto`/`unidad` (accepted behavior change vs the mock's verbatim passthrough).
- `service-proxy`: add `POST /api/extract`; `EXTRACTOR_BASE_URL` (default `http://localhost:8003`) per REQ-PRX-5; ~60 s extract timeout budget (REQ-PRX-3 analog).

## Approach

Copy the proven match/transcribe proxy pattern; the async-interface migration is the sizing driver, not the HTTP plumbing. Strict TDD (`cd frontend && npx vitest run`), single PR, review budget 5000 lines, work-unit commits.

## Affected Areas

| Area | Impact |
|------|--------|
| `frontend/src/lib/extraction/{adapter,mock}.ts`, `frontend/src/lib/pipeline.ts` | Modified (async migration + fallback) |
| `frontend/src/lib/extraction/http.ts`, `frontend/src/pages/api/extract.ts` | New |
| `frontend/src/pages/api/_upstream.ts` | Modified (extractorBase + EXTRACT_TIMEOUT_MS; design keeps `client.ts` unchanged — client constant lives in `http.ts`) |
| `frontend/src/components/operator/CountSession.tsx` | Modified (default adapter) |
| `docker-compose.yml`, `frontend/tests/**` | Modified |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Unbounded Vertex latency (no upstream timeout) | High | 60 s proxy AbortSignal + mock fallback per utterance |
| Gitignored GCP creds missing on demo host | Med | Pre-demo smoke-check task (curl `/api/v1/extract`) |
| LLM canonicalization shifts match inputs | Low | Accepted; REQ-AV-1 still catches unit mismatch |
| Test churn from async migration | Med | Mechanical awaits under TDD |

## Rollback Plan

Flip the `CountSession.tsx` default back to `mockExtractionAdapter` — one line. Async interface and proxy route remain inert.

## Dependencies

- PR #19 (supabase-operational-integration) merged on main — satisfied.
- `product_identification` healthy on `:8003` with the GCP service-account JSON present on the demo host.

## Success Criteria

- [ ] Demo path works: real audio → transcript → real `/api/v1/extract` JSON → match → confirm sheet.
- [ ] Extract failure/timeout degrades to mock; the utterance still completes.
- [ ] All existing frontend tests green (`cd frontend && npx vitest run`).
