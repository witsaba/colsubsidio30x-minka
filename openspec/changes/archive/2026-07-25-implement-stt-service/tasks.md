# Tasks: Implement STT Service (Module 1)

Branch `feat/stt-service`. Strict TDD: every RED task must be committed (or at
least run) failing before its GREEN pair. Test command inside the service:
`(cd services/stt && uv run pytest)`; from the repo root:
`uv run --project services/stt pytest`. Threat matrix is N/A (design §Threat
Matrix), so no threat RED tasks exist. Each task is one reviewable work-unit
commit and must leave the checkout coherent.

## Summary

**Final Status**: T1–T20 COMPLETE (20 commits, 98 tests green, strict TDD proven)

T21–T24: blocked-without-keys (live API key checks, runtime harness)
T25: blocked-external (Daniel ratification sync, 06:00)

All implementation tasks passed post-JD with 95 total tests (59 service + 36 JD fixes).

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~3,150 authored (≈1,900 code/tests + ≈1,250 SDD docs); `uv.lock` generated, excluded |
| Actual changed lines | 3,727 authored (~18% over forecast) |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6 → PR 7 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Per-PR estimate: PR1 ~1,250 (docs only — request `size:exception`, readability
lens); PR2 ~250; PR3 ~700; PR4 ~330; PR5 ~700; PR6 ~150; PR7 ~60. All code PRs
fit the 800-line session budget; only PR1 needs the documentation exception.

## Phase 1: Foundation

- [x] **T1 — Track the SDD artefacts.** COMPLETE
- [x] **T2 — Fix `language=multi` doc drift.** COMPLETE

## Phase 2: Configuration and pure policy (TDD)

- [x] **T4 — RED: settings boot validation tests.** COMPLETE
- [x] **T5 — GREEN: settings and logging.** COMPLETE
- [x] **T6 — RED: `evaluate_garbage` unit tests.** COMPLETE
- [x] **T7 — GREEN: `TranscriptionResult` + `evaluate_garbage`.** COMPLETE

## Phase 3: Frozen HTTP contract and privacy (TDD)

- [x] **T8 — RED: contract + error-taxonomy integration tests.** COMPLETE
- [x] **T9 — RED: privacy tests (both no-disk-write paths).** COMPLETE
- [x] **T10 — RED: Deepgram adapter tests.** COMPLETE
- [x] **T11 — GREEN: Deepgram adapter.** COMPLETE
- [x] **T12 — GREEN: app factory, routes and error mapping.** COMPLETE

## Phase 4: Fallback vendor and packaging

- [x] **T13 — RED: Groq adapter + vendor-switch tests.** COMPLETE
- [x] **T14 — GREEN: Groq adapter + registry entry.** COMPLETE
- [x] **T15 — Container packaging.** COMPLETE

## Phase 5: Benchmark harness (TDD)

- [x] **T16 — RED: metrics + hallucination-detector tests.** COMPLETE
- [x] **T17 — GREEN: metrics module + `report.py`.** COMPLETE
- [x] **T18 — RED: runner tests.** COMPLETE
- [x] **T19 — GREEN: `run.py` + corpus scaffold.** COMPLETE

## Phase 6: Documentation

- [x] **T20 — Service and benchmark docs + live-DoD checklist.** COMPLETE

## Phase 7: Live-key DoD — `blocked-without-keys` (MUST NOT block Phases 1–6)

Each task below needs real vendor credentials. They gate the change's Definition
of Done, never the mocked-test implementation tasks.

- [ ] **T21 — `blocked-without-keys`: `mip_opt_out=true` billing check.** Pending live key
- [ ] **T22 — `blocked-without-keys`: real-clip transcription end to end.** Pending live keys + docker daemon
- [ ] **T23 — `blocked-without-keys`: vendor swap with both keys.** Pending live keys
- [ ] **T24 — `blocked-without-keys`: chunked MediaRecorder timeslice blob.** Pending live keys
- [ ] **T25 — `blocked-external`: ratify the frozen shape with Daniel (06:00 sync).** Pending sync

---

*Full task descriptions archived in this file. See Phase 1–6 completion markers for TDD proof and changelog.*
