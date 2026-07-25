# Proposal: Supabase Catalogue Source + Redis Snapshot Cache (SQLite Removal)

## Intent

Catalogue data must come from the live source of truth (Supabase) without paying a Supabase round trip on every process start or per lookup. Today the matcher never touches Supabase: `MatcherService.__init__` (services/matcher/src/matcher/service.py:29-34) calls `load_catalogue()` once at startup from a local read-only SQLite file (catalogue.py:52-87, 8 hardcoded `STOCK_TABLES`, 1,461 rows) built offline from an Excel workbook. That file silently diverges from the populated Supabase project (56 `warehouses`, 936 `products`, 1,405 `warehouse_products`). Per the Data Engineer's direction (user decision, Engram `sdd/redis-catalogue-cache/scope-decision`): source of truth = Supabase, cache = Redis (3h TTL), **SQLite removed entirely — no fallback**. Both land in this one change.

## Scope

### In Scope
- Replace the SQLite loader with a Supabase catalogue source reading `warehouses`, `products`, `warehouse_products`, `units` (active rows only; merged warehouses excluded).
- Redis snapshot cache: on startup, load snapshot from Redis; on miss/stale, fetch Supabase, rebuild, write snapshot back (best effort). Background refresh every `CATALOGUE_CACHE_TTL_SECONDS` (default 10800) with atomic in-process index swap.
- New identity model; removal of `catalogue.py` SQLite path, `CATALOGUE_DB` setting, `./data:/data:ro` mount.
- Deployment surface: `redis` compose service, Supabase/Redis env vars through `.env.example` → `scripts/setup-env.sh` → `docker-compose.yml`; update `tests/deployment/*` contract tests and `docs/deployment.md`.
- Rebase matcher test fixtures (`services/matcher/tests/conftest.py` `make_synthetic_db`) onto a fake catalogue source + `fakeredis`.

### Out of Scope
- Any change to trigram scoring, `decide()` thresholds, or measured accuracy — the algorithm carries over byte-identical.
- Deleting `scripts/build_bodegas_sqlite.py`, `data/`, and the archived xlsx→sqlite change (dead for matcher runtime; separate cleanup PR).
- Per-request Supabase/Redis reads, write paths, stock quantities, product_identification service, frontend update (coordinated separately).

## Key Decisions (design tensions, positions taken)

1. **`catalogue_id` becomes `warehouses.code` — clean break, no compatibility mapping.** Breaking API change on `POST /match` and `GET /catalogues`: 8 SQLite table names → 56 warehouse codes. The 8→56 shapes don't map 1:1, and the only consumers are the service's own tests (services/matcher/tests/api/test_http.py) and the unmerged `feat/voice-counter-frontend` branch, which can adopt the new IDs before merge. A shim would preserve a dead identifier scheme.
2. **`Row.sd` is DROPPED.** Verified unused by matching: scoring.py:9 ("Stock level (`sd`) is never a matching prior"), `decide()`'s `RowLike` (decision.py:38-44) reads only `articulo/unidad/nr_articulo`, and tests/unit/test_scoring.py:127-129 asserts REQ-ENG-2 (`sd` must never influence ranking). Dropping it means the matcher never reads `warehouse_stock_balances` (RF-18/RLS-protected `theoretical_qty`), needs no privileged key, and the Redis snapshot never holds RF-18-restricted data. Least-privilege Supabase key with read access to only the four catalogue tables.
3. **Identity**: `Row.uid` (`table#rowid`, zero external consumers) → `warehouse_products.id` (uuid). Row fields become: `warehouse_code`, `uid`, `articulo` = `products.name`, `unidad` = `unit_code`, `nr_articulo` = `products.sku`.
4. **Redis and Supabase are SOFT dependencies of `/match`.** `/match` reads only the in-process index — zero I/O per request; p95 ~1.8ms is a hard non-regression constraint. Redis down never degrades `/match` availability.
5. **Stampede control**: TTL jitter + per-process single-flight + Redis `SET NX` refresh lock; serve current in-process index while revalidating (stale-while-refresh). Data is ~1.4k rows; simple is correct.
6. **Startup with Supabase AND Redis unreachable: abort.** Preserve `CatalogueUnavailableError` + `_load_service_with_retry` (main.py:65-92) philosophy — never serve an empty catalogue. Redis-only-down at startup: proceed via Supabase.
7. **Config**: all tunables in `Settings` (config.py convention): `SUPABASE_URL`, `SUPABASE_KEY`, `REDIS_URL`, `CATALOGUE_CACHE_TTL_SECONDS`, snapshot key/version; `catalogue_db` removed.
8. **Compose**: `redis` block added but no `depends_on` — Redis is a soft dependency, so the "services are deliberately independent" promise (docs/deployment.md, docker-compose.yml:10) survives with a documented nuance.

## Capabilities

### New Capabilities
- `catalogue-source-supabase`: matcher catalogue loading from Supabase (tables, identity, least-privilege access, active-row filtering, startup abort semantics).
- `catalogue-redis-cache`: Redis snapshot cache with TTL refresh, soft-dependency guarantees, stampede control.

### Modified Capabilities
- `matcher-service-api`: `catalogue_id` semantics (warehouse codes), `GET /catalogues` shape, removal of SQLite-based availability wording.
- `unified-compose-deployment`: redis service, Supabase env flow, removal of data mount.

*(`product-matching-engine` requirements unchanged — REQ-ENG-2 remains and gains force.)*

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| services/matcher/src/matcher/catalogue.py | Replaced | SQLite loader → Supabase source (new module) |
| services/matcher/src/matcher/cache.py (new) | New | Redis snapshot port + adapter |
| services/matcher/src/matcher/service.py:29-34 | Modified | Compose source + cache; refresh hook |
| services/matcher/src/matcher/main.py:65-116 | Modified | Retry/lifespan wording, background refresh task |
| services/matcher/src/matcher/config.py | Modified | New settings; drop `catalogue_db` |
| services/matcher/tests/ (conftest, unit, api) | Modified | Fake source + fakeredis fixtures; new catalogue IDs |
| docker-compose.yml:82-86, .env.example, scripts/setup-env.sh | Modified | redis service, env vars, drop data mount |
| tests/deployment/test_root_compose.py, test_compose_config.py, test_setup_env.py | Modified | Contract updates |
| docs/deployment.md:53-55 | Modified | Redis + Supabase docs, independence nuance |
| services/matcher/pyproject.toml | Modified | Add supabase (or postgrest) + redis deps |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Breaking `catalogue_id` contract hits frontend branch | High | Coordinate before frontend merge; clean break announced in PR |
| Supabase outage at cold start with cold Redis | Med | Abort-and-retry (existing philosophy); Redis snapshot covers warm restarts |
| Accuracy regression from name/unit source shift (`articulo` → `products.name`) | Med | Strict TDD; carry over scoring tests unchanged; compare rankings on real catalogue sample |
| RLS misconfiguration exposes `warehouse_stock_balances` | Low | Matcher key has no grant on that table; never selected |
| Snapshot schema drift across versions | Low | Versioned snapshot key; mismatched version = cache miss |

## Size Estimate vs 400-line Review Budget

Rough forecast: **~900–1,200 changed lines** (source rewrite ~350, tests ~450, deployment/docs ~150, deletions ~150). **Exceeds budget — chained PRs recommended**: PR1 Supabase source + identity + tests; PR2 Redis cache + TTL refresh; PR3 deployment surface + docs. `sdd-tasks` must produce the formal forecast.

## Rollback Plan

Single revert of the feature branch/PR chain restores the SQLite path; `data/bodegas-y-sqlite` artifacts and `scripts/build_bodegas_sqlite.py` remain in-tree until the separate cleanup, so rollback needs no data rebuild. Redis compose block is additive and inert after revert.

## Dependencies

- Live Supabase project (populated; verified via MCP `list_tables`) + a least-privilege read key for the four catalogue tables.
- New Python deps: `supabase` (or `postgrest`) client, `redis`; test dep `fakeredis`.

## Success Criteria

- [ ] `POST /match` accuracy tests pass unchanged (scoring/decide untouched); p95 in-process latency preserved (no per-request I/O).
- [ ] Startup: cold Redis + live Supabase → loads and writes snapshot; warm Redis → no Supabase call; both down → abort non-zero.
- [ ] Kill Redis while running: `/match` unaffected; refresh logs a warning, index keeps serving.
- [ ] `GET /catalogues` returns 56 warehouse codes with `warehouse_products` counts; no SQLite/`CATALOGUE_DB` reference remains in matcher or compose.
- [ ] Redis snapshot contains no `theoretical_qty`/`sd` data; matcher credential cannot read `warehouse_stock_balances`.
- [ ] `uv run pytest` green from repo root, including updated `tests/deployment/*`.

## Proposal question round

The major scope questions were already answered by the user (one change for both; SQLite removed entirely — final, not revisited). Remaining assumptions taken in this proposal that merit user confirmation before spec/design:

1. **Clean break on `catalogue_id`** (warehouse codes, no legacy-name mapping) — acceptable for the unmerged frontend branch?
2. **Drop `sd` from the matcher entirely** (verified unused by ranking) so the service needs no privileged Supabase key — confirm the matcher has no other planned consumer of stock levels.
3. **Inactive/merged rows excluded**: filter `is_active = true` and exclude warehouses with `merged_into_warehouse_id` set — correct business rule?
4. **Startup abort philosophy kept**: both Supabase and Redis unreachable at start → abort, never serve empty — confirm.
5. **Cleanup deferral**: deleting `scripts/build_bodegas_sqlite.py` + `data/` + Makefile target is a separate follow-up change — OK?
