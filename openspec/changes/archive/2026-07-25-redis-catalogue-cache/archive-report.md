# Archive Report: redis-catalogue-cache

**Change**: redis-catalogue-cache (Supabase Catalogue Source + Redis Snapshot Cache, SQLite removal)
**Archived**: 2026-07-25
**Merge commit**: `058f057` (main)
**PR**: #17, 19 commits, `feat/redis-catalogue-cache` → `main`

## SDD Cycle Summary

explore → propose → spec → design → tasks → apply (strict TDD, 13 work units, 72/72 tasks) →
verify (FAIL on 2 integration CRITICALs → fixed → clean) → 4R review (no blockers) → PR #17 merged.

### Artifact Chain (Engram observation IDs)

| Phase | Artifact | Observation ID |
|---|---|---|
| Explore | `sdd/redis-catalogue-cache/explore` | #139 |
| Proposal | `sdd/redis-catalogue-cache/proposal` | #143 |
| Spec | `sdd/redis-catalogue-cache/spec` | #145 |
| Design | `sdd/redis-catalogue-cache/design` | #146 |
| Tasks | `sdd/redis-catalogue-cache/tasks` | #148 |
| TDD baseline | `sdd/redis-catalogue-cache/tdd-baseline` | #147 |
| Apply progress | `sdd/redis-catalogue-cache/apply-progress` | #149 |
| Decisions (size:exception, chain rejection) | `sdd/redis-catalogue-cache/decisions` | #144 |
| Credential decision (service_role, not least-privilege) | `sdd/redis-catalogue-cache/credential-decision` | #152 |
| Supabase reality check (8 not 56, 1405 not 1461) | `sdd/redis-catalogue-cache/supabase-reality-check` | #151 |
| Unit vocabulary regression (WU-10) | `sdd/redis-catalogue-cache/unit-vocabulary-regression` | #160 |
| Verify report | `sdd/redis-catalogue-cache/verify-report` | #170 |
| Delivery / PR summary | `sdd/redis-catalogue-cache/delivery` | #178 |
| Archive report | `sdd/redis-catalogue-cache/archive-report` | (this document) |

## Delivered

- PR #17 merged to `main` at commit `058f057`, 19 commits.
- Final suites: `uv run pytest` → **1 failed, 542 passed, 1 skipped**. Frontend `npm test` → **667 passed / 31 files**.
- The one Python failure (`tests/deployment/test_root_compose.py::TestSecretSafeEnvWorkflow::test_no_committed_file_carries_a_credential_shaped_default`) is **pre-existing on clean `main` too** — it fires on `.env.example:103` `GOOGLE_CLOUD_PROJECT=gen-lang-client-0715489298`, a committed credential-shaped default this change deliberately left untouched (a working local Google Cloud deploy default; changing it here would risk breaking a deploy this change had no business touching). Reported as a separate security follow-up, not fixed here.

## Two BREAKING changes

1. **`catalogue_id` is now a `warehouses.code`**, not a SQLite stock-table name, on both `POST /match` and `GET /catalogues`. The frontend migration — originally planned as a separately-coordinated follow-up — shipped inside this PR (WU-12) because `feat/voice-counter-frontend` merged to `main` first, carrying the legacy vocabulary; the mitigation expired rather than failed, and `sdd-verify` caught it.
2. **`unidad_display` is non-null again** on `/match` responses. The cutover accidentally nulled it (the unit-vocabulary regression below); WU-10 restored it before merge.

## The premise correction (why this change exists at all)

The original request assumed the matcher constantly queried Supabase and needed insulating with a
cache. It never did: `MatcherService.__init__` loaded a local read-only SQLite file exactly once at
FastAPI startup, and there was no Supabase client anywhere in the codebase (Engram #139, explore).
This change therefore builds **both** pieces in one PR — the Supabase catalogue source (previously
nonexistent) *and* the Redis cache in front of it. `size:exception` was accepted up front against
the 400-line review budget (Engram #144, forecast ~4x budget): a 3-PR chain (source / cache /
deployment) was offered and explicitly rejected, because a Supabase source alone would leave the
matcher with no working catalogue at each intermediate slice.

## A bug this change introduced and fixed before merge

Swapping the source changed the *vocabulary*, not just the identities, of the `unidad` column
(workbook labels `Kilogram`/`Liter`/`Unidad`/`Portion` under SQLite vs. `warehouse_products.unit_code`
values `KG`/`LT`/`UND`/`POR`/`CAJA` from Supabase). `matcher/units.py` still spoke the old labels, so
`unidad_display` was `null` on every `/match` response and `MATCH_UNIT_RERANK` was silently inert —
invisible to the eval baseline because `resolve_unit("Kilogram")` already returned `None` on both
sides of the measurement. Found and fixed in WU-10 (unit-vocabulary regression, Engram #160), a pure
restoration — every synonym set and display string preserved verbatim. The `CAJA` unit domain
question (does a dictated "caja" resolve to `CAJA` or stay `UND`?) is deliberately not decided here.

## Accuracy outcome — accepted as measured, signed off, recorded on the PR

| Metric | Old SQLite | Shipped |
|---|---|---|
| overall top-1 (n=430) | 0.98605 | **0.98372** |
| `has_code` top-1 (n=345) | 0.98551 | **0.99710** |
| `no_code` top-1 (n=85) | 0.98824 | **0.92941** |
| recall@3 (every cohort) | 1.0000 | **1.0000** (unchanged) |
| garbage false-confidence | 0.00543 | **0.00543** (unchanged) |

Cause: exact score ties the trigram metric cannot separate. Row order changed from SQLite `rowid` to
`warehouse_products.id` UUID, and the losing side of tie clusters moved cohorts (6 of 7 misses are
exact-score ties; the 7th is a genuine 4-way Kyocera toner colour-code tie). A deterministic
`(-score, uid)` tie-break (WU-11) made ranking order-independent — proven by mutation: reverting it
makes a shuffled-catalogue replay report 0.99535 instead of 0.98372, i.e. row order alone was worth
about a full accuracy point either way before this fix. The tie-break was **not expected to and did
not** recover the `no_code` cohort — that is a scoring-precision problem (names differing only by a
gram weight or a colour code), not a ranking-order problem, and is listed as an open follow-up. **No
floor was lowered to make a test pass**; the human sign-off gate (task 6.6) explicitly reviewed and
accepted this exact delta.

## Review outcome

- All four 4R lenses (readability, reliability, resilience, risk) returned **no merge blockers**.
- `sdd-verify` FAILed initially on **2 CRITICALs**, both **integration staleness**, not defects in
  this change's diff: C1 — the frontend `catalogue_id` migration's stated mitigation ("the unmerged
  frontend branch adopts new ids before merging") expired because that branch merged to `main` first
  with the legacy vocabulary; C2 — a Compose service-set conflict, `main` had independently added a
  `frontend` service while this branch added `redis`. Both closed in **WU-12** (merge `origin/main`,
  union the 5-service set, migrate the frontend's `catalogue_id` values with new regression guards).
- 4 WARNINGs from the corrected verify pass were all cleared in **WU-13**, a single bounded
  correction transaction: (1) a `SnapshotCache` port/adapter signature drift that could have silently
  disabled the cross-replica refresh lock on a strictly-conforming adapter; (2) a missing end-to-end
  assertion that `SUPABASE_KEY` never appears in a real crash-path traceback; (3) a stale
  "least-privilege" docstring on `config.py` that contradicted the corrected credential story;
  (4) a factually wrong accuracy provenance note, replaced with the real per-case miss table.

## Known-unverified

`docker compose up` was never run for the new topology — no `service_role` Supabase key was
available locally. Only `docker compose config -q` (exit 0) validated the rendered Compose file.
The user tests from `main` after merge and reports back.

## Spec sync — what changed under `openspec/specs/`

1. **`catalogue-source-supabase`** (NEW) — copied verbatim to `openspec/specs/catalogue-source-supabase/spec.md`. REQ-CSS-1..5, all 5 requirements, 13 scenarios.
2. **`catalogue-redis-cache`** (NEW) — copied verbatim to `openspec/specs/catalogue-redis-cache/spec.md`. REQ-RCC-1..5, all 5 requirements, 12 scenarios.
3. **`matcher-service-api`** (MODIFIED) — 6 requirements replaced in place as full-text substitutions (REQ-API-1, -2, -4, -6, -7, -8). REQ-API-5 ("Read-only in-memory catalogue") was **deleted outright** with its `(Reason: ...)`/`(Migration: ...)` note consumed into this report rather than left as a strikethrough or comment in the spec. REQ-API-3 (`GET /health`) was untouched by the delta and preserved verbatim. Added a `rev 5` header line alongside the existing `rev 4` (Judgment Day) line, and corrected the `Purpose` sentence, which still described "reading the catalogue SQLite strictly read-only" — not itself a delta target, but leaving a false statement in a spec meant to read clean would have been wrong.
4. **`unified-compose-deployment`** — special case, see below.

### The non-mechanical case: `unified-compose-deployment`

There was **no** `openspec/specs/unified-compose-deployment/spec.md` before this archive pass. Its
base spec has only ever lived inside the still-open, never-archived change
`openspec/changes/docker-compose-unified-deployment/specs/unified-compose-deployment/spec.md`. That
capability is live and shipped on `main` today (the root `docker-compose.yml` is real), so this
archive pass **materializes** `openspec/specs/unified-compose-deployment/spec.md` as *that pending
change's base spec* + *this change's delta applied on top*:

- REQ-UCD-1 (sole surface): service list widened from `{stt, matcher}` to the 5-service union
  `{stt, matcher, product_identification, frontend, redis}`.
- REQ-UCD-3 (per-service contracts): matcher's env-var set replaced (`CATALOGUE_DB` +
  `./data:/data:ro` mount → `SUPABASE_URL`/`SUPABASE_KEY`/`REDIS_URL`/`CATALOGUE_CACHE_TTL_SECONDS`,
  no mount).
- REQ-UCD-6 (daemon-free validation): extended to the `redis` service key and to asserting the
  absence of the old mount/`CATALOGUE_DB`.
- REQ-UCD-7 (runtime smoke): matcher-smoke gating moved from "catalogue file present" to "Supabase
  credentials present".
- REQ-UCD-12 (redis soft dependency) added new.
- REQ-UCD-2, -4, -5, -8, -9, -10, -11 were untouched by the delta and preserved verbatim.

**This materialization is partial and deliberate.** The base spec's `Purpose` section still reads
"exposes the existing STT service ... and the matcher service ... individually or together" (a
2-service framing) — the delta did not target `Purpose`, so it was left as literal base text rather
than invented. **`openspec/changes/docker-compose-unified-deployment/` was NOT touched, archived, or
modified by this archive pass** — it is a separate, still-open change and remains exactly as found.
**It still needs its own archive pass**, which is the right place to reconcile `Purpose` (and
anything else its authors intended) against the now-materialized 5-service reality.

## Accuracy corrections folded into the main specs (the corrected version shipped, not the original)

- **8 warehouse codes carry a catalogue, not 56.** `warehouses` holds 56 rows; only 8 have
  `warehouse_products`. This is what REQ-CSS-1/REQ-API-2 state in the merged specs.
- **REQ-CSS-4 is "Stock-data isolation," not "least privilege."** The matcher authenticates with the
  Supabase `service_role` key, which bypasses RLS — no least-privilege alternative exists today (the
  `anon` role holds no `GRANT` on any catalogue table; every read policy targets `authenticated`).
  The merged spec explicitly documents the credential as **not** the control: isolation is enforced
  by the service (no `warehouse_stock_balances` query is ever constructed) and by the codec (the
  snapshot payload carries exactly 5 fields, no stock field), plus a credential-non-leakage guarantee.
- **REQ-RCC-4 describes only the cross-replica Redis `SET NX PX` lock.** Per-process single-flight is
  explicitly documented as NOT implemented, with the requirement stating why it would be dead code
  today (`refresh()` has one sequential caller) and what would have to change if a second refresh
  trigger were ever added.
- **The compose service set is the five-service union**: `stt`, `matcher`, `product_identification`,
  `frontend`, `redis`.

## Filesystem archive move — INCOMPLETE, blocked by tooling

This execution context had **no Bash/shell tool available** — only `Read`/`Edit`/`Write`/`Glob` and
the Engram/codegraph MCP tools. `git mv` (required to preserve history on the move) could not be run,
and the skill's step-4 sanity check `uv run pytest -q` could not be run either.

**What WAS done:**
- `openspec/specs/catalogue-source-supabase/spec.md` — created.
- `openspec/specs/catalogue-redis-cache/spec.md` — created.
- `openspec/specs/matcher-service-api/spec.md` — updated in place (delta merged, REQ-API-5 removed).
- `openspec/specs/unified-compose-deployment/spec.md` — created (base + delta materialization, see above).
- This archive report was written to `openspec/changes/redis-catalogue-cache/archive-report.md` —
  **deliberately inside the still-open change folder**, so that the one remaining step (`git mv`)
  carries it into the archive atomically along with every other artifact and its full git history.

**What is NOT done, and must be completed by an agent/session with Bash access:**

```bash
git mv openspec/changes/redis-catalogue-cache openspec/changes/archive/2026-07-25-redis-catalogue-cache
uv run pytest -q   # confirm still 1 failed, 542 passed, 1 skipped; `git checkout -- uv.lock` if uv rewrites the lock
git add openspec/specs/catalogue-source-supabase openspec/specs/catalogue-redis-cache \
        openspec/specs/matcher-service-api openspec/specs/unified-compose-deployment
```

After that single command, every sanity check from the archive skill (change folder gone, four
capabilities represented under `openspec/specs/`, no delta markers leaked, `tasks.md` fully checked)
already holds — the content above satisfies them; only the physical folder move and the final test
re-run are outstanding.

## Open follow-ups (carried forward, must not be lost)

1. **The `CAJA` unit domain question (RF-15)** — should a dictated "caja" resolve to the `CAJA` unit
   code rather than `UND`? Deliberately not decided in this change.
2. **A scoped catalogue-reader role** (`GRANT SELECT` + read policies on exactly `warehouses`,
   `products`, `warehouse_products`, `units`) to restore genuine least privilege and retire
   `service_role` from the matcher — a Data Engineer follow-up.
3. **Delete `scripts/build_bodegas_sqlite.py` and `data/`** — no runtime path reads them anymore;
   deliberately deferred out of scope to keep the cutover diff reviewable.
4. **The pre-existing `.env.example:103` `GOOGLE_CLOUD_PROJECT` credential-shaped default** (and the
   matching filename at line 109) — separate security follow-up, left untouched throughout.
5. **Cold-start Supabase stampede** — `load_index` never takes the `SET NX PX` lock, only the
   periodic refresh path does; zero blast radius today (one replica per service in compose) but
   matters the moment the matcher scales horizontally.
6. **`/health` cannot surface catalogue staleness** — `HealthResponse` reports only
   `status`/`catalogues`/`rows`; if Supabase becomes permanently unreachable after startup, every
   refresh fails behind a catch-all logging one WARNING per ~3h cycle while `/health` keeps answering
   `200 {"status":"ok"}`.
7. **The `no_code` scoring-precision gap** — tied names differing only by a gram weight or a toner
   colour code (the 4-way Kyocera TK-538x tie) are a scoring problem, not a ranking problem; out of
   scope here.
8. **`docker-compose-unified-deployment` still needs its own archive pass** — this archive pass only
   materialized the parts its delta touched; the base change folder is untouched and its own closure
   should reconcile `Purpose` and anything else against the 5-service reality.
9. **`docs/database/TECHNICAL_DATA_SPECIFICATION.md` and `SUPABASE_SCHEMA_COMPARISON.md`** still
   describe a `v_warehouse_catalogue` view that the shipped source does not use — it queries
   `warehouse_products` joined to `products`/`warehouses` directly.

## Change Status

- [x] Implementation complete — 72/72 tasks across 13 work units, strict TDD RED/GREEN pairs, ~45 recorded deviations (all reviewed and sound per `sdd-verify`'s deviation audit)
- [x] Verification — FAIL (2 integration CRITICALs) → both closed in WU-12 → 4 WARNINGs closed in WU-13 → clean
- [x] 4R review — no merge blockers
- [x] PR #17 merged to `main` (`058f057`)
- [x] Delta specs merged into `openspec/specs/` (this report, above)
- [ ] Change folder moved to archive — **BLOCKED, no Bash tool in this execution context**; exact command given above
- [ ] `uv run pytest -q` sanity re-check — **BLOCKED, no Bash tool in this execution context**
- [x] Archive report persisted — filesystem (inside the still-open folder, pending the move) and Engram
