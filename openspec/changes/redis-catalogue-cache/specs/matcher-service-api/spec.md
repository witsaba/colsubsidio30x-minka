# Delta for matcher-service-api

Base: `openspec/specs/matcher-service-api/spec.md` (rev 4). Breaking change: `catalogue_id` becomes `warehouses.code` — clean break, no legacy-name shim.

## MODIFIED Requirements

### Requirement: POST /match contract (REQ-API-1)

`POST /match` SHALL accept `{"spoken_name": str, "catalogue_id": str, "unit": str|null}` where `catalogue_id` is a warehouse code (`warehouses.code`, e.g. one of the 56 active codes — no longer a SQLite stock-table name), and SHALL respond with `{"status", "candidates", "top_score", "margin", "request_id"}` where `status` is exactly one of `matched`, `ambiguous`, `no_match` and each candidate carries `nr_articulo`, `articulo`, `unidad`, `score`. A caller MUST be able to distinguish all three statuses from the response body. An unknown `catalogue_id` SHALL yield an HTTP 4xx client error via the existing `UnknownCatalogueError` path, never a `no_match`. Every request string field SHALL carry an upper length bound — `spoken_name` max 300, `catalogue_id` max 100, `unit` max 50 characters — and a request exceeding any bound SHALL yield HTTP 422; a blank or whitespace-only `spoken_name` is likewise rejected with HTTP 422 before the request reaches the matcher (unchanged).
(Previously: `catalogue_id` identified one of the 8 SQLite stock tables.)

#### Scenario: Matched response shape

- GIVEN a running service and a query that clearly matches one row
- WHEN `POST /match` is called with a valid warehouse code as `catalogue_id`
- THEN the response has `status: "matched"`, a non-empty `candidates` list with `nr_articulo`, `articulo`, `unidad`, `score`, plus `top_score`, `margin`, and a `request_id`

#### Scenario: All three statuses reachable over HTTP

- GIVEN a running service
- WHEN three requests are crafted for a clear match, a crowded/near-tie field, and garbage input
- THEN the responses carry `matched`, `ambiguous`, and `no_match` respectively

#### Scenario: Unknown warehouse code is a client error

- GIVEN a running service
- WHEN `POST /match` is called with `catalogue_id: "NOT_A_WAREHOUSE"`
- THEN the response is an HTTP 4xx error, not a `no_match` result

#### Scenario: Oversized field is rejected

- GIVEN a running service
- WHEN `POST /match` is called with a `spoken_name` longer than 300 characters (or a `catalogue_id` longer than 100, or a `unit` longer than 50)
- THEN the response is HTTP 422 and the matcher is never invoked

### Requirement: GET /catalogues (REQ-API-2)

`GET /catalogues` SHALL return the list of loadable catalogue ids — the active, non-merged warehouse codes (`warehouses.code`; 56 on the real catalogue) — each with its `warehouse_products` row count.
(Previously: returned the 8 SQLite stock-table names.)

#### Scenario: Catalogue listing

- GIVEN the service loaded the catalogue from the Supabase source or a valid Redis snapshot
- WHEN `GET /catalogues` is called
- THEN one entry per active, non-merged warehouse is returned, ids are warehouse codes, and each entry includes its row count

### Requirement: Env-var configuration via pydantic-settings (REQ-API-4)

Service configuration (`SUPABASE_URL`, `SUPABASE_KEY`, `REDIS_URL`, `CATALOGUE_CACHE_TTL_SECONDS`, `MATCH_ACCEPT_SCORE`, `MATCH_AMBIGUITY_MARGIN`, `MATCH_TSR_MARGIN`, `MATCH_MAX_CANDIDATES`, `MATCH_UNIT_RERANK`, `STARTUP_RETRIES`, `STARTUP_RETRY_DELAY_SECONDS`) SHALL be read from environment variables via `pydantic-settings`. `CATALOGUE_CACHE_TTL_SECONDS` (int, default `10800`, > 0) governs the snapshot TTL of REQ-RCC-2; the snapshot key and version are also `Settings` fields. `CATALOGUE_DB` SHALL NOT exist. `STARTUP_RETRIES` (int, default `3`, ≥ 0) and `STARTUP_RETRY_DELAY_SECONDS` (float, default `2.0`, ≥ 0) govern the startup retry loop of REQ-API-7. The service MUST fail at startup — not at first request — on missing or invalid configuration; a configuration `ValidationError` MUST NOT be retried.
(Previously: required `CATALOGUE_DB`; no Supabase/Redis/TTL settings.)

#### Scenario: Invalid config fails fast

- GIVEN `MATCH_ACCEPT_SCORE=not-a-number` or a missing `SUPABASE_URL`
- WHEN the service starts
- THEN startup aborts with a configuration error and the service never reports healthy

### Requirement: Containerized deployment on port 8002 (REQ-API-6)

`services/matcher/` SHALL contain a `Dockerfile`; the service SHALL be deployed via the root Compose file (see unified-compose-deployment) exposing port 8002, setting the env vars of REQ-API-4, with no catalogue volume mount, and defining a healthcheck against `GET /health`. The image SHALL set `ENV PYTHONUNBUFFERED=1` so crash-time log lines are never lost in a stdio buffer; the healthcheck SHALL declare `start_period: 10s` so probes during catalogue load (plus any startup retry) are not failures; compose SHALL pin `STARTUP_RETRIES=3` and `STARTUP_RETRY_DELAY_SECONDS=2.0`; and the repository root SHALL carry a `.dockerignore` for the root build context. `docker compose up matcher` SHALL yield a healthy service against a reachable Supabase source or a valid Redis snapshot.
(Previously: mandated a service-local compose, the `../../data:/data:ro` mount, and `CATALOGUE_DB=/data/bodegas-y-stock.sqlite`.)

#### Scenario: Compose brings up a healthy service

- GIVEN a checkout with valid Supabase credentials configured
- WHEN `docker compose up matcher` runs at the repository root
- THEN the container reaches a healthy state and `POST /match` on port 8002 answers with a valid contract response

### Requirement: Startup retry on transient catalogue unavailability (REQ-API-7)

When catalogue loading raises `CatalogueUnavailableError` — now raised when neither a valid Redis snapshot nor Supabase can supply the catalogue (REQ-CSS-5) — startup SHALL retry the load up to `STARTUP_RETRIES` times (default `3`), waiting `STARTUP_RETRY_DELAY_SECONDS` (default `2.0`) seconds between attempts and logging a WARNING per retry. After exhaustion the service SHALL log an ERROR and exit non-zero (uvicorn exit code 3); Docker's `restart: unless-stopped` is the outer retry layer. A configuration `ValidationError` MUST NOT be retried — bad configuration is permanent and aborts startup immediately. Exhaustion is always an abort: the service MUST never come up serving an empty catalogue.
(Previously: `CatalogueUnavailableError` came from the SQLite loader.)

#### Scenario: Transient unavailability is retried

- GIVEN a catalogue source that becomes reachable only on the second load attempt
- WHEN the service starts with `STARTUP_RETRIES=3`
- THEN a WARNING is logged for the failed attempt and startup completes successfully

#### Scenario: Exhaustion aborts with exit code 3

- GIVEN Supabase and Redis both staying unreachable
- WHEN all `STARTUP_RETRIES + 1` attempts fail
- THEN an ERROR is logged and the process exits with code 3, leaving further restarts to Docker

#### Scenario: Misconfiguration is never retried

- GIVEN an invalid environment value that raises `ValidationError`
- WHEN the service starts
- THEN startup aborts immediately without any retry attempt

### Requirement: Observability with log privacy (REQ-API-8)

The service SHALL log its operational surface on the stdlib logger named `matcher`: startup success at INFO (catalogue count, total rows, and whether the catalogue came from the Redis snapshot or Supabase); startup failure at ERROR; every answered `POST /match` at INFO with `request_id`, `catalogue_id`, `status`, `top_score`, candidate count, and `latency_ms`; and every rejected unknown `catalogue_id` at WARNING with `request_id` and `catalogue_id`. HARD RULE (Ley 1581): `spoken_name`, any transcript text, and any candidate `articulo` text MUST NEVER appear in any log line at any level — the dictated text is personal data, the log is telemetry. This rule SHALL be enforced by tests.
(Previously: startup INFO logged the SQLite database path.)

#### Scenario: Decision line is correlatable

- GIVEN an answered `POST /match`
- WHEN the request completes
- THEN one INFO line on logger `matcher` carries `request_id`, `catalogue_id`, `status`, `top_score`, the candidate count, and `latency_ms`

#### Scenario: No personal data in logs

- GIVEN any request, answered or rejected
- WHEN every emitted log line is inspected
- THEN neither `spoken_name` nor any candidate `articulo` text appears in any line

## REMOVED Requirements

### Requirement: Read-only in-memory catalogue (REQ-API-5)

(Reason: the SQLite catalogue is removed entirely — Supabase is the source of truth and Redis the cache; there is no local database file to open read-only.)
(Migration: replaced by catalogue-source-supabase REQ-CSS-1..REQ-CSS-5 and catalogue-redis-cache REQ-RCC-1..REQ-RCC-5. Tests asserting `mode=ro` and fetch-time SQLite corruption are removed with the loader.)
