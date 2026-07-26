# Delta for Service Proxy

## MODIFIED Requirements

### Requirement: REQ-PRX-1 — Same-origin endpoints, services untouched

The frontend MUST expose `POST /api/transcribe` (→ STT `POST /transcribe`), `POST /api/match` (→ matcher `POST /match`), `GET /api/catalogues` (→ matcher `GET /catalogues`), and `POST /api/extract` (→ extractor `POST /api/v1/extract`). The extract route MUST pass the JSON body through unchanged in both directions. No file under `services/` may be modified and no CORS may be added to any service. (RNF-05 posture)
(Previously: only the three STT/matcher endpoints)

#### Scenario: Match round-trip

- GIVEN the matcher is reachable
- WHEN the browser POSTs a valid MatchRequest to `/api/match`
- THEN the response body and status equal the matcher's response AND the request never left the frontend origin from the browser's perspective

#### Scenario: Extract round-trip

- GIVEN the extractor is reachable
- WHEN the browser POSTs `{"transcription": "..."}` to `/api/extract`
- THEN the response body and status equal the extractor's response
- AND `consensus_status` and `confidence_score` are passed through untouched

### Requirement: REQ-PRX-5 — Upstream URLs from environment

Upstream base URLs MUST come from environment variables with documented defaults: `STT_BASE_URL` (default `http://localhost:8001`), `MATCHER_BASE_URL` (default `http://localhost:8002`), and `EXTRACTOR_BASE_URL` (default `http://localhost:8003`).
(Previously: only STT and matcher base URLs)

#### Scenario: Default and override

- GIVEN no env vars are set
- WHEN the proxy resolves its targets
- THEN it uses the three localhost defaults
- AND GIVEN `EXTRACTOR_BASE_URL=http://other:9003`, THEN `/api/extract` targets that base

## ADDED Requirements

### Requirement: REQ-PRX-6 — Extract timeout budget and error envelope

The extract proxy MUST bound the upstream call with a 60 s abort (`AbortSignal.timeout(60_000)`) because the extractor has no server-side deadline, and the browser client MUST apply `EXTRACT_TIMEOUT_MS = 60_000`. A proxy-side abort or transport failure MUST be mapped exactly like the existing routes: status 502 with the `{"error": {"code": "proxy_unreachable", "message": ...}}` envelope. Upstream 4xx/5xx responses MUST pass through unchanged per REQ-PRX-2.

#### Scenario: Slow extraction inside the budget

- GIVEN the extractor answers 200 after 59 s
- WHEN `/api/extract` is called
- THEN the client receives the extractor's 200 JSON, not a proxy-originated timeout

#### Scenario: Timeout maps to the shared envelope

- GIVEN the extractor does not answer within 60 s
- WHEN `/api/extract` is called
- THEN the proxy aborts and responds 502 with `error.code === 'proxy_unreachable'`

#### Scenario: Upstream error passes through

- GIVEN the extractor responds 500 with its own error body
- WHEN `/api/extract` is called
- THEN the client receives status 500 AND the body unchanged
