# Judgment Day Ledger: add-matching-service (round 1, FROZEN)

> Mode: judgment_day (explicit user /goal: adversarial review → strong/resilient, retry fallback, stays up).
> Target identity: sha256:c612e3ba63eeb3c3383662450ae3d169b24090432565bab15939f2166e34ccf3 (commit f168fa5 vs main, 31 paths, worktree clean).
> Native lifecycle: BLOCKED — `gentle-ai review status` → applicability=corrupted, next_transition=stop (reason corrupted_or_unverifiable_authority); prior lineage review-dc00be538cad37dc was workspace-overlay-bound. Documented, no repair attempted. Fallback store: this file + Engram `sdd/add-matching-service/judgment-day`.
> Judges: A (13 findings), B (3 findings), blind, identical scope/criteria. Frozen 2026-07-25.

## Confirmed severe (both judges) — fix round 1

| ID | Location | Severity | Claim (condensed) | A | B | Status |
|---|---|---|---|---|---|---|
| JD-1 | normalize.py:56 | CRITICAL | `@lru_cache(maxsize=None)` on `trigrams()` keyed by untrusted per-request `spoken_name` → monotonic RSS growth, eventual OOM kill of resident uvicorn process | CRITICAL | CRITICAL | fixed (7bcacfd) |
| JD-2 | schemas.py:16 | MAJOR | `spoken_name` has no max_length and no body-size guard; oversized input is buffered, trigram-expanded, and pinned forever by JD-1 | MAJOR | inside B's CRITICAL claim | fixed (9ac85f4) |

## Severity-split / suspect — elevated to fix scope by explicit user /goal (resilience mandate)

| ID | Location | Severity | Claim | Basis | Status |
|---|---|---|---|---|---|
| JD-3 | main.py:78 + src/* | A: MAJOR / B: WARNING | Zero application logging; request_id minted but never logged; startup success/failure, 404s, decisions leave no server-side trace | Substance confirmed by both; severity split. User /goal ("ensure … will be up") covers outage diagnosability. CONSTRAINT: never log spoken_name/transcripts at INFO (Ley 1581). | fixed (c383a56) |
| JD-4 | catalogue.py:75 | B: MAJOR (A silent) | `cur.fetchall()` outside the `sqlite3.Error` handler → fetch-time corruption escapes as raw sqlite3 error, losing documented CatalogueUnavailableError context | Suspect per protocol; PARENT-VERIFIED deterministic by direct read (line 75 outside except at 69-73). Elevated by user resilience mandate. | fixed (ece12c7) |

## User-goal work unit (mandated regardless of judge ranking)

| ID | Scope | Requirement | Status |
|---|---|---|---|
| JD-U | main.py lifespan, config.py, docker-compose.yml, Dockerfile | Explicit retry fallback + stays-up: bounded in-process startup retry with backoff on CatalogueUnavailableError (env-tunable), then exit 3 → Docker `restart: unless-stopped` as outer retry layer; healthcheck `start_period`; `PYTHONUNBUFFERED=1` so crash evidence survives OOM kill. | fixed (7fb58f6) |

## Info (recorded, NOT fixed this round — WARNING/SUGGESTION stay info per protocol)

- JD-5 (A) compose healthcheck has no consumer; restart policy ignores health state; crash-loop unthrottled. (start_period + PYTHONUNBUFFERED addressed via JD-U; autoheal sidecar NOT added.)
- JD-6 (A) container runs as root (no USER directive).
- JD-7 (A) `uv:latest` floating tag in Dockerfile COPY --from.
- JD-8 (A) no `.dockerignore` at repo-root build context. (Delivered inside JD-U, commit 7fb58f6: context transfer 46.51kB → 857B, build verified green.)
- JD-9 (A) `MATCH_MAX_CANDIDATES=1` silently disables both ambiguity signals.
- JD-10 (A) non-str `articulo` passes startup, AttributeError at request time.
- JD-11 (A) no auth/rate-limit; port published on 0.0.0.0.
- JD-12 (A, SUGGESTION) get_service returns None during shutdown drain → 500 not 503.
- JD-13 (A, SUGGESTION) `c.__dict__` bridge instead of typed CandidateOut mapping.

## Contradictions

None (no finding where judges assert mutually exclusive claims; JD-3 is a severity split, recorded above).

## Round budget

Fix rounds used: 1/2. Scoped re-judgments used: 0/2. Round-1 fix scope: JD-1, JD-2, JD-3, JD-4, JD-U — nothing else.

Round-1 fix result (worktree `add-matching-service`, branch `feat/add-matching-service`, NOT pushed): all five IDs `fixed`, one commit each (7bcacfd, 9ac85f4, c383a56, ece12c7, 7fb58f6), STRICT TDD RED→GREEN per unit. Full suite 232 → 298 green; eval gate unchanged at top1=0.9860 over n=430 (424/430). Ranking/scoring/decision semantics untouched. No new ledger rows added.

## Scoped re-judgment 1 (fix delta f168fa5..7fb58f6) — result

- Judge A: all five fixed IDs verified genuinely fixed (incl. privacy audit: no spoken_name/articulo in any log path). 2 findings, both WARNING, neither confirmed by the other judge → info per protocol:
  - JD-14 (WARNING, pre-existing): "body-size guard" half of JD-2 unremediated — Starlette buffers the raw request body before pydantic max_length applies; a multi-GB POST still spikes transient RSS (no longer pinned, thanks to JD-1). Remediation options: Content-Length middleware or reverse proxy cap. Follow-up.
  - JD-15 (WARNING, fix-caused, deterministic): new logger echoes caller-controlled `catalogue_id` verbatim; embedded newlines can forge log lines. Remediation: sanitize/quote control chars in logged ids. Follow-up.
- Judge B: `{"findings":[]}` — clean; independently verified all five IDs and the transcript-privacy tests.

Confirmed severe findings remaining: **0**. Judges do not contradict. Budget final: fixes 1/2, re-judgments 1/2.

## Terminal state

**APPROVED** (2026-07-25). Verdict:
```yaml
target_identity: sha256:c612e3ba63eeb3c3383662450ae3d169b24090432565bab15939f2166e34ccf3 (+ fix delta f168fa5..7fb58f6)
round: 1
confirmed: [JD-1, JD-2, JD-3, JD-4, JD-U]   # all fixed & re-judged clean
suspect: [JD-4 (parent-verified, fixed)]
contradictions: []
info: [JD-5..JD-13, JD-14, JD-15]
fix_work_units: [7bcacfd, 9ac85f4, c383a56, ece12c7, 7fb58f6]
scoped_rejudgment: approved
terminal_state: approved
skill_resolution: none — no project skill matched; ledger path passed explicitly
```
Independent final verification: live Docker rebuild + availability drill (recorded in Engram `sdd/add-matching-service/judgment-day`).
