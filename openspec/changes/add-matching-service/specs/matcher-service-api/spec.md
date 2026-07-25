# matcher-service-api Specification

> rev 4 (2026-07-25): Judgment Day round-1 hardening (JD-1..JD-4, JD-U) — see judgment-day-ledger.md

## Purpose

Defines the HTTP contract and deployment of the Module 3 matcher: a FastAPI service on port 8002 exposing `POST /match`, `GET /catalogues`, and `GET /health`, configured entirely via environment variables, reading the catalogue SQLite strictly read-only.

## Requirements

### Requirement: POST /match contract (REQ-API-1)

`POST /match` SHALL accept `{"spoken_name": str, "catalogue_id": str, "unit": str|null}` where `catalogue_id` identifies one of the 8 stock tables (not a warehouse), and SHALL respond with `{"status", "candidates", "top_score", "margin", "request_id"}` where `status` is exactly one of `matched`, `ambiguous`, `no_match` and each candidate carries `nr_articulo`, `articulo`, `unidad`, `score`. A caller MUST be able to distinguish all three statuses from the response body. An unknown `catalogue_id` SHALL yield an HTTP 4xx client error, never a `no_match`. Every request string field SHALL carry an upper length bound — `spoken_name` max 300, `catalogue_id` max 100, `unit` max 50 characters — and a request exceeding any bound SHALL yield HTTP 422; a blank or whitespace-only `spoken_name` is likewise rejected with HTTP 422 before the request reaches the matcher (unchanged).

#### Scenario: Matched response shape

- GIVEN a running service and a query that clearly matches one row
- WHEN `POST /match` is called with a valid `catalogue_id`
- THEN the response has `status: "matched"`, a non-empty `candidates` list with `nr_articulo`, `articulo`, `unidad`, `score`, plus `top_score`, `margin`, and a `request_id`

#### Scenario: All three statuses reachable over HTTP

- GIVEN a running service
- WHEN three requests are crafted for a clear match, a crowded/near-tie field, and garbage input
- THEN the responses carry `matched`, `ambiguous`, and `no_match` respectively

#### Scenario: Unknown catalogue is a client error

- GIVEN a running service
- WHEN `POST /match` is called with `catalogue_id: "not_a_table"`
- THEN the response is an HTTP 4xx error, not a `no_match` result

#### Scenario: Oversized field is rejected

- GIVEN a running service
- WHEN `POST /match` is called with a `spoken_name` longer than 300 characters (or a `catalogue_id` longer than 100, or a `unit` longer than 50)
- THEN the response is HTTP 422 and the matcher is never invoked

### Requirement: GET /catalogues (REQ-API-2)

`GET /catalogues` SHALL return the list of loadable catalogue ids — the 8 stock tables — each with its row count.

#### Scenario: Catalogue listing

- GIVEN the service loaded `data/bodegas-y-stock.sqlite`
- WHEN `GET /catalogues` is called
- THEN 8 entries are returned, ids match the stock table names, and each entry includes a positive row count

### Requirement: GET /health (REQ-API-3)

`GET /health` SHALL return a success status once the catalogue is loaded, suitable for the container healthcheck.

#### Scenario: Health after startup

- GIVEN the service started successfully
- WHEN `GET /health` is called
- THEN the response is HTTP 200

### Requirement: Env-var configuration via pydantic-settings (REQ-API-4)

Service configuration (`CATALOGUE_DB`, `MATCH_ACCEPT_SCORE`, `MATCH_AMBIGUITY_MARGIN`, `MATCH_TSR_MARGIN`, `MATCH_MAX_CANDIDATES`, `MATCH_UNIT_RERANK`, `STARTUP_RETRIES`, `STARTUP_RETRY_DELAY_SECONDS`) SHALL be read from environment variables via `pydantic-settings`. `STARTUP_RETRIES` (int, default `3`, ≥ 0) and `STARTUP_RETRY_DELAY_SECONDS` (float, default `2.0`, ≥ 0) govern the startup retry loop of REQ-API-7. The service MUST fail at startup — not at first request — on missing or invalid configuration; a configuration `ValidationError` MUST NOT be retried.

#### Scenario: Invalid config fails fast

- GIVEN `MATCH_ACCEPT_SCORE=not-a-number` or a missing `CATALOGUE_DB`
- WHEN the service starts
- THEN startup aborts with a configuration error and the service never reports healthy

### Requirement: Read-only in-memory catalogue (REQ-API-5)

At startup the service SHALL load the catalogue from the SQLite file at `CATALOGUE_DB` into memory, opening the database read-only via `mode=ro` in the connection string. The service MUST NOT write to the catalogue; a write attempt SHALL fail explicitly. A sqlite failure detected while fetching rows (e.g. page-level corruption that sqlite only reports while streaming) SHALL raise the same contextual `CatalogueUnavailableError` as a failure at statement execution, naming the affected table in the message.

#### Scenario: mode=ro enforced

- GIVEN the service's SQLite connection
- WHEN any write statement is attempted on it
- THEN SQLite rejects it with a read-only error

#### Scenario: Fetch-time corruption aborts like execute-time corruption

- GIVEN a catalogue database whose corruption only surfaces while rows are streamed
- WHEN startup loads the affected table
- THEN `CatalogueUnavailableError` is raised with the table name in the message and startup aborts

### Requirement: Containerized deployment on port 8002 (REQ-API-6)

`services/matcher/` SHALL contain a `Dockerfile` and a `docker-compose.yml` exposing port 8002, mounting `../../data:/data:ro`, setting the env vars of REQ-API-4 (with `CATALOGUE_DB=/data/bodegas-y-stock.sqlite`), and defining a healthcheck against `GET /health`. The image SHALL set `ENV PYTHONUNBUFFERED=1` so crash-time log lines are never lost in a stdio buffer; the healthcheck SHALL declare `start_period: 10s` so probes during catalogue load (plus any startup retry) are not failures; compose SHALL pin `STARTUP_RETRIES=3` and `STARTUP_RETRY_DELAY_SECONDS=2.0`; and the repository root SHALL carry a `.dockerignore` for the root build context. `docker compose up` SHALL yield a healthy service against the real catalogue.

#### Scenario: Compose brings up a healthy service

- GIVEN a checkout with `data/bodegas-y-stock.sqlite` present
- WHEN `docker compose up` runs in `services/matcher/`
- THEN the container reaches a healthy state and `POST /match` on port 8002 answers with a valid contract response

### Requirement: Startup retry on transient catalogue unavailability (REQ-API-7)

When catalogue loading raises `CatalogueUnavailableError`, startup SHALL retry the load up to `STARTUP_RETRIES` times (default `3`), waiting `STARTUP_RETRY_DELAY_SECONDS` (default `2.0`) seconds between attempts and logging a WARNING per retry. After exhaustion the service SHALL log an ERROR and exit non-zero (uvicorn exit code 3); Docker's `restart: unless-stopped` is the outer retry layer. A configuration `ValidationError` MUST NOT be retried — bad configuration is permanent and aborts startup immediately. Exhaustion is always an abort: the service MUST never come up serving an empty catalogue.

#### Scenario: Transient unavailability is retried

- GIVEN a catalogue that becomes readable only on the second load attempt
- WHEN the service starts with `STARTUP_RETRIES=3`
- THEN a WARNING is logged for the failed attempt and startup completes successfully

#### Scenario: Exhaustion aborts with exit code 3

- GIVEN a catalogue that stays unavailable
- WHEN all `STARTUP_RETRIES + 1` attempts fail
- THEN an ERROR is logged and the process exits with code 3, leaving further restarts to Docker

#### Scenario: Misconfiguration is never retried

- GIVEN an invalid environment value that raises `ValidationError`
- WHEN the service starts
- THEN startup aborts immediately without any retry attempt

### Requirement: Observability with log privacy (REQ-API-8)

The service SHALL log its operational surface on the stdlib logger named `matcher`: startup success at INFO (catalogue count, total rows, database path); startup failure at ERROR; every answered `POST /match` at INFO with `request_id`, `catalogue_id`, `status`, `top_score`, candidate count, and `latency_ms`; and every rejected unknown `catalogue_id` at WARNING with `request_id` and `catalogue_id`. HARD RULE (Ley 1581): `spoken_name`, any transcript text, and any candidate `articulo` text MUST NEVER appear in any log line at any level — the dictated text is personal data, the log is telemetry. This rule SHALL be enforced by tests.

#### Scenario: Decision line is correlatable

- GIVEN an answered `POST /match`
- WHEN the request completes
- THEN one INFO line on logger `matcher` carries `request_id`, `catalogue_id`, `status`, `top_score`, the candidate count, and `latency_ms`

#### Scenario: No personal data in logs

- GIVEN any request, answered or rejected
- WHEN every emitted log line is inspected
- THEN neither `spoken_name` nor any candidate `articulo` text appears in any line
