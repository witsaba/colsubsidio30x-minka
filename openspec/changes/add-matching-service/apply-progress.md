# Apply Progress: `add-matching-service`

> Artifact store: hybrid. Engram topic: `sdd/add-matching-service/apply-progress`. This file is the OpenSpec mirror.
> Mode: **Strict TDD** (RED → GREEN → TRIANGULATE → REFACTOR). Test runner: `uv run pytest`.
> Worktree: `colsubsidio30x-minka-worktrees/add-matching-service`, branch `feat/add-matching-service`.
> Working tree intentionally left dirty and uncommitted — the orchestrator commits after the review lifecycle.

## APPLY PHASE COMPLETE — 12 / 12 tasks

| Task | State | Batch |
|---|---|---|
| T1 — Bootstrap uv workspace + pytest scaffold | [x] done | 1 |
| T2 — Promote normalization pipeline | [x] done | 1 |
| T3 — Promote trigram scoring | [x] done | 1 |
| T4 — Unit synonym + display maps | [x] done | 1 |
| T5 — pydantic-settings configuration | [x] done | 2 |
| T6 — `decide()` + unit re-rank band | [x] done | 2 |
| T7 — Read-only catalogue + `MatcherService` | [x] done | 2 |
| T8 — FastAPI app + HTTP smoke suite | [x] done | 3 |
| T9 — 624-case eval acceptance gate | [x] done | 3 |
| T10 — Container on port 8002 | [x] done ⚠️ live harness blocked | 4 |
| T11 — Reconcile openspec config | [x] done | 4 |
| T12 — Dated spike-06 correction note | [x] done | 4 |

Batch 1 = PR 1 slice (scaffold + pure engine); batch 2 = PR 2 slice (config, decision, service);
batch 3 = PR 3 slice (HTTP API + eval gate); batch 4 = PR 4 slice (container + doc reconciliation).

**Full suite: `uv run pytest` → `232 passed, 1 warning in 3.99s`** (217 from batches 1–3, +15 new T10 container
contract tests).

## Files Changed (batch 1)

| File | Action | Lines | What |
|---|---|---|---|
| `pyproject.toml` | Modified | 29 | Workspace root (`members = ["services/matcher"]`, `matcher = {workspace = true}`), dev group → pytest/pytest-asyncio/httpx, **rapidfuzz + unidecode dropped**, `testpaths = ["services/matcher/tests"]` |
| `uv.lock` | Regenerated | generated | Single workspace lock; `unidecode==1.4.0` removed |
| `services/matcher/pyproject.toml` | Created | 18 | project `matcher`, hatchling, `src/matcher/`, main deps fastapi/uvicorn/pydantic-settings/rapidfuzz |
| `services/matcher/src/matcher/__init__.py` | Created | 9 | Package marker + `__version__` |
| `services/matcher/src/matcher/normalize.py` | Promoted | 221 | `spikes/matching/normalize.py`, logic unchanged |
| `services/matcher/src/matcher/scoring.py` | Created (promoted core) | 58 | `TrigramSimilarityMatcher.rank()` body unchanged + `token_set_ratio_01()` |
| `services/matcher/src/matcher/units.py` | Created (promoted map) | 60 | `UNIT_SYNONYMS`/`resolve_unit` + new `UNIT_DISPLAY` |
| `services/matcher/tests/conftest.py` | Created | 17 | Session-scoped `catalogue_db_path` |
| `services/matcher/tests/unit/test_packaging.py` | Created | 34 | T1 RED smoke (3 tests) |
| `services/matcher/tests/unit/test_normalize.py` | Created | 163 | T2 RED characterization (32 tests) |
| `services/matcher/tests/unit/test_scoring.py` | Created | 164 | T3 RED characterization (15 tests) |
| `services/matcher/tests/unit/test_units.py` | Created | 97 | T4 RED (26 tests) |

Authored new lines: **841** plus a 15-line `pyproject.toml` edit (`uv.lock` is generated, excluded from the authored
review budget). 366 production lines vs 475 test lines.

## Files Changed (batch 2)

| File | Action | Lines | What |
|---|---|---|---|
| `services/matcher/src/matcher/config.py` | Created | 44 | `Settings(BaseSettings)`: `catalogue_db` + the five `MATCH_*` knobs, bounded (`ge`/`le`) so bad values raise at construction; `extra="ignore"`, case-insensitive env |
| `services/matcher/src/matcher/decision.py` | Created | 138 | `Candidate`, `Decision` (both frozen), pure `decide()`; dual-signal status from raw scores + band-limited stable unit re-rank |
| `services/matcher/src/matcher/catalogue.py` | Promoted | 82 | `spikes/matching/catalogue.py` + the two D2 edits (`mode=ro` URI via `open_readonly()`, required path param) + `CatalogueUnavailableError` |
| `services/matcher/src/matcher/service.py` | Created | 47 | `MatcherService` (startup load, `match()`, `catalogues()`) + `UnknownCatalogueError` |
| `services/matcher/tests/conftest.py` | Modified | 60 (+43) | Added function-scoped `make_synthetic_db` factory |
| `services/matcher/tests/unit/test_config.py` | Created | 169 | T5 RED (21 tests) |
| `services/matcher/tests/unit/test_decision.py` | Created | 321 | T6 RED (39 tests) |
| `services/matcher/tests/unit/test_service.py` | Created | 228 | T7 RED (25 tests) |

Batch-2 authored lines: **1,032** (311 production vs 721 test/fixture).

## Files Changed (batch 3 — PR 3 slice, T8–T9)

| File | Action | Lines | What |
|---|---|---|---|
| `services/matcher/src/matcher/schemas.py` | Created | 67 | Wire contract only: `MatchRequest` (blank `spoken_name` → 422 via `field_validator`, stored stripped), `CandidateOut`, `MatchResponse`, `CatalogueEntry`, `CataloguesResponse`, `HealthResponse` |
| `services/matcher/src/matcher/main.py` | Created | 103 | `lifespan` builds `MatcherService(Settings())`, errors uncaught → uvicorn exits non-zero; module-level `app`; `POST /match` (uuid4 `request_id`, `UnknownCatalogueError` → 404), `GET /catalogues`, `GET /health` |
| `services/matcher/tests/conftest.py` | Modified | 89 (+29) | Added `settings`, session-scoped `service`, and `client` fixtures (cwd-independent, real lifespan) |
| `services/matcher/tests/api/test_http.py` | Created | 250 | T8 RED (41 tests, 6 classes) |
| `services/matcher/tests/data/eval_set.json` | Copied (byte-identical) | generated | `sha256 5a05cb27792166bdcaabbe5c988921f10e830b34e43dccd86b24d76f04d243bf` |
| `services/matcher/tests/eval/test_eval_accuracy.py` | Created | 212 | T9 RED (15 tests) + pinned cohort baselines with a dated provenance block |

Batch-3 authored lines: **661** (170 production vs 491 test/fixture).

## Files Changed (batch 4 — PR 4 slice, T10–T12)

| File | Action | Lines | What |
|---|---|---|---|
| `services/matcher/tests/unit/test_container.py` | Created | 118 | T10 RED (15 tests): Dockerfile base image / `uv sync --frozen --no-dev` on every sync line / lockfile-before-source layer order / exact `matcher.main:app` CMD + `EXPOSE 8002`; compose build context, published port, `:ro` mount, all five `MATCH_*` pins, healthcheck URL + `retries: 3`, `restart: unless-stopped`. Text assertions on purpose — PyYAML is not a project dependency and is not worth adding to read two files |
| `services/matcher/Dockerfile` | Created | 24 | Design §Dockerfile verbatim: `python:3.12-slim`, uv binary from `ghcr.io/astral-sh/uv:latest`, cached deps layer (`uv sync --frozen --no-dev --no-install-workspace --package matcher`), then source + `uv sync --frozen --no-dev --package matcher`, `ENV PATH="/app/.venv/bin:$PATH"`, `EXPOSE 8002`, `CMD ["uvicorn","matcher.main:app","--host","0.0.0.0","--port","8002"]`. Header documents that the build context is the repo root |
| `services/matcher/docker-compose.yml` | Created | 24 | Spike 06's block + D5 build context (`context: ../..`, `dockerfile: services/matcher/Dockerfile`), `"8002:8002"`, `../../data:/data:ro`, `CATALOGUE_DB=/data/bodegas-y-stock.sqlite`, five `MATCH_*` vars, `/health` healthcheck (10s/3s/3), `restart: unless-stopped` |
| `openspec/config.yaml` | Created (was untracked in main, absent from worktree) | 60 | `strict_tdd: true`, `runner: pytest`, `test_command: uv run pytest` in `testing` + `rules.apply` + `rules.verify`, `rules.apply.tdd: true`, layers unit/api/eval, refreshed `context` (Python 3.11+/uv workspace/FastAPI/pydantic-settings/read-only SQLite), `rules.verify.build_command` → compose build, plus two apply guidelines (RED-first, catalogue stays read-only) |
| `openspec/project.md` | Created (same reason) | 60 | Lifecycle Active, detected stack/architecture, conventions, Strict TDD **Enabled**, capability table (runner/unit/integration/e2e = yes; coverage/lint/types/format = no), runtime section (local uvicorn + compose) |
| `spikes/06-stack-module-3-matching.md` | Modified | 1 | Stack row: historical `unidecode` claim struck through + `**Correction (2026-07-24)**` note (stdlib `unicodedata` in `normalize.py: strip_accents`, nothing imports `unidecode`, dependency dropped in `add-matching-service`) |

Batch-4 authored lines: **~287** (118 test, 48 deployment artefacts, 120 config/docs).

## TDD Cycle Evidence

| Task | Test file | Layer | Safety net | RED | GREEN | TRIANGULATE | REFACTOR |
|---|---|---|---|---|---|---|---|
| T1 | `tests/unit/test_packaging.py` | Unit | N/A (new) | ✅ `Failed to spawn: pytest` | ✅ 3 passed | ✅ 3 cases | ➖ |
| T2 | `tests/unit/test_normalize.py` | Unit | N/A (new) | ✅ `ModuleNotFoundError: matcher.normalize` | ✅ 32 passed | ✅ 32 cases | ➖ |
| T3 | `tests/unit/test_scoring.py` | Unit | N/A (new) | ✅ `ModuleNotFoundError: matcher.scoring` | ✅ 15 passed | ✅ 15 cases | ✅ `RowLike` Protocol |
| T4 | `tests/unit/test_units.py` | Unit | N/A (new) | ✅ `ModuleNotFoundError: matcher.units` | ✅ 26 passed | ✅ 26 cases | ➖ |
| T5 | `tests/unit/test_config.py` | Unit | N/A (new) | ✅ `ModuleNotFoundError: matcher.config` | ✅ 21 passed | ✅ 21 cases | ➖ |
| T6 | `tests/unit/test_decision.py` | Unit | N/A (new) | ✅ `ModuleNotFoundError: matcher.decision` | ✅ 39 passed | ✅ 39 cases | ➖ |
| T7 | `tests/unit/test_service.py` | Unit | N/A (new) | ✅ `ModuleNotFoundError: matcher.catalogue` | ✅ 25 passed | ✅ 25 cases | ➖ |
| T8 | `tests/api/test_http.py` | HTTP (TestClient) | Unit 161 green | ✅ `3 failed, 38 errors` — `ModuleNotFoundError: matcher.main` | ✅ 41 passed in 1.88s | ✅ 41 cases in 6 classes | ➖ |
| T9 | `tests/eval/test_eval_accuracy.py` | Eval | Unit+API 202 green | ✅ `4 failed, 8 errors` (missing `tests/data/eval_set.json`) | ✅ 12 passed in 1.09s after the byte copy | ✅ +3 cases pinning cohort baselines (15 total) | ➖ |
| T10 | `tests/unit/test_container.py` | Unit (artefact contract) | 217 green | ✅ Written first — `15 errors`, cause `assert path.is_file()` on the missing `Dockerfile`/`docker-compose.yml` | ✅ `15 passed in 0.27s` | ✅ 15 cases: 4 Dockerfile + 11 compose (5 parametrized threshold pins) | ✅ Settings-default cross-check test replaced hard-coded duplication of the compose env values |
| T11 | — | Docs/config | 232 green | ➖ N/A — declarative SDD configuration, no runtime behavior to assert | — | — | — |
| T12 | — | Docs | 232 green | ➖ N/A — one prose line in a historical spike document | — | — | — |

T11/T12 are documentation/configuration tasks with no executable behavior; `tasks.md` prescribes `git diff`/`git grep`
verification for both, which is what was run. No production code path is left untested by this exemption.

### Test Summary
- Total tests: **232** (76 batch 1 + 85 batch 2 + 56 batch 3 + **15** batch 4); all passing
- Layers: Unit (176), HTTP/TestClient (41), Eval (15)
- Full suite: `uv run pytest` → `232 passed, 1 warning in 3.99s`

## Measured eval numbers (T9, REQ-ENG-6) — unchanged by batch 4

```
overall   n=430 top1=0.9860 recall@3=1.0000
has_code  n=345 top1=0.9855 recall@3=1.0000
no_code   n= 85 top1=0.9882 recall@3=1.0000
garbage   n=184 false_confidence=0.0054
ambiguous n= 10 flag_recall=1.0
```

## Work Unit Evidence

| Evidence | PR 1 (T1–T4) | PR 2 (T5–T7) | PR 3 (T8–T9) | PR 4 (T10–T12) |
|---|---|---|---|---|
| Focused test command / result | `pytest tests/unit` → 76 passed | 21 + 39 + 25 passed | `tests/api` → 41 passed; `tests/eval` → 15 passed | `pytest services/matcher/tests/unit/test_container.py -q` → **15 passed in 0.27s** |
| Full suite | 76 passed in 0.19s | 161 passed in 0.98s | 217 passed in 4.04s | **232 passed, 1 warning in 3.99s** |
| Runtime harness | N/A — pure functions | ✅ `MatcherService(Settings()).catalogues()` → 8 tables, 1,405 rows | ✅ live uvicorn on 8002: `/health` → `{"status":"ok","catalogues":8,"rows":1405}`; real `POST /match` → `ambiguous` with 5 candidates; unknown catalogue → 404; whitespace name → 422; fail-fast → **exit 3** | ⚠️ **BLOCKED** — `docker compose up -d` → `unable to get image 'matcher-matcher': permission denied while trying to connect to the docker API at unix:///var/run/docker.sock`. Daemon `active`, socket `srw-rw---- root:docker`, invoking user's groups `braejan adm sudo lpadmin` (no `docker`). Substitutes that DID run: `docker compose -f services/matcher/docker-compose.yml config` → OK (schema valid, context resolves); `uv sync --frozen --no-dev --package matcher --dry-run` → resolves against the committed lock, so the Dockerfile's install step cannot fail on a stale lock |
| Rollback boundary | `git rm -r services/matcher && git checkout main -- pyproject.toml uv.lock` | `git rm services/matcher/src/matcher/{config,decision,catalogue,service}.py` + tests | `git rm services/matcher/src/matcher/{schemas,main}.py; git rm -r services/matcher/tests/{api,eval,data}` + revert the conftest hunk | `git rm services/matcher/{Dockerfile,docker-compose.yml,tests/unit/test_container.py} openspec/{config.yaml,project.md}; git checkout main -- spikes/06-stack-module-3-matching.md`. Removes deployment + doc reconciliation without touching service code — the 217 pre-existing tests stay green |

## Deviations

1. `normalize.py` promoted verbatim **minus** its `if __name__ == "__main__":` demo block.
2. `tasks.md` T2 gender-folding claim (`blanca`→`BLANCO`) is inverted vs real behavior (`BLANCO`→`blanca`, lower-cased).
3. `tasks.md` T2 `P/PICAR`→`para picar` is wrong; real behavior is `PARAPICAR`, and `normalize_for_match` never calls `expand_abbrev`.
4. `scoring.py` uses a `RowLike` Protocol instead of importing `catalogue.Row`; `use_word_similarity` dropped per D2.
5. Branch is `feat/add-matching-service` (single orchestrator worktree), not the four planned slice branches.
6. `catalogue.py` gained `CatalogueUnavailableError` and the `open_readonly()` seam beyond D2's "two edits"; both additive and required by REQ-API-4/5.
7. `decision.py` declares its own `RowLike` Protocol rather than importing `catalogue.Row`.
8. Batch 3 — `MatchResponse.status` is typed `str`, not a `Literal` (constraint enforced by `decide()` and pinned by the unit truth table).
9. Batch 3 — `spoken_name` is stored stripped after validation.
10. Batch 3 — cohort baselines are asserted, not merely reported (extra regression guard, dated provenance).
11. Batch 3 — the `service` fixture is session-scoped and pinned to an absolute DB path (cwd-independent).
12. **Batch 4 — `MATCH_TSR_MARGIN: "0.08"` was added to the compose env block.** Spike 06's block predates the TSR
    crowding signal and lists only four `MATCH_*` vars; `tasks.md` T10 requires "the five MATCH_* env vars". A test
    asserts every compose default equals the corresponding `Settings` default, so the two can no longer drift.
13. **Batch 4 — `openspec/config.yaml` and `openspec/project.md` land as NEW files, not modifications.** Both were
    untracked in the main checkout and therefore absent from the worktree, so T11's `git diff openspec/` verification
    is vacuous; `git status` shows them added. Content is the full reconciliation the task specifies.
14. **Batch 4 — T10 shipped with a static artefact-contract test suite in place of the (blocked) live harness.**
    `tasks.md` did not ask for `test_container.py`; Strict TDD requires a RED step, and the container contract is the
    only assertable surface without a daemon. It supplements, never substitutes for, `docker compose ps` healthy.
15. **Batch 4 — total is 232 tests, not 217.** The 217 from batches 1–3 all still pass; the T10 RED cycle added 15.

## Issues

- **OPEN (T10, REQ-API-6): the container was never actually built or run.** `docker compose up -d` fails with
  `permission denied ... unix:///var/run/docker.sock`; the invoking user is not in the `docker` group. Remediation is
  one command outside this agent's remit (`sudo usermod -aG docker $USER` + re-login, or run compose under `sudo`).
  Until then "healthy healthcheck on 8002" is asserted only as file content, never observed. The verify phase should
  treat REQ-API-6 as unproven at runtime.
- One `StarletteDeprecationWarning` from `fastapi.testclient` (test-only, upstream).
- `MATCH_TSR_MARGIN=0.08` remains provisional (crowding sample n=10), flagged in `config.py` for re-measurement.
- OpenSpec `tasks.md` checkboxes are maintained in the main checkout by the executor; the worktree has no
  `openspec/changes/add-matching-service/` directory.

## Next

`sdd-verify` — with REQ-API-6's runtime evidence explicitly carried forward as owed.
