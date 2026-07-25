# Tasks: Implement STT Service (Module 1)

Branch `feat/stt-service`. Strict TDD: every RED task must be committed (or at
least run) failing before its GREEN pair. Test command inside the service:
`(cd services/stt && uv run pytest)`; from the repo root:
`uv run --project services/stt pytest`. Threat matrix is N/A (design §Threat
Matrix), so no threat RED tasks exist. Each task is one reviewable work-unit
commit and must leave the checkout coherent.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~3,150 authored (≈1,900 code/tests + ≈1,250 SDD docs); `uv.lock` generated, excluded |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 → PR 5 → PR 6 → PR 7 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
400-line budget risk: High

Per-PR estimate: PR1 ~1,250 (docs only — request `size:exception`, readability
lens); PR2 ~250; PR3 ~700; PR4 ~330; PR5 ~700; PR6 ~150; PR7 ~60. All code PRs
fit the 800-line session budget; only PR1 needs the documentation exception.

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|------|------|-----------|----------------------|-----------------|-------------------|
| 1 | SDD artefacts tracked + doc-drift fix (T1–T2) | PR 1 | N/A (docs) — `git grep -n 'language=multi' spikes/` returns nothing | N/A — no runtime surface | `git revert` the two doc commits |
| 2 | uv project, settings, logging, `evaluate_garbage` (T3–T7) | PR 2 | `(cd services/stt && uv run pytest tests/test_settings.py tests/test_garbage.py)` | `uv run --project services/stt python -c "from src.settings import Settings; Settings()"` | `git rm -r services/stt` |
| 3 | Frozen contract, privacy, Deepgram adapter (T8–T12) | PR 3 | `(cd services/stt && uv run pytest tests/test_contract.py tests/test_privacy.py tests/test_deepgram.py)` | `uv run --project services/stt uvicorn src.main:app --port 8001` + `curl :8001/health` | revert to PR 2 tree; `src/main.py`, `src/transcribe.py`, `src/vendors/` removable |
| 4 | Groq fallback, vendor swap, Docker packaging (T13–T15) | PR 4 | `(cd services/stt && uv run pytest tests/test_groq.py tests/test_vendor_switch.py)` | `docker compose -f services/stt/docker-compose.yml config` | delete `src/vendors/groq.py`, registry entry, `Dockerfile`, `docker-compose.yml` |
| 5 | Benchmark metrics + runner (T16–T19) | PR 5 | `uv run --project services/stt pytest benchmarks/tests` | `uv run --project services/stt python benchmarks/run.py --dry-run` | `git rm -r benchmarks` |
| 6 | READMEs + live-DoD checklist scaffold (T20) | PR 6 | `(cd services/stt && uv run pytest)` full suite | `docker compose -f services/stt/docker-compose.yml up -d && curl :8001/health` | revert doc commit only |
| 7 | Live-key DoD evidence (T21–T24) `blocked-without-keys` | PR 7 | N/A — manual, keys required | `docker compose up` with real `.env` | evidence file only; no code |

## Phase 1: Foundation

- [x] **T1 — Track the SDD artefacts.** Add currently untracked `openspec/config.yaml`, `openspec/project.md`, and `openspec/changes/implement-stt-service/` (explore, proposal, design, `specs/*/spec.md`, this tasks.md); no code. **Verify:** `git status --short openspec/` is clean and `openspec/changes/implement-stt-service/specs` lists 4 capabilities. **Rollback:** `git revert` the commit (files return to untracked).

- [x] **T2 — Fix `language=multi` doc drift.** Modify exactly two lines: `spikes/01-speech-to-text.md:137` and `spikes/README.md:29` → es-CO / `language=es`. Satisfies REQ-VND-1. **Verify:** `git grep -n 'language=multi' spikes/` returns nothing; `git diff --stat HEAD~1` shows 2 files, ≤4 lines. **Rollback:** `git revert` the commit.

- [x] **T3 — Scaffold the self-contained uv project.** Add `services/stt/pyproject.toml` (fastapi, uvicorn, httpx, pydantic-settings, pinned starlette; dev: pytest, pytest-asyncio, respx), generated `services/stt/uv.lock`, `[tool.pytest.ini_options] asyncio_mode`, `services/stt/src/__init__.py`, `services/stt/tests/__init__.py`, `.gitignore` entry for `services/stt/.env`. Root `pyproject.toml` stays untouched (design §1). Satisfies REQ-VND-4. **Verify:** `uv sync --project services/stt` succeeds; `(cd services/stt && uv run pytest --collect-only)` exits cleanly with 0 tests; `git grep -nE 'deepgram-sdk|groq(-sdk)?|openai' services/stt/pyproject.toml` returns nothing; root `pyproject.toml` unchanged in `git diff --stat`. **Rollback:** `git rm -r services/stt`.

## Phase 2: Configuration and pure policy (TDD)

- [x] **T4 — RED: settings boot validation tests.** Add `services/stt/tests/test_settings.py`: missing key for the ACTIVE vendor raises at boot; non-selected vendor key optional; invalid `STT_VENDOR` fails boot; defaults `STT_MIN_SPEECH_MS=300`, `STT_MAX_UPLOAD_BYTES=1048576`, `STT_VENDOR_TIMEOUT_S=30`, `LOG_LEVEL=INFO`, `STT_CONFIDENCE_FLOOR`. Satisfies REQ-VND-3, REQ-VND-5. **Verify:** `(cd services/stt && uv run pytest tests/test_settings.py)` FAILS on missing `src.settings`. **Rollback:** `git rm services/stt/tests/test_settings.py`.

- [x] **T5 — GREEN: settings and logging.** Add `services/stt/src/settings.py` (pydantic-settings, active-vendor key required) and `services/stt/src/logging_setup.py` (stdlib logging, `LOG_LEVEL`). Satisfies REQ-VND-3, REQ-VND-5, REQ-PRV-3. **Verify:** `(cd services/stt && uv run pytest tests/test_settings.py)` passes. **Rollback:** `git rm services/stt/src/settings.py services/stt/src/logging_setup.py`.

- [x] **T6 — RED: `evaluate_garbage` unit tests.** Add `services/stt/tests/test_garbage.py`: empty stripped transcript → true; confidence `0.40` under floor `0.60` → true; normal clip → false; `audio_duration_ms` below `STT_MIN_SPEECH_MS` → true; **null duration alone does NOT flag garbage**; null confidence skips the floor trigger. Satisfies REQ-STT-3, REQ-STT-1 (null-duration scenario). **Verify:** `(cd services/stt && uv run pytest tests/test_garbage.py)` FAILS (no `evaluate_garbage`). **Rollback:** `git rm services/stt/tests/test_garbage.py`.

- [x] **T7 — GREEN: `TranscriptionResult` + `evaluate_garbage`.** Add `services/stt/src/vendors/__init__.py`, `services/stt/src/vendors/base.py` (`TranscriptionResult`, `VendorAdapter` Protocol) and `services/stt/src/transcribe.py` with the pure vendor-agnostic `evaluate_garbage` only (no routes yet). Satisfies REQ-STT-3, REQ-STT-1. **Verify:** `(cd services/stt && uv run pytest tests/test_garbage.py tests/test_settings.py)` passes. **Rollback:** `git rm -r services/stt/src/vendors services/stt/src/transcribe.py`.

## Phase 3: Frozen HTTP contract and privacy (TDD — tests before any vendor call)

- [x] **T8 — RED: contract + error-taxonomy integration tests.** Add `services/stt/tests/conftest.py` (ASGITransport client, respx fixtures) and `services/stt/tests/test_contract.py`: exactly the six frozen fields with correct types, `request_id` unique across two requests; vendor omits duration → `audio_duration_ms: null` and not garbage; `GET /health` → `{"status":"ok","vendor":"deepgram"}`; `"novecientos"` passes through un-normalised; vendor timeout → **502** `vendor_timeout` with `request_id`; vendor 503 → 502 `vendor_error`; missing `file` field → 4xx; oversized upload → 413 `payload_too_large`; vendor audio rejection → 400 `invalid_audio`. Satisfies REQ-STT-1/2/3/4/5. **Verify:** `(cd services/stt && uv run pytest tests/test_contract.py)` FAILS (no `src.main`). **Rollback:** `git rm services/stt/tests/test_contract.py services/stt/tests/conftest.py`.

- [x] **T9 — RED: privacy tests (both no-disk-write paths).** Add `services/stt/tests/test_privacy.py`: (a) success path and (b) vendor-timeout error path, each monkeypatching `SpooledTemporaryFile.rollover`, `NamedTemporaryFile` and `tempfile.mkstemp` to raise, sending a max-size multipart body with a respx-mocked vendor, asserting 200 / 502 and no raise; plus a `caplog` test that INFO records carry ONLY `request_id`, `duration`, `vendor` and that the transcript string appears in NO record at any level. Satisfies REQ-PRV-1 (both scenarios), REQ-PRV-2, REQ-PRV-3. **Verify:** `(cd services/stt && uv run pytest tests/test_privacy.py)` FAILS. **Rollback:** `git rm services/stt/tests/test_privacy.py`.

- [x] **T10 — RED: Deepgram adapter tests.** Add `services/stt/tests/test_deepgram.py`: respx asserts `POST /v1/listen` with `model=nova-3&language=es&numerals=true&mip_opt_out=true` (never `language=multi`), raw-bytes body plus the caller's `Content-Type`, `Authorization` header; maps `channels[0].alternatives[0].transcript/.confidence` and `metadata.duration` s→ms; missing `metadata.duration` → `None`. Satisfies REQ-VND-1. **Verify:** `(cd services/stt && uv run pytest tests/test_deepgram.py)` FAILS. **Rollback:** `git rm services/stt/tests/test_deepgram.py`.

- [x] **T11 — GREEN: Deepgram adapter.** Add `services/stt/src/vendors/deepgram.py` implementing the `VendorAdapter` Protocol. Satisfies REQ-VND-1, REQ-VND-4. **Verify:** `(cd services/stt && uv run pytest tests/test_deepgram.py)` passes; `git grep -n 'import deepgram' services/stt/src` returns nothing. **Rollback:** `git rm services/stt/src/vendors/deepgram.py`.

- [x] **T12 — GREEN: app factory, routes and error mapping.** Add `services/stt/src/main.py` (`create_app()` + lifespan-shared `httpx.AsyncClient`, `app = create_app()`); extend `services/stt/src/transcribe.py` with `POST /transcribe`, `GET /health`, `ADAPTERS` registry lookup, uuid4 `request_id`, upload-cap check, and the `{"error":{code,message,request_id}}` mapping (422/413/400/502-timeout/502-error). Satisfies REQ-STT-1/2/3/4/5, REQ-PRV-1/2/3, REQ-VND-3. **Verify:** `(cd services/stt && uv run pytest)` fully green; `uv run --project services/stt uvicorn src.main:app --port 8001` then `curl -s localhost:8001/health`. **Rollback:** `git rm services/stt/src/main.py; git checkout <T11-commit> -- services/stt/src/transcribe.py`.

## Phase 4: Fallback vendor and packaging

- [x] **T13 — RED: Groq adapter + vendor-switch tests.** Add `services/stt/tests/test_groq.py` (respx: `POST /openai/v1/audio/transcriptions` multipart with `model=whisper-large-v3-turbo`, `language=es`, `response_format=verbose_json`; `text` mapping; confidence = unweighted mean of `exp(avg_logprob)` over segments clamped to [0,1]; `duration` s→ms) and `services/stt/tests/test_vendor_switch.py` (`STT_VENDOR=groq` routes to the Groq adapter and `/health` reports `groq`; unknown vendor fails boot). Satisfies REQ-VND-2, REQ-VND-3. **Verify:** both files FAIL. **Rollback:** `git rm services/stt/tests/test_groq.py services/stt/tests/test_vendor_switch.py`.

- [x] **T14 — GREEN: Groq adapter + registry entry.** Add `services/stt/src/vendors/groq.py`; register `{"deepgram": ..., "groq": ...}` in the boot-resolved `ADAPTERS` dict. Satisfies REQ-VND-2, REQ-VND-3, REQ-VND-4. **Verify:** `(cd services/stt && uv run pytest)` fully green. **Rollback:** `git rm services/stt/src/vendors/groq.py; git checkout <T12-commit> -- services/stt/src/transcribe.py`.

- [x] **T15 — Container packaging.** Add `services/stt/Dockerfile` and `services/stt/docker-compose.yml` verbatim from `spikes/05-stack-module-1-stt.md` (port 8001, healthcheck, `restart: unless-stopped`) plus `services/stt/.env.example` listing every setting including `STT_MIN_SPEECH_MS`, `STT_MAX_UPLOAD_BYTES`, `STT_VENDOR_TIMEOUT_S`, `LOG_LEVEL`; `.env` stays out of git. Satisfies REQ-STT-2, REQ-VND-5. **Verify:** `docker compose -f services/stt/docker-compose.yml config` succeeds; `git check-ignore services/stt/.env` matches. **Rollback:** `git rm services/stt/Dockerfile services/stt/docker-compose.yml services/stt/.env.example`.

## Phase 5: Benchmark harness (TDD)

- [x] **T16 — RED: metrics + hallucination-detector tests.** Add `benchmarks/tests/test_metrics.py`: digit accuracy exact-match per quantity token with `90`→`900` scored incorrect; hallucination denominator equals exactly N garbage clips; WER Levenshtein cases; per-condition split over `clean|noisy|spontaneous`; detector cases — `"dos cajas"` and `"15 canastas"` hallucinated, `"eh este pues"` and `""` NOT hallucinated, quantity followed by a ≥3-char alphabetic token within two tokens only. Satisfies REQ-BMK-3/4/5/6. **Verify:** `uv run --project services/stt pytest benchmarks/tests/test_metrics.py` FAILS. **Rollback:** `git rm -r benchmarks/tests`.

- [ ] **T17 — GREEN: metrics module + `report.py`.** Add `benchmarks/metrics.py` (normalisation, QUANTITY-NEAR-ITEM detector per design §11, digit accuracy, token Levenshtein WER) and `benchmarks/report.py` rendering the table split by condition, WER labelled secondary, corpus-validity caveat printed. Satisfies REQ-BMK-3/4/5/6. **Verify:** metrics tests pass; `uv run --project services/stt python benchmarks/report.py benchmarks/tests/fixtures/results.json` prints per-condition rows. **Rollback:** `git rm benchmarks/metrics.py benchmarks/report.py`.

- [ ] **T18 — RED: runner tests.** Add `benchmarks/tests/test_run.py`: a 3-clip corpus produces 3 `results.json` entries with no corpus-size error; each entry pairs labels with the frozen response fields plus `latency_ms`/`status`/`error`; concurrency capped by the semaphore; `results.json` carries `run_at`, `vendor`, `base_url`. Satisfies REQ-BMK-1, REQ-BMK-2. **Verify:** the file FAILS. **Rollback:** `git rm benchmarks/tests/test_run.py`.

- [ ] **T19 — GREEN: `run.py` + corpus scaffold.** Add `benchmarks/run.py` (asyncio + semaphore default 4 against `BENCH_STT_URL`, writes `results.json`) and `benchmarks/corpus/labels.csv` with header `clip_id,condition,transcript,items,is_garbage` (condition is `clean|noisy|spontaneous`; garbage clips carry a condition plus `is_garbage=true`) plus `benchmarks/corpus/README.md` recording how to add clips. Satisfies REQ-BMK-1, REQ-BMK-2. **Verify:** `uv run --project services/stt pytest benchmarks/tests` fully green. **Rollback:** `git rm -r benchmarks/run.py benchmarks/corpus`.

## Phase 6: Documentation

- [ ] **T20 — Service and benchmark docs + live-DoD checklist.** Add `services/stt/README.md` (uv commands, env table, docker compose, frozen response shape, `is_garbage` rules) and `benchmarks/README.md` (corpus format, run/report commands, corpus-validity caveat); add `services/stt/docs/dod-live-checks.md` with the four unchecked live-key items from T21–T24. Satisfies REQ-STT-1, REQ-VND-3, REQ-BMK-1. **Verify:** `(cd services/stt && uv run pytest)` and `uv run --project services/stt pytest benchmarks/tests` both green; every env var in `README.md` exists in `src/settings.py`. **Rollback:** `git rm services/stt/README.md benchmarks/README.md services/stt/docs/dod-live-checks.md`.

## Phase 7: Live-key DoD — `blocked-without-keys` (MUST NOT block Phases 1–6)

Each task below needs real vendor credentials. They gate the change's Definition
of Done, never the mocked-test implementation tasks. Record outcomes in
`services/stt/docs/dod-live-checks.md`.

- [ ] **T21 — `blocked-without-keys`: `mip_opt_out=true` billing check.** With a live Deepgram key, POST a clip with `mip_opt_out=true` and confirm the request is accepted and the billed rate in the Deepgram console. Satisfies REQ-VND-1; closes design open question 3. **Verify:** checklist entry records HTTP 200 plus the observed billed rate. **Rollback:** revert the checklist edit.

- [ ] **T22 — `blocked-without-keys`: real-clip transcription end to end.** `docker compose -f services/stt/docker-compose.yml up -d` with a real `.env`; `curl :8001/health` healthy; POST a real es-CO push-to-talk clip and confirm a verbatim transcript with `is_garbage: false`. Satisfies REQ-STT-1/2/4, REQ-VND-5. **Verify:** checklist records the response body with the transcript redacted. **Rollback:** `docker compose down`; revert the checklist edit.

- [ ] **T23 — `blocked-without-keys`: vendor swap with both keys.** Same clip with `STT_VENDOR=deepgram` then `STT_VENDOR=groq`; `/health` reports each vendor and both return the frozen shape. Satisfies REQ-VND-2, REQ-VND-3. **Verify:** checklist records both `stt_vendor` values and both confidences. **Rollback:** revert the checklist edit.

- [ ] **T24 — `blocked-without-keys`: chunked MediaRecorder timeslice blob.** POST a real `MediaRecorder` timeslice webm blob (no duration header) and confirm a correct transcript with `audio_duration_ms: null` and `is_garbage: false`. Satisfies REQ-STT-1 (null-duration scenario), REQ-STT-3. **Verify:** checklist records the null duration and the non-garbage flag. **Rollback:** revert the checklist edit.

- [ ] **T25 — `blocked-external`: ratify the frozen shape with Daniel (06:00 sync).** Confirm `audio_duration_ms: int | null` and the six-field shape; if the sync changes anything, amend `specs/stt-transcription/spec.md` and re-run Phase 3 tests. Satisfies REQ-STT-1; closes design open question 1. **Verify:** spec header notes the ratification date. **Rollback:** revert the spec amendment.
