# stt-privacy Specification

## Purpose

Privacy guarantees of the STT service: audio is never persisted (RNF-04) and transcript bodies are never logged at INFO (Ley 1581).

## Requirements

### Requirement: REQ-PRV-1 Audio never written to disk

The service MUST NOT write uploaded audio bytes to disk at any point in the request lifecycle: no temp files, no spooling to named files, no `UploadFile` save operations. The upload SHALL be read into memory, forwarded to the vendor, and the reference dropped.

#### Scenario: No file is created during a transcription request

- GIVEN a running service with the vendor mocked and filesystem writes observable (including temp directories)
- WHEN a client POSTs an audio clip to `/transcribe` and the response returns
- THEN no new file containing the audio bytes exists anywhere on disk

#### Scenario: No file is created on the error path

- GIVEN the vendor call fails with a timeout (mocked)
- WHEN a client POSTs an audio clip
- THEN no new file containing the audio bytes exists anywhere on disk

### Requirement: REQ-PRV-2 Transcript never logged at INFO

The service MUST NOT emit the transcript body (or any substring of it) in log records at INFO level or below-threshold production logging. Transcript content is personal data under Ley 1581.

#### Scenario: Transcript text absent from INFO logs

- GIVEN INFO-level log capture is active and the mocked vendor returns a known transcript string
- WHEN a client POSTs a clip to `/transcribe`
- THEN no captured INFO log record contains the transcript string

### Requirement: REQ-PRV-3 Per-request INFO log fields

Per-request INFO logging SHALL include only `request_id`, request duration, and vendor name. No other request-derived payload data (audio bytes, filenames from the client, transcript, confidence) MAY appear at INFO.

#### Scenario: INFO log carries only the allowed fields

- GIVEN INFO-level log capture is active
- WHEN a client POSTs a clip to `/transcribe`
- THEN the per-request INFO record contains the `request_id`, a duration, and the vendor name
- AND contains no transcript text and no audio-derived payload data
