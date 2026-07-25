# Tasks: Module 3 — Product Matching Service (`add-matching-service`)

> Artifact store: hybrid. Engram topic: `sdd/add-matching-service/tasks`. This file is the OpenSpec mirror.

**Apply preamble.** Implementation happens on a branch inside a dedicated git worktree, never on `main`
(`<repo-parent>/colsubsidio30x-minka-worktrees/<slice-branch>`; each worktree needs its own `.codegraph/`).
**STRICT TDD is active**: every task below is RED (failing test committed/run first) → implementation → GREEN.
Promoted spike modules are logic-unchanged moves and still land behind characterization tests written *before*
the file appears under `services/matcher/src/`. Test runner: `uv run pytest`. Design §Threat Matrix is N/A
(no routing, shell, subprocess, or process-integration boundary), so no threat-case RED tasks exist.

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~1,750 authored (excludes generated `uv.lock` and the copied 624-case `eval_set.json`) |
| 800-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | PR 1 → PR 2 → PR 3 → PR 4 |
| Delivery strategy | auto-chain |
| Chain strategy | stacked-to-main |

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: stacked-to-main
800-line budget risk: High
400-line budget risk: High

### Suggested Work Units (stacked-to-main slices)

| Unit | Tasks | Branch (base) | Est. lines | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|---|
| PR 1 — scaffold + pure engine | T1–T4 | `feat/matcher-01-engine-core` (base `main`) | ~610 | `uv run pytest services/matcher/tests/unit` | N/A — no process/HTTP boundary yet; pure functions only | `git rm -r services/matcher; git checkout main -- pyproject.toml uv.lock` |
| PR 2 — config, decision, service | T5–T7 | `feat/matcher-02-decision-service` (base PR 1 branch, retarget to `main` after PR 1 merges) | ~610 | `uv run pytest services/matcher/tests/unit` | `uv run python -c "from matcher.config import Settings; from matcher.service import MatcherService; print(MatcherService(Settings()).catalogues())"` | `git rm services/matcher/src/matcher/{config,catalogue,decision,service}.py` + their tests |
| PR 3 — HTTP API + eval gate | T8–T9 | `feat/matcher-03-api-eval` (base PR 2 branch → `main`) | ~425 | `uv run pytest services/matcher/tests/api services/matcher/tests/eval` | `uv run uvicorn matcher.main:app --port 8002` + `curl -s localhost:8002/health` | `git rm services/matcher/src/matcher/{schemas,main}.py services/matcher/tests/{api,eval} -r` |
| PR 4 — container + doc reconciliation | T10–T12 | `feat/matcher-04-container-docs` (base PR 3 branch → `main`) | ~115 | `uv run pytest` (full suite, unchanged) | `cd services/matcher && docker compose up -d && docker compose ps` (expect `healthy`) | `git rm services/matcher/{Dockerfile,docker-compose.yml}; git checkout main -- openspec/config.yaml openspec/project.md spikes/06-stack-module-3-matching.md` |

Parallelism: **T2, T3, T4 are parallelizable** after T1 (independent modules, no shared imports). **T11 and T12
are fully independent** of every code task and of each other — they may run at any time. Everything else is
strictly sequential: T1 → {T2‖T3‖T4} → T5 → T6 → T7 → T8 → {T9, T10}.

## Phase 1: Foundation (PR 1)

- [x] **T1 — Bootstrap uv workspace + pytest scaffold.** Modify root `pyproject.toml` (workspace root with
  `members = ["services/matcher"]`, `matcher = {workspace = true}`, dev group → `pytest`/`pytest-asyncio`/`httpx`,
  **drop `rapidfuzz` and `unidecode` from dev**, `[tool.pytest.ini_options] testpaths = ["services/matcher/tests"]`);
  add `services/matcher/pyproject.toml` (hatchling, `src/matcher/`, main deps `fastapi`/`uvicorn`/`pydantic-settings`/`rapidfuzz`),
  `services/matcher/src/matcher/__init__.py`, `services/matcher/tests/conftest.py` (session-scoped `catalogue_db_path`),
  and one RED smoke test asserting `import matcher` plus `unidecode` absent from resolved deps; regenerate `uv.lock`.
  Satisfies REQ-ENG-1 (dependency clause); design D1. **Verify:** `uv sync` then `uv run pytest` — green, collects from
  `services/matcher/tests`; `git grep -n unidecode -- pyproject.toml uv.lock` returns no dependency entry.
  **Rollback:** `git rm -r services/matcher; git checkout HEAD~1 -- pyproject.toml uv.lock`.

## Phase 2: Pure engine modules (PR 1 — T2/T3/T4 parallelizable)

- [x] **T2 — Promote the normalization pipeline behind per-rule tests.** RED first:
  `services/matcher/tests/unit/test_normalize.py` with one test per rule in spike 06's build order — accent stripping
  (stdlib `unicodedata`), packaging tokens (`50X38CM`, `X50 UN`, `FB`, `X 300 GR`), gender folding (`blanca`→`BLANCO`),
  plural folding, abbreviation expansion (`P/PICAR`→`para picar`), catalogue-typo tolerance (`TABLA PICAR AMRILLA`), and the
  composite `TABLA P/PICAR BLANCA X 300 GR` scenario. Then promote `spikes/matching/normalize.py` verbatim to
  `services/matcher/src/matcher/normalize.py`. Satisfies REQ-ENG-1; design D2. **Verify:**
  `uv run pytest services/matcher/tests/unit/test_normalize.py`. **Rollback:** `git rm services/matcher/src/matcher/normalize.py services/matcher/tests/unit/test_normalize.py`.

- [x] **T3 — Promote trigram scoring behind pg_trgm characterization tests.** RED first: `tests/unit/test_scoring.py`
  asserting the documented pg_trgm examples (`show_trgm('cat')`, `show_trgm('cat and dog')`, `similarity` set arithmetic),
  `rank()` ordering/`top_k` truncation with a synthetic row list, and `token_set_ratio_01()` returning 0–1 using the spike's
  exact processor `default_process(strip_accents(s))`. Then add `services/matcher/src/matcher/scoring.py` with
  `TrigramSimilarityMatcher.rank()` body unchanged plus the wrapper; the other six research matcher classes are NOT promoted.
  Satisfies REQ-ENG-2; design D2. **Verify:** `uv run pytest services/matcher/tests/unit/test_scoring.py`; audit
  `grep -rn "WRatio\|word_similarity\|\bsd\b" services/matcher/src` shows no scoring use (verify-report W3: the original
  `git grep` form searched the index and returned a false clean on untracked files). **Rollback:**
  `git rm services/matcher/src/matcher/scoring.py services/matcher/tests/unit/test_scoring.py`.

- [x] **T4 — Add the two unit maps.** RED first: `tests/unit/test_units.py` covering `resolve_unit("litros")→"Liter"`,
  case/accent tolerance, `resolve_unit(None)→None`, unrecognized spoken unit → `None` (never an error), `UNIT_DISPLAY`
  mapping the 4 canonical units to `kg`/`litros`/`unidades`/`porciones`, and NULL `unidad` → display `None`
  (never coerced to `Unidad`). Then add `services/matcher/src/matcher/units.py` (`UNIT_SYNONYMS`/`resolve_unit` promoted
  from `extra_experiments.py`, new `UNIT_DISPLAY` with the documented deviation comment from design D3/Interfaces).
  Satisfies REQ-ENG-5 (maps half); design §Interfaces. **Verify:** `uv run pytest services/matcher/tests/unit/test_units.py`.
  **Rollback:** `git rm services/matcher/src/matcher/units.py services/matcher/tests/unit/test_units.py`.

## Phase 3: Configuration, decision layer, service (PR 2)

- [x] **T5 — Add pydantic-settings configuration.** RED first: `tests/unit/test_config.py` — defaults
  (`MATCH_ACCEPT_SCORE=0.50`, `MATCH_AMBIGUITY_MARGIN=0.08`, `MATCH_TSR_MARGIN=0.08`, `MATCH_MAX_CANDIDATES=5`,
  `MATCH_UNIT_RERANK=true`, `CATALOGUE_DB=data/bodegas-y-stock.sqlite`), env override via `monkeypatch`, and
  `ValidationError` on `MATCH_ACCEPT_SCORE=not-a-number` (no silent default). Then add
  `services/matcher/src/matcher/config.py`. Satisfies REQ-ENG-4, REQ-API-4 (parse half); design §Configuration.
  **Verify:** `uv run pytest services/matcher/tests/unit/test_config.py`. **Rollback:**
  `git rm services/matcher/src/matcher/config.py services/matcher/tests/unit/test_config.py`.

- [x] **T6 — Implement `decide()` and the unit re-rank band.** RED first: `tests/unit/test_decision.py` as a truth table
  over synthetic ranked lists — `top_score 0.87/margin 0.21` no crowding → `matched`; `top_score 0.31` → `no_match` with no
  SKU asserted; `margin < 0.08` → `ambiguous`; wide margin but `(tsr₁−tsr₂) < MATCH_TSR_MARGIN` over top-5 → `ambiguous`;
  `(tsr₁−tsr₂) ≥ MATCH_TSR_MARGIN` → stays `matched`; status computed from **raw** pre-re-rank scores; re-rank is a stable
  partition inside the band `score ≥ top_score − MATCH_AMBIGUITY_MARGIN` (candidates outside the band never move, nothing is
  ever removed, NULL `unidad` never counts as equal and is never penalized); `MATCH_UNIT_RERANK=false` disables reordering;
  empty ranked list → `[]`, `0.0`, `0.0`; `MATCH_ACCEPT_SCORE=0.60` flips a `0.55` case to `no_match` with no code change.
  Then add `services/matcher/src/matcher/decision.py` (`Candidate`, `Decision`, pure `decide()`). Satisfies REQ-ENG-3,
  REQ-ENG-4, REQ-ENG-5 (re-rank half); design D3. **Verify:** `uv run pytest services/matcher/tests/unit/test_decision.py`.
  **Rollback:** `git rm services/matcher/src/matcher/decision.py services/matcher/tests/unit/test_decision.py`.

- [x] **T7 — Promote the read-only catalogue and add `MatcherService`.** RED first: `tests/unit/test_service.py` plus a
  function-scoped synthetic-sqlite factory in `conftest.py` — a write statement on the loaded connection raises
  `sqlite3.OperationalError` (`mode=ro` URI), missing DB file / missing stock table raises `CatalogueUnavailableError`,
  `catalogues()` returns the 8 `(catalogue_id, rows)` pairs against the real DB, `match()` on an unknown `catalogue_id`
  raises `UnknownCatalogueError` (never a `no_match`), a NULL-`unidad` row surfaces `unidad=None`/`unidad_display=None`,
  and a clear query returns `status == "matched"`. Then add `services/matcher/src/matcher/catalogue.py` (promoted with the
  two design-D2 edits: `sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)` and required path parameter) and
  `service.py` (startup load, `match()`, `catalogues()`). Satisfies REQ-API-5, REQ-API-4 (fail-fast half), REQ-API-2 (data half);
  design D2, §Error Handling. **Verify:** `uv run pytest services/matcher/tests/unit/test_service.py`; harness
  `uv run python -c "from matcher.config import Settings; from matcher.service import MatcherService; print(MatcherService(Settings()).catalogues())"`
  prints 8 tables. **Rollback:** `git rm services/matcher/src/matcher/{catalogue,service}.py services/matcher/tests/unit/test_service.py`.

## Phase 4: HTTP surface and acceptance gates (PR 3)

- [x] **T8 — Ship the FastAPI app and HTTP smoke suite.** RED first: `tests/api/test_http.py` via `fastapi.testclient` with a
  `client` fixture in `conftest.py` — `POST /match` matched response carries `status`, non-empty `candidates` with
  `nr_articulo`/`articulo`/`unidad`/`unidad_display`/`score`, plus `top_score`, `margin`, uuid4 `request_id`; all three
  statuses reachable over HTTP (clear match / crowded near-tie / garbage input); `catalogue_id: "not_a_table"` → HTTP 404
  with `detail` naming the id (never `no_match`); blank/whitespace `spoken_name` → HTTP 422 before reaching the matcher;
  `GET /catalogues` → 8 entries with positive row counts; `GET /health` → 200 with `catalogues`/`rows`. Then add
  `services/matcher/src/matcher/schemas.py` and `main.py` (lifespan builds `MatcherService`, exits non-zero on
  `CatalogueUnavailableError`). Satisfies REQ-API-1, REQ-API-2, REQ-API-3, REQ-API-4 (startup half); design §HTTP contract.
  **Verify:** `uv run pytest services/matcher/tests/api`; harness `uv run uvicorn matcher.main:app --port 8002` then
  `curl -s localhost:8002/health` and a real `POST /match`. **Rollback:**
  `git rm services/matcher/src/matcher/{schemas,main}.py services/matcher/tests/api -r`.

- [x] **T9 — Add the 624-case eval acceptance gate.** Byte-copy `spikes/matching/eval_set.json` to
  `services/matcher/tests/data/eval_set.json`; add `tests/eval/test_eval_accuracy.py` driving `MatcherService.match()`
  in-process over all 624 cases and asserting overall top-1 ≥ 0.986, recall@3 == 1.00 on variant cases, and garbage
  false-confidence (`status == "matched"`) ≤ 2.2%; report and pin the has-code (`nr_articulo` present) vs no-code
  (`nr_articulo` NULL) split as module constants with a provenance docstring. Add the D4 guard test hashing the copy against
  the spike file (skip when absent). `spikes/matching/run_eval.py` stays untouched. Satisfies REQ-ENG-6; design D4.
  **Verify:** `uv run pytest services/matcher/tests/eval -q` green in seconds; `sha256sum services/matcher/tests/data/eval_set.json spikes/matching/eval_set.json` match.
  **Rollback:** `git rm -r services/matcher/tests/eval services/matcher/tests/data`.

## Phase 5: Deployment and documentation reconciliation (PR 4)

- [x] **T10 — Containerize on port 8002.** Add `services/matcher/Dockerfile` (design §Dockerfile verbatim: two-stage
  `uv sync --frozen --no-dev` layers, `CMD ["uvicorn", "matcher.main:app", "--host", "0.0.0.0", "--port", "8002"]`) and
  `services/matcher/docker-compose.yml` (spike 06's block with the D5 build context `{context: ../.., dockerfile: services/matcher/Dockerfile}`,
  `../../data:/data:ro`, `CATALOGUE_DB=/data/bodegas-y-stock.sqlite`, the five MATCH_* env vars, `GET /health` healthcheck,
  `restart: unless-stopped`). Satisfies REQ-API-6; design D5. **Verify:** `cd services/matcher && docker compose up -d`,
  `docker compose ps` shows `healthy`, then `curl -s -X POST localhost:8002/match -H 'content-type: application/json' -d '{"spoken_name":"aceite de oliva","catalogue_id":"stock_almacen_ayb","unit":"litros"}'`
  returns a valid contract response. **Rollback:** `git rm services/matcher/{Dockerfile,docker-compose.yml}`.
  **DONE 2026-07-24 (⚠️ runtime harness blocked)** — Dockerfile + compose written per design D5 (`MATCH_TSR_MARGIN`
  added; spike 06's block omitted it). RED-first contract suite `tests/unit/test_container.py` (15 tests) run before
  the artefacts existed. `docker compose config` validates. **`docker compose up -d` could not run: the invoking user
  is not in the `docker` group — `permission denied while trying to connect to the docker API at
  unix:///var/run/docker.sock`.** Live `healthy` + `POST /match` on 8002 remain unverified.

- [x] **T11 — Reconcile openspec config with the selected stack.** Modify `openspec/config.yaml` (`strict_tdd: true`,
  `testing.test_command`/`rules.apply.test_command`/`rules.verify.test_command` → `uv run pytest`, `runner: pytest`,
  `layers.unit`/`integration` populated, `rules.apply.tdd: true`, refresh `context` to Python 3.11+/uv/FastAPI) and
  `openspec/project.md` with the same reconciliation. Satisfies proposal decision 3; design §File Changes. Independent of
  every code task. **Verify:** `git diff openspec/` shows no `test_command: null` and no "Tech stack: Not selected" line remaining.
  **Rollback:** `git checkout main -- openspec/config.yaml openspec/project.md`.
  **DONE 2026-07-24** — both files were untracked in the main checkout and absent from the worktree, so they land as
  NEW files on `feat/add-matching-service` (reconciled content, not a diff).

- [x] **T12 — Add the dated spike-06 correction note.** Modify `spikes/06-stack-module-3-matching.md` line 16's stack row:
  keep the historical claim and append a dated note (2026-07-24) that the code uses stdlib `unicodedata`, nothing imports
  `unidecode`, and the dependency was dropped in `add-matching-service`. Satisfies proposal decision 2. Independent of every
  other task. **Verify:** `git diff spikes/06-stack-module-3-matching.md` touches only that row/note; `git grep -n unidecode -- pyproject.toml`
  returns nothing. **Rollback:** `git checkout main -- spikes/06-stack-module-3-matching.md`.
  **DONE 2026-07-24** — one-line change; `git grep -n unidecode -- pyproject.toml` returns nothing.

## Requirement Traceability

| Requirement | Tasks |
|---|---|
| REQ-ENG-1 normalization pipeline (+ no `unidecode`) | T1, T2 |
| REQ-ENG-2 trigram ranking (no WRatio/`sd`/two-stage) | T3 |
| REQ-ENG-3 three-way decision layer | T6 |
| REQ-ENG-4 env-configurable thresholds | T5, T6 |
| REQ-ENG-5 unit maps + re-rank never a gate | T4, T6 |
| REQ-ENG-6 eval reproduces spike accuracy | T9 |
| REQ-API-1 `POST /match` contract | T8 (+T7 unknown-catalogue error) |
| REQ-API-2 `GET /catalogues` | T7, T8 |
| REQ-API-3 `GET /health` | T8 |
| REQ-API-4 pydantic-settings, fail fast at startup | T5, T7, T8 |
| REQ-API-5 read-only in-memory catalogue (`mode=ro`) | T7 |
| REQ-API-6 container on 8002 + compose healthcheck | T10 |
