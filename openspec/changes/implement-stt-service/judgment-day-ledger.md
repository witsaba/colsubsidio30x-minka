# Judgment Day Ledger: `implement-stt-service` (PR #2)

> Mode: judgment_day (explicit user request, replaces ordinary 4R for this target).
> Target identity: tree `ad50316e11ce32cb5d8cb9d3cc345c493ddf6825`, head `96afb84`, base `51c9f a1d` (merge-base with origin/main), diff 4,867 lines / 50 paths.
> Judges: two blind read-only judges, identical scope and criteria (resilience emphasis per user /goal).
> Round: 1. Ledger frozen 2026-07-25. Artifact store: hybrid (this file + Engram `sdd/implement-stt-service/judgment-day`).
> Note: shared ledger contract file `~/.claude/skills/_shared/review-ledger-contract.md` was absent; persistence follows the hybrid store convention instead.

## Confirmed severe (fixable in round 1)

| ID | Sev | Status | Location | Claim | Corroboration |
|----|-----|--------|----------|-------|---------------|
| JD-1 | CRITICAL | fixed | `services/stt/src/transcribe.py:92-104` | Starlette 0.47.3 does not apply `max_part_size` to file parts; a >1 MiB upload rolls the `SpooledTemporaryFile` over to a real temp file on disk BEFORE the service cap check runs, violating REQ-PRV-1/RNF-04. | Judge A + parent deterministic repro: rollover trap fired on 1 MiB+1 POST (`scratchpad/jd/verify_a1_disk_spool.py`). |
| JD-2 | MAJOR | fixed | `services/stt/tests/test_contract.py:208-219`, `tests/test_privacy.py:36-59` | Existing tests give false assurance: the `MultiPartException` → 413 branch in `main.py` is dead for file parts, and the rollover trap sends exactly 1 MiB (rollover requires strictly greater), so the disk-write case is untested. | Judge A + parent repro (trap fires only at 1 MiB+1). Folded into JD-1's work unit. |
| JD-3 | MAJOR | fixed | `services/stt/src/transcribe.py:106-124`, `src/vendors/{deepgram,groq}.py`, `src/main.py:36-51` | A 2xx vendor response with malformed/non-JSON body or unexpected shape raises uncaught `JSONDecodeError`/`AttributeError` → bare plain-text 500 outside the frozen error envelope; spec requires 502 vendor_error with request_id. | **Both judges** (A finding 3 ≡ B finding 2). |
| JD-4 | CRITICAL | fixed | `services/stt/docker-compose.yml:7` | `${DEEPGRAM_API_KEY:?}` is unconditional, so a Groq-only deployment (STT_VENDOR=groq, no Deepgram key) cannot start — violates REQ-VND-5 at the deploy layer and blocks the fallback-vendor scenario. | Judge B + parent deterministic repro: `env -u DEEPGRAM_API_KEY STT_VENDOR=groq GROQ_API_KEY=x docker compose config` → exit 1. |
| JD-5 | MAJOR | fixed | `services/stt/Dockerfile:8` | `CMD ["uv","run",...]` without `--no-sync` re-resolves/installs the dev dependency group at every container start: boot requires PyPI reachability exactly when restart resilience matters, and test tooling lands in the production runtime. | Judge A; deterministic (uv default includes dev group; build used `--no-dev`). Parent accepts on documented uv semantics. |

## User-directed work units (from /goal, not JD corroboration)

| ID | Status | Scope |
|----|--------|-------|
| GOAL-1 | fixed | Retry with bounded exponential backoff on transient vendor failures (timeout, connect error, 429, 5xx). |
| GOAL-2 | fixed | Automatic failover to the other vendor when the primary exhausts retries and the fallback vendor's key is configured; `stt_vendor` response field reflects the vendor actually used. |
| GOAL-3 | fixed | Uptime hardening: compose healthcheck `start_period`; boot must not depend on the network (ties to JD-5). |

## Round-1 correction record

Applied by the bounded fix actor; each unit is independently revertable at its
commit pair. Full suite after the round: 86 passed (from 59 at freeze).

| Unit | IDs | RED | GREEN / FIX | Runtime evidence |
|------|-----|-----|-------------|------------------|
| 1 | JD-1, JD-2 | `e7924a1` | `3b7ab3d` | 1 MiB+1 POST: rollover trap fired → 413, `rollover_fired: False` |
| 2 | JD-3 | `6e01913` | `a2c7e6d` | malformed 2xx: `text/plain` 500 → 502 JSON envelope |
| 3 | JD-4 | — | `ddfb75d` | `docker compose config` (Groq-only): exit 1 → exit 0 |
| 4 | JD-5, GOAL-3 | — | `e2d185c` | N/A — image-build scope, verified by the parent orchestrator |
| 5 | GOAL-1, GOAL-2 | `d6f4f58` | `d8ab1fa` | 13 RED → 86 passed |

## Info (recorded, not fixed this round — WARNING/SUGGESTION stay info per protocol)

- A6: scalar httpx timeout expands to 4 per-phase timeouts; no overall request deadline.
- A7: `restart: unless-stopped` never recycles a hung-but-alive unhealthy container (start_period addressed via GOAL-3).
- A8: container runs as root; no image-level HEALTHCHECK.
- A9: `benchmarks/run.py` gather without `return_exceptions` loses all results on one crash.
- A10: one missing corpus clip aborts the whole benchmark run.
- A11: `--concurrency 0` hangs forever (Semaphore(0)).
- A12: 422 validation errors bypass the frozen error envelope (README contradicts itself).
- B evidence note: settings-level REQ-VND-5 validation is correct; the defect was compose-layer only.

## Contradictions

None. (Judge B's evidence claimed the no-disk design "correctly implemented and test-covered"; treated as a coverage miss, not a findings-level contradiction — parent repro settled it in favour of Judge A.)

## Round-1 authorization

The user /goal ("adversarial review … make strong and resilient. Ensure it have a retry fallback and that will be up") is the standing maintainer directive for this correction round; the session is autonomous (Stop-hook goal active).
