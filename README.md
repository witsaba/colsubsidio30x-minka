# Minka — Voice Inventory Counter

> **Hackathon Colsubsidio x 30X · July 2026**
> Replace paper-and-retyping with push-to-talk voice capture, three-model consensus
> and a clean Oracle-compatible export.

Minka is the working name for the **Voice Inventory Counter** MVP built for the
Hospitality Challenge at the Colsubsidio x 30X hackathon. It replaces the current
"counter writes on paper, a typist retypes into Oracle, an auditor recounts
everything" loop with a tablet push-to-talk flow that captures, validates, and
exports clean inventory data ready to load into Oracle My Inventory.

The tool does **not** replace the ERP. It feeds it correct data the first time.

---

## Table of contents

- [What it does](#what-it-does)
- [Team](#team)
- [Architecture at a glance](#architecture-at-a-glance)
- [Tech stack](#tech-stack)
- [Repository layout](#repository-layout)
- [Quick start](#quick-start)
- [Documentation](#documentation)
- [Testing](#testing)
- [Privacy and security notes](#privacy-and-security-notes)
- [License](#license)
- [Status](#status)

---

## What it does

End-to-end flow (the agreed flow, not the discovery draft):

1. **Setup** (auditor, web) — upload `BODEGAS Y STOCK.xlsx`; the system characterises
   warehouses, SKUs and units, then computes per-product statistical parameters.
   The auditor reviews and approves.
2. **Audit plan** (auditor, web) — pick **one** warehouse, define the period,
   assign authorised operators.
3. **Count** (operator, tablet) — the operator selects the plan, holds
   push-to-talk, and dictates ("3 kilos of lettuce … 12 bottles of oil").
4. **Extraction** (AI engine) — transcription → inverse text normalisation
   ("novecientos" → 900) → multi-item split → three AI models in parallel return
   `{product, quantity, unit, warehouse}` as JSON. If they agree, the record is
   validated; if not, the audio is reprocessed.
5. **Asynchronous validation** (trigger) — does the product exist in this
   warehouse? Does the unit correspond? Is the quantity reasonable versus
   history? Does it produce a negative balance? Anomalies raise an orange warning
   with a preventive block — after the in-flight audio finishes.
6. **Correction** (operator) — delete and re-record. Voice never edits and
   never deletes.
7. **Review** (auditor) — on site: approve / decline / correct. In office: the
   operator resolves and the auditor receives a traceable report.
8. **Close** — export in Oracle My Inventory format (Import Count Sequences
   style) + reconciliation report + full audit trail.

A practical target: pipeline error rate below 1 %, end-to-end latency per voice
note below 20–30 s, onboarding under five minutes.

---

## Team

| Role | People |
|---|---|
| Technical implementation | Braejan David Arias Heregua, Daniel Rosas |
| Documentation, use cases, QA | Adriana Durand (Invitado), Edith Lavado |
| Sponsor / challenge host | 30X, Colsubsidio |

The PRD is owned by the team and bears their names. See
[`docs/prd.md`](docs/prd.md) for the full document.

---

## Architecture at a glance

Two interfaces over a shared backend, deployed as four independent containers
from a single `docker-compose.yml`:

```
                +-------------------------+
                |   Operator tablet app   |
                |   (push-to-talk voice)  |
                +-----------+-------------+
                            |
                            v
        +-------------------+--------------------+
        |                frontend               |  Astro / TypeScript   :4321
        +--+--------------+--------------+------+
           |              |              |
           v              v              v
   +-----+----+   +------+------+   +---+---------------------+
   |   STT    |   |   Matcher   |   | product_identification  |
   |  :8001   |   |   :8002     |   | :8003                   |
   +----------+   +------+------+   +-----+-------------------+
                          |                |
                          v                v
                data/bodegas-y-stock.sqlite  Vertex AI / Gemini
                (built from xlsx, read-only) (dual-model consensus)
```

```
                +-------------------------+
                |   Auditor web platform  |
                | (upload, plans, review) |
                +-----------+-------------+
                            |
                            v
                       (same backend)
```

Services are deliberately independent: no `depends_on`, no shared network, no
shared lifecycle. One of them failing never holds another down. The catalogue
is mounted read-only (`:ro`) and opened `mode=ro` in the matcher.

---

## Tech stack

| Layer | Choice |
|---|---|
| Runtime | Python 3.11+ managed by [uv](https://docs.astral.sh/uv/) |
| API framework | FastAPI + uvicorn |
| Configuration | pydantic-settings (`MATCH_*`, `STARTUP_*`, `STT_*`) |
| Catalogue scoring | rapidfuzz + first-party trigram scoring |
| STT | Deepgram (primary), ElevenLabs (mid-priority), Groq (fallback) via `httpx` |
| Product identification | Vertex AI / Gemini dual-model consensus |
| Persistence | SQLite (`data/bodegas-y-stock.sqlite`), built with pandas + openpyxl |
| Frontend | Astro / TypeScript |
| Deployment | Docker Compose (single root file, single root `.env`) |
| Audio | Never persisted (RNF-04) |

---

## Repository layout

```
.
|-- docker-compose.yml         # single deployment surface (one .env)
|-- pyproject.toml             # root uv workspace
|-- uv.lock
|-- .env.example               # template; ./scripts/setup-env.sh fills it
|-- docs/
|   |-- prd.md                 # the PRD (v1.0)
|   |-- prd-seed.md            # traceable extraction of the 23 Jul meeting
|   |-- deployment.md          # single-env deployment checklist
|   |-- test-plan.md
|   |-- database/              # architecture, audit, technical data spec
|   |-- diagrams/              # two-app architecture + end-to-end flow
|   `-- sources/               # discovery artefacts meeting notes and xlsx
|-- openspec/
|   |-- project.md             # project context (stack, conventions)
|   |-- config.yaml            # SDD config (strict TDD mode)
|   |-- specs/                 # active capability specs
|   `-- changes/               # in-flight SDD changes
|-- services/
|   |-- stt/                   # module 1: speech-to-text (standalone uv project)
|   |-- matcher/               # module 3: product matching (uv workspace member)
|   `-- product_identification/ # module 2: voice inventory extraction
|-- frontend/                  # operator + auditor UI
|-- scripts/                   # setup-env.sh, build-sqlite, snapshots
|-- data/                      # built SQLite catalogue (gitignored)
|-- spikes/                    # 01..06 promotion trail
|-- benchmarks/                # STT benchmark harness
`-- tests/                     # deployment contracts + product_identification
```

---

## Quick start

Prerequisites: Docker, Docker Compose, and (for local Python work) `uv`.

```bash
# 1. Configure the single root .env (one question per variable, secrets masked)
./scripts/setup-env.sh

# 2. Build the catalogue SQLite from the source xlsx
make build-sqlite

# 3. Start the whole stack
docker compose up -d --build

# 4. Health per service
docker compose ps
curl localhost:8001/health   # STT
curl localhost:8002/health   # matcher
curl localhost:8003/health   # product_identification
curl localhost:4321/health   # frontend
```

Running one service at a time:

```bash
docker compose up -d matcher
docker compose up -d stt
```

No `.env`? See [`docs/deployment.md`](docs/deployment.md) for the full checklist
and the troubleshooting matrix.

---

## Documentation

The repository is the documentation. Read in this order:

1. [`docs/prd.md`](docs/prd.md) — the PRD, v1.0, draft for approval. Source of
   truth for scope, requirements, use cases and the QA plan.
2. [`docs/prd-seed.md`](docs/prd-seed.md) — the traceable extraction of the 23 Jul
   meeting, with transcript timestamps. Use it to settle any dispute about what
   was actually agreed.
3. [`docs/deployment.md`](docs/deployment.md) — the single-env deployment model
   and the checklist for adding a service.
4. [`docs/diagrams/README.md`](docs/diagrams/README.md) — diagrams as received,
   with a flag-by-flag list of where the end-to-end figure contradicts the
   agreed flow (three points, plus eight further decided elements missing).
5. [`docs/database/DATABASE_ARCHITECTURE.md`](docs/database/DATABASE_ARCHITECTURE.md)
   — the database architecture and the Supabase schema comparison.
6. [`openspec/project.md`](openspec/project.md) — the project context for the
   SDD workflow (stack, conventions, testing capabilities).
7. [`openspec/specs/`](openspec/specs/) — the active capability specs for the
   system.

Source materials (discovery, double-diamond, draft PRD, datasets) are vendored
under [`docs/sources/`](docs/sources/README.md).

---

## Testing

Strict TDD is enabled. Every change lands RED first, and promoted spike code
lands behind characterisation tests.

```bash
# Root suite: matcher + deployment contracts
uv run pytest

# STT service suite (its own environment)
cd services/stt && uv run pytest

# Deployment contracts (no daemon required)
uv run pytest tests/deployment
```

| Layer | Command |
|---|---|
| Unit | `uv run pytest services/matcher/tests/unit` |
| API (FastAPI TestClient) | `uv run pytest services/matcher/tests/api` |
| E2E / accuracy gate | `uv run pytest services/matcher/tests/eval` |
| Deployment contracts | `uv run pytest tests/deployment` |

Coverage, linter, type checker and formatter are not configured for this
project. This is intentional; the SDD rules call out the testing layers that
must remain green, and the deployment tests encode the deployment contract.

---

## Privacy and security notes

- **Voice is not stored.** Cloning risk from a few seconds of audio is the
  reason. If audio storage is later reconsidered, the legal analysis in
  `docs/prd.md` §13.10 must be completed first (RNF-04).
- **Transcript bodies are never logged at INFO.** `spoken_name` and any
  candidate `articulo` are personal data under Ley 1581; the log is telemetry.
  `tests/api/test_logging.py` enforces this.
- **The catalogue is read-only everywhere.** SQLite is opened `mode=ro` and
  mounted `:ro` in Compose.
- **Documented framework is ISO 27001.** It is the framework we talk to in the
  pitch; the controls are still the conversational ones above (RNF-05).

---

## License

This repository is **not open source**. Use is restricted to the authorised
team and sponsor organisations listed in [`LICENSE`](LICENSE). See that file
for the full grant of rights, the prohibitions, and the contact for anything
outside it.

---

## Status

**Hackathon MVP, draft for approval.** The PRD is at v1.0; the agreed flow is
captured; the backend services and the deployment contract are in place.
Frontend, email-link onboarding (RNF-06) and Oracle-format export (RF-30) are
in active development. The diagrams in `docs/diagrams/` are vendored as
received and **not** yet reconciled with the agreed flow (see
[`docs/diagrams/README.md`](docs/diagrams/README.md) for the three
contradictions).
