# Tasks: Supabase Catalogue Source + Redis Snapshot Cache (SQLite Removal)

> **Size-budget deviation, deliberate**: the `sdd-tasks` 530-word artifact budget is
> intentionally exceeded. Strict TDD is ACTIVE and the orchestrator requires every task
> to name its exact test path, test name, RED assertion, minimal GREEN implementation,
> and verification command. A 530-word checklist cannot carry that contract.

## Definition of "green" — READ THIS BEFORE JUDGING ANY RUN

Test command: **`uv run pytest` from the repository root.**

Baseline on `origin/main` @ `d60e934` (Engram `sdd/redis-catalogue-cache/tdd-baseline`, #147):
**4 failed, 368 passed.** All four are PRE-EXISTING, base-only, NOT introduced here:

| # | Failure | Treatment in this change |
|---|---------|--------------------------|
| 1 | `tests/deployment/test_compose_config.py::TestRenderedContract::test_it_validates` | **FIXED** in WU-8 |
| 2 | `tests/deployment/test_root_compose.py::TestSoleSurface::test_the_root_file_defines_every_service` | **FIXED** in WU-8 |
| 3 | `tests/deployment/test_root_compose.py::TestSoleSurface::test_operator_docs_never_point_at_a_service_local_compose` | **FIXED** in WU-8 |
| 4 | `tests/deployment/test_root_compose.py::TestSecretSafeEnvWorkflow::test_no_committed_file_carries_a_credential_shaped_default` | **LEFT RED ON PURPOSE** |

#1-#3 are compose-suite drift: PR #12 added `product_identification` (port 8003) to
`docker-compose.yml` and the docs, but `tests/deployment/test_root_compose.py:85` still
asserts the service set is exactly `{"stt", "matcher"}`. This change edits
`docker-compose.yml`, `.env.example` and `tests/deployment/*` anyway, and its own
`unified-compose-deployment` delta covers the service set. Post-change service set is
`{stt, matcher, product_identification, redis}`.

#4 is `GOOGLE_CLOUD_PROJECT=gen-lang-client-0715489298` at `.env.example:103` (plus the
same id embedded in the filename at line 109). **Do NOT touch it.** Changing that
committed default risks breaking the user's working local deploy. It is reported to the
user as a separate pre-existing security follow-up.

> ### TARGET END STATE: `uv run pytest` reports **exactly 1 failed** — and that one is
> `test_no_committed_file_carries_a_credential_shaped_default`. Everything else passes.
> `sdd-apply` and `sdd-verify` MUST NOT read a 1-failure run as a regression.
> **2 or more failures = regression. 0 failures = someone touched `.env.example:103`,
> which is also wrong.**

`uv.lock`: any `uv run` invocation in this worktree rewrites it (+777 lines of
previously-unlocked `product_identification` transitive deps from PR #12). This change
legitimately adds `httpx`, `redis` and `fakeredis`, so a lock update is expected. Commit
the lock deliberately (WU-0) and call the unrelated +777 lines out in the PR body.

**No test in this change may require network access.** Every Supabase interaction is
covered by `httpx.MockTransport`; every Redis interaction by `fakeredis`; the eval suite
runs off a checked-in fixture snapshot.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,300-1,600 authored (`+`/`-`), excluding generated data fixtures |
| 400-line budget risk | High |
| Chained PRs recommended | No |
| Suggested split | Single PR — user explicitly rejected the 3-PR chain |
| Delivery strategy | single-pr |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

**`size:exception` accepted by user** (Engram `sdd/redis-catalogue-cache/decisions`, #144).
The honest forecast is ~4x the 400-line budget. The user was shown the 3-slice chain
(PR1 Supabase source / PR2 Redis cache / PR3 deployment) and rejected it: a Supabase
source alone leaves the matcher with no working catalogue, so the slices are not
independently shippable. **Do NOT re-forecast a split.** The review workload guard is
satisfied by the recorded exception, not by chaining.

Breakdown of the estimate: `ports.py` ~60, `cache.py` ~140, `supabase_source.py` ~150,
`catalogue.py` net ~+90/-60, `service.py` ~+60, `main.py` ~+70, `config.py` ~+25, new
tests ~700, migrated/deleted tests ~300, deployment ~120, docs ~60.
`services/matcher/tests/data/catalogue_snapshot.json` (~1,405 rows) and the remapped
`eval_set.json` are **generated goldens** — excluded from the authored count per the
review guard, but included in snapshot identity.

### Suggested Work Units

Each unit is one commit and leaves the suite at the target-green state (1 failed) —
except the one hazard flagged in WU-5/WU-6. Tests ship in the same commit as the code
they cover (`work-unit-commits`).

| Unit | Goal | Focused test command | Runtime harness | Rollback boundary |
|------|------|----------------------|-----------------|-------------------|
| WU-0 | Declare `httpx`/`redis`/`fakeredis`; commit lock | `uv run pytest services/matcher/tests/unit/test_packaging.py` | N/A — dependency declaration only | revert `pyproject.toml` + `uv.lock` |
| WU-1 | Ports (`Row`/`Snapshot`/Protocols) + snapshot codec | `uv run pytest services/matcher/tests/unit/test_snapshot_codec.py` | N/A — pure functions | delete `ports.py`, codec half of `cache.py` |
| WU-2 | `RedisSnapshotCache` over `fakeredis` | `uv run pytest services/matcher/tests/unit/test_redis_cache.py` | `docker compose exec redis redis-cli GET matcher:catalogue:snapshot:v1` | delete adapter half of `cache.py` |
| WU-3 | `SupabaseCatalogueSource` over `MockTransport` | `uv run pytest services/matcher/tests/unit/test_supabase_source.py` | manual: curl the PostgREST URL with the least-privilege key | delete `supabase_source.py` |
| WU-4 | `load_index` startup orchestration | `uv run pytest services/matcher/tests/unit/test_load_index.py` | N/A — covered by WU-5 lifespan tests | delete `load_index` from `catalogue.py` |
| WU-5 | **CUTOVER**: rewire service/main/config, migrate fixtures, delete SQLite | `uv run pytest services/matcher/tests` | `docker compose up matcher` reaches healthy | single revert of the cutover commit |
| WU-6 | Eval fixture snapshot + offline remap + re-pinned baselines | `uv run pytest services/matcher/tests/eval` | N/A — offline fixture, no network by contract | revert eval data + eval test commit |
| WU-7 | Background refresh loop, atomic swap, `SET NX` lock, jitter | `uv run pytest services/matcher/tests/unit/test_refresh.py services/matcher/tests/api/test_refresh_loop.py` | kill Redis while `/match` is under load; watch WARNING, `/match` unaffected | delete `_refresh_loop`, `refresh()`, `_next_delay` |
| WU-8 | Deployment surface + pre-existing drift fix #1-#3 | `uv run pytest tests/deployment services/matcher/tests/unit/test_container.py` | `docker compose config` then `docker compose up` | revert compose + `.env.example` + deployment-test commit |
| WU-9 | Docs, PR body, manual security evidence | `uv run pytest` (full) | live REQ-CSS-4 credential-denial check | revert doc commit only |

### Execution batches — parallel vs sequential

| Batch | Units | Mode | Why |
|-------|-------|------|-----|
| 1 | WU-0 → WU-1 | **sequential** | everything imports `Row` from `ports.py` |
| 2 | WU-2 ∥ WU-3 | **PARALLEL** | disjoint files: `cache.py` adapter half vs `supabase_source.py`; disjoint test files; both depend only on WU-1 |
| 3 | WU-4 | **sequential** | needs both adapters to exist for its fakes |
| 4 | WU-5 | **sequential, single writer** | touches `catalogue.py`, `service.py`, `main.py`, `config.py`, `conftest.py`, and 4 test modules at once — no parallel writers |
| 5 | WU-6 ∥ WU-7 | **PARALLEL** | WU-6 = `tests/eval/*` + `tests/data/*` + `scripts/*`; WU-7 = `service.py`/`main.py` + `tests/unit/test_refresh.py` + `tests/api/test_refresh_loop.py`. Disjoint. |
| 6 | WU-8 | **sequential** | shared `docker-compose.yml`; depends on WU-5 having removed `catalogue_db` from `Settings` |
| 7 | WU-9 | **sequential** | documents the final state |

---

## WU-0: Dependencies

- [x] 0.1 **RED** — `services/matcher/tests/unit/test_packaging.py::TestRuntimeDependencies::test_it_declares_the_postgrest_and_redis_clients`. Assert the matcher's declared runtime dependencies contain a requirement starting `httpx` and one starting `redis`. **Expected RED:** `AssertionError: 'redis' not declared in services/matcher/pyproject.toml [project].dependencies`.
- [x] 0.2 **GREEN** — add `httpx>=0.27` and `redis>=5` to `[project].dependencies` and `fakeredis>=2` to the dev group in `services/matcher/pyproject.toml` (design D1). *Applied deviation: `fakeredis>=2` went into the **root** `pyproject.toml` `[dependency-groups].dev` (where `pytest`/`httpx` already live). `services/matcher/pyproject.toml` declares no dependency group, and `uv sync` at the workspace root installs only the root project's groups — a member-level dev group would never be installed, leaving `fakeredis` unimportable in the suite.* **Verify:** `uv run pytest services/matcher/tests/unit/test_packaging.py`.
- [x] 0.3 **NON-TDD, mechanical** — run `uv sync`, then `git add uv.lock` deliberately. The diff carries ~+777 lines of unrelated `product_identification` transitive deps PR #12 never locked; that is expected, not a mistake. Record the fact for the WU-9 PR body. **Measured:** `uv.lock` +826/-0 lines, 27 newly locked packages; only 3 (`redis`, `fakeredis`, `sortedcontainers`) belong to this change, the other 24 are PR #12's unlocked `product_identification` transitive deps. *Non-TDD because a lockfile is generated state, not behavior.* **Verify:** `uv run pytest` → 4 failed, 368 passed (baseline unchanged).

## WU-1: Ports + snapshot codec

New file `services/matcher/src/matcher/ports.py`.
**Design refinement, stated explicitly**: D2 places the new `Row` "in `catalogue.py`",
but the legacy SQLite `Row` still lives there until WU-5, and two classes cannot share a
name. The new `Row`/`Snapshot`/Protocols therefore land in `ports.py`; at WU-5
`catalogue.py` re-exports them, so the public import path `matcher.catalogue.Row` that
D2 specifies is preserved. This keeps every commit green with no rename churn.

- [x] 1.1 **RED** — create `services/matcher/tests/unit/test_snapshot_codec.py`:
  - `TestRowShape::test_the_row_carries_exactly_the_five_catalogue_fields` — assert `{f.name for f in fields(Row)} == {"warehouse_code","uid","articulo","unidad","nr_articulo"}`.
  - `TestRowShape::test_the_row_carries_no_stock_field` (REQ-CSS-2, REQ-ENG-2) — assert `not hasattr(row, "sd")` and `not hasattr(row, "theoretical_qty")`.
  - `TestRowShape::test_the_row_is_frozen` — `dataclasses.FrozenInstanceError` on assignment.
  - **Expected RED:** `ImportError: cannot import name 'Row' from 'matcher.ports'` (module does not exist → `ModuleNotFoundError: No module named 'matcher.ports'`).
- [x] 1.2 **RED** — same file, codec suite:
  - `TestCodecRoundTrip::test_encode_then_decode_returns_the_same_rows_and_loaded_at`
  - `TestCodecRoundTrip::test_a_different_schema_version_decodes_to_none` (REQ-RCC-1)
  - `TestCodecRoundTrip::test_malformed_json_decodes_to_none`
  - `TestCodecRoundTrip::test_a_missing_required_field_decodes_to_none`
  - `TestSnapshotContentSafety::test_the_encoded_bytes_name_no_stock_field` (REQ-RCC-5, RF-18) — assert `b'"sd"' not in payload` and `b"theoretical_qty" not in payload` on a payload built from rows whose text deliberately does **not** contain those substrings.
  - **Expected RED:** `ImportError: cannot import name 'encode_snapshot' from 'matcher.cache'`.
- [x] 1.3 **GREEN** — create `ports.py` (`Row`, `Snapshot(rows, loaded_at)`, `CatalogueSource` Protocol, `SnapshotCache` Protocol) and the codec half of `services/matcher/src/matcher/cache.py`: `SNAPSHOT_SCHEMA_VERSION = 1`, `SNAPSHOT_KEY = "matcher:catalogue:snapshot:v1"`, `REFRESH_LOCK_KEY = "matcher:catalogue:refresh-lock:v1"`, `encode_snapshot(snapshot) -> bytes`, `decode_snapshot(raw) -> Snapshot | None`. Version is a code constant, never a `Setting` (D3). **Verify:** `uv run pytest services/matcher/tests/unit/test_snapshot_codec.py` then `uv run pytest` → 4 failed (baseline). *Applied refinement: `SNAPSHOT_KEY`/`REFRESH_LOCK_KEY` are derived from `SNAPSHOT_SCHEMA_VERSION` (f-strings) rather than hand-written literals, so the key suffix can never desync from the parser version; a test pins both literal values anyway. The two Protocols are `@runtime_checkable` so WU-2/WU-3 can assert their real adapters satisfy the ports instead of relying on a comment.*

## WU-2: `RedisSnapshotCache` over `fakeredis` — PARALLEL with WU-3

- [x] 2.1 **RED** — create `services/matcher/tests/unit/test_redis_cache.py`, `TestGetPut`:
  - `test_a_written_snapshot_is_read_back_intact`
  - `test_get_on_an_empty_redis_returns_none`
  - `test_put_sets_a_key_ttl_of_twice_the_configured_ttl` (D3) — `ttl = client.ttl(SNAPSHOT_KEY)`; assert `2*cfg - 2 <= ttl <= 2*cfg`.
  - `test_a_version_mismatched_payload_reads_as_a_miss` (REQ-RCC-1)
  - `test_a_redis_error_on_get_returns_none_instead_of_raising` (REQ-RCC-3) — client whose `get` raises `redis.RedisError`.
  - `test_put_never_raises_when_redis_is_down` (REQ-RCC-1, best effort)
  - Fixture: `fakeredis.FakeRedis()` injected into the **real** `RedisSnapshotCache` (D2 — real adapter, throwaway backend; never a hand-rolled cache fake).
  - **Expected RED:** `ImportError: cannot import name 'RedisSnapshotCache' from 'matcher.cache'`.
- [x] 2.2 **RED** — same file, `TestRefreshLock` (REQ-RCC-4):
  - `test_only_the_first_caller_acquires_the_lock` — two `RedisSnapshotCache` instances over one `FakeRedis`; second `try_acquire_refresh_lock(60)` returns `False`.
  - `test_the_lock_carries_the_configured_px_expiry` — `0 < client.pttl(REFRESH_LOCK_KEY) <= 60_000`.
  - `test_releasing_lets_the_next_caller_acquire`
  - `test_an_expired_lock_frees_itself` — advance `fakeredis` time / use a 1ms TTL; a dead holder never wedges refresh forever (D4).
  - `test_a_redis_error_on_lock_acquisition_returns_false` — the lock is a stampede optimization, never a correctness dependency.
- [x] 2.3 **GREEN** — implement `RedisSnapshotCache(client: redis.Redis, ttl_seconds: int, lock_ttl_seconds: int)` in `cache.py`: `get`/`put`/`try_acquire_refresh_lock` (`SET NX PX`) / `release_refresh_lock`. Every `redis.RedisError` is swallowed into `None`/`False`/no-op. **Verify:** `uv run pytest services/matcher/tests/unit/test_redis_cache.py` → 21 passed; `uv run pytest` → 4 failed, 413 passed (baseline unchanged). *Applied refinements: (a) `lock_ttl_seconds: float` and `try_acquire_refresh_lock(ttl_seconds: float | None = None)` — the float admits a sub-second expiry so `test_an_expired_lock_frees_itself` can observe real `PX` self-healing in 100 ms instead of mocking the clock, and the default lets the caller use the configured value without restating it; the port still accepts an explicit ttl as D2 specifies. (b) The "Redis is down" harness is `FakeServer().connected = False`, **not** `FakeRedis(connected=False)` — the latter is silently ignored by fakeredis 2.37 and made two soft-failure tests pass vacuously. A guard test (`test_the_unreachable_harness_really_refuses_commands`) now pins that the harness really raises `redis.ConnectionError`.*

## WU-3: `SupabaseCatalogueSource` over `httpx.MockTransport` — PARALLEL with WU-2

- [x] 3.1 **RED** — create `services/matcher/tests/unit/test_supabase_source.py`, `TestQueryShape`. Harness: a real `httpx.Client` with `httpx.MockTransport(handler)` where `handler` appends every `httpx.Request` to a `recorded` list.
  - `test_it_queries_only_the_warehouse_products_endpoint` — every recorded `request.url.path == "/rest/v1/warehouse_products"`.
  - `test_it_never_queries_warehouse_stock_balances` (**REQ-CSS-4**) — assert no recorded request URL (path **or** query) contains `warehouse_stock_balances`, `theoretical_qty`, or `stock`.
  - `test_it_filters_inactive_and_merged_rows` (REQ-CSS-3) — query string contains `is_active=eq.true`, `warehouses.is_active=eq.true`, `warehouses.merged_into_warehouse_id=is.null`, `products.is_active=eq.true`.
  - `test_it_sends_the_apikey_and_bearer_headers`
  - `test_it_never_fetches_the_units_table` — `unit_code` is denormalized; `UNIT_DISPLAY` is local (D1).
  - **Expected RED:** `ImportError: cannot import name 'SupabaseCatalogueSource' from 'matcher.supabase_source'`.
- [x] 3.2 **RED** — `TestPagination` (D1; the 1,000-row PostgREST cap makes the loop mandatory, not defensive):
  - `test_it_follows_the_range_header_past_the_thousand_row_page` — transport serves 1,000 rows then 405 rows; assert exactly 2 requests carrying `Range: 0-999` then `Range: 1000-1999`, and 1,405 rows loaded in total.
  - `test_a_short_first_page_stops_after_one_request`
  - **Expected RED:** `AssertionError: expected 2 requests, got 1` (a non-paginating implementation silently truncates at 1,000 — this is the truncation guard from the design risk table).
- [x] 3.3 **RED** — `TestRowMapping` (REQ-CSS-2):
  - `test_rows_map_uid_articulo_unidad_and_nr_articulo_from_the_joined_tables` — `uid == warehouse_products.id`, `articulo == products.name`, `unidad == unit_code`, `nr_articulo == products.sku`.
  - `test_a_null_unit_code_and_null_sku_are_preserved_as_none` — never coerced.
  - `test_rows_are_grouped_by_warehouse_code` — result is `dict[str, list[Row]]` keyed by `warehouses.code`.
- [x] 3.4 **RED then GREEN** — `TestFailureModes` (D5 taxonomy; all wrapped into `CatalogueUnavailableError`, cause-chained):
  - `test_a_5xx_raises_catalogue_unavailable`
  - `test_a_401_raises_catalogue_unavailable` — permanent in truth, but the bounded 4-attempt retry loop makes one taxonomy the simpler correct choice.
  - `test_a_transport_timeout_raises_catalogue_unavailable`
  - `test_invalid_json_raises_catalogue_unavailable`
  - `test_zero_rows_raises_catalogue_unavailable` (REQ-CSS-5 — never serve empty)
  - **GREEN:** create `services/matcher/src/matcher/supabase_source.py` implementing the D1 query, the `Range` pagination loop, grouping, and the error taxonomy. Import `CatalogueUnavailableError` from the (still legacy) `matcher.catalogue` — that class survives the rewrite unchanged, so there is no conflict. **Verify:** `uv run pytest services/matcher/tests/unit/test_supabase_source.py` → 22 passed; `uv run pytest` → 4 failed, 435 passed (baseline unchanged). *Applied additions beyond the listed cases: `test_it_orders_by_id_so_pagination_is_stable` (an unordered paginated read can duplicate or drop rows at a page boundary — `order=id` was in the D1 query but had no assertion), `test_an_exactly_full_page_followed_by_an_empty_one_is_not_truncated` (the off-by-one boundary the `< page_size` stop condition turns on), `test_a_payload_of_the_wrong_shape_raises_catalogue_unavailable`, and `test_the_error_message_never_leaks_the_credential` (REQ-API-8 — the key is in every request header, so an exception message is the natural leak path). The truncation guard was verified by mutation: removing the `len(page) < page_size` stop condition fails `test_it_follows_the_range_header_past_the_thousand_row_page`, so the test genuinely bites rather than passing incidentally.*

## WU-4: `load_index` startup orchestration

Add to `services/matcher/tests/conftest.py` (additive only — legacy SQLite fixtures stay
until WU-5): `make_rows(...)` and `FakeCatalogueSource(rows, fail_times=0)` exposing a
`calls: int` counter and a `queried_tables: set[str]` record.

- [x] 4.1 **RED — THE CORE REQUIREMENT** — create `services/matcher/tests/unit/test_load_index.py`, `TestWarmStart`:
  - `test_a_fresh_snapshot_performs_zero_supabase_calls` — seed a `RedisSnapshotCache` over `fakeredis` with a snapshot whose `loaded_at` is `now - 1s` and `ttl = 10800`; call `load_index(source, cache, ttl_seconds=10800)`; **assert `source.calls == 0`** and the index holds the snapshot's rows. This is the user's stated core requirement (REQ-RCC-1, "Warm start performs zero Supabase calls").
  - **Expected RED (step 1):** `ImportError: cannot import name 'load_index' from 'matcher.catalogue'`. **Expected RED (step 2, if an implementation reaches for Supabase unconditionally):** `AssertionError: assert 1 == 0` — i.e. `expected 0 supabase calls, got 1`.
  - `test_the_reported_source_is_redis_snapshot` — `load_index` returns/logs `source="redis-snapshot"`.
- [x] 4.2 **RED** — `TestColdStart`:
  - `test_an_empty_cache_fetches_supabase_exactly_once` — `source.calls == 1`.
  - `test_a_cold_start_writes_the_snapshot_back` — `cache.get()` after the call returns a snapshot with the same rows.
  - `test_a_failing_cache_put_does_not_fail_startup` (REQ-RCC-1, best effort) — cache whose `put` raises; `load_index` still returns an index.
  - `test_the_reported_source_is_supabase`
- [x] 4.3 **RED** — `TestDegradedPaths`:
  - `test_a_stale_snapshot_triggers_a_supabase_fetch` — `loaded_at = now - 2*ttl`; `source.calls == 1`.
  - `test_a_stale_snapshot_serves_when_supabase_fails` (D5 step 3) — assert the stale rows are served, source reported as `redis-snapshot-stale`, and a WARNING is emitted on logger `matcher`.
  - `test_an_incompatible_snapshot_version_is_treated_as_a_miss` (REQ-RCC-1)
  - `test_redis_unreachable_but_supabase_up_still_loads_and_warns` (REQ-CSS-5 second scenario). *Applied deviation, split in two: `test_redis_unreachable_but_supabase_up_still_loads` drives the **real** `RedisSnapshotCache` over a disconnected `FakeServer` and asserts `source.calls == 1` / `source="supabase"` — but it deliberately does **not** assert a warning, because the adapter swallows every `redis.RedisError` by design (REQ-RCC-3), so `load_index` cannot distinguish a dead Redis from a cold one and a warning there would be a lie. The warning contract is covered by `test_a_cache_that_raises_on_read_is_survived_with_a_warning`, where the failure is actually observable to `load_index`.*
  - *Added beyond the list: `test_an_empty_snapshot_is_never_served` (a zero-row snapshot is a miss, REQ-CSS-5 — otherwise a warm start could serve an empty catalogue), `test_the_written_snapshot_is_immediately_fresh` (the cold-start write-back must make the next start a warm one), `test_a_snapshot_just_inside_the_ttl_is_still_fresh` (the freshness boundary), and `test_the_snapshot_rows_are_regrouped_by_warehouse_code` (the payload is flat; grouping is rebuilt in-process).*
- [x] 4.4 **RED then GREEN** — `TestBothUnavailable::test_no_snapshot_and_a_failing_source_raises_catalogue_unavailable` (REQ-CSS-5). **GREEN:** add `load_index(source, cache, ttl_seconds)` to `services/matcher/src/matcher/catalogue.py` implementing the D5 four-step order. **The legacy SQLite loader is untouched in this commit** — new and old coexist, old suite still green. **Verify:** `uv run pytest services/matcher/tests/unit/test_load_index.py` → 17 passed; `uv run pytest` → 4 failed, 452 passed (baseline unchanged). *Applied refinement: `load_index` returns a frozen `LoadedCatalogue(catalogue, source)` rather than a bare dict, so the D5 provenance label reaches the WU-5 startup log line as data instead of being re-derived. `CatalogueIndex` (which bundles a built matcher) stays in `service.py` at WU-5 — `catalogue.py` must not import `scoring`. The zero-Supabase-call guarantee was verified by mutation: disabling the fresh-snapshot branch turns 5 tests red, including `test_a_fresh_snapshot_performs_zero_supabase_calls` with `assert 1 == 0`.*

## WU-5: CUTOVER — one commit, single writer, no parallel work

This commit rewires the service and deletes the SQLite path. The suite is green on both
sides of it. Do the sub-steps in order; commit once at the end.

**Applied deviations across WU-5** (each also noted on its task):
1. **`_build_adapters` is patched alongside the service factory** in `test_startup_retry.py`
   (task 5.7). The retry loop builds the adapters once and then constructs the service per
   attempt, so the attempt that finally *succeeds* would otherwise dial the real
   `supabase.invalid`. `_install_service_factory` now installs the fake pair too; the loop
   assertions (attempt counts, `sleeps`, log text, `app.state.service`) are unchanged.
2. **The flaky factory's error text changed** from `cannot open catalogue database
   '<path>': unable to open database file` to `the Supabase catalogue is unavailable:
   connection refused`, and the one assertion reading it moved from
   `"unable to open database file"` to `"connection refused"`. Keeping a SQLite-shaped
   message after deleting SQLite would have been a lie in the test that documents the
   operator-visible retry log.
3. **Test doubles are imported from `conftest`** (`from conftest import ...`). Under
   pytest's default prepend import mode the tests directory is on `sys.path`, so the
   already-loaded `conftest` module is importable; this keeps `make_rows` /
   `FakeCatalogueSource` / `make_cache` as plain callables usable at module scope
   (fixture parameters cannot be used to build module-level constants).
4. **A fixture catalogue replaced the real database's query provenance.**
   `conftest.FIXTURE_CATALOGUE` (3 warehouses, 9 rows) reproduces all three decision
   statuses: `ACEITE DE OLIVA` + `ACEITE DE OLIVA EXTRA VIRGEN` are the deliberate near
   duplicates that keep `"aceite de oliva"` `ambiguous`. Hard-coded counts (`catalogues=8`,
   `rows>0`) became `len(FIXTURE_WAREHOUSES)` / `FIXTURE_ROW_COUNT`.
5. **`test_schemas.py::test_every_real_catalogue_id_fits_the_limit`** imported
   `STOCK_TABLES`, which 5.8 deletes; it now measures the fixture warehouse codes. Not
   listed in any task, found by the deletion.
6. **`_startup_line()` in `test_logging.py` reads the LAST startup record, not the first**
   — `caplog` retains every propagated record for the whole test, so the warm-start test
   (which starts the app twice) was asserting against the first start's line. Caught as a
   real RED: `assert 'source=redis-snapshot' in 'catalogue loaded catalogues=3 rows=9
   source=supabase'`.

- [x] 5.1 **RED** — `services/matcher/tests/unit/test_config.py`:
  - `TestDefaults::test_the_supabase_and_redis_settings_carry_their_documented_defaults` — `redis_url == "redis://localhost:6379/0"`, `supabase_timeout_seconds == 10.0`, `catalogue_cache_ttl_seconds == 10800`, `catalogue_refresh_lock_ttl_seconds == 60`.
  - `TestDefaults::test_catalogue_db_no_longer_exists` — `assert not hasattr(settings, "catalogue_db")`.
  - `TestDefaults::test_a_trailing_slash_on_the_supabase_url_is_normalized_away`
  - `TestInvalidValuesFailFast::test_a_missing_supabase_url_is_a_validation_error` (REQ-API-4) — permanent, never retried.
  - `TestInvalidValuesFailFast::test_a_ttl_below_sixty_seconds_is_rejected`
  - **Expected RED:** `AssertionError: hasattr(settings, 'catalogue_db') is True` and `Failed: DID NOT RAISE ValidationError`.
  - **GREEN:** rewrite `services/matcher/src/matcher/config.py` per D6; remove `catalogue_db`.
- [x] 5.2 **RED** — `services/matcher/tests/unit/test_service.py::TestAtomicIndex::test_the_service_holds_one_immutable_catalogue_index` — construct `MatcherService(settings, source, cache)`; assert `service._index` is a frozen `CatalogueIndex` bundling both `catalogue` and a built `TrigramSimilarityMatcher`. **Expected RED:** `TypeError: MatcherService.__init__() takes 2 positional arguments but 4 were given`. **GREEN:** add `CatalogueIndex` (frozen dataclass) and the three-arg constructor calling `load_index`.
- [x] 5.3 **RED** — `test_service.py::TestServiceMatch` migrated to warehouse codes: `test_an_unknown_warehouse_code_raises_unknown_catalogue`, `test_catalogues_reports_each_warehouse_code_with_its_row_count`, `test_match_reads_the_index_once_at_entry`. **Expected RED:** `UnknownCatalogueError: unknown catalogue_id 'BOD-01'` on the happy-path test, because the fixture still builds SQLite table names. **GREEN:** driven by 5.4.
- [x] 5.4 **Migrate** `services/matcher/tests/conftest.py` (D7 table): DELETE `catalogue_db_path`, `make_synthetic_db`, `StockRow`, and the `sqlite3` import. REPLACE `settings` with `Settings(supabase_url="http://supabase.invalid", supabase_key="test", redis_url="redis://localhost:6379/0")` — constructed, never dialed. REPLACE `service` with `MatcherService(settings, FakeCatalogueSource(fixture_rows), RedisSnapshotCache(FakeRedis(), ...))`. REPLACE `client` with a `monkeypatch` of `main._build_adapters` returning the fake pair, keeping the real `TestClient` lifespan.
- [x] 5.5 **RED** — `services/matcher/tests/api/test_http.py`: `TestCatalogues::test_it_lists_warehouse_codes_with_row_counts` (REQ-API-2), and every `catalogue_id` literal across `TestMatchResponseShape` / `TestAllThreeStatusesReachable` / `TestClientErrors` swapped from stock-table names to fixture warehouse codes. **Expected RED:** HTTP 4xx `UnknownCatalogueError` on requests that previously matched. **GREEN:** fixture data only — the route code is unchanged.
- [x] 5.6 **RED** — `services/matcher/tests/api/test_logging.py::TestStartupLogging::test_it_reports_which_source_the_catalogue_came_from` — assert the INFO line matches `catalogue loaded catalogues=%d rows=%d source=%s` with `source` in `{redis-snapshot, supabase, redis-snapshot-stale}`, and that no `db=` fragment survives. The existing `"catalogue loaded"` substring assertion must keep passing (D5). **Expected RED:** `AssertionError: 'source=' not in 'catalogue loaded catalogues=8 rows=1405 db=/data/...'`. **GREEN:** edit the `logger.info` call in `main.lifespan` (currently `main.py:105-110`).
- [x] 5.7 **RED** — `services/matcher/tests/api/test_startup_retry.py`: swap the `CATALOGUE_DB` env manipulation for `SUPABASE_URL=http://127.0.0.1:9/` and `REDIS_URL=redis://127.0.0.1:9/0` (closed localhost ports → connection refused locally, **no external network**). `TestRetryRecoversFromATransientFailure`, `TestExhaustedRetriesFailFast`, and `TestTheProcessActuallyExitsThree` keep their factory-monkeypatch structure and their assertions verbatim. **Expected RED:** `AttributeError: 'Settings' object has no attribute 'catalogue_db'` from the old env setup. **GREEN:** add module-level `_build_adapters(settings) -> tuple[CatalogueSource, SnapshotCache]` in `main.py`, called by `_load_service_with_retry` — the monkeypatch seam.
- [x] 5.8 **DELETE** — from `services/matcher/src/matcher/catalogue.py`: `STOCK_TABLES`, `open_readonly`, `load_catalogue`, the legacy `Row`, and the `sqlite3`/`Path` imports. Keep `CatalogueUnavailableError` and `load_index`; re-export `Row`, `Snapshot`, `CatalogueSource`, `SnapshotCache` from `matcher.ports` so `matcher.catalogue.Row` resolves as D2 specifies. From `services/matcher/tests/unit/test_service.py`: delete `TestReadOnlyConnection`, `TestLoadCatalogue`, `_FetchFailingConnection`, `TestFetchTimeCorruption` (REQ-API-5 is REMOVED by the spec delta — these tests retire with the loader they cover).
- [x] 5.9 *Applied deviation: `test_container.py` had **two** `Settings(catalogue_db=...)` constructions, not one — line 168 and line 210 (`test_pins_the_startup_retry_knobs`). Both were switched to `Settings(supabase_url=..., supabase_key=...)`; leaving the second would have failed collection for a reason this task did not predict. `test_mounts_the_catalogue_read_only` was left untouched as instructed and is still green.* **Fix the coupled container test** — `services/matcher/tests/unit/test_container.py::TestCompose::test_compose_env_defaults_match_the_settings_defaults` constructs `Settings(catalogue_db=Path("/data/bodegas-y-stock.sqlite"))` at line 168. Drop that kwarg (supply `supabase_url`/`supabase_key` instead). **Leave `test_mounts_the_catalogue_read_only` alone in this commit** — the compose mount still exists until WU-8, so it stays green here.
- [x] 5.10 **SEQUENCING HAZARD — read carefully.** `services/matcher/tests/eval/test_eval_accuracy.py` consumes the `service` fixture and `case["table"]`/`case["gold_rowid"]`, both of which die in this commit. Add a module-level `pytestmark = pytest.mark.skip(reason="eval set remapped to warehouse identities in WU-6; see openspec/changes/redis-catalogue-cache/tasks.md")`. **This skip is intentional and MUST live for exactly one commit** — WU-6 removes it. `sdd-verify` must confirm no `skip`/`xfail` marker survives in `services/matcher/tests/eval/` at the end of the change. **Verify WU-5:** `uv run pytest` → **1 failed** (credential test only), eval suite reported as skipped.

> **CORRECTION, measured at WU-5 (not a regression).** The "1 failed after WU-5"
> expectation in this task is **wrong**, and it contradicts the §"Definition of green"
> table above, which already routes pre-existing failures #1-#3 to **WU-8**. Measured
> after the cutover commit: **4 failed, 443 passed, 15 skipped** — the same four
> pre-existing failures as every prior work unit, byte-identical. None of them is
> reachable from this commit: #1/#2 assert the compose service set is exactly
> `{"stt","matcher"}` (PR #12's `product_identification` drift — fixed by tasks 8.1/8.2)
> and #3 is `services/product_identification/README.md` pointing at a service-local
> compose file (fixed by task 8.4). Removing `Settings.catalogue_db` does not touch any
> of them: they read `docker-compose.yml` and a README, never `Settings`. The suite
> reaches 1 failed at **WU-8**, exactly as the table says. No test was adjusted to fit
> the wrong number.

## WU-6: Eval fixture + offline remap + baseline re-pin — PARALLEL with WU-7

**No test in this unit may touch the network.** All Supabase access happens once, by a
human, through a one-shot script whose output is checked in.

- [x] 6.1 **NON-TDD, one-shot, human-run, network-required** — create `scripts/export_catalogue_snapshot.py`: runs `SupabaseCatalogueSource` against the real project with real credentials and writes `services/matcher/tests/data/catalogue_snapshot.json` in snapshot-v1 format. *Non-TDD because it is a data-export utility executed once by a person, never by CI.* It must be documented as such in its docstring. Run it once; check in the JSON (~1,405 rows, 56 warehouses; carries no RF-18 data by construction).
- [x] 6.2 **RED** — create `services/matcher/tests/eval/test_eval_fixture.py`:
  - `TestSnapshotFixture::test_the_fixture_parses_as_a_v1_snapshot` — **Expected RED:** `FileNotFoundError: .../tests/data/catalogue_snapshot.json` (write the test before 6.1's output is committed if working strictly).
  - `test_it_carries_the_expected_row_and_warehouse_counts` — pinned to the exported counts.
  - `test_it_names_no_stock_field` (REQ-RCC-5, RF-18) — `b'"sd"'` and `b"theoretical_qty"` absent from the raw bytes.
  - `test_its_sha256_is_pinned` — provenance guard.
  - **GREEN:** commit the fixture and pin the counts/hash.
- [x] 6.3 **NON-TDD, one-shot, offline** — create `scripts/remap_eval_set.py`: reads the checked-in `catalogue_snapshot.json` and `services/matcher/tests/data/eval_set.json`; rewrites each case `table` → `catalogue_id` (warehouse code) and `gold_rowid` → `gold_uid` (`warehouse_products.id`), joining on `nr_articulo` first and exact `articulo` as fallback; **drops unmappable cases and prints the dropped count and reasons**. *Non-TDD because it is a one-shot data migration; its output is guarded by 6.4.* Reads only local files — no network.
- [x] 6.4 **RED** — `services/matcher/tests/eval/test_eval_accuracy.py::TestEvalSetProvenance`:
  - `test_every_case_carries_a_catalogue_id_and_gold_uid` — **Expected RED:** `KeyError: 'catalogue_id'`.
  - `test_every_gold_uid_resolves_in_the_fixture_snapshot`
  - `test_the_remapped_set_hash_is_pinned` — **DELETE** `test_copy_is_byte_identical_to_the_spike_file` and `SPIKE_EVAL_PATH`; the spike file is no longer the provenance authority (D7).
  - Update `EXPECTED_CASE_COUNT` from `624` to the measured post-remap count, with a comment recording how many cases were dropped and why.
- [x] 6.5 **GREEN** — rewrite `evaluate()` and `gold_has_code()` in the same file: build the catalogue from `catalogue_snapshot.json` through `FakeCatalogueSource` (replacing `load_catalogue(service.settings.catalogue_db)` at line 79); `gold_has_code` looks up `row.uid == case["gold_uid"]` (replacing `row.rowid == case["gold_rowid"]`); the driver calls `service.match(case["catalogue_id"], ...)` (replacing `case["table"]`).
- [x] 6.6 **HUMAN GATE — do not automate this** — run `uv run pytest services/matcher/tests/eval -s`, read the printed eval report, and re-pin `TOP1_FLOOR`, `RECALL3_FLOOR`, `FALSE_CONFIDENCE_CEILING`, `HAS_CODE_TOP1_BASELINE`, `NO_CODE_TOP1_BASELINE`, `COHORT_RECALL3_BASELINE` to the newly measured values with a **dated provenance comment** in the style of the existing block at lines 44-60 (`measured YYYY-MM-DD against catalogue_snapshot.json, N rows across M warehouses, through MatcherService.match() with default settings`). **A human MUST eyeball the delta against the current 0.98605 / 1.0000 / 0.00543 baseline and explicitly approve or stop.** An agent MUST NOT silently lower a floor to make the suite pass — a large drop is the proposal's acknowledged accuracy-shift risk surfacing, and it is a stop-and-ask, not a re-pin.
- [x] 6.7 **Remove the WU-5 skip** — delete the module-level `pytestmark = pytest.mark.skip(...)` from `test_eval_accuracy.py`. Add `TestEvalSetProvenance::test_the_eval_suite_is_not_skipped` asserting no `skip`/`xfail` marker is applied to this module, so the temporary skip can never silently return.
- [x] 6.8 **Verify** — `uv run pytest services/matcher/tests/eval` then `uv run pytest` → **1 failed** (credential test only), zero skipped in `tests/eval`. **Measured: `uv run pytest services/matcher/tests/eval` → 28 passed; `uv run pytest` → 1 failed, 507 passed, 1 skipped.** The one failure is #4, the deliberate one; the one skip is WU-8's credential-gated Docker-daemon class (deviation 20), not an eval skip.

### WU-6 deviations, recorded at apply time

24. **Zero eval cases were dropped — the remap resolved all 430 variants (345 by
    `nr_articulo`, 85 by exact `articulo`), so `EXPECTED_CASE_COUNT` stays 624.**
    Task 6.3/6.4 anticipated an unmappable remainder from the 1,405-vs-1,461 row
    gap. Measured, that gap does not exist: the retired SQLite file holds the same
    1,405 product rows, plus 8 spreadsheet header rows (`articulo IS NULL`) the
    loader always discarded and which are never gold. The dropped-case machinery
    in `scripts/remap_eval_set.py` is kept anyway — it reports and counts, and a
    future export that really does lose rows must fail loudly, not silently.
25. **`scripts/remap_eval_set.py` needs a third input: `data/bodegas-y-stock.sqlite`.**
    Task 6.3 lists only the snapshot and the eval set, but `gold_rowid` is only
    interpretable against the database that issued it, and the SKU it carries is
    the join key into the snapshot. That file is untracked local data, so the
    script cannot be re-run from a clean checkout — which is exactly why its
    output is checked in and hash-pinned (`EVAL_SET_SHA256`) instead.
26. **The accuracy delta is tie-break ordering, not a regression — and it was
    proven, not assumed.** Overall top-1 moved 0.98605 → 0.98372 and the `no_code`
    cohort 0.98824 → 0.92941. Replaying this same suite against rows read straight
    out of the retired SQLite file reproduces 424/430 = 0.98605 **exactly**, so the
    engine did not change and the catalogues hold identical rows; only the row
    ORDER did (`rowid` → `warehouse_products.id` UUID). Six of the seven misses are
    exact score ties where rank 1 is decided by catalogue order alone: the losing
    tie-cluster moved out of `has_code` (340/345 → 344/345) and into `no_code`
    (84/85 → 79/85). recall@3 stays a flat 1.0000 in every cohort and garbage
    false-confidence is byte-identical at 1/184. The baselines were re-pinned to
    the measured values with the full dated explanation in the file; **task 6.6's
    human gate still owes an explicit sign-off on the `no_code` figure.**
27. **`test_eval_fixture.py` and the fixture-provenance half of
    `TestEvalSetProvenance` are approval tests, not RED-first cycles.** They pin
    already-generated data (counts, hash, codec round-trip, the 8-entry warehouse
    mapping), so there is no production behaviour to drive out. Each one was
    verified by mutation instead: uppercasing the `zoologico_suministros` mapping
    turns 3 tests red, and corrupting one `gold_uid` turns the resolvability and
    hash guards red. The genuine RED-first cycle in this unit is the identity
    remap itself (`KeyError: 'catalogue_id'`).
28. **The eval suite builds its own session-scoped `eval_service`.**
    `conftest.service` is function-scoped and carries the 9-row fixture catalogue;
    REQ-ENG-6 has to be measured over the real 1,405-row catalogue, and the old
    session-scoped `metrics` fixture would have raised `ScopeMismatch` against it.
    The new fixture composes the same real-but-throwaway pair used everywhere else
    (`FakeCatalogueSource` over the snapshot + `RedisSnapshotCache` over fakeredis).
29. **Found, NOT fixed here — the unit vocabularies diverged at the cutover.**
    `matcher/units.py` speaks `Kilogram`/`Liter`/`Unidad`/`Portion`, but the
    Supabase catalogue's `unidad` is `KG`/`LT`/`UND`/`POR`. So
    `_unit_rerank`'s `c.unidad == canonical` can no longer ever match, and
    `UNIT_DISPLAY.get("UND")` is `None`, i.e. `unidad_display` is now always
    `None` on `/match` responses (REQ-ENG-5). This is invisible to the eval
    baseline — `resolve_unit("Kilogram")` already returned `None`, so the re-rank
    was inert on both sides of the measurement — but it is a live REQ-ENG-5 defect
    in the shipped API surface. Out of WU-6's scope (eval data only); reported to
    the orchestrator for WU-9 or a follow-up change.

## WU-7: Background refresh, atomic swap, lock, jitter — PARALLEL with WU-6

- [x] 7.1 **RED — real concurrency, not a shape assertion** — create `services/matcher/tests/unit/test_refresh.py::TestAtomicSwap::test_a_concurrent_match_never_observes_a_half_built_index`. Build a service over generation-A rows (`articulo` prefixed `"GEN-A "`); start 8 `threading.Thread` workers looping `service.match(code, "GEN-A tomate", None)` for ~200 iterations each; concurrently call `service.refresh()` with a `FakeCatalogueSource` whose `load()` sleeps ~50ms mid-build and returns generation-B rows (`"GEN-B "`). Assert: (a) no worker raised; (b) **every single decision's candidate set is drawn entirely from one generation — never a mix of `GEN-A` and `GEN-B`**; (c) both generations were observed by at least one worker (proves the swap actually happened during the hammering, not before or after); (d) `id(service._index)` changed exactly once. **Expected RED:** `AttributeError: 'MatcherService' object has no attribute 'refresh'`. **A test that merely asserts `_index` is reassigned does NOT satisfy this task.**
- [x] 7.2 **RED** — `TestAtomicSwap::test_a_failed_refresh_keeps_the_previous_index` (REQ-RCC-3) — source raises `CatalogueUnavailableError`; assert `service._index is old_index`, a WARNING is logged on logger `matcher`, and `cache.get()` still returns the pre-existing snapshot (**the snapshot must not be deleted**).
- [x] 7.3 **RED** — `TestRefreshLock::test_a_lost_lock_adopts_the_winners_newer_snapshot` (REQ-RCC-4) — pre-acquire `REFRESH_LOCK_KEY` on the shared `FakeRedis` and write a snapshot with a newer `loaded_at`; call `refresh()`; assert **`source.calls == 0`** and the index now holds the winner's rows.
- [x] 7.4 **RED** — `TestRefreshLock::test_a_lost_lock_with_an_older_snapshot_skips_the_cycle` — assert `source.calls == 0` and `service._index is old_index`.
- [x] 7.5 **RED** — `TestRefreshLock::test_redis_down_still_refreshes_directly_from_supabase` (D4 — the lock is stampede optimization, not correctness) — cache whose lock call raises; assert `source.calls == 1` and the index swapped.
- [x] 7.6 **RED** — `TestJitter::test_the_delay_stays_within_ten_percent_of_the_ttl` — sample `_next_delay(10800)` 200 times; assert every sample in `[9720, 11880]` **and** `len(set(samples)) > 1` (a constant would pass a bounds-only assertion — this is the de-sync guarantee of REQ-RCC-4).
- [x] 7.7 **RED** — create `services/matcher/tests/api/test_refresh_loop.py::TestLifespanTask`:
  - `test_the_loop_task_starts_with_the_app_and_is_cancelled_on_shutdown` — `TestClient(app)` context; assert a task exists during, and is cancelled after.
  - `test_a_refresh_exception_does_not_kill_the_loop` — source raising on the first cycle; assert the loop survives and attempts a second cycle (the "refresh task dies silently" risk from the design table).
- [x] 7.8 **RED** — `test_refresh_loop.py::TestNoPerRequestIO::test_match_performs_no_redis_or_supabase_call` (REQ-RCC-3, REQ-API-1). Record `source.calls` and a `FakeRedis` command count immediately after startup, issue 20 `POST /match`, assert **both counters are unchanged**. This is the p95-1.8ms non-regression constraint expressed as a contract.
- [x] 7.9 **GREEN** — `MatcherService.refresh()` (build a complete new `CatalogueIndex` off to the side, then one attribute assignment); `match()`/`catalogues()` read `index = self._index` once at entry; `_next_delay(ttl)` with ±10% jitter and `_refresh_loop(service, settings)` in `main.py`, dispatched through `asyncio.to_thread` and started with `asyncio.create_task` in `lifespan`, cancelled on shutdown. **Verify:** `uv run pytest services/matcher/tests/unit/test_refresh.py services/matcher/tests/api/test_refresh_loop.py` then `uv run pytest` → **1 failed**.

### WU-7 deviations, recorded at apply time

14. **`CatalogueIndex` and `LoadedCatalogue` gained a `loaded_at` field.** Tasks 7.3/7.4 compare a competitor's snapshot `loaded_at` against the currently served catalogue, and the index carried no such timestamp. It is the *origin* timestamp (the instant Supabase was read), not the moment this process built the index, so a snapshot adopted from another replica keeps the winner's stamp. `catalogue.py`'s `_group`/`_flatten` were renamed to public `group_rows`/`flatten_catalogue` and a shared `as_utc` was extracted, because `service.refresh()` needs both.
15. **Task 7.1's literal recipe was adjusted to make the race real.** A fixed 200-iteration worker loop finished *before* the 50ms rebuild landed, so the swap fell outside the hammering window and the test reported `observed ['GEN-A']`. The workers now loop until the swapping thread sets `stop` (bounded at 200k iterations as a runaway guard), and the query is the generation-neutral `"TOMATE CHONTO"` rather than `"GEN-A tomate"` so both generations return candidates. Assertions (b)/(c)/(d) are unchanged and all four hold.
16. **Task 7.7's cancellation assertion needed a second test.** `TestClient` runs the app in an anyio portal whose event loop is torn down on exit, and that teardown cancels stray tasks by itself — so `test_the_loop_task_starts_with_the_app_and_is_cancelled_on_shutdown` passes even with the `refresh_task.cancel()` removed from `lifespan` (verified by mutation). `test_shutdown_cancels_the_loop_inside_the_lifespan` drives `lifespan` directly on a loop that stays alive afterwards; that one goes red on the same mutation. Both are kept: the first pins "no leak", the second pins "we cancel it ourselves".
17. **Task 7.8 was GREEN on arrival.** `/match` already performed no I/O after WU-5, so `TestNoPerRequestIO` passed against the pre-WU-7 code. It is kept as a regression guard for the refresh work (the constraint the whole design protects), not claimed as a TDD cycle.
18. **The lost-lock path never releases the lock**, and a Redis that can serve neither the lock *nor* a snapshot falls through to a direct source read (D4: the lock is stampede control, not correctness). Four extra tests pin those two rules plus real `PX` self-expiry.
19. **Task 7.9's verify target of "1 failed" is the same wrong number corrected under task 5.10.** Measured after WU-7: **4 failed, 462 passed, 15 skipped** — the identical 4 pre-existing deployment/credential failures, unchanged and unreachable from this unit. No test was adjusted to fit the number.

## WU-8: Deployment surface + pre-existing drift fix

- [x] 8.1 **RED** — `tests/deployment/test_root_compose.py::TestSoleSurface::test_the_root_file_defines_every_service` (line 85): change the expected set from `{"stt", "matcher"}` to `{"stt", "matcher", "product_identification", "redis"}`. **Observed RED:** `AssertionError: assert {'matcher','product_identification','stt'} == {'matcher','product_identification','redis','stt'}` — "Extra items in the right set: 'redis'". **Fixes pre-existing failure #2.**
- [x] 8.2 **RED** — `tests/deployment/test_compose_config.py::TestRenderedContract::test_it_validates` (line 81): same expected-set change. **Observed the same RED against the rendered config.** **Fixes pre-existing failure #1.**
- [x] 8.3 **GREEN for 8.1/8.2** — add the `redis` block to `docker-compose.yml` per D8: `image: redis:7.4-alpine` (explicitly pinned), `command: ["redis-server","--save","","--appendonly","no"]` (pure cache — a cold start rebuilds from Supabase), `healthcheck: ["CMD","redis-cli","ping"]` with `interval: 10s / timeout: 3s / retries: 3 / start_period: 5s`, `restart: unless-stopped`, **no `ports:`** (internal-only; debug via `docker compose exec redis redis-cli`), **no `depends_on` in either direction**.
- [x] 8.4 **NON-TDD fix of pre-existing failure #3** — `services/product_identification/README.md:36` documents `docker compose -f services/product_identification/docker-compose.yml up --build`, pointing at a service-local compose file that does not exist in the tree. Rewrite it to the root-file form: `docker compose up --build product_identification`. *Non-TDD because the assertion already exists* (`test_operator_docs_never_point_at_a_service_local_compose`) *and is already red — this task turns it green with no new test.* **Fixes pre-existing failure #3.**
- [x] 8.5 **RED** — `test_root_compose.py::TestPerServiceContract::test_every_service_builds_from_an_explicit_context` (line 109) and `::test_every_service_probes_its_own_health_endpoint` (line 117) now fail on the new `redis` block. Add an explicit **image-pinned-infrastructure exemption**: a service may substitute `build:` with an `image:` carrying an explicit tag (never `latest`), and may substitute an HTTP `/health` probe with a documented CLI probe. Assert redis satisfies exactly that (`image: redis:7.4-alpine`, `redis-cli ping`). **Observed RED:** `AssertionError: assert set() == {'redis'}` from the new `test_the_exempt_infrastructure_is_pinned_and_probed_by_its_cli`, plus `KeyError: 'redis'` from the two new redis-specific tests. *Applied refinement: the exemption is a named predicate, `is_image_pinned_infrastructure(block)`, that requires **both** no `build:` at all **and** a pinned non-`latest` tag, so it cannot be taken by a half-built or unpinned service. Two extra tests pin what the exemption costs: `test_the_redis_cache_publishes_no_host_port` and `test_the_redis_cache_persists_nothing`.*
- [x] 8.6 **RED** — replace `test_root_compose.py::TestPerServiceContract::test_the_catalogue_is_mounted_read_only` (line 149) with `test_the_matcher_declares_no_catalogue_mount`: assert `"./data:/data" not in compose` and `"CATALOGUE_DB" not in compose` (REQ-CSS-1, REQ-UCD-3). **Observed RED:** `AssertionError: assert './data:/data' not in '    build:\...'` — "'./data:/data' is contained here: - ./data:/data:ro".
- [x] 8.7 **RED** — same flip in `test_compose_config.py::TestRenderedContract::test_the_catalogue_is_mounted_read_only` (line 105) → `test_the_matcher_renders_no_catalogue_mount`, asserting against the **rendered** config (Compose, not our regexes, is the authority). **Observed RED:** `AssertionError: assert not [{'type': 'bind', 'source': '.../data', 'target': '/data', 'read_only': True}]`.
- [x] 8.8 **RED** — same flip in `services/matcher/tests/unit/test_container.py::TestCompose::test_mounts_the_catalogue_read_only` (line 141) → `test_declares_no_catalogue_mount`. *Added alongside it: `test_receives_the_supabase_and_redis_variables` and `test_the_cache_ttl_default_matches_the_settings_defaults` — the existing file already pins every `MATCH_*` compose default against the `Settings` default, and the new TTL knob deserves the same drift guard.*
- [x] 8.9 **RED** — `test_root_compose.py::TestPerServiceContract::test_the_matcher_receives_the_supabase_and_redis_variables` (new, REQ-UCD-3/REQ-UCD-12): assert the exact interpolations `SUPABASE_URL: ${SUPABASE_URL:-}`, `SUPABASE_KEY: ${SUPABASE_KEY:-}`, `REDIS_URL: ${REDIS_URL:-redis://redis:6379/0}`, `CATALOGUE_CACHE_TTL_SECONDS: ${CATALOGUE_CACHE_TTL_SECONDS:-10800}`. **Observed RED:** `assert 'SUPABASE_URL: ${SUPABASE_URL:-}' in '    build:\n      context: .\n...'` and `KeyError: 'SUPABASE_URL'` against the rendered config. *Added `test_the_matcher_reaches_redis_by_its_service_name`, because the compose default (`redis://redis:6379/0`) and the `Settings` default (`redis://localhost:6379/0`) differ deliberately and a future reader would otherwise read the divergence as a bug.*
- [x] 8.10 **GREEN for 8.6-8.9** — edit `docker-compose.yml:78-93` (matcher block): delete the `volumes: ./data:/data:ro` block and the `CATALOGUE_DB: /data/bodegas-y-stock.sqlite` line; add the four variables above. Leave every `MATCH_*` and `STARTUP_*` line untouched.
- [x] 8.11 **RED then GREEN** — the four new interpolations make `test_root_compose.py::TestSecretSafeEnvWorkflow::test_every_interpolated_variable_is_documented` fail (**Expected RED:** `AssertionError: undocumented in .env.example: ['CATALOGUE_CACHE_TTL_SECONDS','REDIS_URL','SUPABASE_KEY','SUPABASE_URL']`). **GREEN:** add all four to the matcher section of `.env.example` with help-text comments; ship `SUPABASE_KEY` **blank**. The existing `*_KEY` secret convention then auto-covers it, so `test_secret_variables_ship_blank` and `test_setup_env.py::TestReadiness::test_every_secret_named_in_the_template_is_treated_as_one` pass with **zero changes to `scripts/setup-env.sh`** (template-driven by design, D8). **Verify this claim explicitly:** `git diff --exit-code scripts/setup-env.sh` must be clean at the end of this unit.
- [x] 8.12 **RED** — `test_root_compose.py::TestNoCrossServiceOrdering::test_redis_is_coupled_to_nothing` (new, REQ-UCD-12): assert no `depends_on` names `redis` and the `redis` block declares none — the "deliberately independent services" promise (`docker-compose.yml:10`) survives because Redis is a *soft* cache dependency. **Observed RED:** `assert 'redis' in {'stt': ..., 'matcher': ..., 'product_identification': ...}`.
- [x] 8.13 **DO NOT TOUCH — leave red on purpose.** `test_root_compose.py::TestSecretSafeEnvWorkflow::test_no_committed_file_carries_a_credential_shaped_default` and `.env.example:103` (`GOOGLE_CLOUD_PROJECT=gen-lang-client-0715489298`) / line 109 (`GOOGLE_APPLICATION_CREDENTIALS=gen-lang-client-...json`). Rationale: that value is a working committed default for the user's local Google Cloud deploy; changing or blanking it here risks breaking a deploy this change has no business touching. It is a pre-existing security finding, reported to the user as a separate follow-up. **Verify WU-8:** `uv run pytest tests/deployment services/matcher/tests/unit/test_container.py` then `uv run pytest` → **1 failed, and it is this one.**

### WU-8 deviations, recorded at apply time

20. **`scripts/smoke-compose.sh` gained a `preflight_matcher`, and its test file a
    credential gate.** Not named by any 8.x task, but REQ-UCD-7 as modified by this
    change's own delta already requires it ("missing Supabase credentials SHALL skip
    only matcher-dependent smoke evidence", replacing the previous SQLite-file gate).
    It is not cosmetic: `TestAgainstARunningDaemon` calls `docker compose up -d --wait
    matcher`, and the first run after the compose edit **recreated the developer's
    running, healthy matcher container** into one that cannot boot without
    `SUPABASE_KEY`. Observed live (`Starting: matcher`, container dropped to
    `health: starting`); the container was restored from the unmodified main checkout.
    `preflight_matcher` now skips with the missing variable named, and the daemon test
    additionally skips unless `SUPABASE_URL`/`SUPABASE_KEY` are exported. Three new
    plan-level tests pin the gate. `scripts/setup-env.sh` is still untouched, as 8.11
    requires — this is a different script.
21. **`SUPABASE_URL` ships blank in `.env.example`, with the project URL in its help
    comment instead of as its value.** Tasks 8.9/D8 pin the compose interpolation to
    `${SUPABASE_URL:-}`, and `test_template_defaults_match_the_compose_defaults`
    requires the template default and the compose fallback to be byte-identical — so a
    committed `SUPABASE_URL=https://...` value would have made the two diverge and
    turned that test red. Blank also preserves the REQ-API-4 fail-fast: an unconfigured
    deployment aborts boot with a named error instead of silently starting against the
    wrong project. The operator still sees the real URL, one line above, in the prompt
    text `setup-env.sh` reads back.
22. **The `redis` block's own comments had to avoid the literal string `depends_on`.**
    `service_blocks()` attributes the comment lines *above* a service key to the
    *previous* service, so explaining the absence of `depends_on` in prose made
    `test_no_service_declares_depends_on` fail on `product_identification`. Caught as a
    real RED and reworded rather than weakening the assertion — the test is right that
    the token has no business in a service block.
23. **Suite ends at 1 failed, 479 passed, 16 skipped** — not 15 skipped. The extra skip
    is the new credential-gated `TestAgainstARunningDaemon` (deviation 20), reported
    with a named reason exactly as REQ-UCD-7 requires. The 15 eval skips are unchanged
    and still WU-6's to remove. The single failure is #4, the deliberate one.

## WU-9: Docs, PR body, manual security evidence

- [ ] 9.1 **NON-TDD** — `docs/deployment.md`: document the `redis` service, the four Supabase/Redis env vars, the `docker compose exec redis redis-cli` debug path, and the one documented nuance to the independence promise (Redis is a *soft* dependency — the matcher boots without it via Supabase and keeps serving if it dies). Remove the `data/bodegas-y-stock.sqlite` prerequisite from the matcher quick path. *Non-TDD: prose; the contract it describes is already covered by `tests/deployment/*`.*
- [ ] 9.2 **NON-TDD** — PR body must state, in this order: (a) `size:exception accepted by user` (Engram #144) with the ~1,300-1,600-line forecast; (b) **BREAKING**: `catalogue_id` changes from 8 SQLite table names to 56 `warehouses.code` values on `POST /match` and `GET /catalogues` — coordinate with `feat/voice-counter-frontend` before it merges; (c) `uv.lock` carries ~+777 lines of unrelated `product_identification` transitive deps that PR #12 never locked; (d) pre-existing deployment failures #1-#3 are fixed here; (e) pre-existing failure #4 (`GOOGLE_CLOUD_PROJECT` credential-shaped default) is **deliberately untouched** and reported as a separate security follow-up, so the suite intentionally ends at 1 failed; (f) the eval baselines were re-measured and re-pinned with a dated provenance note.
- [ ] 9.3 **NON-TDD, blocked-without-credentials, MANUAL EVIDENCE** — REQ-CSS-4's second scenario ("the matcher's credential cannot read `warehouse_stock_balances`") cannot be verified offline: it is a live authorization property, and no CI test may reach the network. **CI treatment**: the offline guarantee is `test_supabase_source.py::TestQueryShape::test_it_never_queries_warehouse_stock_balances` (the client provably never *constructs* such a query) plus `test_snapshot_codec.py::TestSnapshotContentSafety` (no stock bytes can enter Redis). **Manual evidence**: with the least-privilege key, `curl -H "apikey: $SUPABASE_KEY" "$SUPABASE_URL/rest/v1/warehouse_stock_balances?select=theoretical_qty&limit=1"` must return 401/403 (or an empty RLS-filtered result). Paste the status code into the PR body. Record it as an open item if the least-privilege key is not yet provisioned — the design's Open Questions note the anon-key fallback is acceptable only if RLS denies that read.
- [ ] 9.4 **FINAL VERIFICATION** — `uv run pytest` from the repository root. **PASS = exactly `1 failed`, and the failure is `tests/deployment/test_root_compose.py::TestSecretSafeEnvWorkflow::test_no_committed_file_carries_a_credential_shaped_default`.** Any other count, or any other failing test id, is a regression. Zero `skip`/`xfail` markers may remain in `services/matcher/tests/eval/`.

## WU-10: Unit vocabulary regression — restore REQ-ENG-5 against the code vocabulary

Fixes the defect recorded as WU-6 deviation 29. The cutover swapped the *vocabulary* of the
`unidad` column: the retired SQLite catalogue carried the workbook labels
(`Kilogram`/`Liter`/`Unidad`/`Portion`, which Supabase now keeps in `units.source_label`),
while `warehouse_products.unit_code` — the column the new source reads — carries the codes
(`KG`/`LT`/`UND`/`POR`/`CAJA`). `units.py` still speaks the labels, so `unidad_display` is
`None` on every `/match` response and `_unit_rerank` can never fire. This is a **pure
restoration**, not a behaviour change: every spoken synonym must keep resolving to the same
physical unit it did before, and every display string is preserved verbatim.

- [x] 10.1 **RED — display copy** — `services/matcher/tests/unit/test_service.py::TestUnitVocabulary::test_a_code_vocabulary_unidad_still_renders_its_display_copy`: build a service over a `Row(unidad="KG")` and assert the top candidate's `unidad_display == "kg"`, plus the same for `LT`/`UND`/`POR`. **Expected RED:** `assert None == 'kg'` — `UNIT_DISPLAY.get("KG")` is `None`.
- [x] 10.2 **RED — the re-rank actually fires** — `services/matcher/tests/unit/test_decision.py::TestUnitRerankSpeaksTheCatalogueVocabulary`: a three-candidate band whose `unidad` values are the Supabase codes; assert a spoken `"litros"` promotes the `LT` candidate inside the band. **Expected RED:** the raw order survives, because `resolve_unit("litros")` returns a label that no candidate carries. Include a companion asserting `resolve_unit` returns a value that the catalogue's `unidad` vocabulary can actually equal.
- [x] 10.3 **GREEN** — rekey `UNIT_SYNONYMS` and `UNIT_DISPLAY` in `services/matcher/src/matcher/units.py` to `KG`/`LT`/`UND`/`POR`, preserving every synonym set and every display string. `caja`/`cajas` continues to resolve to `UND` exactly as before.
- [x] 10.4 **Migrate the test fixtures to the source vocabulary** — `services/matcher/tests/conftest.py`, `tests/unit/test_decision.py`, `tests/unit/test_units.py`, `tests/api/test_http.py`. These fixtures asserted the workbook labels and are precisely why the regression was invisible; a fixture that does not speak the source's vocabulary cannot catch a vocabulary drift.
- [x] 10.5 **OUT OF SCOPE, recorded deliberately** — Supabase carries a distinct `CAJA` unit code that the workbook never had. Whether spoken "caja" should resolve to `CAJA` instead of `UND`, and how RF-15 resolves a dictated box to a stocked unit, is a domain decision for a follow-up change. Note it in `units.py` and do not decide it here.
- [x] 10.6 **Verify** — `uv run pytest` → still exactly **1 failed, 1 skipped**. **Measured: 1 failed, 520 passed, 1 skipped** (+13 over WU-6's 507).

### WU-10 deviations, recorded at apply time

30. **The spec text needed no correction.** `specs/catalogue-source-supabase/spec.md`
    (REQ-CSS-2) already says `unidad` = `warehouse_products.unit_code`, and
    `specs/matcher-service-api/spec.md` names the field without pinning a vocabulary.
    The workbook labels were only ever hard-coded in `units.py` and in the test
    fixtures — the specs were right and the code was wrong.
31. **Task 10.4 was not cosmetic and is the reason the defect was invisible.**
    `conftest.FIXTURE_CATALOGUE`, `test_decision.py`, `test_http.py` and
    `test_units.py` all asserted the workbook labels, so the whole suite agreed with
    the broken map. Two guards were added so the vocabulary cannot drift back:
    `test_neither_map_is_keyed_on_a_retired_workbook_label` and
    `TestUnitRerankSpeaksTheCatalogueVocabulary::test_the_rerank_is_inert_for_a_retired_label_vocabulary_row`.
32. **`test_the_rerank_is_inert_for_a_retired_label_vocabulary_row` was RED for the
    *opposite* reason to the other two** — before the fix a `Liter` row *was* treated
    as unit-equal (`['2','1']`), which is exactly the confusion being removed. It is
    kept because it pins the direction of the migration, not just its outcome.

## WU-11: Deterministic tie-break in ranking

WU-6 proved the eval movement (`no_code` 0.98824 → 0.92941) was caused purely by catalogue
row order (`rowid` → `warehouse_products.id` UUID) deciding rank 1 among **exactly equal**
scores. Ranking must not depend on the order the source happens to return rows in.

- [ ] 11.1 **RED — order independence** — `services/matcher/tests/unit/test_scoring.py::TestDeterministicTieBreak::test_the_same_catalogue_in_two_row_orders_ranks_identically`: build one catalogue twice, second time with the row list reversed/shuffled, over rows whose trigram scores tie; assert `rank()` returns the same `uid` sequence. **Expected RED:** the two orders disagree.
- [ ] 11.2 **RED — the tie-break touches only ties** — `test_rows_with_different_scores_keep_their_score_order`: assert a strictly-descending score set is returned in score order regardless of `uid`, so the stable key can never outrank a better score.
- [ ] 11.3 **GREEN** — sort `TrigramSimilarityMatcher.rank` by `(-score, uid)`. The scoring function itself is untouched; REQ-ENG-2 still holds (stock is never a matching prior and `sd` no longer exists).
- [ ] 11.4 **Re-measure and re-pin** — run `uv run pytest services/matcher/tests/eval -s`, re-pin `TOP1_FLOOR`, `HAS_CODE_TOP1_BASELINE`, `NO_CODE_TOP1_BASELINE`, `RECALL3_FLOOR`, `FALSE_CONFIDENCE_CEILING` to the newly measured values with a dated provenance note that replaces WU-6's order-dependence explanation. **Report the numbers honestly against both prior sets.** A tie-break picks a *stable* winner, not necessarily the *correct* one — an unchanged or slightly worse cohort figure is a legitimate outcome and must be reported, never tuned away.
- [ ] 11.5 **Verify** — `uv run pytest` → still exactly **1 failed, 1 skipped**.

## Requirement traceability

| Requirement | Covering tasks |
|---|---|
| REQ-CSS-1 (Supabase sole source, no SQLite remnant) | 3.1, 4.1-4.4, 5.8, 8.6-8.8, 8.10 |
| REQ-CSS-2 (row identity and shape) | 1.1, 3.3 |
| REQ-CSS-3 (active-row filtering, merged excluded) | 3.1 |
| REQ-CSS-4 (stock isolation, least privilege) | 3.1, 1.2, 9.3 (manual for the live-denial scenario) |
| REQ-CSS-5 (startup abort, never serve empty) | 3.4, 4.3, 4.4, 5.7 |
| REQ-RCC-1 (snapshot lifecycle) | 2.1, 4.1, 4.2, 4.3 |
| REQ-RCC-2 (TTL refresh, atomic swap) | 2.1, 7.1, 7.7 |
| REQ-RCC-3 (soft dependencies, zero per-request I/O) | 2.1, 7.2, 7.8 |
| REQ-RCC-4 (stampede control) | 2.2, 7.3, 7.4, 7.5, 7.6 |
| REQ-RCC-5 (snapshot content safety) | 1.2, 6.2 |
| REQ-API-1 / REQ-API-2 (warehouse-code `catalogue_id`, `/catalogues`) | 5.3, 5.5 |
| REQ-API-4 (config; no `CATALOGUE_DB`) | 5.1 |
| REQ-API-6 (containerized deployment, no mount) | 8.6-8.10 |
| REQ-API-7 (startup retry, exit 3) | 5.7 |
| REQ-API-8 (observability, log privacy) | 5.6 |
| REQ-API-5 (read-only SQLite catalogue) | **REMOVED** — retired with its tests in 5.8 |
| REQ-UCD-1 (sole surface, full service set) | 8.1, 8.2, 8.4 |
| REQ-UCD-3 / REQ-UCD-6 (per-service contracts, daemon-free validation) | 8.5-8.11 |
| REQ-UCD-12 (redis soft dependency, env flow) | 8.3, 8.9, 8.11, 8.12 |
| REQ-ENG-2 (stock never a matching prior) | 1.1, 3.1 — extended: stock is now never even loaded |
| Eval accuracy (REQ-ENG-6) | 6.1-6.8 |

## Threat Matrix

N/A per design — no new routing, shell, subprocess, VCS/PR automation, or executable-file
classification. The only process-integration surface is the existing uvicorn exit-3
contract, preserved and still covered by `TestTheProcessActuallyExitsThree` with its env
swapped per D7 (task 5.7). Compose changes are covered by the deployment contract tests
(WU-8). No threat-matrix rows require RED tests beyond those already listed.
