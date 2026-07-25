# stt-vendor-adapters Specification

## Purpose

Deepgram primary and Groq fallback adapters, the `STT_VENDOR` runtime switch, and boot-time configuration validation.

## Requirements

### Requirement: REQ-VND-1 Deepgram primary adapter parameters

When `STT_VENDOR=deepgram`, the service SHALL call the Deepgram transcription API with `model=nova-3`, `language=es`, `numerals=true`, and `mip_opt_out=true`. It MUST NOT use `language=multi` or `smart_format` in place of `numerals`.

#### Scenario: Deepgram request carries the frozen parameters

- GIVEN `STT_VENDOR=deepgram` and the Deepgram endpoint is mocked
- WHEN a clip is POSTed to `/transcribe`
- THEN the outbound request includes `model=nova-3`, `language=es`, `numerals=true`, `mip_opt_out=true`
- AND the response reports `stt_vendor: "deepgram"`

### Requirement: REQ-VND-2 Groq fallback adapter

When `STT_VENDOR=groq`, the service SHALL call Groq's OpenAI-compatible audio transcription endpoint with `model=whisper-large-v3-turbo`, sending the audio as multipart with the Groq API key as bearer token.

#### Scenario: Groq request uses the OpenAI-compatible contract

- GIVEN `STT_VENDOR=groq` and the Groq endpoint is mocked
- WHEN a clip is POSTed to `/transcribe`
- THEN the outbound request targets the OpenAI-compatible transcriptions path with `model=whisper-large-v3-turbo`
- AND the response reports `stt_vendor: "groq"`

### Requirement: REQ-VND-3 Runtime vendor switch

Changing `STT_VENDOR` (values: `deepgram` | `groq`) SHALL be the only action required to swap vendors — no code change, no other configuration edits. An unrecognised `STT_VENDOR` value MUST fail at startup.

#### Scenario: One env var swaps the vendor

- GIVEN a service instance started with `STT_VENDOR=groq` and no code changes since the deepgram configuration
- WHEN a clip is POSTed to `/transcribe`
- THEN the vendor call goes to Groq and `/health` reports `vendor: "groq"`

#### Scenario: Invalid vendor rejected at boot

- GIVEN `STT_VENDOR=elevenlabs`
- WHEN the application starts
- THEN startup fails with an error naming the invalid vendor value

### Requirement: REQ-VND-4 httpx only, no vendor SDKs

Vendor calls SHALL be made with `httpx`. The project dependencies MUST NOT include any vendor SDK (e.g. `deepgram-sdk`, `groq`, `openai`).

#### Scenario: Dependency manifest is SDK-free

- GIVEN the project `pyproject.toml`
- WHEN its dependency list is inspected
- THEN it contains `httpx` and no Deepgram, Groq, or OpenAI SDK package

### Requirement: REQ-VND-5 Boot-time API key validation

Configuration SHALL be loaded via pydantic-settings at startup. A missing API key for the selected vendor MUST fail at startup, before serving any request. A missing key for the non-selected vendor MUST NOT block startup.

#### Scenario: Missing key for selected vendor fails boot

- GIVEN `STT_VENDOR=deepgram` and `DEEPGRAM_API_KEY` unset
- WHEN the application starts
- THEN startup fails with an error identifying the missing key

#### Scenario: Missing key for non-selected vendor is tolerated

- GIVEN `STT_VENDOR=deepgram`, `DEEPGRAM_API_KEY` set, `GROQ_API_KEY` unset
- WHEN the application starts
- THEN startup succeeds and `/health` returns `200`

### Requirement: REQ-VND-6 Bounded retry with backoff on transient vendor failures

The service SHALL retry the selected vendor up to `STT_RETRY_ATTEMPTS` times in total (default 2, minimum 1), waiting `STT_RETRY_BACKOFF_S` doubled per attempt between tries, when the call fails with a timeout, a connection error, or HTTP 429, 500, 502, 503 or 504. Any other failure — including HTTP 400/401/403, audio the vendor rejects, and a 2xx body the adapter cannot parse — MUST fail on the first attempt without a retry.

#### Scenario: A transient vendor failure is retried and succeeds

- GIVEN `STT_VENDOR=deepgram` and `STT_RETRY_ATTEMPTS=2`
- AND the Deepgram endpoint answers `503` once and then `200`
- WHEN a clip is POSTed to `/transcribe`
- THEN the vendor is called twice with a `STT_RETRY_BACKOFF_S` wait in between
- AND the response is `200` with the transcript from the second call

#### Scenario: An authentication failure is not retried

- GIVEN `STT_VENDOR=deepgram` and the Deepgram endpoint answers `401`
- WHEN a clip is POSTed to `/transcribe`
- THEN the vendor is called exactly once
- AND the response is `502` with `code: "vendor_error"`

### Requirement: REQ-VND-7 Automatic failover to the configured fallback vendor

When the selected vendor exhausts its retry budget on transient failures, `STT_FALLBACK_ENABLED` is true (default), and the other vendor's API key is configured, the service SHALL make one attempt against that other vendor. The response's `stt_vendor` field and the per-request log's `vendor` field MUST name the vendor that actually served the request. If the fallback also fails, or no fallback is available, the service SHALL report the selected vendor's failure class. A missing fallback key MUST NOT affect startup.

#### Scenario: Exhausted primary fails over and the response names the real vendor

- GIVEN `STT_VENDOR=deepgram` with `GROQ_API_KEY` configured and `STT_FALLBACK_ENABLED=true`
- AND the Deepgram endpoint answers `503` on every attempt
- WHEN a clip is POSTed to `/transcribe`
- THEN Groq is called once, authenticated with the Groq key
- AND the response is `200` with `stt_vendor: "groq"`
- AND the per-request INFO record reports `vendor: "groq"` and carries no other fields beyond `request_id` and `duration_ms`

#### Scenario: No fallback key means no failover

- GIVEN `STT_VENDOR=deepgram` and `GROQ_API_KEY` unset
- AND the Deepgram endpoint times out on every attempt
- WHEN a clip is POSTed to `/transcribe`
- THEN Groq is never called
- AND the response is `502` with `code: "vendor_timeout"`
