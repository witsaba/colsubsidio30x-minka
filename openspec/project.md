# Project Context

## Project

- Name: `colsubsidio30x-minka`
- Repository: `git@github.com:witsaba/colsubsidio30x-minka.git`
- Default branch: `main`
- Lifecycle: Active
- SDD persistence: OpenSpec (hybrid with Engram)
- Delivery strategy: Chained pull requests (`auto-chain`)
- Review budget: 800 lines

## Current State

The repository contains product/discovery documents, source datasets and spikes under `docs/` and `spikes/`,
a reproducible spreadsheet-to-SQLite build (`scripts/`, `Makefile`, `data/bodegas-y-stock.sqlite`), and two
backend services: Module 1 — speech-to-text — under `services/stt/` and Module 3 — product matching — under
`services/matcher/`. The services share no process, datastore, or deploy unit.

## Detected Stack and Architecture

- Runtime/language: Python 3.11+ (`requires-python = ">=3.11"`), managed by **uv**
- Framework: **FastAPI** + **uvicorn** (STT on port 8001, matcher on port 8002)
- Configuration: **pydantic-settings** (matcher: `CATALOGUE_DB`, `MATCH_*` thresholds, `STARTUP_*` retry knobs;
  STT: `STT_VENDOR` and vendor credentials)
- Matching primitives: **rapidfuzz** plus first-party trigram scoring; accent folding uses stdlib `unicodedata`
- STT vendors: **httpx** only (no vendor SDKs) against Deepgram (primary) and Groq (fallback) REST APIs
- Persistence implementation: **SQLite** (`data/bodegas-y-stock.sqlite`), opened read-only (`mode=ro` URI) and
  loaded into memory at startup; built from the workbook with **pandas** + **openpyxl**. Audio is never
  persisted (RNF-04).
- Architecture: root **uv workspace** — root project (data build) plus the installable `matcher` workspace
  member with a `src/` layout, served as `matcher.main:app` and containerized via
  `services/matcher/docker-compose.yml`. `services/stt` is a **standalone uv project** (own `pyproject.toml`
  and `uv.lock`) with its own docker compose.
- Existing conventions: `from __future__ import annotations`, type hints on public functions, frozen dataclasses
  for value objects, pure functions kept free of I/O, tests mirroring the module they cover; technical SDD
  artifacts default to English

## Testing Capabilities

**Strict TDD Mode**: Enabled
**Detected**: 2026-07-25

| Capability | Available | Tool / command |
| --- | --- | --- |
| Test runner | Yes | `uv run pytest` (matcher suite); `cd services/stt && uv run pytest` (STT suite) |
| Unit tests | Yes | `uv run pytest services/matcher/tests/unit`; STT unit tests under `services/stt/tests` |
| Integration tests | Yes | `uv run pytest services/matcher/tests/api` (FastAPI `TestClient`); STT api tests (respx) |
| E2E tests | Yes | `uv run pytest services/matcher/tests/eval` (labelled 624-case accuracy gate) |
| Coverage | No | — |
| Linter | No | — |
| Type checker | No | — |
| Formatter | No | — |

`testpaths` is pinned to `services/matcher/tests` in the root `pyproject.toml`, so `uv run pytest` from the repo
root collects the matcher suite; the STT suite runs from `services/stt/` with its own environment. Strict TDD is
enabled: every change lands RED first, and promoted spike code is covered by characterization tests written
before the file is promoted.

## Runtime

- Matcher local: `uv run uvicorn matcher.main:app --port 8002`
- Matcher container: `cd services/matcher && docker compose up -d` (build context is the repo root; the
  catalogue is mounted `../../data:/data:ro`)
- STT container: `cd services/stt && docker compose up -d` (port 8001; vendor keys via environment)
