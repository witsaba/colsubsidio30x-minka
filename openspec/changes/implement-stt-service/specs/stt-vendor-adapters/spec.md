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
