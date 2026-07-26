# Service Proxy Specification

## Purpose

Astro server endpoints that give the browser same-origin access to the two archived services — STT (`:8001`) and matcher (`:8002`) — without modifying them or adding CORS. New capability — no prior spec.

## Requirements

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

### Requirement: REQ-PRX-2 — Faithful error surfacing with request_id

Upstream status codes and error bodies MUST be surfaced unchanged: STT `{"error":{code,message,request_id}}` for 413 `payload_too_large`, 400 `invalid_audio`, 502 `vendor_timeout`/`vendor_error`; matcher 404 for unknown `catalogue_id` (never remapped to `no_match`) and 422 for validation errors. The upstream `request_id` MUST be preserved and surfaced for correlation.

#### Scenario: STT 413 passes through

- GIVEN STT responds 413 `{"error":{"code":"payload_too_large","message":...,"request_id":"r1"}}`
- WHEN `/api/transcribe` is called with an oversized body
- THEN the client receives status 413 with the same envelope AND `request_id === "r1"`

#### Scenario: Unknown catalogue is 404, not no_match

- GIVEN the matcher responds 404 for `catalogue_id: "nope"`
- WHEN `/api/match` is called
- THEN the client receives 404 AND the body is not transformed into a `no_match` result

### Requirement: REQ-PRX-3 — Timeout budget covers the STT worst case

The proxy and its client MUST tolerate the STT worst case of 45 s (`STT_TOTAL_DEADLINE_S`). Any client/proxy timeout MUST be > 45 s so the upstream deadline, not the proxy, decides. (RNF-02)

#### Scenario: Slow vendor still completes

- GIVEN STT takes 44 s to answer 200
- WHEN `/api/transcribe` is called
- THEN the client receives the 200 transcript, not a proxy-originated timeout

### Requirement: REQ-PRX-4 — Audio is streamed, never written to disk

`/api/transcribe` MUST pass audio bytes through in memory/stream. It MUST NOT write the audio to disk, temp files included. (RNF-04)

#### Scenario: No filesystem writes during transcribe

- GIVEN filesystem write APIs are spied in the test environment
- WHEN `/api/transcribe` forwards a capture
- THEN zero file-write calls occur for the audio payload

### Requirement: REQ-PRX-5 — Upstream URLs from environment

Upstream base URLs MUST come from environment variables with documented defaults: `STT_BASE_URL` (default `http://localhost:8001`), `MATCHER_BASE_URL` (default `http://localhost:8002`), and `EXTRACTOR_BASE_URL` (default `http://localhost:8003`).
(Previously: only STT and matcher base URLs)

#### Scenario: Default and override

- GIVEN no env vars are set
- WHEN the proxy resolves its targets
- THEN it uses the three localhost defaults
- AND GIVEN `EXTRACTOR_BASE_URL=http://other:9003`, THEN `/api/extract` targets that base

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
