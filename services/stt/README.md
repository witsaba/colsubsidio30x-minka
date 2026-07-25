# Module 1 — Speech-to-text service

Stateless FastAPI service that turns a push-to-talk audio clip into a verbatim
es-CO transcript. It is an independent deploy unit: its own `pyproject.toml`,
its own lockfile, its own image. It shares no process, datastore or runtime
dependency with Module 3 — only the repository's single Compose file, which
starts each service on its own (`docker compose up stt`).

Two rules define this service more than any feature:

- **Audio is never written to disk** (RNF-04). The upload is read into memory,
  forwarded to the vendor, and the reference dropped. No temp files, no
  `UploadFile.save()`. Two tests prove it, one on the success path and one on
  the vendor-error path.
- **The transcript is never logged** (Ley 1581). Per-request INFO records carry
  exactly `request_id`, `duration_ms` and `vendor` — not the transcript, not
  the confidence, not even the client-supplied filename.

## Running it

```bash
# tests
(cd services/stt && uv run pytest)

# local server
./scripts/setup-env.sh                    # asks for DEEPGRAM_API_KEY
uv run --project services/stt --directory services/stt \
  uvicorn src.main:app --port 8001

# container — from the repository root, one Compose file for every service
docker compose up --build stt
curl localhost:8001/health
```

The root `.env` is gitignored and must stay that way. `docs/deployment.md` is
the deployment guide for the whole repository.

## API

### `POST /transcribe`

`multipart/form-data` with a `file` field containing the audio blob. Responds
`200` with **exactly** these six fields — this shape is frozen with Module 2:

```json
{
  "raw_transcript": "tres kilos de lechuga y doce botellas de aceite",
  "is_garbage": false,
  "stt_confidence": 0.94,
  "audio_duration_ms": 4200,
  "stt_vendor": "deepgram",
  "request_id": "0f0b1f2e-..."
}
```

| Field | Type | Notes |
|---|---|---|
| `raw_transcript` | string | Verbatim. No inverse text normalisation — `novecientos` stays `novecientos`; RF-17 belongs to Module 2 |
| `is_garbage` | bool | A signal, not a verdict. Module 2 decides what to do |
| `stt_confidence` | float \| null | `null` when the vendor reports none |
| `audio_duration_ms` | int \| null | `null` when the vendor omits duration — chunked MediaRecorder webm often has no duration header. Never substituted with `0` |
| `stt_vendor` | string | The vendor that served this request |
| `request_id` | string | uuid4, unique per request, also present in every error body |

### `GET /health`

```json
{"status": "ok", "vendor": "deepgram"}
```

### `is_garbage` rules

`true` when **any** of these holds, otherwise `false`:

1. the stripped transcript is empty;
2. `stt_confidence` is known and below `STT_CONFIDENCE_FLOOR`;
3. `audio_duration_ms` is known and below `STT_MIN_SPEECH_MS`.

An unknown (`null`) confidence or duration never triggers on its own. A garbage
clip still returns `200` with the full shape.

### Errors

Every failure uses one envelope:

```json
{"error": {"code": "vendor_timeout", "message": "deepgram timed out", "request_id": "..."}}
```

| Condition | HTTP | `code` |
|---|---|---|
| Missing or invalid `file` field | 422 | FastAPI validation body |
| Upload above `STT_MAX_UPLOAD_BYTES` | 413 | `payload_too_large` |
| Vendor rejects the audio as undecodable | 400 | `invalid_audio` |
| Vendor timeout (`STT_VENDOR_TIMEOUT_S`) | 502 | `vendor_timeout` |
| Vendor 5xx, auth failure, other 4xx | 502 | `vendor_error` |
| Vendor answers 2xx with a body we cannot parse | 502 | `vendor_error` |
| Anything unexpected inside the service | 500 | `internal_error` |

A 2xx status is not a promise about the body. A proxy returning HTML, or a
vendor shipping a breaking change, is a `vendor_error` — never a bare 500 and
never an empty transcript passed off as a real one.

## Configuration

Loaded by pydantic-settings at boot. A missing API key **for the selected
vendor**, or for an explicitly named `STT_FALLBACK_VENDOR`, fails startup before
the first request; the remaining vendors' keys may stay empty. An unrecognised
`STT_VENDOR` also fails startup.

That check lives in `src/settings.py` and nowhere else — the root
`docker-compose.yml` passes every key through without requiring any, so a
single-vendor deployment (for example `STT_VENDOR=groq` with no Deepgram or
ElevenLabs key) comes up:

```bash
env -u DEEPGRAM_API_KEY STT_VENDOR=groq GROQ_API_KEY=... docker compose up stt
```

| Variable | Default | Meaning |
|---|---|---|
| `STT_VENDOR` | `deepgram` | `deepgram` \| `groq`. The only change needed to swap primary. `elevenlabs` is rejected at boot — backup only, see Vendors |
| `DEEPGRAM_API_KEY` | — | Required when Deepgram is active or the explicit fallback |
| `GROQ_API_KEY` | — | Required when Groq is active or the explicit fallback |
| `ELEVENLABS_API_KEY` | — | Required when ElevenLabs is the explicit fallback; enables it as an automatic backup |
| `STT_ELEVENLABS_MODEL` | `scribe_v1` | `scribe_v1` \| `scribe_v2` |
| `STT_LANGUAGE` | `es` | Dedicated Spanish model; never `multi` |
| `STT_MODEL` | `nova-3` | Deepgram model |
| `STT_NUMERALS` | `true` | Deepgram numeral handling |
| `STT_MIP_OPT_OUT` | `true` | Deepgram zero retention |
| `STT_CONFIDENCE_FLOOR` | `0.60` | `is_garbage` confidence trigger |
| `STT_MIN_SPEECH_MS` | `300` | `is_garbage` negligible-speech trigger |
| `STT_MAX_UPLOAD_BYTES` | `1048576` | Upload cap; see the note below |
| `STT_VENDOR_TIMEOUT_S` | `30` | Vendor call timeout |
| `STT_RETRY_ATTEMPTS` | `2` | Total attempts against the primary vendor, initial call included. `1` disables retry; `0` fails startup |
| `STT_RETRY_BACKOFF_S` | `0.5` | Base wait between primary attempts; doubles each time (0.5s, 1s, …) |
| `STT_FALLBACK_ENABLED` | `true` | Automatic failover to the backup chain. Needs those vendors' keys to be set |
| `STT_FALLBACK_VENDOR` | — (auto) | Which vendor takes over. Empty walks the priority order; naming one makes it the whole chain and its key required at boot |
| `STT_TOTAL_DEADLINE_S` | `45` | Ceiling on **all** vendor work for one request: every attempt, every backoff and every failover together. Must be > 0 |
| `LOG_LEVEL` | `INFO` | Standard logging level |
| `DEEPGRAM_BASE_URL` | `https://api.deepgram.com` | Override for testing |
| `GROQ_BASE_URL` | `https://api.groq.com` | Override for testing |

**How `STT_MAX_UPLOAD_BYTES` keeps audio off the disk.** Starlette does *not*
apply `max_part_size` to file parts — it streams them into a
`SpooledTemporaryFile` that flushes to a real inode past its spool threshold,
inside form parsing and therefore before any route code. `src/body_limit.py`
closes that gap in two moves: an ASGI guard in front of the app answers `413`
for any raw body over the cap (plus a 4 KiB multipart-envelope allowance),
counting streamed chunks in memory when there is no `Content-Length`; and
`MultiPartParser.spool_max_size` is raised to that same limit, so nothing the
guard admits can reach the spool threshold either. Changing the cap needs no
other edit. 1 MiB of Opus is over five minutes of voice — far beyond any
push-to-talk clip.

## Vendors

Three vendors. `STT_VENDOR` picks the primary and nothing else changes — but
it accepts `deepgram` or `groq` only. **ElevenLabs is a backup, never a
primary**: its zero-retention guarantee is Enterprise-gated and documented as
revocable at the vendor's discretion, so RNF-04 ("audio is never persisted")
does not permit routing every clip through it. Reaching it as a failover
target is a bounded, deliberate exposure — it only happens once the primary is
already failing — and `STT_VENDOR=elevenlabs` fails startup with that reason.

| | Deepgram (default) | Groq | ElevenLabs |
|---|---|---|---|
| Request | `POST /v1/listen?model=nova-3&language=es&numerals=true&mip_opt_out=true`, raw bytes | `POST /openai/v1/audio/transcriptions`, multipart, `whisper-large-v3-turbo`, `verbose_json` | `POST /v1/speech-to-text`, multipart, `scribe_v1`, `language_code=es`, `tag_audio_events=false` |
| Auth | `Authorization: Token …` | `Authorization: Bearer …` | `xi-api-key: …` |
| Confidence | Vendor-reported | Derived: clamped mean of `exp(avg_logprob)` over segments | Vendor-reported `language_probability` |

Groq's confidence is an **uncalibrated proxy**. It exists so the `is_garbage`
confidence trigger keeps working there; it is not comparable to Deepgram's
number and must not be presented as one.

ElevenLabs sends `tag_audio_events=false` deliberately: annotations such as
`[laughter]` would otherwise land inside `raw_transcript`, and Module 2 reads
that text as an inventory line. Its `422` is a generic validation error, not
"bad audio", so it maps to `vendor_error` rather than `invalid_audio` — a
rejected `model_id` is our bug, not the caller's.

### Retry and failover

A vendor hiccup should not cost the speaker a dictation, so the primary vendor
gets `STT_RETRY_ATTEMPTS` tries with an exponential backoff, and then — if
`STT_FALLBACK_ENABLED` is on — each configured backup gets exactly one attempt,
in order, until one answers.

The sanctioned chain is **Deepgram → ElevenLabs → Groq**. ElevenLabs is the
second layer because it is the stronger Spanish transcriber and the primary has
already failed by the time it is reached; Groq is the last resort for the same
reason read the other way.

Which vendors take over is either named or derived:

- **Explicit**: set `STT_FALLBACK_VENDOR`. It must differ from `STT_VENDOR` and
  its key must be present, both checked at boot. Naming a fallback you have no
  key for is a safety net that would never fire, and you would find out during
  an outage; the service refuses to start instead. A named fallback is the
  *whole* chain — the service will not walk past it to a vendor you did not
  choose.
- **Auto** (`STT_FALLBACK_VENDOR` empty): every vendor other than the primary
  that has a key, in the fixed order `deepgram`, `elevenlabs`, `groq`. A vendor
  with no key is skipped silently — that is the right default, and it is why the
  explicit form is stricter. If nothing qualifies there is no failover.

Only failures a retry could plausibly fix are eligible: timeouts, connection
errors, and HTTP 429/500/502/503/504. A 400, 401 or 403, audio the vendor
rejects, or a 2xx body we cannot parse fails on the first attempt — asking
again returns the same answer and the speaker pays for the wait.

`stt_vendor` in the response and `vendor` in the request log always name the
vendor that **actually served** the request, not the configured one. When every
layer fails, the caller gets the primary's failure class.

Retries multiply the worst-case wait — with the defaults above and all three
keys set, per-call timeouts alone would allow 30 + 0.5 + 30 + 30 + 30 s before a
502. `STT_TOTAL_DEADLINE_S`
caps the whole of it, so resilience never buys itself with availability. When
the budget runs out the answer is the same `502 vendor_timeout` as a single
vendor timeout, because that is what it is, and the request log names the
vendor that was in flight when it expired.

Auto failover needs the chosen vendor's key to be present; a missing one is
still tolerated at boot, so the feature switches itself off rather than
blocking startup. The root `docker-compose.yml` passes every key through
without requiring any, which is what makes a single-vendor deployment possible.

Calls go through `httpx` only — no vendor SDK is a dependency, which is what
makes the swap a function swap.

## Layout

```
services/stt/
├── src/
│   ├── main.py            create_app(), shared AsyncClient, error envelope
│   ├── body_limit.py      ASGI body guard: 413 before anything can spool to disk
│   ├── transcribe.py      routes, vendor dispatch, evaluate_garbage
│   ├── settings.py        boot-time configuration
│   ├── logging_setup.py   stdlib logging
│   └── vendors/           base protocol + deepgram, groq, elevenlabs adapters
├── tests/                 contract, privacy, adapters, settings, vendor switch
└── docs/dod-live-checks.md  live-key checks that need real credentials
```
