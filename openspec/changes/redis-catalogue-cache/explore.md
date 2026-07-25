# Exploration: redis-catalogue-cache

> Materialized from Engram observation #139 (topic `sdd/redis-catalogue-cache/explore`, 2026-07-25).
> The explore sub-agent had no Write tool, so only the Engram copy existed; this file reproduces it faithfully.

**What**: Explored the premise "avoid constantly searching in Supabase when matching, add Redis with 3h TTL" for change `redis-catalogue-cache`.

**Why**: User requested exploration before proposing a Redis cache-aside layer in front of Supabase for the matcher.

**Where**: services/matcher/src/matcher/{main.py,service.py,catalogue.py,config.py,schemas.py,scoring.py}; services/product_identification/ (Vertex AI extractor, no DB); docs/database/DATABASE_ARCHITECTURE.md; spikes/06-stack-module-3-matching.md; scripts/build_bodegas_sqlite.py; docker-compose.yml; .env.example; openspec/changes/convert-bodegas-xlsx-to-sqlite/tasks.md.

**Learned — PREMISE MISMATCH (load-bearing)**:

- The matcher service (services/matcher/src/matcher/service.py:26-34) loads the ENTIRE catalogue exactly ONCE at FastAPI startup (main.py:95-116, lifespan) from a **local read-only SQLite file** `data/bodegas-y-stock.sqlite` (catalogue.py:52, config.py:27), NOT from Supabase. `/match` requests (main.py:130-170) read purely from an in-process dict of dataclasses (`self._catalogue`) plus a prebuilt TrigramSimilarityMatcher index — zero disk or network I/O per request.
- There is NO Supabase client anywhere in the codebase: no supabase-py, no psycopg/asyncpg, no SUPABASE_URL/KEY env var (verified via repo-wide grep and .env.example). The sqlite catalogue is itself built at CI/dev time from an Excel workbook (docs/sources/bodegas-y-stock.xlsx) via scripts/build_bodegas_sqlite.py — a build-time ETL, not a runtime dependency.
- The spike doc spikes/06-stack-module-3-matching.md:17,21-24 is explicit and current: "Supabase becomes the source later without touching the matcher" and "Deliberately absent: ... no cache layer. Each catalogue is 56-345 rows and the matcher measured p95 = 1.8ms in process. There is nothing to optimise and nothing to synchronise."
- Supabase's only footprint today is a documented FUTURE architecture (docs/database/DATABASE_ARCHITECTURE.md): a planned persistent Postgres layer (products, warehouse_stock, audit tables) with an as-yet-unimplemented "Sincronización Asíncrona" down into the matcher's in-memory layer.
- services/product_identification (Module 2) also has zero Supabase interaction — pure Vertex AI/Gemini dual-model extraction + local difflib consensus engine.

**Conclusion**: As literally stated, there is nothing in this repo's current matching hot path for Redis to insulate. Any Redis-cache proposal must first get an explicit human decision on scope: (a) build the not-yet-existing "catalogue loader reads from Supabase" path first, with Redis/TTL sitting between that loader and Supabase; or (b) locate a different, not-yet-explored component actually doing per-request/per-restart Supabase queries; or (c) drop/defer this change since the current architecture already satisfies the goal (sub-2ms in-memory matching, no live DB in the hot path).

*(Resolution: the user chose (a), extended with full SQLite removal — see Engram `sdd/redis-catalogue-cache/scope-decision`, observation #142, and proposal.md.)*

**Testability pattern in repo**: tests/conftest.py favors real-but-throwaway fixtures (real tmp sqlite file via `make_synthetic_db`) over mocking, and scoring.py already uses a structural `Protocol` (`RowLike`) — supports either `fakeredis` (emulates real redis-py) or a small Protocol-based cache port with an in-memory adapter, consistent with existing conventions. No redis dependency exists yet in any pyproject.toml.

**Deploy surface**: single root docker-compose.yml, no depends_on/shared network by design (docs/deployment.md); adding a `redis` service requires a new compose block + .env.example vars documented per docs/deployment.md's "Adding a service" checklist, and must pass tests/deployment/*.
