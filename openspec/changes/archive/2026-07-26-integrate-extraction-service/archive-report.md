# Archive Report: integrate-extraction-service

**Change**: integrate-extraction-service
**Date**: 2026-07-26
**Status**: COMPLETE
**PR**: #21 (merged at 7f95985)

## SDD Cycle Summary

The extraction service integration was completed through the full SDD cycle:

| Phase | Status | Date | Observation ID | Artifact |
|-------|--------|------|--------|----------|
| Explore | Done | 2026-07-25 | (in flight, not captured separately) | `openspec/changes/integrate-extraction-service/exploration.md` |
| Proposal | Done | 2026-07-26 03:10:28 | 190 | `sdd/integrate-extraction-service/proposal` |
| Spec | Done | 2026-07-26 03:13:49 | 192 | `sdd/integrate-extraction-service/spec` |
| Design | Done | 2026-07-26 03:15:12 | 193 | `sdd/integrate-extraction-service/design` |
| Tasks | Done | 2026-07-26 03:21:16 | 194 | `sdd/integrate-extraction-service/tasks` |
| Apply | Done | 2026-07-26 03:51:59 | 195 (referenced in tasks) | Implementation: 14/14 tasks, commits 062d80f..5d9b3bd |
| Verify | Done | 2026-07-26 03:51:59 | 196 | `sdd/integrate-extraction-service/verify-report` |
| Archive | Done | 2026-07-26 | — | This report |

### Proposal Summary (obs #190)

**Intent**: Wire the real `product_identification` service into the extraction flow for the demo. The agreed flow is audio → STT → extraction → match → confirm, but today only the mock extraction adapter is active.

**Scope**: 
- Async ExtractionAdapter interface migration (REQ-EXT-1)
- New `/api/extract` proxy route (REQ-PRX-1, -5, -6)
- HTTP adapter with tolerant response mapping (REQ-EXT-6)
- Fallback-on-error to the mock (REQ-EXT-7)
- Real adapter as production default (REQ-EXT-5)
- Deployment via docker-compose environment variable

**Constraints**: No operator-visible degraded indicator; 60 s timeout backstop; pre-demo GCP creds smoke-check on host.

### Spec Compliance (obs #192)

**Delta Specs**: Two existing capabilities modified (no new capabilities).

- **extraction-adapter**: 
  - MODIFIED REQ-EXT-1: async interface signature
  - MODIFIED REQ-EXT-4: unit vocabulary bound to extraction result, not invented
  - MODIFIED REQ-EXT-5: real HTTP adapter is default, mock is fallback
  - ADDED REQ-EXT-6: HTTP adapter response mapping and validation
  - ADDED REQ-EXT-7: fallback-on-error to the mock

- **service-proxy**:
  - MODIFIED REQ-PRX-1: add `/api/extract` route (4th endpoint)
  - MODIFIED REQ-PRX-5: add EXTRACTOR_BASE_URL environment variable
  - ADDED REQ-PRX-6: 60 s extract timeout budget and error envelope

All 18 scenarios (12 extraction-adapter + 6 service-proxy) defined with Given/When/Then, verifiable in tests.

### Design Validation (obs #193)

**Technical Approach**: 
- Async interface migration with single signature serving both mock and HTTP adapter
- Fallback as a composing adapter (`withFallback` decorator) outside HTTP layer
- Tolerant response mapping: drop invalid items, never crash on 2xx
- Proxy route mirrors match.ts; client `EXTRACT_TIMEOUT_MS` lives in http.ts
- Compose wiring via env variable; no `depends_on`
- Pre-demo smoke check script `scripts/smoke-extract.sh`

**Decisions approved**:
1. Async interface: single Promise signature for both adapters (no union type)
2. Fallback composition: not inside HTTP adapter, not inside pipeline
3. Tolerant mapping: keep decimals verbatim, never round
4. 60s timeout: extractor has no upstream deadline
5. Smoke-check owner: Braejan, demo host, morning of 26 Jul

### Implementation Status (obs #194, #195)

**Tasks**: 14/14 complete (all marked `[x]`)
- Phase 1: Async interface migration ✓
- Phase 2: Proxy route ✓
- Phase 3: HTTP adapter ✓
- Phase 4: Fallback and wiring ✓
- Phase 5: Deployment contract and smoke check ✓

**Test Coverage**: 977 passed (52 test files) vs 921 baseline (+56 tests, +2 files, 0 regressions).

**Code Review**: Delivered as PR #21, approved and merged into main at commit 7f95985.

### Verification Result (obs #196)

**Verdict**: PASS WITH WARNINGS (0 CRITICAL, 4 WARNING, 4 SUGGESTION)

**Spec Compliance**: 18/18 scenarios verified (8/8 requirements)
- REQ-EXT-1: async interface, Promise return ✓
- REQ-EXT-4: unit vocabulary from extraction, no invention ✓
- REQ-EXT-5: HTTP adapter default, mock fallback injectable ✓
- REQ-EXT-6: response mapping, enum resolution, item validation ✓
- REQ-EXT-7: fallback-on-error, no operator-visible degraded state ✓
- REQ-PRX-1/5/6: proxy routes, env vars, timeout budget ✓

**Test Evidence**:
- Frontend: `npx vitest run` → 977 passed, exit 0
- Build: `npx tsc --noEmit` → exit 0
- Deployment: 4 pre-existing failures (identical to main), zero new failures

**Non-Blocking Issues**:
1. Deployment pytest suite exits 1 with 4 pre-existing failures (same on clean main)
2. Under bare `uv run pytest` (no Supabase env), test_compose_config.py collection errors — verified separately with env export, both assertions pass
3. apply-progress baseline recorded as "5 failed, 94 passed"; actual main is "4 failed, 95 passed" (no impact on claim of zero new failures)
4. Pre-existing sessionStorage isolation hazard in count-session.test.tsx; no new test exposed

## Delta Spec Merges to Main Specs

The following modifications were made to the main spec files at archive time:

### File: `openspec/specs/extraction-adapter/spec.md`

**REQ-EXT-1** — Replaced with async Promise signature:
- From: `extract(transcript: string): ExtractedItem[]`
- To: `extract(rawTranscript: string): Promise<ExtractedItem[]>`
- Added scenario: "Result is a promise"

**REQ-EXT-4** — Updated unit vocabulary scope:
- From: Drawn from UNIT_SYNONYMS, never invent words
- To: MUST originate from extraction result (spoken for mock, consensus unidad for HTTP)
- Note: LLM canonicalization of producto/unidad is accepted behavior change vs verbatim passthrough
- Updated scenarios with GIVEN for mock adapter context

**REQ-EXT-5** — Flipped production default:
- From: "shipped implementation is a MOCK"
- To: "production default MUST be the real HTTP adapter"
- Added scenario: "Production default is the HTTP adapter"
- Mock remains injectable as fallback

**REQ-EXT-6** — Added HTTP adapter response mapping:
- POST `{transcription}` to `/api/extract`
- Map producto→spokenName, unidad(enum)→unit, cantidad→quantity
- Drop invalid items, never repair
- Scenarios: successful mapping, invalid items dropped, empty inventory is not failure

**REQ-EXT-7** — Added fallback-on-error:
- Any transport failure, timeout, non-2xx, unparsable body → fall back to mock
- No operator-visible degraded indicator
- Scenarios: timeout falls back, upstream 5xx falls back silently

### File: `openspec/specs/service-proxy/spec.md`

**REQ-PRX-1** — Extended same-origin endpoints:
- From: 3 endpoints (transcribe, match, catalogues)
- To: 4 endpoints (added `/api/extract`)
- Added scenario: "Extract round-trip"

**REQ-PRX-5** — Extended environment variables:
- From: STT_BASE_URL, MATCHER_BASE_URL
- To: Added EXTRACTOR_BASE_URL (default `http://localhost:8003`)

**REQ-PRX-6** — Added extract timeout budget and error envelope:
- 60 s AbortSignal.timeout
- 502 proxy_unreachable error envelope
- Upstream 4xx/5xx pass through unchanged
- Scenarios: slow extraction inside budget, timeout mapping, upstream error passthrough

## Follow-ups

The following items were identified during verification and remain for future work:

1. **Server-side Vertex timeout in product_identification** (High priority)
   - The extractor has no upstream deadline; the 60 s proxy signal is the only backstop
   - Adding a server-side timeout in the service config is a recorded follow-up
   - Recorded in proposal under Out of Scope

2. **test_compose_config.py fixture fragility** (Pre-existing)
   - Under bare `uv run pytest` (no Supabase env), collection errors occur
   - Pre-existing issue from supabase-operational-integration merge
   - One of the two new EXTRACTOR_BASE_URL assertions never executes under documented command
   - Workaround: export env vars before running pytest

3. **sessionStorage test isolation** (Pre-existing)
   - count-session.test.tsx mid-count tests leaving resume context
   - No NEW test exposed; all new tests pass `resumeStorage: null`
   - Pre-existing exposure only

4. **Demo smoke-check validation** (Critical — owner: Braejan)
   - Script: `scripts/smoke-extract.sh` on demo host
   - Validates: GCP credentials, extractor health, proxy routing
   - **MUST run before demo presentation** (morning of 26 Jul)
   - Local extractor has no working GCP creds; every extraction degrades to mock silently without this check

## Archive Metadata

**Observation IDs for Traceability**:
- Proposal: obs #190 (sdd/integrate-extraction-service/proposal)
- Spec: obs #192 (sdd/integrate-extraction-service/spec)
- Design: obs #193 (sdd/integrate-extraction-service/design)
- Tasks: obs #194 (sdd/integrate-extraction-service/tasks)
- Apply: referenced in obs #195 (apply-progress, not separately archived)
- Verify: obs #196 (sdd/integrate-extraction-service/verify-report)
- Archive: obs [to be assigned] (sdd/integrate-extraction-service/archive-report)

**Archived Artifacts**:
- `openspec/changes/archive/2026-07-26-integrate-extraction-service/proposal.md`
- `openspec/changes/archive/2026-07-26-integrate-extraction-service/design.md`
- `openspec/changes/archive/2026-07-26-integrate-extraction-service/tasks.md`
- `openspec/changes/archive/2026-07-26-integrate-extraction-service/verify-report.md`
- `openspec/changes/archive/2026-07-26-integrate-extraction-service/state.yaml`
- `openspec/changes/archive/2026-07-26-integrate-extraction-service/specs/extraction-adapter/spec.md` (delta)
- `openspec/changes/archive/2026-07-26-integrate-extraction-service/specs/service-proxy/spec.md` (delta)

**Merged into Main Specs**:
- `openspec/specs/extraction-adapter/spec.md` (all deltas merged)
- `openspec/specs/service-proxy/spec.md` (all deltas merged)

## Completeness Checklist

- [x] All 14 implementation tasks completed and verified
- [x] 18/18 spec scenarios verified with passing tests (0 critical issues)
- [x] Frontend suite green: 977 tests, +56 vs main, zero regressions
- [x] Delta specs merged into main specs (MODIFIED REQ-EXT-1/4/5, ADDED REQ-EXT-6/7; MODIFIED REQ-PRX-1/5, ADDED REQ-PRX-6)
- [x] Change folder archived with all artifacts
- [x] PR #21 approved and merged (7f95985)
- [x] No CRITICAL issues blocking demo or archive

## Status: CLOSED

The integrate-extraction-service change is complete, archived, and the SDD cycle is finished. All artifacts are preserved in `/openspec/changes/archive/2026-07-26-integrate-extraction-service/` and linked in Engram with observation IDs for traceability.

The demo is ready for the real extraction service end-to-end flow with silent mock fallback.

**Final reminder**: Run `bash scripts/smoke-extract.sh` on the demo host the morning of 26 Jul before the presentation — it is the only validation that GCP credentials are available and the extractor is reachable.
