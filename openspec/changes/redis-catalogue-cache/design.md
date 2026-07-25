# Design: Supabase Catalogue Source + Redis Snapshot Cache (SQLite Removal)

## Technical Approach

Replace the SQLite loader with two ports composed by `MatcherService`: a `CatalogueSource` (Supabase/PostgREST over plain `httpx`) and a `SnapshotCache` (Redis, versioned JSON snapshot, 3h TTL). `POST /match` keeps reading only an immutable in-process index (`CatalogueIndex`); all I/O happens in `lifespan` (startup load + one background refresh task). Trigram scoring and `decide()` are untouched; `catalogue_id` becomes `warehouses.code`; `Row.uid` becomes `warehouse_products.id`; `sd` is gone and `warehouse_stock_balances` is never queried (least-privilege key over `warehouses`, `products`, `warehouse_products`, `units` only). Single PR, `size:exception` accepted (Engram #144).

## Architecture Decisions

### D1 — Supabase client: plain `httpx` against PostgREST

**Choice**: sync `httpx.Client` calling the PostgREST REST endpoint directly. New runtime deps for `services/matcher/pyproject.toml`: `httpx>=0.27`, `redis>=5`; dev group adds `fakeredis>=2`.

**Rejected**: `supabase` SDK (drags gotrue/realtime/storage3/websockets — auth and realtime the service never uses; heavier image, larger supply-chain surface). `postgrest-py` (thin query-builder over httpx; one query hardly justifies a dependency, and its sync/async duality adds nothing here).

**Rationale**: the load path is sync (`_load_service_with_retry`, `MatcherService.__init__`) and runs once per start/refresh; `httpx` is already in the repo's dev universe, is trivially testable with `httpx.MockTransport` (real client + throwaway transport — the repo's real-but-throwaway convention), and one embedded-resource query covers everything.

**The query** (one request shape, paginated): headers `apikey: {key}`, `Authorization: Bearer {key}`;

```
GET {SUPABASE_URL}/rest/v1/warehouse_products
  ?select=id,unit_code,warehouses!inner(code),products!inner(name,sku)
  &is_active=eq.true
  &warehouses.is_active=eq.true
  &warehouses.merged_into_warehouse_id=is.null
  &products.is_active=eq.true
  &order=id
```

with `Range: 0-999`, `1000-1999`, … looping until a short page (Supabase caps responses at 1,000 rows; 1,405 rows means two pages — the loop is mandatory, not defensive). Assembly is in-process: group rows by `warehouses.code` into `dict[str, list[Row]]`. `units` is granted to the credential (per decision #144) but not fetched — `unit_code` is denormalized on `warehouse_products` and `UNIT_DISPLAY` is local. Zero total rows raises `CatalogueUnavailableError` (never serve empty).

### D2 — Ports: two Protocols, plain construction, no DI container

**Choice** (follows `RowLike` structural-Protocol precedent, `scoring.py:22`):

```python
class Row:            # frozen dataclass, catalogue.py replacement
    warehouse_code: str; uid: str; articulo: str
    unidad: str | None; nr_articulo: str | None

class CatalogueSource(Protocol):
    def load(self) -> dict[str, list[Row]]: ...        # raises CatalogueUnavailableError

class SnapshotCache(Protocol):
    def get(self) -> Snapshot | None: ...              # None on miss/parse/version/redis error
    def put(self, snapshot: Snapshot) -> None: ...     # best-effort, never raises
    def try_acquire_refresh_lock(self, ttl_seconds: int) -> bool: ...
    def release_refresh_lock(self) -> None: ...
```

`Snapshot` = frozen dataclass `(rows: list[Row], loaded_at: datetime)`. `MatcherService(settings, source, cache)` takes both explicitly; `main._build_adapters(settings) -> tuple[CatalogueSource, SnapshotCache]` is a module-level function `_load_service_with_retry` calls — the monkeypatch seam for `TestClient` lifespan tests, same style as today's `MatcherService` factory patch in `test_startup_retry.py`.

**Test doubles**: `fakeredis.FakeRedis` injected into the real `RedisSnapshotCache` (adapter accepts a constructed `redis.Redis` client) — this exercises real `SET NX PX`/`GET`/TTL semantics instead of hand-reimplementing them (mock drift), the exact analogue of the tmp-SQLite convention. A hand-rolled `FakeCatalogueSource(rows)` with a `calls` counter covers the source side (the real adapter is tested separately with `MockTransport`). **Rejected**: hand-rolled in-memory cache fake (re-implements NX/PX expiry = the thing under test); mocking `redis.Redis` methods (against repo convention).

### D3 — Snapshot key and format

**Choice**: key `matcher:catalogue:snapshot:v1`; lock key `matcher:catalogue:refresh-lock:v1`. Version lives in the key (incompatible payload = different key = clean miss) and is a code constant in `cache.py`, deliberately NOT a Setting — an env-tunable schema version could desync from the parser. Serialization: **JSON** (stdlib, debuggable via `redis-cli`, no deserialization RCE). **Rejected**: pickle (arbitrary-code-execution on a shared cache), msgpack (new dep for ~30% size win on a 250 KB value read twice per 3h).

Payload: `{"schema_version": 1, "loaded_at": "<iso8601 utc>", "rows": [{"warehouse_code","uid","articulo","unidad","nr_articulo"}]}` — flat list; grouping is rebuilt in-process. ~1,405 rows × ~160 B ≈ **~230 KB**. The codec serializes exactly the five `Row` fields; a test asserts the encoded bytes contain neither `"sd"` nor `"theoretical_qty"` (proves RF-18 data cannot enter Redis). Redis key TTL = `2 × CATALOGUE_CACHE_TTL_SECONDS` so a warm restart still finds a (stale) snapshot after a missed refresh; freshness for refresh decisions is judged from `loaded_at`, not key expiry.

### D4 — Refresh: one asyncio task in lifespan, atomic single-reference swap

**Choice**: `lifespan` starts `asyncio.create_task(_refresh_loop(service, settings))` after the service is built and cancels it on shutdown. **Rejected**: lazy refresh on request (adds I/O and tail latency to `/match` — violates the p95 1.8ms constraint); a thread + timer (asyncio task is native to FastAPI lifespan and trivially cancellable); celery/apscheduler (absurd for one loop).

Loop: `sleep(ttl + uniform(-0.1, +0.1) * ttl)` (jitter ±10% → ±1080s at 10800s, de-syncs replicas), then refresh via `asyncio.to_thread` (sync httpx/redis calls never block the event loop). Per-process single-flight is structural — the loop is the sole refresher. Cross-process: `SET refresh-lock NX PX 60000` (lock TTL **60s** ≫ observed load of ~2 pages + one Redis write; expiry auto-frees a dead holder — no fencing token needed because a duplicate Supabase read is idempotent and harmless). Lock not acquired → read the snapshot the winner wrote; if its `loaded_at` is newer, swap it in; else skip this cycle. Redis down → refresh directly from Supabase (the lock is stampede optimization, not correctness).

**Atomic swap**: `MatcherService` holds one attribute `self._index: CatalogueIndex` — a frozen dataclass bundling `catalogue: dict[str, list[Row]]` AND a fully `build()`-ed `TrigramSimilarityMatcher`. Refresh constructs a complete new `CatalogueIndex` off to the side, then performs a single attribute assignment; `match()`/`catalogues()` read `index = self._index` once at entry. A single reference store is atomic in CPython, so a concurrent `/match` sees either the whole old index or the whole new one — never a dict paired with a mismatched matcher. Any refresh failure logs a warning, keeps the old index, and waits for the next jittered cycle (stale-while-refresh).

### D5 — Error taxonomy and startup sequence

Startup order in `load_index(source, cache)` (called by `MatcherService.__init__`):

1. `cache.get()` → fresh snapshot (`now - loaded_at < ttl`) → use; done (zero Supabase calls).
2. Miss/stale/parse/version/redis error → `source.load()` → build index, `cache.put()` best-effort → done.
3. Supabase failed AND step 1 returned a *stale but parseable* snapshot → use it with a warning (Redis is up, data is real — stale beats abort and honors "never serve empty").
4. Nothing usable → raise `CatalogueUnavailableError` → existing `_load_service_with_retry` (main.py:65-92) retries → exhaustion aborts, uvicorn exit 3. Loop and semantics unchanged.

Transient (wrapped into `CatalogueUnavailableError`, cause-chained like today): httpx transport/timeout errors, HTTP ≥ 400 (including 401/403 — technically permanent, but the retry loop is bounded at 4 attempts/seconds, so one taxonomy is simpler; accepted tradeoff), JSON decode, zero rows. Permanent (uncaught, no retry — existing behavior): `ValidationError` from `Settings()`. Redis errors are never fatal on their own — they only degrade to source-or-abort.

Log line becomes: `catalogue loaded catalogues=%d rows=%d source=%s` with `source ∈ {redis-snapshot, supabase, redis-snapshot-stale}` (the existing `"catalogue loaded"` substring assertion survives).

### D6 — Configuration (`config.py`, eager pydantic-settings validation)

| Field | Env var | Default | Validation |
|---|---|---|---|
| `supabase_url: str` | `SUPABASE_URL` | **required** | non-empty; normalized `rstrip("/")` |
| `supabase_key: str` | `SUPABASE_KEY` | **required** | non-empty |
| `supabase_timeout_seconds: float` | `SUPABASE_TIMEOUT_SECONDS` | `10.0` | `gt=0` |
| `redis_url: str` | `REDIS_URL` | `redis://localhost:6379/0` | non-empty |
| `catalogue_cache_ttl_seconds: int` | `CATALOGUE_CACHE_TTL_SECONDS` | `10800` | `ge=60` |
| `catalogue_refresh_lock_ttl_seconds: int` | `CATALOGUE_REFRESH_LOCK_TTL_SECONDS` | `60` | `ge=1` |

`catalogue_db` **removed**. Required-without-default makes a missing `SUPABASE_URL` a `ValidationError` at `Settings()` — permanent, unretried, matching `test_a_misconfigured_setting_is_never_retried`. Snapshot key/version and jitter ratio (0.1) are code constants, not env (version must match the parser; jitter is not an operational knob). Match thresholds and `startup_retries*` are untouched.

### D7 — Test strategy (Strict TDD, `uv run pytest` from root, no network)

| Today | Becomes |
|---|---|
| `catalogue_db_path` (real sqlite, skip-if-absent) | deleted |
| `make_synthetic_db` (tmp sqlite) | `make_rows(...)` helper + `FakeCatalogueSource(rows, fail_times=0, calls: int)` |
| `settings` | `Settings(supabase_url="http://supabase.invalid", supabase_key="test", redis_url=...)` — constructed, never dialed |
| `service` (session, real db) | `MatcherService(settings, FakeCatalogueSource(fixture_rows), InProcess fakeredis cache)` |
| `client` (env + lifespan) | monkeypatch `main._build_adapters` to return fake source + fakeredis cache; `TestClient` lifespan stays real |

New RED suites: snapshot codec round-trip + version mismatch + no-`sd`-bytes; `RedisSnapshotCache` over `fakeredis` (get/put/TTL/lock NX semantics); `SupabaseCatalogueSource` over `httpx.MockTransport` (pagination across the 1,000-row boundary, filters present in the request, 4xx/5xx/timeout → `CatalogueUnavailableError`, zero-rows abort); startup-order tests (warm fresh snapshot → **assert `source.calls == 0`** — the "warm Redis means zero Supabase calls" proof; cold → `calls == 1` and snapshot written; stale + failing source → serves stale with warning; both dead → `CatalogueUnavailableError`); refresh-loop tests with short TTL + fakeredis (swap atomicity asserted by capturing `service._index` identity before/after; lock-lost path).

`test_startup_retry.py`: keeps its factory-monkeypatch structure; `CATALOGUE_DB` env swaps for `SUPABASE_URL=http://127.0.0.1:9/`-style unroutable localhost values. The subprocess exit-3 test points `SUPABASE_URL` and `REDIS_URL` at closed localhost ports (connection-refused locally — no external network).

**Eval accuracy** (`tests/eval/test_eval_accuracy.py`): survives via a checked-in fixture snapshot `services/matcher/tests/data/catalogue_snapshot.json` — the Redis snapshot-v1 JSON exported once from Supabase (1,405 rows; no RF-18 data by construction) — loaded through `FakeCatalogueSource`. The eval set is remapped offline once: `table`/`gold_rowid` → `catalogue_id` (warehouse code)/`gold_uid` (`warehouse_products.id`), matching on `nr_articulo`/`articulo`; unmappable cases are dropped with a recorded count, cohort baselines re-pinned with a dated provenance note (the file already documents exactly this re-pin procedure). The byte-identical-to-spike hash test retires in favor of a pinned sha256 of the remapped file. Accuracy floors are re-measured, not assumed — this is the proposal's acknowledged "accuracy shift" risk made visible in one commit.

### D8 — Deployment

```yaml
  redis:
    image: redis:7.4-alpine                      # pinned
    command: ["redis-server", "--save", "", "--appendonly", "no"]  # pure cache; cold start rebuilds from Supabase
    healthcheck: {test: ["CMD", "redis-cli", "ping"], interval: 10s, timeout: 3s, retries: 3, start_period: 5s}
    restart: unless-stopped
    # no ports: internal-only (compose default network); debug via `docker compose exec redis redis-cli`
```

No `depends_on` anywhere — the "deliberately independent" promise holds because Redis is soft: matcher boots without it (Supabase path) and keeps serving if it dies; `docs/deployment.md` gains that one documented nuance. Matcher block: drop `volumes: ./data:/data:ro` and `CATALOGUE_DB`; add `SUPABASE_URL: ${SUPABASE_URL:-}`, `SUPABASE_KEY: ${SUPABASE_KEY:-}`, `REDIS_URL: ${REDIS_URL:-redis://redis:6379/0}` (`:-` treats blank as unset, existing pattern), `CATALOGUE_CACHE_TTL_SECONDS: ${CATALOGUE_CACHE_TTL_SECONDS:-10800}`. `.env.example` matcher section: those four vars with help comments; `SUPABASE_KEY` is auto-masked by the existing `*_KEY` secret convention — **`scripts/setup-env.sh` needs zero changes** (template-driven by design).

`tests/deployment` updates: service set gains `redis`; the "every service builds from an explicit context" and "probes its own HTTP health endpoint" assertions get an image-pinned-infrastructure exemption (redis asserts `image:` with an explicit tag + `redis-cli ping` healthcheck instead); `test_root_compose.py:151-152` flips to negative assertions (no `./data:/data` mount, no `CATALOGUE_DB:` anywhere); add assertions for the new env interpolations and continued absence of `depends_on`. Pre-existing inconsistency found: `docker-compose.yml` defines `product_identification` but `test_root_compose.py:85` asserts `{"stt", "matcher"}` — reconcile to the actual on-branch service set while editing (flagged for apply, not silently absorbed).

## Data Flow

```
startup:  Redis snapshot ──fresh──▶ CatalogueIndex ──▶ app.state.service
             │ miss/stale                ▲ atomic single-ref swap
             ▼                           │
          Supabase (PostgREST, paged) ──▶ build ──▶ cache.put (best effort)
             │ both unusable
             ▼
          CatalogueUnavailableError → retry loop → exit 3

runtime:  /match ─▶ self._index (zero I/O)
          refresh task (3h ± 10%) ─▶ SET NX lock ─▶ Supabase ─▶ new index ─▶ swap ─▶ put
```

## File Changes

| File | Action |
|---|---|
| `services/matcher/src/matcher/catalogue.py` | Rewrite: new `Row`, `CatalogueSource`/`SnapshotCache` protocols, `load_index`, `CatalogueUnavailableError` kept; SQLite/`STOCK_TABLES`/`open_readonly` deleted |
| `services/matcher/src/matcher/supabase_source.py` | Create: httpx PostgREST adapter |
| `services/matcher/src/matcher/cache.py` | Create: snapshot codec + `RedisSnapshotCache` + keys |
| `services/matcher/src/matcher/service.py` | Modify: compose ports, `CatalogueIndex`, `refresh()` |
| `services/matcher/src/matcher/main.py` | Modify: `_build_adapters`, refresh task in lifespan, log line |
| `services/matcher/src/matcher/config.py` | Modify per D6 |
| `services/matcher/pyproject.toml` | Add `httpx`, `redis`; dev `fakeredis` |
| `services/matcher/tests/**` | Migrate per D7; new `tests/data/catalogue_snapshot.json`, remapped `eval_set.json` |
| `docker-compose.yml`, `.env.example`, `tests/deployment/*`, `docs/deployment.md` | Per D8 |

## Migration / Sequencing (suite green at every commit)

1. Deps commit (`httpx`, `redis`, `fakeredis`) — green, nothing wired.
2. RED→GREEN: snapshot codec (`cache.py` codec half).
3. RED→GREEN: `RedisSnapshotCache` over fakeredis.
4. RED→GREEN: `SupabaseCatalogueSource` over `MockTransport`.
5. RED→GREEN: new `Row`/protocols/`load_index` (new modules coexist with old loader; old suite untouched, still green).
6. **Atomic swap commit**: `MatcherService`/`main`/`config` rewired + `conftest`/unit/api tests migrated + SQLite loader and its tests deleted — one commit, suite green on both sides of it.
7. Eval fixture snapshot + remapped eval set + re-pinned baselines (dated note).
8. RED→GREEN: background refresh loop + swap-atomicity tests.
9. Deployment surface (compose/.env.example/deployment tests) RED→GREEN.
10. `docs/deployment.md` nuance + PR body breaking-change notice.

## Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Accuracy floors shift with the new per-warehouse row populations | Step 7 re-measures and re-pins with provenance; regression in scoring itself is impossible (byte-identical `scoring.py`/`decision.py`) |
| Pagination bug silently truncates catalogue at 1,000 rows | Dedicated MockTransport test crossing the page boundary; total-row-count log + zero-rows abort |
| Refresh task dies silently → permanently stale index | Task wrapper logs exceptions and re-enters the loop; snapshot key TTL 2× keeps warm restarts viable |
| `SUPABASE_KEY` over-privileged | Key provisioned with grants on the 4 tables only; codec test proves no `sd`/`theoretical_qty` bytes; matcher never references `warehouse_stock_balances` |
| Frontend branch breaks on new `catalogue_id` | Clean break announced in PR body (decision #144); coordinate before frontend merge |
| Pre-existing deployment-test/compose drift (`product_identification`) | Reconciled explicitly in step 9, called out in PR |

## Rejected Alternatives (summary)

`supabase` SDK / `postgrest-py` (D1); DI container or ABC hierarchy (D2 — repo uses Protocols + direct construction); pickle/msgpack (D3); lazy on-request refresh, threads, schedulers (D4); keeping SQLite as fallback and a `catalogue_id` shim (re-litigated nowhere — closed by Engram #142/#144); per-request Redis reads (violates zero-I/O `/match`); locks with fencing tokens (refresh is idempotent); hand-rolled Redis fake (mock drift).

## Threat Matrix

N/A — no new routing, shell, subprocess, VCS/PR automation, or executable-file classification. The only process-integration surface is the existing uvicorn exit-3 contract, preserved and still covered by `TestTheProcessActuallyExitsThree` (env swapped per D7). Compose changes are covered by the deployment contract tests.

## Open Questions

None blocking. One recommendation needing later confirmation: the Supabase least-privilege key must be provisioned (role/grants on the 4 tables) before deploy; fallback until then is the anon key restricted by RLS — acceptable only if RLS denies `warehouse_stock_balances` reads, which must be verified with `get_advisors`/policy review at apply time.
