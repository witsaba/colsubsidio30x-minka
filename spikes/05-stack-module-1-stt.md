# Stack — Module 1: Speech-to-text service

Scope: **backend only**. This is one of the two modules Braejan committed to in
the 24 Jul meeting (`00:54:21`). It is an independent, self-contained service
with its own stack and its own `docker-compose`. It shares no process, no
datastore and no deployment unit with Module 3.

Read `01-speech-to-text.md` for why Deepgram was chosen and what the kill
criteria are. This document is the build spec.

## Stack

| Concern | Choice | Rationale |
| :--- | :--- | :--- |
| Runtime | Python 3.11+, managed by **`uv`** | Repository convention (`pyproject.toml` + `uv.lock`, no `requirements.txt`) |
| API framework | **FastAPI** + **uvicorn** | Async, multipart upload handled natively, OpenAPI schema for free — the contract with Module 2 becomes self-documenting |
| HTTP client | **httpx** (async), no vendor SDK | The whole call is one multipart POST. Staying on raw HTTP means the Groq fallback is a function swap, not a dependency change — Groq is OpenAI-compatible, Deepgram is not |
| Config | **pydantic-settings** | Env-var validation at boot; a missing API key fails at startup, not at the first request on stage |
| Tests | **pytest** + **pytest-asyncio** + **respx** (httpx mocking) | `respx` lets every vendor-error path be tested without burning API credits |
| Container | `python:3.12-slim`, `uv sync --frozen` | Small, reproducible, no compiler toolchain needed |

**Deliberately absent**: no database, no cache, no queue, no ORM. This service
is stateless by design — it has no state to keep, and that is the point.

## Service contract

One endpoint, plus health.

```
POST /transcribe        multipart/form-data: file=<audio blob>
GET  /health            → {"status": "ok", "vendor": "deepgram"}
```

Response — **this is the contract with Daniel's Module 2. Freeze it at the
06:00 sync before either side builds against it.**

```json
{
  "raw_transcript": "tres kilos de lechuga y doce botellas de aceite",
  "is_garbage": false,
  "stt_confidence": 0.94,
  "audio_duration_ms": 4200,
  "stt_vendor": "deepgram",
  "request_id": "uuid"
}
```

Rules that belong to this service and nowhere else:

- **It returns what was said.** Inverse Text Normalisation (`novecientos` → 900,
  RF-17) belongs to Module 2, whose prompt already emits structured output.
- `is_garbage` is a signal, not a verdict: set it when the vendor returns an
  empty transcript, when confidence falls below a configured floor, or when
  detected speech duration is negligible. Module 2 decides what to do about it.
- **Audio is never written to disk.** Read the upload into memory, forward it,
  drop the reference. No temp files, no logging of audio bytes, no
  `UploadFile.save()`. This is RNF-04 and it is not negotiable — a stray temp
  file makes the privacy claim false.
- Log the `request_id`, duration and vendor. Never log the transcript body at
  INFO — it is personal data under Ley 1581.

## Vendor configuration

```
DEEPGRAM_API_KEY=...
STT_VENDOR=deepgram            # deepgram | groq
STT_LANGUAGE=es                # es-CO scope: dedicated Spanish model, never multi
STT_MODEL=nova-3
STT_NUMERALS=true
STT_MIP_OPT_OUT=true           # zero retention — verify it does not change billing
STT_CONFIDENCE_FLOOR=0.60
GROQ_API_KEY=...               # fallback vendor
```

`STT_VENDOR` must be a real runtime switch, not a code branch to be written
later. The kill criteria in `01-speech-to-text.md` require swapping vendors
**mid-build**; if that swap needs a refactor, the kill criteria are decorative.

## docker-compose

`services/stt/docker-compose.yml`:

```yaml
services:
  stt:
    build: .
    ports:
      - "8001:8001"
    environment:
      DEEPGRAM_API_KEY: ${DEEPGRAM_API_KEY:?set it in .env}
      GROQ_API_KEY: ${GROQ_API_KEY:-}
      STT_VENDOR: ${STT_VENDOR:-deepgram}
      STT_LANGUAGE: es
      STT_MODEL: nova-3
      STT_NUMERALS: "true"
      STT_MIP_OPT_OUT: "true"
      STT_CONFIDENCE_FLOOR: "0.60"
    healthcheck:
      test: ["CMD", "python", "-c",
             "import urllib.request;urllib.request.urlopen('http://localhost:8001/health')"]
      interval: 10s
      timeout: 3s
      retries: 3
    restart: unless-stopped
```

`services/stt/Dockerfile`:

```dockerfile
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY src/ ./src/
EXPOSE 8001
CMD ["uv", "run", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8001"]
```

Bring it up with `docker compose up --build`. `.env` stays out of git.

## Benchmark harness — a first-class deliverable

This is the evidence behind the `< 1 %` claim. It is not an afterthought, and
it is what the pitch actually rests on.

```
benchmarks/
├── corpus/          audio clips + labels.csv (clip_id, transcript, items[], is_garbage)
├── run.py           fans clips at the service concurrently, writes results.json
└── report.py        renders the metrics table
```

Score **two** things, not WER:

1. **Digit accuracy** — every quantity token, exact match. "Said 90, transcribed
   900" is a discrete failure, not a fractional WER penalty.
2. **Hallucination rate on garbage clips** — any inventory-shaped output from a
   clip that contains none. Run **all** garbage clips, never a sample.

WER stays as a secondary sanity signal. Report accuracy split by clip
condition (clean / noisy / spontaneous) — a single blended number hides the
case that matters.

## Working agreement

**Strict TDD is enabled for this repository**: failing test first, then
implementation, then green. For this service that means the contract test
(`POST /transcribe` returns the frozen JSON shape) and the "audio is never
persisted" test exist *before* the Deepgram call does. Both are cheap with
`respx` and both protect claims made to the client.

## Definition of done

- [ ] `docker compose up` yields a healthy service that transcribes a real clip.
- [ ] Vendor swap works by changing one env var, verified with both keys.
- [ ] `mip_opt_out=true` confirmed accepted against a live key, and the billed
      rate checked.
- [ ] A raw MediaRecorder blob recorded **in timeslice chunks** transcribes
      correctly — chunked webm often lacks a duration header.
- [ ] Test proving no audio is written to disk during a request.
- [ ] Benchmark runs end to end and emits the metrics table.
- [ ] Response shape agreed with Daniel and frozen.
