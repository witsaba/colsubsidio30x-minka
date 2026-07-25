# Voice Capture Specification

## Purpose

MediaRecorder wrapper for the operator's push-to-talk microphone: container negotiation, bitrate control, duration cap, size guard, local timer, and permission flow. New capability — no prior spec.

## Requirements

### Requirement: REQ-VC-1 — Container preference chain

The recorder MUST select its mimeType via `MediaRecorder.isTypeSupported()` in this exact order: `audio/ogg;codecs=opus` → `audio/webm;codecs=opus` → browser default (no mimeType option). The chosen mimeType MUST be recorded on the capture result and surfaced to the UI. (RNF-12)

#### Scenario: Chromium supports only webm/opus

- GIVEN `isTypeSupported` returns false for `audio/ogg;codecs=opus` and true for `audio/webm;codecs=opus`
- WHEN a recording starts
- THEN the recorder is constructed with `audio/webm;codecs=opus` AND the capture result exposes that mimeType

#### Scenario: Nothing in the chain is supported

- GIVEN `isTypeSupported` returns false for both preferred types
- WHEN a recording starts
- THEN the recorder is constructed without a mimeType option AND the result exposes the recorder's actual `mimeType`

### Requirement: REQ-VC-2 — Explicit low bitrate

The recorder MUST set `audioBitsPerSecond` explicitly to a value in [24000, 32000]. It MUST NOT be left unset (some Chromium builds default to ~128 kbps, consuming the 1 MiB budget in ~65 s). (RNF-12)

#### Scenario: Recorder options always carry a bitrate

- WHEN the MediaRecorder is constructed
- THEN its options include `audioBitsPerSecond` AND 24000 ≤ value ≤ 32000

### Requirement: REQ-VC-3 — Hard 20 s auto-stop `[TEAM]`

Recording MUST auto-stop at 20 seconds, client-side, defined by ONE named constant. `[TEAM]`: RF-13 requires a cap but the value 20 s was never ratified by the client; changing the constant MUST be the only edit needed.

#### Scenario: Operator holds past the cap

- GIVEN a recording in progress
- WHEN elapsed time reaches the cap constant (20 000 ms)
- THEN the recorder stops without a pointerup AND the captured audio is processed normally

### Requirement: REQ-VC-4 — Pre-upload size guard

Before upload, the captured Blob size MUST be checked against 1 048 576 bytes. An oversized capture MUST be refused client-side with a user-facing message; the server's 413 MUST NOT be the first signal. (RNF-12)

#### Scenario: Oversized blob is refused locally

- GIVEN a captured Blob of 1 048 577 bytes
- WHEN the upload guard runs
- THEN no request is issued AND the operator is informed the dictation was too long and must be repeated

### Requirement: REQ-VC-5 — Push-to-talk only

`pointerdown` on the mic MUST start recording; `pointerup` AND `pointerleave` MUST stop it. There MUST be no toggle mode and no real-time streaming. (RF-12)

#### Scenario: Pointer leaves the mic button

- GIVEN a recording in progress
- WHEN a `pointerleave` event fires on the mic
- THEN the recording stops exactly as on `pointerup`

### Requirement: REQ-VC-6 — Local elapsed timer

The elapsed-time display ("Suelta para procesar · 0:04") MUST come from a local client timer started at `pointerdown`. It MUST NOT be derived from the STT response; `audio_duration_ms: null` MUST NOT affect the timer or read as failure. (QA-10)

#### Scenario: STT returns null duration

- GIVEN a completed capture whose STT response has `audio_duration_ms: null`
- WHEN the record is created
- THEN the displayed duration is the local timer value AND no "0" or error is rendered for duration

### Requirement: REQ-VC-7 — Permission at consent, fallback on denial

`getUserMedia` MUST be invoked when the operator taps "Permitir el micrófono" on the consent screen — not lazily at first recording. A denial MUST route to the designed manual fallback ("No autorizar por ahora" path), never surface as a mid-count error. (RF-22)

#### Scenario: OS denies the microphone

- GIVEN the operator checked consent and tapped "Permitir el micrófono"
- WHEN `getUserMedia` rejects with `NotAllowedError`
- THEN the UI shows the fallback note "Sin autorización el conteo se hace escribiendo artículo por artículo. Puedes autorizar más tarde desde tu perfil." AND does not enter the voice count flow

### Requirement: REQ-VC-8 — Recording is never interrupted

An incoming anomaly or preventive block MUST NOT stop or discard an in-flight recording; the block takes effect only after the current capture completes. (RF-29)

#### Scenario: Anomaly arrives mid-recording

- GIVEN a recording in progress
- WHEN an anomaly flag is raised for a previous record
- THEN the recorder keeps running until pointerup/cap AND the captured audio is processed
