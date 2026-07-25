# Design: Module 3 — Product Matching Service (`add-matching-service`)

> Artifact store: hybrid. Engram topic: `sdd/add-matching-service/design`. This file is the OpenSpec mirror.

## Technical Approach

Promote the measured spike algorithm (`normalize.py`, `catalogue.py`, the `TrigramSimilarityMatcher`) logic-unchanged into an installable `matcher` package under `services/matcher/`, structured as a **uv workspace member** of the root project. Author the genuinely new layers TDD-first: pydantic-settings config, unit maps (matching + display), the pure `decide()` function producing `matched`/`ambiguous`/`no_match`, an in-memory `MatcherService`, and the FastAPI app on port 8002. The 624-case eval set is copied into the service test suite and driven in-process against `MatcherService`'s own ranking (proposal decision 5); a TestClient smoke suite proves all three statuses over HTTP. Hard rules preserved: no WRatio, no stock (`sd`) prior, unit is re-rank only, NULL unit never coerced, sqlite opened `mode=ro`.

## Architecture Decisions

### D1 — Packaging: uv workspace member with src layout

**Choice**: Root `pyproject.toml` becomes a workspace root (`[tool.uv.workspace] members = ["services/matcher"]`, stays `package = false`) and depends on `matcher = { workspace = true }`. New `services/matcher/pyproject.toml` defines project `matcher` (hatchling, `src/matcher/` layout) with runtime deps `fastapi`, `uvicorn`, `pydantic-settings`, `rapidfuzz`. Root dev group gains `pytest`, `pytest-asyncio`, `httpx`; `rapidfuzz`/`unidecode` leave the dev group. One shared `uv.lock` at root.
**Alternatives rejected**: (a) single root project with `pythonpath` pytest hack — repeats the `sys.path` fragility exploration already rejected and root `package = false` cannot install the package; (b) standalone sub-project with its own lock — two lockfiles to drift, and the proposal's root `pyproject.toml`/`uv.lock` fixes assume one manifest.
**Rationale**: `uv run pytest` from a clean checkout works (workspace sync installs `matcher` editable); `uv sync --frozen --no-dev --package matcher` in the container installs only the service and its main deps, fixing the latent dev-group import failure. Refinement of proposal decision 1: rapidfuzz/fastapi/uvicorn/pydantic-settings land as **main deps of the `matcher` member** — still non-dev, still in the shared lock, same container guarantee.

### D2 — Promotion scope: only what the service uses

**Choice**: Promote `normalize.py` verbatim; `catalogue.py` with two edits only (`sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)`, path becomes a required parameter); `TrigramSimilarityMatcher.rank()` body unchanged into `scoring.py` plus a `token_set_ratio_01()` wrapper using the spike's exact processor (`default_process(strip_accents(s))`). Drop the six other matcher classes (FTS5, WRatio, word-similarity, hybrid) — research-only; WRatio is explicitly banned.
**Rationale**: "promote and clean, do not rewrite" — dead research code in prod is neither.

### D3 — Decision layer semantics

**Choice**: `decide()` is pure over `rank()` output. Status uses **raw trigram scores, computed before any re-rank**:

```
top_score = ranked[0].score (0.0 if empty); margin = top_score − second (second = 0.0 if < 2)
if top_score < MATCH_ACCEPT_SCORE            → no_match
elif margin < MATCH_AMBIGUITY_MARGIN
     or (tsr₁ − tsr₂) < MATCH_TSR_MARGIN     → ambiguous     # tsrᵢ = token_set_ratio_01 over top-5
else                                          → matched
```

Unit re-rank (only when `MATCH_UNIT_RERANK` and `resolve_unit(unit)` is non-None): stable partition **inside the band** `score ≥ top_score − MATCH_AMBIGUITY_MARGIN` — unit-equal candidates first, everything else keeps order; candidates outside the band never move. `unidad = NULL` never counts as equal and is never penalized beyond stable order. Because a `matched` result by definition has a single-candidate band, re-rank can only reorder ambiguous crowds — structurally "secondary, never a gate".
**Rationale**: spike 06's dual-signal crowding rule made concrete; `MATCH_TSR_MARGIN` (new env knob, default 0.08) mirrors the trigram margin and stays re-tunable without rebuild (n=10 caveat).

### D4 — eval_set.json: copy into the service tests

**Choice**: `services/matcher/tests/data/eval_set.json` is a byte copy. A guard test hashes it against `spikes/matching/eval_set.json` and fails on divergence (skips if the spike file is absent).
**Alternative rejected**: shared path into `spikes/` — couples the shippable suite to research files the Dockerfile never copies and future cleanup may delete.

### D5 — Docker build context is the repo root

**Choice**: compose uses `build: {context: ../.., dockerfile: services/matcher/Dockerfile}`; everything else matches spike 06 byte-for-byte (port 8002, `../../data:/data:ro`, env block, healthcheck, `restart: unless-stopped`). Uvicorn target is `matcher.main:app` (installable package supersedes the spike's `src.main:app` shape).
**Rationale**: the workspace lock and both pyprojects live at root; `build: .` cannot see them. Documented deviation, same runtime shape.

## Package Tree

```
services/matcher/
├── pyproject.toml          # project "matcher", hatchling, src layout
├── Dockerfile
├── docker-compose.yml
├── src/matcher/
│   ├── __init__.py
│   ├── config.py           # NEW  Settings(BaseSettings)
│   ├── catalogue.py        # PROMOTED (ro URI, param path)
│   ├── normalize.py        # PROMOTED verbatim
│   ├── scoring.py          # PROMOTED TrigramSimilarityMatcher + token_set_ratio_01
│   ├── units.py            # PROMOTED UNIT_SYNONYMS/resolve_unit + NEW display map
│   ├── decision.py         # NEW  Candidate, Decision, decide()
│   ├── service.py          # NEW  MatcherService (startup load, match(), catalogues())
│   ├── schemas.py          # NEW  pydantic request/response models
│   └── main.py             # NEW  FastAPI app, lifespan, routes
└── tests/
    ├── conftest.py
    ├── data/eval_set.json  # copy of the 624-case set (D4)
    ├── unit/test_normalize.py │ test_scoring.py │ test_units.py │ test_decision.py │ test_config.py
    ├── api/test_http.py
    └── eval/test_eval_accuracy.py
```

## Interfaces / Contracts

```python
# units.py — two separate maps, per spike 06
UNIT_SYNONYMS: dict[str, set[str]]          # canonical → spoken Spanish (from extra_experiments prototype)
def resolve_unit(spoken: str | None) -> str | None   # None when absent or unrecognized (re-rank skipped)
UNIT_DISPLAY = {"Kilogram": "kg", "Liter": "litros", "Unidad": "unidades", "Portion": "porciones"}
# unidad NULL → display None. Never coerced to "unidades".
# Documented deviation from spike 02's display example (Liter → L, Portion → porción,
# Unidad → unidad): full plural Spanish words read naturally in voice-driven UI copy;
# only "kg" is kept as the conventional abbreviation.

# decision.py
@dataclass(frozen=True)
class Candidate:  nr_articulo: str | None; articulo: str; unidad: str | None
                  unidad_display: str | None; score: float
@dataclass(frozen=True)
class Decision:   status: Literal["matched", "ambiguous", "no_match"]
                  candidates: list[Candidate]; top_score: float; margin: float
def decide(ranked: list[tuple[Row, float]], query: str,
           unit: str | None, settings: Settings) -> Decision

# service.py
class MatcherService:
    def __init__(self, settings: Settings): ...   # raises CatalogueUnavailableError → process exits
    def match(self, catalogue_id: str, spoken_name: str, unit: str | None) -> Decision
    #   raises UnknownCatalogueError → HTTP 404
    def catalogues(self) -> list[tuple[str, int]]  # (catalogue_id, row_count)
```

### HTTP contract (aligned to spike 06; `unidad_display` is an additive field)

```jsonc
// POST /match  — request (422 if spoken_name blank after strip; unit optional)
{"spoken_name": "aceite de oliva", "catalogue_id": "stock_almacen_ayb", "unit": "litros"}

// POST /match — 200 response (candidates always top-N, all statuses; empty table ⇒ [] , 0.0, 0.0)
{"status": "matched",
 "candidates": [{"nr_articulo": "7003", "articulo": "ACHIOTE MOLIDO",
                 "unidad": "Kilogram", "unidad_display": "kg", "score": 0.87}],
 "top_score": 0.87, "margin": 0.21, "request_id": "<uuid4>"}

// GET /catalogues — 200
{"catalogues": [{"catalogue_id": "stock_almacen_ayb", "rows": 345}, ...]}   // the 8 stock tables

// GET /health — 200 once startup load succeeded (app never serves without a catalogue)
{"status": "ok", "catalogues": 8, "rows": 1413}
```

## Configuration

| Env var | Default (local) | Container | Notes |
|---|---|---|---|
| `CATALOGUE_DB` | `data/bodegas-y-stock.sqlite` | `/data/bodegas-y-stock.sqlite` | opened `mode=ro` URI; missing/unopenable ⇒ startup abort |
| `MATCH_ACCEPT_SCORE` | `0.50` | same | no_match gate |
| `MATCH_AMBIGUITY_MARGIN` | `0.08` | same | trigram margin + re-rank band width |
| `MATCH_TSR_MARGIN` | `0.08` | same | **new** — token_set_ratio crowding margin over top-5; provisional, re-measure on real dictation |
| `MATCH_MAX_CANDIDATES` | `5` | same | rank/response depth |
| `MATCH_UNIT_RERANK` | `true` | same | disables unit re-rank entirely when false |

Invalid values fail pydantic-settings validation at import of the lifespan — uvicorn exits non-zero, compose healthcheck never passes. No silent defaults on bad input.

## Error Handling

| Condition | Behavior |
|---|---|
| Unknown `catalogue_id` | HTTP 404, `{"detail": "unknown catalogue_id '<id>'"}` (valid ids in `GET /catalogues`) |
| Blank/whitespace `spoken_name` | HTTP 422 (schema validator), request never reaches the matcher |
| Query yields empty trigram set (e.g. `"???"`) | valid 200: `top_score 0.0` ⇒ `no_match` — not an error |
| Unrecognized `unit` string | treated as `None`; re-rank skipped; never an error |
| Sqlite missing/unopenable/table missing at startup | `CatalogueUnavailableError` in lifespan ⇒ process exits non-zero; fail fast, never serve empty |
| Write attempt against catalogue | impossible by construction: `mode=ro` URI **and** `:ro` mount |

## Dockerfile / Compose

```dockerfile
FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
COPY services/matcher/pyproject.toml services/matcher/pyproject.toml
RUN uv sync --frozen --no-dev --no-install-workspace --package matcher   # deps layer, cached
COPY services/matcher/src services/matcher/src
RUN uv sync --frozen --no-dev --package matcher
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8002
CMD ["uvicorn", "matcher.main:app", "--host", "0.0.0.0", "--port", "8002"]
```

Compose = spike 06's block with the D5 build context; healthcheck/env/volumes verbatim.

## File Changes

| File | Action | Description |
|---|---|---|
| `services/matcher/**` (tree above) | Create | package, tests, Dockerfile, compose |
| `pyproject.toml` | Modify | workspace root, `matcher` workspace dep, dev group → pytest/pytest-asyncio/httpx, drop rapidfuzz+unidecode, `[tool.pytest.ini_options] testpaths = ["services/matcher/tests"]` |
| `uv.lock` | Regenerate | single workspace lock |
| `openspec/config.yaml` | Modify | `strict_tdd: true`, `test_command: uv run pytest`, runner pytest, stack Python 3.11+/uv/FastAPI |
| `openspec/project.md` | Modify | same reconciliation |
| `spikes/06-stack-module-3-matching.md` | Modify | dated note: stack row said `unidecode`; code uses stdlib `unicodedata`; dep dropped |

## Testing Strategy

Strict TDD: every module lands RED-first — promoted code gets characterization tests written **before** the file is promoted (pg_trgm documented examples for `scoring.py`; one test per normalization rule in spike 06's build order for `normalize.py`).

| Layer | What | Approach |
|---|---|---|
| Unit | normalization rules (each individually), trigram examples, unit maps + NULL handling, `decide()` truth table (gate/margin/tsr-crowding/re-rank band), Settings parsing + failure | pure-function pytest, no I/O; tiny synthetic sqlite fixture for catalogue error paths |
| Eval | 624 cases against `MatcherService.match()` in-process | assert overall top-1 ≥ 0.986 and recall@3 = 1.00 on variant cases; garbage false-confidence (`status == matched`) ≤ 2.2%; report and pin the has-code vs no-code split as constants with provenance docstring |
| HTTP | TestClient smoke: three statuses reachable, `/catalogues`, `/health`, 404/422 paths | `fastapi.testclient` (httpx), env via monkeypatch |

`conftest.py`: session-scoped `catalogue_db_path` (repo `data/bodegas-y-stock.sqlite`), `service` (default Settings), `client`; function-scoped synthetic-db factory. Entire suite runs in one `uv run pytest` (matcher p95 = 1.8 ms ⇒ eval ≈ seconds); no CI split or markers needed.

## Threat Matrix

N/A — no routing, shell, subprocess, VCS/PR automation, executable-file classification, or process-integration boundary. The service is read-only over sqlite (`mode=ro` + `:ro` mount) and spawns nothing.

## Migration / Rollout

No migration. New service; rollout is `docker compose up` in `services/matcher/` for the demo. Rollback per proposal (revert commits, delete tree).

## Open Questions

None blocking. `MATCH_TSR_MARGIN=0.08` is a provisional default derived by symmetry with the trigram margin (crowding sample n=10) — env-tunable, flagged for re-measurement on real dictation.

## Judgment Day amendment (2026-07-25)

Round-1 hardening (JD-1..JD-4, JD-U — see `judgment-day-ledger.md`), landed on `feat/add-matching-service`:

1. **Startup resilience** — new config knobs `STARTUP_RETRIES` (int, default `3`, ≥ 0) and `STARTUP_RETRY_DELAY_SECONDS` (float, default `2.0`, ≥ 0): the lifespan retries catalogue load on `CatalogueUnavailableError` up to `STARTUP_RETRIES` times with that delay, logging WARNING per retry; on exhaustion it logs ERROR and exits 3 (`restart: unless-stopped` is the outer retry layer). A configuration `ValidationError` is never retried.
2. **Request bounds** — `spoken_name` max 300, `catalogue_id` max 100, `unit` max 50 characters → HTTP 422 beyond bounds (blank rejection unchanged).
3. **Observability contract** — stdlib logger `matcher`: startup success INFO (catalogue count, rows, db path); startup failure ERROR; per-request INFO (`request_id`, `catalogue_id`, `status`, `top_score`, candidates, `latency_ms`); unknown-catalogue WARNING (`request_id`, `catalogue_id`). HARD RULE (Ley 1581): `spoken_name` / transcript / candidate `articulo` text never appears in any log line — test-enforced.
4. **Engine hardening** — `trigrams()` `lru_cache` bounded at 4096 (memory ceiling for untrusted per-request input; the ~1405 hot catalogue `articulo` strings stay resident with headroom); fetch-time sqlite corruption raises the same contextual `CatalogueUnavailableError` as execute-time, naming the table in the message.
5. **Container** — `ENV PYTHONUNBUFFERED=1`; healthcheck `start_period: 10s`; compose pins `STARTUP_RETRIES=3` / `STARTUP_RETRY_DELAY_SECONDS=2.0`; repo-root `.dockerignore` added.
