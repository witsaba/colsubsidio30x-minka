# Archive Report: add-matching-service

**Change**: add-matching-service (Module 3 Product-Matching Service)  
**Archived**: 2026-07-25  
**Merge Commit**: 5e571ad (2026-07-25)  
**PR**: #3 (`feat/add-matching-service` → `main`)

## SDD Cycle Summary

Completed full lifecycle: **explore → propose → spec ∥ design (cross-validated) → tasks → apply (strict TDD) → verify (298 tests) → judgment-day (1 fix round, dual blind judges) → PR merged**.

### Artifact Chain

| Phase | Artifact | Observation ID | Status |
|-------|----------|----------------|--------|
| Propose | `sdd/add-matching-service/proposal` | #49 | Complete |
| Spec | `sdd/add-matching-service/spec` | #51 | Complete (rev 4: Judgment Day hardening) |
| Design | `sdd/add-matching-service/design` | #53 | Complete (rev 2: UNIT_DISPLAY amendment) |
| Tasks | `sdd/add-matching-service/tasks` | #55 | T1–T12 complete; all code tasks green |
| Apply | `sdd/add-matching-service/apply-progress` | #59 | 12 tasks, 232 tests green, strict TDD proven |
| Verify | `sdd/add-matching-service/verify-report` | #63 | PASS rev-2 addendum (298 tests, 14/14 reqs, 26/26 scenarios) |
| Judgment Day | `sdd/add-matching-service/judgment-day` | #72 | Terminal APPROVED (dual blind judges, 1 fix round, re-judgment clean) |

## Delivered Capabilities

Two NEW capabilities, all merged to main:

### product-matching-engine
- Spanish normalization (accent stripping, packaging-token removal, punctuation collapse)
- PostgreSQL trigram (`pg_trgm`) faithful ranking with tunable margin
- Three-way decision layer: `matched` / `ambiguous` / `no_match` with crowding detection
- Unit synonym and display maps (Spanish ↔ canonical); unit as secondary re-rank only
- Hard guarantees: no WRatio, no stock (`sd`) prior, NULL unit never coerced

**Requirements**: REQ-ENG-1 (Spanish normalization helpers), REQ-ENG-2 (ranked candidates with margin), REQ-ENG-3 (three-way decision), REQ-ENG-4 (env-configurable thresholds), REQ-ENG-5 (unit re-rank band), REQ-ENG-6 (eval gate top-1 ≥0.986)  
**Scenarios**: 18 COMPLIANT (plus 8 post-JD amendments)  
**Test coverage**: 176 unit tests over real SQLite catalogue (1,405 rows), zero mocks  
**Eval gate**: top-1 0.9860 (424/430), recall@3 1.0000, split by has-code / no-code cohorts

### matcher-service-api
- HTTP contract: `POST /match` (input: `spoken_name`, `catalogue_id`, `unit`; output: `status`, `candidates`, `top_score`, `margin`, `request_id`)
- `GET /catalogues` → 8 stock tables with row counts
- `GET /health` → service readiness for compose healthcheck
- FastAPI on port 8002; pydantic-settings env-var configuration (all `MATCH_*` knobs tunable without rebuild)
- Read-only catalogue access (`mode=ro` URI); startup fast-fail on missing/corrupted database
- Startup retry with backoff on transient catalogue unavailability (env-tunable)
- Observability: per-decision logging with request_id, decision status, score, latency; zero transcript/spoken_name at INFO+ (Ley 1581 compliance)

**Requirements**: REQ-API-1 (POST /match contract + all three statuses), REQ-API-2 (GET /catalogues), REQ-API-3 (GET /health), REQ-API-4 (pydantic-settings fail-fast), REQ-API-5 (read-only catalogue), REQ-API-6 (containerized), REQ-API-7 (startup retry), REQ-API-8 (logging + privacy)  
**Scenarios**: 8 COMPLIANT (plus 18 post-JD amendments)  
**Test coverage**: 41 API + 15 container contract tests; all three statuses proven over real HTTP socket + TestClient

## Implementation Summary

- **Codebase**: `services/matcher/` (uv workspace member with src/matcher/ layout, own pyproject.toml, shared root uv.lock), `pyproject.toml`, `uv.lock`
- **Lines**: 841 authored (366 production + 475 test), 30 files, excl. generated uv.lock
- **Tests**: 298 green (232 initial + 66 post-JD hardening), all strict TDD (RED→GREEN pairs proven)
- **TDD Compliance**: 6/6 checks; RED structurally verified at 10 commits (test files present, implementation absent)
- **Docker**: Dockerfile + docker-compose.yml (port 8002, read-only `/data` bind, healthcheck with 3s start_period, `restart: unless-stopped`) + .dockerignore (46.5 KB → 857 B context)
- **SDD Docs**: Tracked at `openspec/changes/add-matching-service/` (proposal, design, specs, tasks, apply-progress, verify-report, judgment-day-ledger)

## Verification & Hardening

### Verify Phase (Observation #63)
- Verdict: **PASS rev-2 addendum** (14/14 requirements, 26/26 scenarios; rev-1 had 2 PARTIALs resolved by Judgment Day amendments)
- Initial suite: 232 passed, 0 failed, 1 upstream deprecation warning
- Spec rev 4 amendments added REQ-API-7/8 + amended REQ-ENG-2/API-1/4/5/6
- Post-amendment suite: 298 passed (all new reqs covered, all new scenarios green)

### Judgment Day Rounds (Observation #72)

**Round 1**: 4 CRITICAL/MAJOR + 1 user-goal work unit confirmed by dual blind judges

| ID | Severity | Status | Issue | Fix |
|----|----------|--------|-------|-----|
| JD-1 | CRITICAL | Fixed | `@lru_cache(maxsize=None)` on `trigrams(spoken_name)` → monotonic RSS growth, eventual OOM | Remove cache; key is untrusted per-request input (commit 7bcacfd) |
| JD-2 | MAJOR | Fixed | `spoken_name` has no max_length; oversized input buffered + trigram-expanded + pinned by JD-1 | Add 300-char limit to pydantic field; 422 on oversize (commit 9ac85f4) |
| JD-3 | MAJOR/WARNING split | Fixed | Zero application logging; request_id minted but never logged; outage diagnosability gap (user mandate) | Add per-decision logs with request_id/status/score/latency; never log transcripts (commit c383a56) |
| JD-4 | MAJOR/silent | Fixed | `cur.fetchall()` outside sqlite3.Error handler → fetch-time corruption escapes raw | Move fetchall inside exception handler; preserve documented error context (commit ece12c7) |
| JD-U | user mandate | Fixed | Explicit retry fallback + stays-up: startup retry + Docker `restart: unless-stopped` + healthcheck start_period + PYTHONUNBUFFERED | All implemented; tested real Docker rebuild (commit 7fb58f6) |

**Scoped Re-judgment 1**: Over fix delta f168fa5..7fb58f6
- Judge A: 5/5 fixes verified genuinely fixed; 2 new single-judge findings (JD-14, JD-15) → info per protocol
- Judge B: clean (`{"findings":[]}`); independently verified all five IDs + transcript-privacy tests

**User Goals** (from /goal mandate): All 3 delivered
- Bounded retry with exponential backoff on transient failures
- Explicit retry fallback with visibility (logs + Docker restart)
- Uptime hardening: healthcheck start_period, network-free boot

**Runtime Verification**: 6/6 structural checks (Docker rebuild, healthcheck, real HTTP socket, startup retry drill, privacy audit, log shape)

**Follow-up Info Items** (WARNING/SUGGESTION, not blockers):

- **JD-5**: Healthcheck has no consumer; restart policy ignores health state; crash-loop unthrottled (outside SDD scope)
- **JD-6**: Container runs as root (no USER directive)
- **JD-7**: `uv:latest` floating tag in Dockerfile COPY --from (security/reproducibility)
- **JD-8**: No `.gitignore` — 21 untracked `.pyc` files (fixed; .dockerignore added commit 7fb58f6)
- **JD-9**: `MATCH_MAX_CANDIDATES=1` silently disables ambiguity signals (reserved for future measurement)
- **JD-10**: Non-str `articulo` in catalogue passes startup, AttributeError at request time
- **JD-11**: No auth/rate-limit; port published on 0.0.0.0
- **JD-12**: Drain-time None return → 500 not 503 (SUGGESTION)
- **JD-13**: `c.__dict__` bridge instead of typed CandidateOut (SUGGESTION)
- **JD-14**: Request body buffered by Starlette before pydantic limit applies; transient RSS spike (pre-existing, not JD-2's fault)
- **JD-15**: Logger echoes `catalogue_id` verbatim; embedded newlines can forge log lines (fix-caused, sanitization follow-up)

## Main Specs Merged

Two NEW capabilities with full specification in `openspec/specs/`:

1. **product-matching-engine/spec.md** — REQ-ENG-1..6 (6 reqs, 18 scenarios incl. post-JD amendments)
2. **matcher-service-api/spec.md** — REQ-API-1..8 (8 reqs, 8 scenarios incl. post-JD amendments)

**Total**: 14 requirements, 26 scenarios (all NEW, no deltas to existing specs)

**Verified** (rev 4 header blockquote present in both):
- `product-matching-engine/spec.md`: ✅ "rev 4 (2026-07-25): Judgment Day round-1 hardening"
- `matcher-service-api/spec.md`: ✅ "rev 4 (2026-07-25): Judgment Day round-1 hardening"

## Change Status

**ARCHIVED & CLOSED**

- [x] Implementation complete (T1–T12, 12 tasks, 232 tests → 298 post-JD)
- [x] Verification passed (14/14 requirements, 26/26 scenarios, rev-2 addendum)
- [x] Judgment Day approved (5 findings fixed + 3 user goals delivered, terminal)
- [x] PR merged to main (commit 5e571ad)
- [x] Delta specs merged to main specs tree (product-matching-engine, matcher-service-api, rev 4)
- [x] Change folder moved to archive
- [x] Archive report persisted

## Honest Caveats

**Native Review Receipt Status: INVALIDATED**

The native gentle-ai bounded review transaction is **not the review of record** for this change:
- Initial review captured under a workspace-overlay lineage; by archive time, the committed tree's content has moved past the frozen genesis scope (spec rev 4, verify-report rev 2, JD fixes applied).
- `gentle-ai review status` reported `applicability=corrupted, next_transition=stop (reason corrupted_or_unverifiable_authority)`.
- No repair was attempted. Per user instruction, the change was archived on explicit maintainer decision.
- **Review of record**: The Judgment Day dual-blind transaction (observation #72, commits 7bcacfd..7fb58f6, scoped re-judgment approved, terminal APPROVED) is the authoritative hardening record.

**No Destructive Deltas**

Both merged capabilities are new — no existing specs modified or deleted. Archive proceeded without spec-merge conflicts or version reconciliation.

## Engram Observation IDs (for traceability)

| Artifact | ID | Type |
|----------|----|----|
| proposal | #49 | architecture |
| spec | #51 | architecture |
| design | #53 | architecture |
| tasks | #55 | architecture |
| apply-progress | #59 | architecture |
| verify-report | #63 | architecture |
| judgment-day | #72 | decision |
| archive-report | (this file) | architecture |

## Next Steps

The change is complete and closed. The following are deferred follow-ups:

1. **JD-5–JD-7, JD-10–JD-11**: Optional hardening (autoheal sidecar, USER directive, uv image pin, type safety, auth/rate-limit)
2. **JD-8**: `.gitignore` added; confirm no .pyc in final commit
3. **JD-9**: `MATCH_MAX_CANDIDATES` design decision — reserved for measured re-tuning
4. **JD-14/JD-15**: Follow-up remediation (Content-Length middleware, log-line sanitization)
