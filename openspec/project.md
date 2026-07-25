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
a reproducible spreadsheet-to-SQLite build (`scripts/`, `Makefile`, `data/bodegas-y-stock.sqlite`), and
Module 3 — the product matching service — under `services/matcher/`.

## Detected Stack and Architecture

- Runtime/language: Python 3.11+ (`requires-python = ">=3.11"`), managed by **uv**
- Framework: **FastAPI** + **uvicorn** (service listens on port 8002)
- Configuration: **pydantic-settings** (`CATALOGUE_DB`, `MATCH_*` thresholds)
- Matching primitives: **rapidfuzz** plus first-party trigram scoring; accent folding uses stdlib `unicodedata`
- Persistence implementation: **SQLite** (`data/bodegas-y-stock.sqlite`), opened read-only (`mode=ro` URI) and
  loaded into memory at startup; built from the workbook with **pandas** + **openpyxl**
- Architecture: single **uv workspace** — root project (data build) plus the installable `matcher` workspace
  member with a `src/` layout, served as `matcher.main:app` and containerized via `services/matcher/docker-compose.yml`
- Existing conventions: `from __future__ import annotations`, type hints on public functions, frozen dataclasses
  for value objects, pure functions kept free of I/O, tests mirroring the module they cover; technical SDD
  artifacts default to English

## Testing Capabilities

**Strict TDD Mode**: Enabled
**Detected**: 2026-07-24

| Capability | Available | Tool / command |
| --- | --- | --- |
| Test runner | Yes | `uv run pytest` |
| Unit tests | Yes | `uv run pytest services/matcher/tests/unit` |
| Integration tests | Yes | `uv run pytest services/matcher/tests/api` (FastAPI `TestClient`) |
| E2E tests | Yes | `uv run pytest services/matcher/tests/eval` (labelled 624-case accuracy gate) |
| Coverage | No | — |
| Linter | No | — |
| Type checker | No | — |
| Formatter | No | — |

`testpaths` is pinned to `services/matcher/tests` in the root `pyproject.toml`, so `uv run pytest` from the repo
root collects the whole suite. Strict TDD is enabled: every change lands RED first, and promoted spike code is
covered by characterization tests written before the file is promoted.

## Runtime

- Local: `uv run uvicorn matcher.main:app --port 8002`
- Container: `cd services/matcher && docker compose up -d` (build context is the repo root; the catalogue is
  mounted `../../data:/data:ro`)
