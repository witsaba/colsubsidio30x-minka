# catalogue-redis-cache Specification

## Purpose

Defines the Redis snapshot cache between the Supabase catalogue source and the matcher's in-process index: snapshot lifecycle, TTL refresh with atomic swap, soft-dependency guarantees for `POST /match`, stampede control, and snapshot content safety.

## Requirements

### Requirement: Snapshot lifecycle (REQ-RCC-1)

On startup the matcher SHALL first attempt to load a versioned catalogue snapshot from Redis. A valid, version-compatible snapshot SHALL be used without any Supabase call. On miss, expiry, or version incompatibility, the matcher SHALL fetch from Supabase, build the index, and write the snapshot back to Redis with a TTL (best effort — a failed write MUST NOT fail startup).

#### Scenario: Warm start performs zero Supabase calls

- GIVEN a valid, version-compatible snapshot in Redis and an instrumented Supabase source
- WHEN the service starts
- THEN the catalogue is served from the snapshot and the Supabase source records zero calls

#### Scenario: Cold start writes the snapshot with TTL

- GIVEN an empty Redis and a reachable Supabase source
- WHEN the service starts
- THEN the catalogue is fetched from Supabase and a snapshot is written to Redis with a positive TTL

#### Scenario: Version-incompatible snapshot is a miss

- GIVEN a Redis snapshot written under a different snapshot version
- WHEN the service starts
- THEN the snapshot is ignored, the catalogue is fetched from Supabase, and a fresh snapshot is written

### Requirement: TTL refresh with atomic index swap (REQ-RCC-2)

The cache TTL SHALL be configurable via `CATALOGUE_CACHE_TTL_SECONDS` (default `10800` = 3h). When the snapshot expires, a background refresh SHALL fetch Supabase, rebuild the index, atomically swap the in-process index, and rewrite the snapshot. Requests SHALL be served from the previous index throughout the refresh — a request MUST never observe a partial or empty index.

#### Scenario: Expired snapshot refreshes while serving

- GIVEN a running service whose snapshot TTL has elapsed
- WHEN the background refresh runs
- THEN Supabase is fetched, the snapshot is rewritten, the in-process index is swapped atomically, and every `POST /match` issued during the refresh is answered from a complete index

#### Scenario: TTL setting is honored

- GIVEN `CATALOGUE_CACHE_TTL_SECONDS=60`
- WHEN the snapshot is written
- THEN its Redis TTL derives from 60 seconds (subject to REQ-RCC-4 jitter), not the default

### Requirement: Redis and Supabase are soft dependencies of /match (REQ-RCC-3)

`POST /match` SHALL perform zero Redis or Supabase I/O — it reads only the in-process index; the existing in-process latency (p95 ~1.8ms) is a hard non-regression constraint. Redis becoming unreachable mid-flight MUST NOT affect `/match`; the refresh SHALL log a WARNING and the last-good index keeps serving. Supabase unreachable at refresh time SHALL keep the last-good index: no swap, and the existing snapshot MUST NOT be cleared.

#### Scenario: /match does no per-request I/O

- GIVEN a running service with instrumented Redis and Supabase clients
- WHEN `POST /match` requests are answered
- THEN neither client records any call attributable to request handling

#### Scenario: Redis dies mid-flight

- GIVEN a running service whose Redis becomes unreachable
- WHEN `POST /match` is called and a refresh is attempted
- THEN `/match` answers normally from the in-process index and the refresh failure is logged as a WARNING

#### Scenario: Supabase unreachable at refresh keeps last-good

- GIVEN a running service whose Supabase source fails during a refresh
- WHEN the refresh attempt completes
- THEN the in-process index is unchanged, the Redis snapshot is not deleted, and `/match` keeps answering from the last-good catalogue

### Requirement: Stampede control (REQ-RCC-4)

Refresh SHALL apply: TTL jitter on the snapshot expiry; per-process single-flight so concurrent triggers coalesce into one fetch; a Redis `SET NX` refresh lock so at most one replica fetches Supabase at a time; and stale-while-refresh so non-lock-holders keep serving their current index instead of blocking or fetching.

#### Scenario: Concurrent replicas do not pile onto Supabase

- GIVEN multiple service replicas observing an expired snapshot
- WHEN they attempt refresh concurrently
- THEN exactly one acquires the `SET NX` lock and fetches Supabase, while the others continue serving their current index

#### Scenario: In-process refresh triggers coalesce

- GIVEN one process where refresh is triggered concurrently more than once
- WHEN the triggers run
- THEN a single Supabase fetch occurs (single-flight)

### Requirement: Snapshot content safety (REQ-RCC-5)

The Redis snapshot payload MUST NOT contain `theoretical_qty`, `sd`, or any stock-quantity data (RF-18; extends REQ-ENG-2 and REQ-CSS-4).

#### Scenario: Snapshot holds no stock data

- GIVEN a snapshot written by the service
- WHEN its full payload is inspected
- THEN no `theoretical_qty`, `sd`, or quantity-like field is present
