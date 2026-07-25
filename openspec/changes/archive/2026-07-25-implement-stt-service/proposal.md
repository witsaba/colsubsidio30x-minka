# Proposal: Implement STT Service (Module 1)

## Intent

Operators need push-to-talk voice capture turned into a raw Spanish transcript for Module 2. No Module 1 code exists; the vendor decision and build spec are done (`spikes/01-speech-to-text.md`, `spikes/05-stack-module-1-stt.md`). Build the stateless STT backend service now so the frozen `POST /transcribe` contract can be agreed with Daniel and the accuracy claims backed by measurable evidence.

## Scope

### In Scope
- `services/stt/` FastAPI service on port 8001: `POST /transcribe` (multipart), `GET /health`, frozen JSON response shape per the spike.
- Deepgram Nova-3 (`language=es`) primary adapter + Groq whisper-large-v3-turbo fallback, switched at runtime by `STT_VENDOR`; httpx only, no vendor SDKs.
- pydantic-settings config; missing API key fails at boot.
- `services/stt/Dockerfile` + `docker-compose.yml` per spike.
- Benchmark harness `benchmarks/` (corpus layout, `run.py`, `report.py`) scoring digit accuracy and garbage-clip hallucination rate; WER secondary. Runs on whatever clips exist.
- Doc-drift fix: stale `language=multi` phrasing at `spikes/01-speech-to-text.md:137` and `spikes/README.md:29`.

### Out of Scope
- Module 2 (extraction/ITN — RF-17) and Module 3 (matching).
- Frontend and any browser VAD/energy gate.
- Real corpus recording; Supabase; Ley 1581 legal-text fix (follow-up).

## Capabilities

### New Capabilities
- `stt-transcription`: frozen `/transcribe` + `/health` contract, `is_garbage` signal rules.
- `stt-vendor-adapters`: Deepgram/Groq adapters, `STT_VENDOR` runtime switch, boot-time config validation.
- `stt-privacy`: audio never persisted (RNF-04); transcript never logged at INFO (Ley 1581).
- `stt-benchmark`: corpus format, concurrent runner, metrics report split by clip condition.

### Modified Capabilities
- None.

## Approach

Stateless FastAPI app; upload read into memory, forwarded via httpx, reference dropped. Vendor adapters as swappable functions behind one env var. Strict TDD: the frozen contract test and the "audio is never persisted" test exist (failing) before the Deepgram call does; `respx` mocks all vendor paths; `uv run pytest`. Delivery on single branch `feat/stt-service`, 800-line review budget, auto-chain into chained PRs only if the tasks forecast exceeds it.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `services/stt/` | New | App, adapters, tests, Dockerfile, compose |
| `benchmarks/` | New | Corpus layout, run.py, report.py |
| `pyproject.toml`, `uv.lock` | Modified | fastapi, uvicorn, httpx, pydantic-settings, pytest-asyncio, respx |
| `spikes/01-speech-to-text.md`, `spikes/README.md` | Modified | Two-line `language=multi` doc-drift fix |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| `mip_opt_out=true` changes Deepgram billing | Med | Verify against live key (DoD item) |
| Chunked webm lacks duration header, trips decoders | Med | Explicit timeslice-blob verification task |
| Garbage-clip hallucination unmeasured | Med | Benchmark measures it; VAD gate is frontend follow-up if both vendors fail |
| Corpus validity (self-recorded, same-person label) | High | Caveat in report; real corpus out of scope |

## Rollback Plan

Additive change only (new directories + dependency additions). Rollback = revert `feat/stt-service`; no data migrations.

## Dependencies

- Live Deepgram and Groq API keys for DoD verification.
- 06:00 sync with Daniel to freeze the response shape.

## Success Criteria

- [ ] `docker compose up` healthy; transcribes a real clip.
- [ ] Vendor swap via one env var, verified with both keys.
- [ ] `mip_opt_out=true` accepted on a live key; billed rate checked.
- [ ] Chunked MediaRecorder timeslice blob transcribes correctly.
- [ ] "No audio written to disk" test green.
- [ ] Benchmark emits metrics table end to end.
- [ ] Response shape frozen with Daniel at the 06:00 sync.
