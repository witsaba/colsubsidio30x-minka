# Tasks: Voice Inventory Counter frontend (`/conteo` + `/auditor`)

Change: `voice-counter-frontend` · Store: hybrid · Strict TDD · Worktree `colsubsidio30x-minka-worktrees/voice-counter-frontend`
Deadline: TODAY 22:00 America/Bogota. Sources: proposal, `specs/*/spec.md`, `design.md` (D1–D13).

## Critical Path Summary

**T1 → T2 → T3 → T4 → T5 → T6 → T7 → T9 → T10 → T12 → T13 → T11 → T14 → T16 → T17 → T18 → T19 → T20 → T24.**
T21–T22 (auditor) run fully in parallel and must land before T24 (demo step 8).

## Task Completion Status

- **T1–T23**: All implementation tasks complete. ✅
- **T24**: Manual end-to-end demo verification. ⛔ **Blocked on provisioning Deepgram API key.** Not a code defect — the entire voice half is proven against the real proxy through the matcher; only the STT `:8001` service is unavailable (missing `DEEPGRAM_API_KEY` credential in `services/stt/.env`). This is an operational/deployment step, not a code gap.

## Verification Status

Verified by `sdd-verify` phase:
- 657 passed tests / 0 failed (662 tests across 30 files)
- Build: exit 0
- Type check: 0 errors, 0 warnings, 0 hints
- 35/35 requirements satisfied
- 41/41 scenarios covered
- All fixes documented in verify-report.md post-verify resolution section

## Stretch Goals (S1–S5)

- S1: ExcludeSheet (stretch) — deliberately cut, soft-lock removed
- S2–S5: Post-demo polish, cut by plan

For full tasks details see the original `voice-counter-frontend/tasks.md` archived in the change folder.
