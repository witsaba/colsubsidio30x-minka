# Tasks: Integrate Real Extraction Service

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~550-650 (adds ~470 new, ~90 test edits, ~15 modified lines) |
| Authorized review budget | 5000 lines — estimate is ~12% of it |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR, 5 work-unit commits |
| Delivery strategy | single-pr (authorized) |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

Batching: ONE sequential batch, one apply agent. Phases 2 and 3 are independent
and could parallelize, but at this size the coordination cost exceeds the gain.
Phases 1 → 4 are strictly ordered by dependency.

### Suggested Work Units

| Unit | Goal | Focused test command | Runtime harness | Rollback boundary |
|------|------|----------------------|-----------------|-------------------|
| 1 | Async `ExtractionAdapter` interface | `cd frontend && npx vitest run tests/extraction tests/pipeline` | N/A — interface-only, no behavior change | Revert signature + `await`; mock body untouched |
| 2 | `/api/extract` proxy route | `cd frontend && npx vitest run tests/api-routes/proxy.test.ts` | `curl -X POST localhost:4321/api/extract` (proxy leg of smoke script) | Delete `extract.ts` + `_upstream.ts` additions |
| 3 | HTTP adapter + mapping | `cd frontend && npx vitest run tests/extraction/http-adapter.test.ts` | N/A — not wired until unit 4 | Delete `http.ts` + its test |
| 4 | Fallback + default flip ⭐ | `cd frontend && npx vitest run tests/extraction/fallback.test.ts tests/components/session` | Dictate an utterance in the browser at `:4321` | One line: default back to `mockExtractionAdapter` |
| 5 | Compose env + smoke check | `uv run pytest tests/deployment` | `bash scripts/smoke-extract.sh` on the demo host | Remove env line + script |

## Phase 1: Async interface migration (REQ-EXT-1)

- [x] 1.1 RED — migrate existing suites to `await`: `frontend/tests/extraction/mock-adapter.test.ts`, `tests/pipeline/run-pipeline.test.ts`, `tests/pipeline/on-transcript.test.ts`, `tests/components/session/count-session{,-resume}.test.tsx` (stub adapters become `async`). Add `expect(mockExtractionAdapter.extract('x')).toBeInstanceOf(Promise)`. Fails: current sync `extract` returns an array, not a thenable.
- [x] 1.2 GREEN — `frontend/src/lib/extraction/adapter.ts` → `extract(rawTranscript: string): Promise<ExtractedItem[]>` + determinism-is-mock-only doc note; `mock.ts` → `async extract`; `pipeline.ts:131` → `const items = await deps.extraction.extract(transcript);`.

## Phase 2: Proxy route (REQ-PRX-1, REQ-PRX-5, REQ-PRX-6)

- [x] 2.1 RED — extend `frontend/tests/api-routes/proxy.test.ts`: add `EXTRACTOR_BASE_URL` to `ENV_KEYS`; assert body forwarded verbatim to `${base}/api/v1/extract`, `AbortSignal.timeout(60_000)`, upstream 500 `{detail}` passes through unchanged, thrown `fetch` → 502 `error.code === 'proxy_unreachable'`, default `http://localhost:8003` + env override, `prerender === false`. Fails: cannot resolve `../../src/pages/api/extract`.
- [x] 2.2 GREEN — `frontend/src/pages/api/_upstream.ts`: `EXTRACTOR_BASE_DEFAULT`, `extractorBase()` (env-only, SSRF guard), `EXTRACT_TIMEOUT_MS = 60_000`. Create `frontend/src/pages/api/extract.ts` mirroring `match.ts` (`forward`, `contentTypeOf`, `streamBody`, `prerender = false`).

## Phase 3: HTTP adapter (REQ-EXT-6)

- [x] 3.1 RED — create `frontend/tests/extraction/http-adapter.test.ts` (`vi.stubGlobal('fetch', ...)` per `tests/api/client.test.ts`): POSTs `{transcription}` to `/api/extract`; all 4 `unidad` enums lowercase-resolve (`KILOGRAMO` → `'kilogramo'`); unknown `unidad` → `unit: null`, item kept; decimal `cantidad` kept verbatim (never rounded); items with `cantidad` 0/-1/NaN or blank `producto` dropped; missing/non-array `validated_inventory` → `[]`; 502 from the proxy rejects with `UiError` code `'vendor_error'` (client-side decode of the envelope; `proxy_unreachable` is envelope-only). Fails: module not found.
- [x] 3.2 GREEN — create `frontend/src/lib/extraction/http.ts`: `HttpExtractionAdapter` via `request<ExtractionResponse>()` from `lib/api/client.ts`, `EXTRACT_TIMEOUT_MS = 60_000`, `resolveSpokenUnit` mapping, singleton export. Never throws on a 2xx body.

## Phase 4: Fallback and wiring (REQ-EXT-5, REQ-EXT-7)

- [ ] 4.1 RED — create `frontend/tests/extraction/fallback.test.ts`: primary success passes through untouched; primary throw → fallback invoked with the SAME transcript and its result returned; primary returning `[]` does NOT trigger fallback; a fallback throw propagates. Fails: module not found.
- [ ] 4.2 GREEN — create `frontend/src/lib/extraction/fallback.ts`: `withFallback(primary, fallback)` — try primary, on any throw `console.warn` then run fallback. No operator-visible degraded indicator.
- [ ] 4.3 RED — in `frontend/tests/components/session/count-session.test.tsx`, render `CountSession` with NO `extraction` prop and a stubbed `fetch`; assert `/api/extract` is requested. If the harness cannot reach the dictation path, assert the exported default composition is not `mockExtractionAdapter`. Fails: default is still the mock.
- [ ] 4.4 GREEN ⭐ DEMOABLE — `frontend/src/components/operator/CountSession.tsx`: module-level `const realExtraction = withFallback(httpExtractionAdapter, mockExtractionAdapter)`; flip the `extraction` default param to it. After this task the demo runs on the real service with silent mock fallback.

## Phase 5: Deployment contract, smoke check, full green

- [ ] 5.1 RED — `tests/deployment/test_root_compose.py`: assert `"EXTRACTOR_BASE_URL: http://product_identification:8003" in frontend`. `tests/deployment/test_compose_config.py`: assert `environment["EXTRACTOR_BASE_URL"] == "http://product_identification:8003"`. Fails: key absent.
- [ ] 5.2 GREEN — add `EXTRACTOR_BASE_URL: http://product_identification:8003` to the `frontend` service env in `docker-compose.yml` (beside `MATCHER_BASE_URL`, line ~179). NO `depends_on`.
- [ ] 5.3 Create `scripts/smoke-extract.sh` (`bash`, `set -euo pipefail`, `chmod +x`): curl `POST :8003/api/v1/extract` with a sample `transcription` expecting 200 + `validated_inventory`, then `POST :4321/api/extract` for the proxy leg. Owner: Braejan — run on the demo host the morning of 26 Jul, before the presentation. Validates GCP creds.
- [ ] 5.4 Full suite green: `cd frontend && npx vitest run` AND `uv run pytest tests/deployment`. Both must pass with zero skips added.

## Notes

- Threat matrix is `N/A` (design): no shell, subprocess, VCS, or process-integration boundary. SSRF is covered by the env-only `extractorBase()` route test in 2.1.
- The design listed `frontend/.env.example` as modified — that file does NOT exist in this repo (upstream bases are hardcoded in compose). The documented default lives in the `_upstream.ts` doc comment instead; no separate task.
- Demo-slip safety: if Phase 5 slips, the flow still works (defaults resolve to `localhost:8003`); if Phases 2-4 slip, Phase 1 alone is inert and shippable.
