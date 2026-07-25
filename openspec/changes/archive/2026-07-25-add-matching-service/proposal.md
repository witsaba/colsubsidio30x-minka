# Proposal: Module 3 — Product Matching Service (`add-matching-service`)

## Intent

Ship the committed Module 3 deliverable before the Saturday 22:00 demo deadline: a runnable FastAPI service on port 8002 that matches spoken product names against the warehouse catalogue with the measured <1% top-1 error (98.6% top-1, 100% recall@3, spike 02). Today that accuracy exists only as research scripts under `spikes/matching/` — no service, no status contract, no test runner. A confident wrong match is worse than `no_match`; the three-way `matched`/`ambiguous`/`no_match` contract is the product safeguard and does not exist in code yet.

## Scope

**In scope**: `services/matcher/` (package promoted from spike modules + new decision layer, FastAPI app, config, Dockerfile, docker-compose, pytest suite); `pyproject.toml`/`uv.lock` dependency fixes; `openspec/config.yaml` + `openspec/project.md` reconciliation; one dated correction note in `spikes/06-stack-module-3-matching.md`.

**Out of scope (non-goals)**: frontend/UI; Module 1 (STT) and Module 2 integration; Postgres/FTS5/embeddings/vector store/cache/second datastore; RF-11 warehouse-vs-stock-table product decision (`catalogue_id` = stock table, as decided); threshold re-tuning on real dictation; rewriting the measured matcher.

## Capabilities

### New Capabilities
- `product-matching-engine`: Spanish normalization, trigram ranking, and the three-way threshold/ambiguity decision layer with unit synonym + display maps.
- `matcher-service-api`: HTTP contract (`POST /match`, `GET /catalogues`, `GET /health`), env-var configuration, containerized deployment on port 8002.

### Modified Capabilities
None (`bodegas-stock-database`, `xlsx-to-sqlite-build` unchanged; the sqlite is a read-only input).

## Approach

Approach 1 from exploration (accepted): promote `normalize.py`/`matchers.py`/`catalogue.py` algorithm code unchanged into an installable `services/matcher/src/` package; author the missing decision layer TDD-first (`uv run pytest`, red → green). Five decisions taken:

1. **Dependencies**: move `rapidfuzz` to main deps; add `fastapi`, `uvicorn`, `pydantic-settings` (main) and `pytest`, `pytest-asyncio`, `httpx` (dev). Fixes the latent `uv sync --frozen --no-dev` container import failure.
2. **Drop `unidecode`**: code uses stdlib `unicodedata`; nothing imports `unidecode`. Align docs to code — remove the dep, add a dated correction note to spike 06's stack table.
3. **Reconcile openspec config in this change**: `strict_tdd: true`, `test_command: uv run pytest`, stack = Python 3.11+/uv/FastAPI in `config.yaml` and `project.md`.
4. **Decision layer shape**: pure function over ranked candidates — gate on raw `similarity ≥ MATCH_ACCEPT_SCORE`; `ambiguous` when margin `< MATCH_AMBIGUITY_MARGIN` **or** `token_set_ratio` over top-5 flags crowding; unit as secondary re-rank behind `MATCH_UNIT_RERANK`, never a hard gate; two separate unit maps (matching Spanish→canonical, display canonical→Spanish); `NULL` unit never coerced. All thresholds via env (pydantic-settings), no rebuild to re-tune.
5. **run_eval DoD**: satisfied by an in-process pytest eval driving the service's own ranking function over the 624-case `eval_set.json`, reproducing spike numbers split has-code vs no-code, plus a thin HTTP smoke test (TestClient) proving all three statuses reachable. `spikes/matching/run_eval.py` stays untouched.

## Affected Areas

| Area | Impact |
|------|--------|
| `services/matcher/` (src, tests, Dockerfile, compose) | New |
| `pyproject.toml`, `uv.lock` | Modified |
| `openspec/config.yaml`, `openspec/project.md` | Modified |
| `spikes/06-stack-module-3-matching.md` | Modified (+dated note) |
| `data/bodegas-y-stock.sqlite` | Read-only input, opened `mode=ro` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Accuracy regression while promoting spike code | Med | 624-case eval test is the regression gate; algorithm logic moved unchanged |
| Ambiguity logic tuned on n=10 clusters | High | Env-configurable thresholds; second scorer swappable; re-measure on real dictation later |
| Stray write to catalogue | Low | `:ro` mount **and** sqlite `mode=ro` URI |
| No test scaffold exists yet | Med | First task bootstraps pytest + conftest, RED-first |
| Review budget overflow (service + tests + config) | Med | sdd-tasks must forecast vs 800-line budget; chain PRs by work unit if exceeded |

## Rollback Plan

Revert the change commits: delete `services/matcher/`, revert `pyproject.toml`/`uv.lock` and openspec config edits, drop the spike-06 note. No data migration — the sqlite artefact and spike code are unchanged inputs.

## Dependencies

- `data/bodegas-y-stock.sqlite` (exists, reproducible via `make build-sqlite`).
- `spikes/matching/` modules and `eval_set.json` (exist, final).

## Success Criteria

- [ ] `docker compose up` in `services/matcher/` yields a healthy service against the real catalogue
- [ ] All three `status` values reachable and covered by tests
- [ ] Normalisation rules unit-tested individually
- [ ] In-process eval reproduces spike numbers, split has-code vs no-code
- [ ] Thresholds changeable via env without rebuild
- [ ] `uv run pytest` green from a clean checkout; no `requirements.txt`
