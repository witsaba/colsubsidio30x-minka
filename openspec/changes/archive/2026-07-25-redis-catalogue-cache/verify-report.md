```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:6abe9b3ebac3b877859da4d56667ca603d11f053f5c0841123ad7e139094c1d7
verdict: fail
blockers: 2
critical_findings: 2
requirements: 19/21
scenarios: 42/49
test_command: uv run pytest
test_exit_code: 1
test_output_hash: sha256:6abe9b3ebac3b877859da4d56667ca603d11f053f5c0841123ad7e139094c1d7
build_command: docker compose config -q
build_exit_code: 0
build_output_hash: sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
```

## Verification Report

**Change**: redis-catalogue-cache
**Branch**: `feat/redis-catalogue-cache` @ `17f694a`
**Mode**: Strict TDD
**Verdict**: **FAIL** — internal quality is high; both blockers are *integration staleness*, not defects inside this change's diff.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 72 |
| Tasks complete | 72 |
| Tasks incomplete | 0 |

### Build & Tests Execution

**Tests**: `uv run pytest` → **1 failed, 526 passed, 1 skipped** (14.98s), exit 1 — matches the established expected end state exactly.
- The single failure is `tests/deployment/test_root_compose.py::TestSecretSafeEnvWorkflow::test_no_committed_file_carries_a_credential_shaped_default`, pre-existing on `main`, left red deliberately (task 8.13, `.env.example:103`). Zero failures would itself be a defect.
- The single skip is `tests/deployment/test_smoke_compose.py:157`, the credential-gated Docker-daemon class, skipped **with a named reason** exactly as REQ-UCD-7 requires.
- Baseline on `main` was 4 failed / 368 passed (Engram #147). Three of the four are fixed here.

**Build**: `docker compose config -q` → exit 0. `docker compose up` deliberately not run.
**`uv.lock` drift**: none after all runs (`git diff --stat uv.lock` empty).
**Coverage / linter**: no coverage tool and no `ruff` binary in the environment — skipped, not a failure.

### Spec Compliance Matrix (49 scenarios across 21 requirements)

| Requirement | Enforcing test | Result |
|---|---|---|
| REQ-CSS-1 sole Supabase source | `tests/unit/test_supabase_source.py:90`, `tests/unit/test_config.py:87` | COMPLIANT |
| REQ-CSS-1 no SQLite remnant | `tests/deployment/test_root_compose.py` no-mount/no-`CATALOGUE_DB` tests | COMPLIANT |
| REQ-CSS-2 row identity/shape | `tests/unit/test_supabase_source.py:202,229`, `tests/unit/test_snapshot_codec.py:54` | COMPLIANT |
| REQ-CSS-2 no stock field | `tests/unit/test_snapshot_codec.py:57`, `tests/unit/test_supabase_source.py:256` | COMPLIANT |
| REQ-CSS-3 inactive excluded | `tests/unit/test_supabase_source.py:117` | COMPLIANT |
| REQ-CSS-3 merged excluded | `tests/unit/test_supabase_source.py:117` (query-shape only) | **PARTIAL** |
| REQ-CSS-4 no stock query | `tests/unit/test_supabase_source.py:98` (path+query, both pages) | COMPLIANT |
| REQ-CSS-4 snapshot has no stock | `tests/unit/test_snapshot_codec.py:245,264`, `tests/eval/test_eval_fixture.py:77` | COMPLIANT |
| REQ-CSS-4 credential never leaks | `tests/unit/test_supabase_source.py:324` | COMPLIANT |
| REQ-CSS-5 both unreachable aborts | `tests/unit/test_load_index.py:288,297`, `tests/api/test_startup_retry.py:171` | COMPLIANT |
| REQ-CSS-5 Redis down still starts | `tests/unit/test_load_index.py:253` | COMPLIANT |
| REQ-RCC-1 warm start zero calls | `tests/unit/test_load_index.py:91` | COMPLIANT |
| REQ-RCC-1 cold start writes TTL | `tests/unit/test_load_index.py:154`, `tests/unit/test_redis_cache.py:144` | COMPLIANT |
| REQ-RCC-1 version mismatch = miss | `tests/unit/test_load_index.py:225` | COMPLIANT |
| REQ-RCC-2 refresh while serving | `tests/unit/test_refresh.py:145` | COMPLIANT |
| REQ-RCC-2 TTL honored | `tests/unit/test_redis_cache.py:154`, `tests/api/test_refresh_loop.py:135` | COMPLIANT |
| REQ-RCC-3 /match no per-request I/O | `tests/api/test_refresh_loop.py:161` | COMPLIANT |
| REQ-RCC-3 Redis dies mid-flight | `tests/unit/test_refresh.py:362`, `tests/unit/test_redis_cache.py:202-233` | COMPLIANT |
| REQ-RCC-3 Supabase down keeps last-good | `tests/unit/test_refresh.py:213` | COMPLIANT |
| REQ-RCC-4 SET NX cross-replica | `tests/unit/test_redis_cache.py:238`, `tests/unit/test_refresh.py:259,285` | COMPLIANT |
| REQ-RCC-4 in-process coalesce | **(none found)** | **UNTESTED** |
| REQ-RCC-4 jitter | `tests/unit/test_refresh.py:386,395` | COMPLIANT |
| REQ-RCC-5 snapshot content safety | `tests/unit/test_snapshot_codec.py:245` | COMPLIANT |
| REQ-API-1 contract / 3 statuses / bounds | `tests/api/test_http.py:64-193` | COMPLIANT |
| REQ-API-2 GET /catalogues | `tests/api/test_http.py:200,209` | COMPLIANT |
| REQ-API-4 config, no CATALOGUE_DB | `tests/unit/test_config.py:76,87,124,208` | COMPLIANT |
| REQ-API-6 compose healthy service | `tests/deployment/test_smoke_compose.py:157` | SKIPPED (Docker+creds) |
| REQ-API-7 retry / exit 3 / no retry on config | `tests/api/test_startup_retry.py:80,171,261,284` | COMPLIANT |
| REQ-API-8 observability + Ley 1581 privacy | `tests/api/test_logging.py:91,175,250` | COMPLIANT |
| REQ-UCD-1 sole surface / service set | `tests/deployment/test_root_compose.py:104` | COMPLIANT (stale — see C2) |
| REQ-UCD-3 per-service contracts | `tests/deployment/test_root_compose.py:171,177,217,231` | COMPLIANT |
| REQ-UCD-6 daemon-free validation | `tests/deployment/test_compose_config.py:117,147` | COMPLIANT |
| REQ-UCD-7 runtime smoke (3 live scenarios) | `tests/deployment/test_smoke_compose.py` | SKIPPED (by design) |
| REQ-UCD-7 skip reporting | plan-level tests in `test_smoke_compose.py` | COMPLIANT |
| REQ-UCD-12 redis uncoupled + env flow | `tests/deployment/test_root_compose.py:263`, `.env.example:78-96` | COMPLIANT |
| REQ-API-5 (REMOVED) | retired with its tests in task 5.8 | N/A |

**Compliance summary**: 42/49 COMPLIANT, 2 PARTIAL/UNTESTED, 5 deliberately runtime-gated.

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD evidence reported | PASS | Engram #149 apply-progress, per-work-unit |
| Tests ship with their code | PASS | all 11 code commits carry tests; only the 3 docs/planning commits do not |
| RED confirmed by mutation | PASS | 3/3 spot-checks went red on exactly the claimed tests |
| GREEN confirmed | PASS | 526 passing at HEAD |
| Assertion quality | PASS | no tautologies, no ghost loops, no smoke-only tests found |
| Tree restored after mutation | PASS | `git status --short` clean |

**Mutation spot-checks performed (all restored):**
1. Disabled the warm-start early return (`catalogue.py:118`) → 5 red, incl. `test_a_fresh_snapshot_performs_zero_supabase_calls` with `assert 1 == 0`.
2. Reverted `(-score, uid)` → `-score` (`scoring.py:69`) → 4 red, incl. the shuffled-catalogue eval test.
3. Re-keyed `UNIT_DISPLAY` to workbook labels (`units.py:66`) → 8 red across unit and HTTP layers.

### Headline requirement (zero Supabase calls on a warm start) — CONFIRMED

`test_a_fresh_snapshot_performs_zero_supabase_calls` (`tests/unit/test_load_index.py:91-101`) asserts **both** `source.calls == 0` and `source.queried_tables == set()`. Confirmed from the startup code, not the test name:
- `load_index` returns at `catalogue.py:118-123` before reaching `source.load()` at line 126.
- `MatcherService.__init__` calls `load_index` exactly once (`service.py:87`).
- `_refresh_loop` **sleeps before its first cycle** (`main.py:155-156`), pinned by `test_refresh_loop.py:135-157` — so the background task cannot dial Supabase at startup.
- `_build_adapters` constructs `httpx.Client` and `redis.Redis` lazily; neither dials (`main.py:90-98`).
- `/match`, `/catalogues`, `/health` read only the in-process index.

No other path can reach Supabase when a fresh snapshot exists.

### Security controls (REQ-CSS-4, service_role bypasses RLS)

1. **No `warehouse_stock_balances` query is constructible.** `CATALOGUE_PATH` is a module constant (`supabase_source.py:45`) used at the single call site (line 110); `SELECT` (line 46) names no stock column. Repo-wide, the string appears only in tests, docstrings, and a one-shot script.
2. **Snapshot payload carries no stock field.** `encode_snapshot` serializes `asdict(row)` (`cache.py:54`) over a frozen 5-field `Row` (`ports.py:29-37`).
3. **`SUPABASE_KEY` cannot leak.** `self._key` appears only in request headers (`supabase_source.py:103-104`); every raised message is a literal (lines 115-130, 145-147). `SupabaseCatalogueSource` is not a dataclass, so its default `repr()` exposes nothing. No log statement interpolates `Settings`.
4. **`.env.example:85` ships `SUPABASE_KEY=` empty**; compose uses `${SUPABASE_KEY:-}`.

### Soft-dependency guarantee (REQ-RCC-3) — CONFIRMED

`match()` binds `index = self._index` once (`service.py:187`) and does no I/O. `_refresh_from_source` builds the new index off to the side and swaps it in a single assignment (`service.py:134`). Four independent guard layers keep Redis/Supabase failures off the request path: adapter-level `RedisError` swallowing (`cache.py:107,119,136,143`), `_guarded` (`service.py:165-178`), `refresh()`'s broad catch (`service.py:111-120`), and the loop guard (`main.py:157-162`). Refresh runs in a worker thread (`main.py:158`), so it cannot block the event loop.

### Accuracy audit (H) — numbers are honest

Re-measured live: overall 0.9837, has_code 0.9971, no_code 0.9294, recall@3 1.0000, false-confidence 0.0054 — identical to the values recorded in the provenance block.

| Constant | on `main` | now | Assessment |
|---|---|---|---|
| `HAS_CODE_TOP1_BASELINE` | 340/345 | 344/345 | raised — improvement |
| `NO_CODE_TOP1_BASELINE` | 84/85 | **79/85** | pinned **exactly** at the measurement, zero slack |
| `TOP1_FLOOR` | 0.986 | 0.983 | measured 0.98372; same round-down-to-3dp method as before; still fails on a 1-case regression |
| `RECALL3_FLOOR` / `COHORT_RECALL3_BASELINE` / `FALSE_CONFIDENCE_CEILING` / `EXPECTED_CASE_COUNT` | 1.00 / 1.00 / 0.022 / 624 | unchanged | unchanged |

**No floor was lowered to turn a red test green beyond what the measurement forces.** Independent rank audit of all 7 top-1 misses is reported under W3/W4.

### Issues Found

**CRITICAL**

- **C1 — the BREAKING `catalogue_id` change's stated mitigation has expired.** Engram #144 decision 2 premised the clean break on "the unmerged `feat/voice-counter-frontend` branch, which adopts the new IDs before merging". That branch has since **merged** (PR #13, `59c6541`) and been archived (`5ea4652`); `origin/main` is now `13f3733`, **37 commits ahead** of this branch's merge-base `d60e934`. The merged frontend still speaks the legacy vocabulary: `origin/main:frontend/src/lib/catalogues.ts:22-30` hardcodes all 8 SQLite table names, `:43` sets `DEMO_CATALOGUE_ID = 'stock_restaurante_fuentes_ayb'`, and `origin/main:frontend/tests/api-routes/proxy.test.ts:135` posts that id. After this change, `MatcherService.match` (`services/matcher/src/matcher/service.py:188-189`) raises `UnknownCatalogueError` → HTTP 404 for every one of them. Merging as-is breaks the operator match flow on `main`. Not a defect in this diff — a coordination window that closed while the change was being built.
- **C2 — post-merge Compose service-set conflict.** `origin/main:docker-compose.yml` declares `stt`, `matcher`, `product_identification`, **`frontend`** (added by `6a48647`). This branch declares `stt`, `matcher`, `product_identification`, **`redis`**. `tests/deployment/test_root_compose.py:104-110` asserts set **equality**, and `tests/deployment/test_compose_config.py` mirrors it, so both go red on merge until the union of 5 services is adopted. The `unified-compose-deployment` delta REQ-UCD-1 also needs `frontend` added to its "exactly" list.

**WARNING**

- **W1 — REQ-RCC-4's "per-process single-flight" is neither implemented nor tested.** No single-flight construct exists in `services/matcher/src/` and no test covers the "In-process refresh triggers coalesce" scenario. Measured directly: with Redis up, 4 concurrent `refresh()` calls → **1** Supabase fetch (coalesced by the `SET NX` lock, `cache.py:122-138`); with Redis down → **4** fetches, because `_follow_the_winner` falls through to `_refresh_from_source` (`service.py:145-148`). Not reachable today — `refresh()` has exactly one caller, the sequential `_refresh_loop` (`main.py:155-158`). A strict reading of the verify gate gives CRITICAL-UNTESTED; downgraded on the measured evidence that the outcome holds on every reachable path. It becomes live the moment a second refresh trigger is added.
- **W2 — `services/matcher/src/matcher/config.py:30` still calls `supabase_key` a "Least-privilege API key".** Engram #152 required correcting every least-privilege claim; the spec was corrected (`specs/catalogue-source-supabase/spec.md:61`) but this docstring was not. Security-relevant: it tells a future reader the credential cannot read `warehouse_stock_balances`, which is false for `service_role`.
- **W3 — the accuracy provenance note overstates the miss profile.** `services/matcher/tests/eval/test_eval_accuracy.py:125-126` says "In every one of those misses the gold row is still rank 2". Independently measured across all 7 misses: gold is rank 2 in **6**, and rank **3** in one (`kyocera toner tk 538ic`, gold `TONER KYOCERA TK 5382C`). recall@3 = 1.0000 remains true and is what the test asserts. This matters because task 6.6's human sign-off rests on this note.
- **W4 — the same note misplaces the kyocera tie cluster.** `test_eval_accuracy.py:107-109` implies the four-way kyocera colour tie moved into `no_code`. Measured, it is the sole `has_code` miss; `no_code`'s 6 misses are 5 × "porcion filete pechuga" + 1 × "cola cola". The arithmetic elsewhere in the block (344/345, 79/85, 423/430) is correct.

**SUGGESTION**

- **S1** — `Settings.supabase_key` is a plain `str` (`config.py:29`), not `pydantic.SecretStr`. Nothing reprs `Settings` today, so there is no live leak, but with a `service_role` key `SecretStr` is cheap defence in depth against a future `repr()` or debug dump.
- **S2** — port/adapter signature drift: `SnapshotCache.try_acquire_refresh_lock(ttl_seconds: int)` (`ports.py:77`) vs `RedisSnapshotCache.try_acquire_refresh_lock(ttl_seconds: float | None = None)` (`cache.py:122`). `runtime_checkable` only checks method presence, so conformance tests pass either way.
- **S3** — REQ-CSS-3's "merged warehouses excluded" scenario is proven only at query-shape level (`test_supabase_source.py:117-127`). Server-side filtering cannot be proven offline; the stated outcome ("its code is absent from `GET /catalogues`") is not directly exercised.
- **S4** — the 168-file / 27,995-deletion diff is an artifact of being 37 commits behind; the frontend "deletions" are not real deletions.

### Deviations (F)

All 39 recorded deviations reviewed. Every one is an implementation-level engineering call consistent with the specs; **none silently changed a requirement**. Notable and sound: #4 (splitting the Redis-unreachable test rather than asserting a warning the adapter cannot emit), #20 (the credential gate added after a live incident recreated the developer's running container), #24-#26 (the 1,405-vs-1,461 gap resolved as discarded header rows, with the accuracy delta proven rather than assumed), #29→WU-10 (the unit-vocabulary regression found and fixed inside the change), #33 (the tie-break explicitly reported as not recovering `no_code`, nothing tuned). Deviations #21 and #22 correctly chose to satisfy an existing test rather than weaken it. Deviation #39 correctly reclassifies the live credential check as *moot* rather than pending. Two plan corrections (56→8 warehouses; withdrawn least-privilege claim) were propagated into the specs — except the residual code docstring flagged as W2.

### Leftovers (G)

- No `TODO`/`FIXME`/`XXX`/`HACK` anywhere in `services/matcher/src/`.
- The WU-5 temporary eval skip is **gone**, and its return is guarded by `TestEvalSetProvenance::test_the_eval_suite_is_not_skipped` (`test_eval_accuracy.py:272`) plus a companion proving the guard itself bites (`:275`). The only `pytest.mark.skip` left in the matcher suite is the fake marker used as test data inside that companion.
- No unreferenced imports in the matcher runtime (all 9 modules reviewed).
- SQLite survives only in `scripts/build_bodegas_sqlite.py` and `scripts/remap_eval_set.py` — both one-shot, out of the runtime path, and deliberately retained (proposal Out of Scope, deviation 25).

### Verdict

**FAIL** — blocked by C1 and C2. Both are integration staleness against a `main` that moved 37 commits during implementation, not defects inside this change's diff. Nothing in this change needs to be reverted; it needs a rebase onto `13f3733`, adoption of the 5-service Compose union, and a decision on the frontend `catalogue_id` migration. Internal quality is high: absent C1/C2 this would be PASS WITH WARNINGS.
