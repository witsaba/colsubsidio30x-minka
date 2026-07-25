# Module 1 — Speech-to-text service

Stateless FastAPI service that turns a push-to-talk audio clip into a verbatim
es-CO transcript. It is an independent deploy unit: its own `pyproject.toml`,
its own lockfile, its own `docker-compose.yml`. It shares no process, datastore
or deployment unit with Module 3.

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
cd services/stt && cp .env.example .env   # then fill in DEEPGRAM_API_KEY
uv run --project services/stt --directory services/stt \
  uvicorn src.main:app --port 8001

# container
docker compose -f services/stt/docker-compose.yml up --build
curl localhost:8001/health
```

`.env` is gitignored and must stay that way.

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
vendor** fails startup before the first request; the other vendor's key may stay
empty. An unrecognised `STT_VENDOR` also fails startup.

| Variable | Default | Meaning |
|---|---|---|
| `STT_VENDOR` | `deepgram` | `deepgram` \| `groq`. The only change needed to swap vendor |
| `DEEPGRAM_API_KEY` | — | Required when Deepgram is active |
| `GROQ_API_KEY` | — | Required when Groq is active |
| `STT_LANGUAGE` | `es` | Dedicated Spanish model; never `multi` |
| `STT_MODEL` | `nova-3` | Deepgram model |
| `STT_NUMERALS` | `true` | Deepgram numeral handling |
| `STT_MIP_OPT_OUT` | `true` | Deepgram zero retention |
| `STT_CONFIDENCE_FLOOR` | `0.60` | `is_garbage` confidence trigger |
| `STT_MIN_SPEECH_MS` | `300` | `is_garbage` negligible-speech trigger |
| `STT_MAX_UPLOAD_BYTES` | `1048576` | Upload cap; see the note below |
| `STT_VENDOR_TIMEOUT_S` | `30` | Vendor call timeout |
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

| | Deepgram (primary) | Groq (fallback) |
|---|---|---|
| Request | `POST /v1/listen?model=nova-3&language=es&numerals=true&mip_opt_out=true`, raw bytes | `POST /openai/v1/audio/transcriptions`, multipart, `whisper-large-v3-turbo`, `verbose_json` |
| Confidence | Vendor-reported | Derived: clamped mean of `exp(avg_logprob)` over segments |

Groq's confidence is an **uncalibrated proxy**. It exists so the `is_garbage`
confidence trigger keeps working on the fallback vendor; it is not comparable to
Deepgram's number and must not be presented as one.

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
│   └── vendors/           base protocol + deepgram + groq adapters
├── tests/                 contract, privacy, adapters, settings, vendor switch
└── docs/dod-live-checks.md  live-key checks that need real credentials
```
