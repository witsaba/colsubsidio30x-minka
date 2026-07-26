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
a reproducible spreadsheet-to-SQLite build (`scripts/`, `Makefile`, `data/bodegas-y-stock.sqlite`), and three
backend services: Module 1 — speech-to-text — under `services/stt/`, Module 2 — product identification /
voice inventory extraction — under `services/product_identification/` (port 8003, merged via PR #11/#12),
and Module 3 — product matching — under `services/matcher/`. The services share no process, datastore, or
deploy unit; all three are started from the single root `docker-compose.yml`.

Documentation under `docs/database/` (`DATABASE_ARCHITECTURE.md`, `SUPABASE_SCHEMA_COMPARISON.md`) specifies a
Supabase/Postgres schema. As of the `redis-catalogue-cache` change the matcher reads that schema for real:
it loads its catalogue from Supabase over PostgREST (`httpx`, no SDK) and caches a versioned snapshot in
Redis. The rest of the schema (audits, stock balances) is still design documentation with no code behind it.

**Not present in this worktree/branch**: there is no Astro/TS frontend. It exists only on the separate,
unmerged `feat/voice-counter-frontend` branch; it is not part of this project's current tree. A grep "hit"
for `redis` in `docs/sources/prd-draft-es.md` is a false positive (`rediseño`, Spanish for "redesign") —
the real Redis is the `redis` service in the root `docker-compose.yml`.

## Detected Stack and Architecture

- Runtime/language: Python 3.11+ (`requires-python = ">=3.11"` for root/matcher/stt; product_identification
  allows `>=3.10`), managed by **uv** (`uv 0.11.31` observed)
- Framework: **FastAPI** + **uvicorn** on all three services (STT :8001, matcher :8002, product_identification :8003)
- Configuration: **pydantic-settings** (matcher: `SUPABASE_URL`/`SUPABASE_KEY` — the in-container name;
  Compose feeds it from the host's canonical `SUPABASE_SECRET_KEY` — `REDIS_URL`,
  `CATALOGUE_CACHE_TTL_SECONDS`, `MATCH_*` thresholds, `STARTUP_*` retry knobs;
  STT: `STT_VENDOR` and vendor credentials); product_identification uses plain `python-dotenv` + `.env` (Vertex
  AI / Gemini credentials, `USE_VERTEX_AI`, `GOOGLE_CLOUD_*`)
- Matching primitives: **rapidfuzz** plus first-party trigram scoring; accent folding uses stdlib `unicodedata`
- STT vendors: **httpx** only (no vendor SDKs) against Deepgram (primary), ElevenLabs, and Groq REST APIs
- Product identification: **google-genai** dual-model consensus (Gemini 2.5 Flash/Pro via Vertex AI) over voice
  transcripts, `pypdf`/`pandas` for supporting extraction, `rich` for CLI/table output
- Persistence implementation: the matcher's catalogue is **Supabase/Postgres** read over PostgREST with
  `httpx` (no SDK) and held in memory; it is rebuilt at startup and refreshed in the background. The
  spreadsheet-to-SQLite build (`scripts/`, `Makefile`, `data/bodegas-y-stock.sqlite`, **pandas** +
  **openpyxl**) still exists as a data-pipeline artefact but is **no longer read by any service at runtime**;
  its deletion is a separate follow-up change. Audio is never persisted (RNF-04).
- Cache layer: **Redis** (`redis:7.4-alpine`, `redis` service in the root `docker-compose.yml`, no host port,
  persists nothing). It holds one versioned catalogue snapshot on a 3 h TTL so a warm matcher start performs
  zero Supabase reads. It is a **soft** dependency: no `depends_on`, and the matcher boots and keeps serving
  without it.
- Architecture: root **uv workspace** — root project (data build) plus the installable `matcher` and
  `product_identification` workspace members (both `src`/package layout, served as `matcher.main:app` and
  `services/product_identification/server.py` respectively). `services/stt` is a **standalone uv project**
  (own `pyproject.toml` and `uv.lock`). All three are deployed from the single root `docker-compose.yml` with
  a single root `.env`; see `docs/deployment.md`.
- Frontend: none in this worktree/branch. An Astro/TS frontend exists only on the unmerged
  `feat/voice-counter-frontend` branch — not part of `main` or any service under `services/`.
- Existing conventions: `from __future__ import annotations`, type hints on public functions, frozen dataclasses
  for value objects, pure functions kept free of I/O, tests mirroring the module they cover; technical SDD
  artifacts default to English

## Testing Capabilities

**Strict TDD Mode**: Enabled
**Detected**: 2026-07-25

| Capability | Available | Tool / command |
| --- | --- | --- |
| Test runner | Yes | `uv run pytest` (from repo root — matcher suite; confirmed 372 tests collected) |
| Unit tests | Yes | `uv run pytest services/matcher/tests/unit`; STT unit tests under `services/stt/tests` |
| Integration tests | Yes | `uv run pytest services/matcher/tests/api` (FastAPI `TestClient`); STT api tests (respx) |
| E2E tests | Yes | `uv run pytest services/matcher/tests/eval` (labelled 624-case accuracy gate) |
| Coverage | No | — |
| Linter | No | — (no ruff/flake8/eslint config found anywhere in the repo) |
| Type checker | No | — (no mypy config found) |
| Formatter | No | — (no black/ruff-format/prettier config found) |

**Matcher test command (exact, verbatim)**: `uv run pytest` — run from the **repository root** (not
`services/matcher/`). Dependency management is **uv** exclusively (root `uv.lock`, workspace member
`services/matcher`); tests run **on host**, no container required (matcher has no separate test container/CI
job). `testpaths` is pinned to `services/matcher/tests` and `tests/deployment` in the root `pyproject.toml`,
so plain `uv run pytest` from the repo root collects the matcher suite (`tests/unit`, `tests/api`,
`tests/eval`) plus the daemon-free deployment contracts — nothing else needs to be told to pytest. Narrower
matcher-only reruns: `uv run pytest services/matcher/tests/unit`, `.../tests/api`, `.../tests/eval`.

The **STT** suite runs separately from its own directory: `cd services/stt && uv run pytest` (own
`pyproject.toml`/`uv.lock`, standalone uv project, not a workspace member).

The **product_identification** service has **no pytest suite**. Its tests under `tests/product_identification/`
are standalone scripts, not collected by root `uv run pytest` (its path is absent from root `testpaths`) and
requiring a running server plus live Vertex AI/Gemini credentials: `uv run python
tests/product_identification/test_inventory_extraction.py` (20-case consistency benchmark) and `uv run python
tests/product_identification/test_api_client.py --port 8003` (live HTTP smoke client). These are external
tests, not part of the automated/TDD test loop.

Strict TDD is enabled (also confirmed by the user's global Strict TDD Mode setting): every change lands RED
first, and promoted spike code is covered by characterization tests written before the file is promoted.

## Runtime

- Matcher local: `uv run uvicorn matcher.main:app --port 8002`
- Product identification local: `uv run python services/product_identification/server.py --port 8003`
- Whole stack: `./scripts/setup-env.sh` once, then `docker compose up -d` from the repository root
- Matcher container: `docker compose up -d matcher` (build context is the repo root; no catalogue mount —
  the catalogue is read from Supabase and cached in `redis`, so `SUPABASE_URL`/`SUPABASE_SECRET_KEY` must be
  set in the root `.env` — Compose maps the secret key into the container's `SUPABASE_KEY`)
- STT container: `docker compose up -d stt` (port 8001; vendor keys come from the root `.env`)
- Product identification container: `docker compose up -d product_identification` (port 8003; Vertex AI /
  Gemini credentials come from the root `.env`)
