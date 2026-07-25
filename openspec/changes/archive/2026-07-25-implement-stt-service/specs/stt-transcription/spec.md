# stt-transcription Specification

## Purpose

Frozen HTTP contract of the Module 1 STT service: `POST /transcribe`, `GET /health`, and the `is_garbage` signal rules consumed by Module 2.

## Requirements

### Requirement: REQ-STT-1 Frozen transcribe response shape

`POST /transcribe` SHALL accept `multipart/form-data` with a `file` field containing an audio blob and SHALL respond `200` with exactly these fields: `raw_transcript` (string), `is_garbage` (bool), `stt_confidence` (float), `audio_duration_ms` (int | null), `stt_vendor` (string), `request_id` (string, unique per request). No additional or missing top-level fields. `audio_duration_ms` SHALL be `null` when the vendor omits duration (chunked MediaRecorder webm often lacks a duration header); the service MUST NOT substitute `0`, since a forced `0` would falsely trigger the negligible-speech `is_garbage` path.

#### Scenario: Successful transcription

- GIVEN the service is configured with a working vendor (mocked)
- WHEN a client POSTs a valid audio file to `/transcribe`
- THEN the response is `200` with exactly the six frozen fields, correctly typed
- AND `request_id` differs across two consecutive requests

#### Scenario: Vendor omits duration

- GIVEN the mocked vendor response contains no duration for an otherwise valid transcript
- WHEN a client POSTs the clip to `/transcribe`
- THEN the response is `200` with `audio_duration_ms: null`
- AND `is_garbage` is not triggered by duration alone

### Requirement: REQ-STT-2 Health endpoint

`GET /health` SHALL return `200` with `{"status": "ok", "vendor": "<active-vendor>"}` where `<active-vendor>` is the currently selected vendor name.

#### Scenario: Health reports active vendor

- GIVEN the service runs with `STT_VENDOR=deepgram`
- WHEN a client GETs `/health`
- THEN the response is `200` with `status` `"ok"` and `vendor` `"deepgram"`

### Requirement: REQ-STT-3 is_garbage signal rules

The service SHALL set `is_garbage: true` when the vendor returns an empty transcript, when `stt_confidence` is below the configured floor (`STT_CONFIDENCE_FLOOR`), or when detected speech duration is negligible. Otherwise `is_garbage` MUST be `false`. `is_garbage` is a signal only; the service MUST still return `200` with the full shape.

#### Scenario: Empty transcript flags garbage

- GIVEN the vendor returns an empty transcript for a clip
- WHEN the client POSTs that clip
- THEN the response is `200` with `is_garbage: true`

#### Scenario: Confidence below floor flags garbage

- GIVEN `STT_CONFIDENCE_FLOOR=0.60` and the vendor reports confidence `0.40`
- WHEN the client POSTs the clip
- THEN `is_garbage` is `true` and `stt_confidence` is `0.40`

#### Scenario: Normal clip is not garbage

- GIVEN the vendor returns a non-empty transcript with confidence above the floor and normal speech duration
- WHEN the client POSTs the clip
- THEN `is_garbage` is `false`

### Requirement: REQ-STT-4 Verbatim transcript, no ITN

`raw_transcript` SHALL be the vendor transcript verbatim. The service MUST NOT apply Inverse Text Normalisation or any post-processing of number words (RF-17 belongs to Module 2).

#### Scenario: Number words pass through unchanged

- GIVEN the vendor transcript contains `"novecientos"`
- WHEN the client POSTs the clip
- THEN `raw_transcript` contains `"novecientos"` unchanged

### Requirement: REQ-STT-5 Upstream and input error paths

On vendor timeout or vendor 5xx, the service SHALL respond with a `502` error body that includes a `request_id` and MUST NOT crash. A request missing the `file` field or carrying audio the vendor rejects as unsupported SHALL yield a `4xx` error, never a `200`.

#### Scenario: Vendor timeout

- GIVEN the vendor call times out (mocked)
- WHEN the client POSTs a clip
- THEN the response is `502` with a `request_id` and no frozen-shape success body

#### Scenario: Vendor 5xx

- GIVEN the vendor responds `503` (mocked)
- WHEN the client POSTs a clip
- THEN the response is `502` with a `request_id`

#### Scenario: Missing file field

- GIVEN a multipart request without a `file` field
- WHEN it is POSTed to `/transcribe`
- THEN the response status is `4xx`
