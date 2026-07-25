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

| 12 | Vendor resilience | Bounded retry of the primary vendor with exponential backoff, then one attempt on the other vendor when its key is configured | Retry only; or fail fast to Module 2 | A single vendor hiccup otherwise costs the speaker a whole dictation, and the Groq adapter was a fallback in name only — nothing ever called it. `STT_RETRY_ATTEMPTS` (default 2, minimum 1) bounds the primary; `STT_RETRY_BACKOFF_S` (default 0.5s) doubles between attempts; `STT_FALLBACK_ENABLED` (default true) gates the failover. Only failures that a retry could plausibly fix are eligible — timeout, connect error, 429, 5xx. A 400/401/403, rejected audio or an unparsable body fails on the first attempt, because asking again returns the same answer and the speaker pays for the wait. The response's `stt_vendor` and the INFO log's `vendor` name the vendor that actually served, not the configured one; when both vendors fail, the primary's failure class is what the caller sees. `STT_TOTAL_DEADLINE_S` (default 45s) caps the whole of `dispatch` — every attempt, every backoff, and the failover together — because the per-call settings otherwise multiply out to a ~90.5s worst case that no single knob expresses, and the caller is a person holding a push-to-talk button; budget exhaustion answers with the same `502 vendor_timeout` as a single vendor timeout. |

| 13 | Third vendor and failover selection | ElevenLabs Scribe as a peer vendor (primary or fallback); `STT_FALLBACK_VENDOR` names the failover target, otherwise a fixed priority order `deepgram, groq, elevenlabs` picks the first candidate with a key | Fallback-only ElevenLabs; averaging its word `logprob`s for confidence; auto-only selection | Confidence comes from `language_probability`, the vendor's own transcript-level score: Groq needs a derived proxy because it reports nothing comparable, but inventing a second proxy where the vendor already publishes one would add noise and an incomparable scale for no gain. The priority order is explicit rather than "whatever `ADAPTERS` iterates as", because which vendor takes over is an operational decision and a test keeps the order in step with the registry. An explicitly named fallback fails boot when its key is absent, while auto-selection silently skips a keyless vendor: skipping is the right default, but naming a fallback you cannot authenticate is a safety net that never fires and would only be discovered during an outage. ElevenLabs' 422 is a generic validation error covering fields we control (`model_id`), so it maps to `vendor_error`, not `invalid_audio`. |

**Correction to Decision 6 (JD-1).** Aligning `STT_MAX_UPLOAD_BYTES` with Starlette's spool threshold did *not* guarantee what it claimed: Starlette 0.47.3 never applies `max_part_size` to file parts, so a 1 MiB + 1 upload rolled the `SpooledTemporaryFile` over to a real inode inside form parsing — before the route's cap check could run. `src/body_limit.py` replaces the coupling with an ASGI guard that answers 413 on the raw body before parsing, and pins the spool threshold to that same limit. The cap is now a single number to change, not a number plus a library invariant to re-derive.

## Data Flow

    Module 2 ──multipart──▶ /transcribe ──bytes──▶ ADAPTERS[STT_VENDOR] ──httpx──▶ Deepgram | Groq
                                │◀── TranscriptionResult ──┘
                                ├─ evaluate_garbage(result, settings)
                                └─▶ frozen JSON {raw_transcript, is_garbage, stt_confidence,
                                                 audio_duration_ms, stt_vendor, request_id}

Audio path: `await file.read()` → forward → drop reference. No temp files, no `UploadFile.save()`.

## Migration / Rollout

No migration. Additive; rollback = revert `feat/stt-service`.

## Open Questions

- [x] Confirm nullable `audio_duration_ms` with Daniel at the 06:00 contract freeze — RATIFIED post-JD (pending T25 formal sync)
- [x] Pin a Starlette version and verify `max_part_size`/spool behavior — CLOSED via range pin `>=0.41,<0.48` + RED test
- [ ] `mip_opt_out=true` billing effect — live-key DoD check (T21), unresolvable at design time
