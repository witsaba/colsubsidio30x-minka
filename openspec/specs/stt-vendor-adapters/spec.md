# stt-vendor-adapters Specification

## Purpose

Deepgram, Groq and ElevenLabs adapters — Deepgram or Groq as primary, any of the three as a failover target — the `STT_VENDOR` runtime switch, failover chain selection, and boot-time configuration validation.

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

Changing `STT_VENDOR` (values: `deepgram` | `groq`) SHALL be the only action required to swap the primary vendor — no code change, no other configuration edits. An unrecognised `STT_VENDOR` value MUST fail at startup, as MUST a value naming a backup-only vendor (see REQ-VND-9).

#### Scenario: One env var swaps the vendor

- GIVEN a service instance started with `STT_VENDOR=groq` and no code changes since the deepgram configuration
- WHEN a clip is POSTed to `/transcribe`
- THEN the vendor call goes to Groq and `/health` reports `vendor: "groq"`

#### Scenario: Invalid vendor rejected at boot

- GIVEN `STT_VENDOR=whisper-cpp`
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

When the selected vendor exhausts its retry budget on transient failures and `STT_FALLBACK_ENABLED` is true (default), the service SHALL make one attempt against each vendor in the failover chain (REQ-VND-9), in order, until one succeeds. The response's `stt_vendor` field and the per-request log's `vendor` field MUST name the vendor that actually served the request. If every vendor in the chain fails, or the chain is empty, the service SHALL report the selected vendor's failure class. A missing fallback key MUST NOT affect startup.

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

### Requirement: REQ-VND-8 Total deadline on end-to-end vendor time

All vendor work for one request — every retry attempt, every backoff wait, and the failover attempt together — SHALL be bounded by `STT_TOTAL_DEADLINE_S` (default 45 seconds, must be greater than zero). When the budget is exhausted the service SHALL answer `502` with `code: "vendor_timeout"` on the frozen error envelope, emit its per-request INFO record naming the vendor that was in flight, and MUST NOT wait for the remaining attempts.

#### Scenario: A hanging vendor is cut off at the total deadline

- GIVEN `STT_TOTAL_DEADLINE_S` is shorter than the vendor's response time
- AND the selected vendor accepts the connection and never answers
- WHEN a clip is POSTed to `/transcribe`
- THEN the response is `502` with `code: "vendor_timeout"` and a `request_id`
- AND the caller waits approximately the deadline, not the sum of the per-attempt timeouts
- AND the per-request INFO record carries that same `request_id`

### Requirement: REQ-VND-9 ElevenLabs as a backup-only vendor, and failover chain selection

The service SHALL support ElevenLabs Scribe as a third vendor, calling `POST /v1/speech-to-text` with the `xi-api-key` header, `model_id` from `STT_ELEVENLABS_MODEL` (default `scribe_v1`), `language_code` from `STT_LANGUAGE`, and `tag_audio_events=false`. It SHALL map `text` to `raw_transcript`, `language_probability` to `stt_confidence`, and `audio_duration_secs` to `audio_duration_ms`; a body without `text` MUST raise a vendor error.

ElevenLabs SHALL be usable **only as a failover target**. `STT_VENDOR=elevenlabs` MUST fail at startup with an error stating the reason and naming the permitted primaries. The rationale is RNF-04: ElevenLabs zero-retention is Enterprise-gated and documented as revocable at the vendor's discretion, so it cannot carry every clip. Reaching it after the primary has already failed is a bounded, deliberate exposure; making it the primary is not. Note the accepted trade-off — ElevenLabs precedes the zero-retention-capable Groq in the chain below because it is the stronger Spanish transcriber, so a deployment configuring all three keys prefers transcription quality over retention posture *at the point where a dictation would otherwise be lost*.

The failover chain SHALL be `STT_FALLBACK_VENDOR` alone when it is set, which MUST differ from `STT_VENDOR` and MUST have its API key configured — both validated at startup. When unset, the chain SHALL be every vendor other than the primary that has a configured key, in the fixed order `deepgram`, `elevenlabs`, `groq`. Each vendor in the chain SHALL receive exactly one attempt. The service SHALL perform no failover when the chain is empty.

#### Scenario: ElevenLabs as the primary is rejected at boot

- GIVEN `STT_VENDOR=elevenlabs` and `ELEVENLABS_API_KEY` set
- WHEN the application starts
- THEN startup fails with an error citing RNF-04, naming `deepgram` and `groq` as the permitted primaries, and pointing at `STT_FALLBACK_VENDOR=elevenlabs`

#### Scenario: ElevenLabs serves as the automatic backup, ahead of Groq

- GIVEN `STT_VENDOR=deepgram` with `DEEPGRAM_API_KEY`, `ELEVENLABS_API_KEY` and `GROQ_API_KEY` all set and `STT_FALLBACK_VENDOR` unset
- AND Deepgram fails transiently on every attempt
- WHEN a clip is POSTed to `/transcribe`
- THEN ElevenLabs is called once with the `xi-api-key` header and Groq is not called
- AND the response reports `stt_vendor: "elevenlabs"` with the confidence taken from `language_probability`

#### Scenario: The chain continues to Groq when ElevenLabs also fails

- GIVEN the same three-key configuration
- AND both Deepgram and ElevenLabs fail transiently
- WHEN a clip is POSTed to `/transcribe`
- THEN Groq is called once and the response reports `stt_vendor: "groq"`

#### Scenario: An explicitly named fallback vendor is the whole chain

- GIVEN `STT_VENDOR=deepgram` with both `GROQ_API_KEY` and `ELEVENLABS_API_KEY` set
- AND `STT_FALLBACK_VENDOR=elevenlabs`
- WHEN Deepgram fails transiently on every attempt and ElevenLabs then fails too
- THEN ElevenLabs is called once and Groq is never called
- AND the response is `502` carrying Deepgram's failure class

#### Scenario: An explicit fallback without its key fails boot

- GIVEN `STT_VENDOR=deepgram` with `DEEPGRAM_API_KEY` set and `ELEVENLABS_API_KEY` unset
- AND `STT_FALLBACK_VENDOR=elevenlabs`
- WHEN the application starts
- THEN startup fails with an error naming `ELEVENLABS_API_KEY`
