# Design: Implement STT Service (Module 1)

## Technical Approach

Stateless FastAPI app in a self-contained `services/stt/` project. One route module, two vendor adapter functions behind a registry keyed by `STT_VENDOR`, all vendor I/O through one shared `httpx.AsyncClient` (created in app lifespan). Dockerfile and docker-compose adopted verbatim from `spikes/05-stack-module-1-stt.md` (port 8001, healthcheck, `restart: unless-stopped`, `.env` out of git). Benchmark harness at repo root reuses the service's uv environment.

## Architecture Decisions

| # | Decision | Choice | Rejected alternative | Rationale |
|---|----------|--------|----------------------|-----------|
| 1 | Project layout | `services/stt/` with its OWN `pyproject.toml` + `uv.lock` | Grafting fastapi/uvicorn/httpx onto root pyproject (as proposal's affected-areas row implied) | Root project is data tooling (pandas/openpyxl); each module is an independent deploy unit; spike Dockerfile copies lockfiles from local context. Cost accepted: second lockfile, commands need `uv run --project services/stt`. **Supersedes the proposal's "root pyproject modified" row — root stays untouched.** |
| 2 | Benchmarks env | `benchmarks/` at repo root, executed via `uv run --project services/stt` | Third pyproject under `benchmarks/` | httpx + pytest already in the service env; avoids a third lockfile. |
| 3 | Adapter shape | Module-level async functions matching a `VendorAdapter` Protocol; registry dict resolved once at boot | ABC hierarchy; vendor SDKs | Spike requires vendor swap = function swap; Protocol gives typing without inheritance. |
| 4 | Groq confidence | Unweighted mean of `exp(avg_logprob)` over `verbose_json` segments, clamped to [0,1] | Return `None` and skip the floor trigger | Keeps the `is_garbage` confidence trigger alive on the fallback vendor. Documented as an uncalibrated proxy — NOT comparable to Deepgram's confidence; `STT_CONFIDENCE_FLOOR` applies to it as-is. |
| 5 | Missing duration | `audio_duration_ms` is nullable; `null` = vendor omitted it (chunked webm without duration header) | Return `0` | `0` would falsely fire the negligible-speech trigger. Nullability must be confirmed at the 06:00 contract freeze. |
| 6 | Upload cap | `STT_MAX_UPLOAD_BYTES` default 1 MiB, aligned with Starlette's `max_part_size` and `SpooledTemporaryFile` 1 MiB spool threshold | Larger cap + custom streaming multipart parser | ≤1 MiB Opus ≈ 5+ min of voice, far above push-to-talk clips; guarantees the spool never rolls to disk (RNF-04). Raising the cap later requires revisiting the spool threshold — coupling recorded. |
| 7 | No-disk proof | Test monkeypatches `SpooledTemporaryFile.rollover`, `NamedTemporaryFile`, and `tempfile.mkstemp` to raise, then sends a max-size request (respx-mocked vendor) and asserts 200 | Watching `tempfile.gettempdir()` during the request | Patching is deterministic and hermetic; filesystem watching is flaky. |
| 8 | Logging | stdlib `logging`; `request_id` (uuid4, generated per request — it is in the response contract) passed explicitly; transcript body never logged at ANY level | structlog; contextvar middleware | Honors the spike's "deliberately absent" dependency philosophy; one endpoint needs no middleware. Per REQ-PRV-3 (Ley 1581), per-request INFO fields are ONLY request_id, duration, vendor; byte size and is_garbage log at DEBUG. |
| 9 | is_garbage placement | Pure function in route layer, vendor-agnostic | Inside each adapter | Single implementation of policy; adapters only map vendor payloads. |
| 10 | WER | Internal token-level Levenshtein (~20 lines, unit-tested) | `jiwer` dependency | WER is a secondary sanity signal only. |
| 11 | Hallucination detector | Deterministic "inventory-shaped output" pattern (spike-05:138, REQ-BMK-4). After normalization (lowercase, unaccent, strip punctuation, tokenize on whitespace), a garbage clip counts as hallucinated iff its transcript matches QUANTITY-NEAR-ITEM: a quantity token (regex `\d+` or a Spanish number word from a closed list — `un/uno/una, dos…diez, once…quince, dieciseis…veintinueve, treinta…noventa, cien/cientos, quinientos, mil, docena, medio/media`) followed within two tokens by an alphabetic token of length ≥3 not in a filler stoplist (`eh, este, pues, bueno, sea, ya, entonces, mmm, ah, listo`) | Non-empty-transcript proxy | A bare filler transcript ("eh…") is a correct low-content transcription, not an invented inventory line — the proxy overcounts. Pattern is deterministic and unit-testable. Accepted false negative: an item hallucinated without any quantity token is not counted; noted in the report caveat. |

## Data Flow

    Module 2 ──multipart──▶ /transcribe ──bytes──▶ ADAPTERS[STT_VENDOR] ──httpx──▶ Deepgram | Groq
                                │◀── TranscriptionResult ──┘
                                ├─ evaluate_garbage(result, settings)
                                └─▶ frozen JSON {raw_transcript, is_garbage, stt_confidence,
                                                 audio_duration_ms, stt_vendor, request_id}

Audio path: `await file.read()` → forward → drop reference. No temp files, no `UploadFile.save()`.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `services/stt/pyproject.toml`, `uv.lock` | Create | fastapi, uvicorn, httpx, pydantic-settings; dev: pytest, pytest-asyncio, respx |
| `services/stt/src/main.py` | Create | `create_app()` factory + lifespan (shared `AsyncClient`); `app = create_app()` for `src.main:app` |
| `services/stt/src/settings.py` | Create | pydantic-settings; key for the ACTIVE vendor required at boot |
| `services/stt/src/transcribe.py` | Create | `/transcribe`, `/health`, `evaluate_garbage`, error mapping |
| `services/stt/src/vendors/{base,deepgram,groq}.py` | Create | Protocol + `TranscriptionResult`; two adapters |
| `services/stt/src/logging_setup.py` | Create | stdlib logging config, `LOG_LEVEL` env |
| `services/stt/Dockerfile`, `docker-compose.yml` | Create | Verbatim from spike 05 |
| `services/stt/tests/*` | Create | See Testing Strategy |
| `benchmarks/run.py`, `report.py`, `corpus/` | Create | Harness (below) |
| `spikes/01-speech-to-text.md:137`, `spikes/README.md:29` | Modify | Stale `language=multi` doc-drift fix |

## Interfaces / Contracts

```python
class TranscriptionResult(BaseModel):
    raw_transcript: str
    stt_confidence: float | None
    audio_duration_ms: int | None

class VendorAdapter(Protocol):
    async def __call__(self, audio: bytes, content_type: str,
                       settings: Settings, client: httpx.AsyncClient) -> TranscriptionResult: ...

ADAPTERS = {"deepgram": deepgram.transcribe, "groq": groq.transcribe}
```

Vendor mapping:

| | Deepgram | Groq |
|---|---|---|
| Request | `POST /v1/listen?model=nova-3&language=es&numerals=true&mip_opt_out=true`, raw bytes body + Content-Type | `POST /openai/v1/audio/transcriptions` multipart: `model=whisper-large-v3-turbo`, `language=es`, `response_format=verbose_json` |
| transcript / confidence / duration | `channels[0].alternatives[0]` `.transcript` / `.confidence`; `metadata.duration` s→ms | `text`; mean `exp(avg_logprob)`; `duration` s→ms |

`is_garbage` triggers (any): empty stripped transcript; `stt_confidence < STT_CONFIDENCE_FLOOR` (when confidence known); `audio_duration_ms < STT_MIN_SPEECH_MS` (default 300, only when duration known).

Error shape `{"error": {"code", "message", "request_id"}}`:

| Condition | HTTP | code |
|---|---|---|
| Missing/invalid multipart field | 422 | FastAPI default |
| Upload > `STT_MAX_UPLOAD_BYTES` | 413 | `payload_too_large` |
| Vendor rejects audio as undecodable (audio-related 4xx) | 400 | `invalid_audio` |
| Vendor timeout (`STT_VENDOR_TIMEOUT_S` default 30) | 502 | `vendor_timeout` (REQ-STT-5 freezes 502) |
| Vendor 5xx / auth / other 4xx | 502 | `vendor_error` |

New settings beyond spike: `STT_MIN_SPEECH_MS=300`, `STT_MAX_UPLOAD_BYTES=1048576`, `STT_VENDOR_TIMEOUT_S=30`, `LOG_LEVEL=INFO`.

Benchmark: `corpus/labels.csv` = `clip_id, condition(clean|noisy|spontaneous), transcript, items` (JSON string)`, is_garbage`. `garbage` is NOT a condition — a garbage clip carries a condition plus `is_garbage=true` (spike-05, REQ-BMK-1/6). `run.py`: asyncio + semaphore (default 4) against `BENCH_STT_URL`, writes `results.json` = `{run_at, vendor, base_url, clips:[{clip_id, condition, status, response, latency_ms, error}]}`. `report.py`: digit accuracy (numeric-token exact match) split by condition; hallucination rate over ALL garbage clips using the Decision 11 inventory-shaped detector; WER secondary; prints corpus-validity caveat.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `evaluate_garbage` triggers incl. null duration; settings boot validation (missing key per vendor); Groq confidence mapping; WER fn | plain pytest |
| Integration | Frozen `/transcribe` shape; `/health`; error taxonomy; 413; no-disk-write on the success path AND a second no-disk-write test on the vendor-timeout error path (REQ-PRV-1, second scenario) | httpx `ASGITransport` + respx vendor mocks |
| Benchmark | `run.py` vs fake service; `report.py` metrics on fixture results.json | respx / tmp fixtures |
| Manual DoD | Live keys: mip_opt_out billing, vendor swap, timeslice-webm clip | scripted checklist, not CI |

Strict TDD ordering: contract test and both no-disk-write tests (success path + vendor-timeout error path) authored FAILING before any adapter code exists.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. (Compose healthcheck `python -c` is spike-verbatim config, not designed here.)

## Migration / Rollout

No migration. Additive; rollback = revert `feat/stt-service`.

## Open Questions

- [ ] Confirm nullable `audio_duration_ms` with Daniel at the 06:00 contract freeze.
- [ ] Pin a Starlette version and verify `max_part_size`/spool behavior matches Decision 6 (RED test covers it either way).
- [ ] `mip_opt_out=true` billing effect — live-key DoD check, unresolvable at design time.
