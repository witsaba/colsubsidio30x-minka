# Exploration: Module 3 — product-matching backend service (`add-matching-service`)

> Artifact store: hybrid. Engram topic: `sdd/add-matching-service/explore`. This file is the OpenSpec mirror.

## Current State

Nothing implementing Module 3 exists in application code yet. What exists:

- `spikes/02-product-matching.md`, `spikes/06-stack-module-3-matching.md`, `spikes/03-integration-risks.md`, `spikes/04-next-steps.md` — decided, final research/build-spec docs. Winner: in-process trigram matcher (pg_trgm-faithful `similarity()` reimplementation), no datastore, thresholds `accept: sim>=0.50 & margin>=0.08`, `ambiguous: sim>=0.50 & margin<0.08`, `no_match: sim<0.50`.
- `spikes/matching/` — a **research harness**, not a service: `catalogue.py` (loads the 8 stock tables into `Row` dataclasses via a hardcoded `sqlite3` path `parents[2]/data/bodegas-y-stock.sqlite`), `normalize.py` (pg_trgm trigram reimpl + Spanish normalizer: accent-strip via stdlib `unicodedata`, packaging-token strip, gender-fold, pluralize, abbrev-expand), `matchers.py` (7 matcher classes incl. `TrigramSimilarityMatcher`, `RapidFuzzMatcher`), `gen_eval_set.py`/`eval_set.json` (624 labelled cases), `run_eval.py`/`threshold_experiment.py`/`extra_experiments.py` (benchmark scripts, in-process only, no HTTP). `extra_experiments.py` contains a throwaway `UNIT_SYNONYMS`/`detect_unit` prototype for the Spanish→English unit map — not promoted to a reusable module.
- `pyproject.toml` — Python 3.11+, `uv`-managed, `[project.dependencies]` = `pandas`, `openpyxl` only. `rapidfuzz` and `unidecode` sit in `[dependency-groups] dev`, NOT main dependencies. `uv.lock` has no `pytest`, `fastapi`, `uvicorn`, or `pydantic` entries anywhere.
- `scripts/build_bodegas_sqlite.py` + `data/bodegas-y-stock.sqlite` — the committed, reproducible catalogue artefact (9 tables incl. `_meta`; the 8 stock tables match `spikes/matching/catalogue.py:STOCK_TABLES` exactly). `data/README.md` documents schema/regeneration (`make build-sqlite` / `check-sqlite`).
- `openspec/changes/convert-bodegas-xlsx-to-sqlite/` — prior, already-applied change (T1–T5 done) that introduced the uv toolchain. Its `tasks.md` explicitly ran with **no test framework** ("strict TDD Mode: Disabled" at the time).
- `openspec/project.md` and `openspec/config.yaml` are still the original bootstrap: `strict_tdd: false`, `test_command: null`, "Runtime/language: Not selected" — **stale**, written before uv/Python/pytest conventions existed and before the spike's TDD decision.
- No `services/` directory exists at all (neither Module 1 STT nor Module 3 matcher has been scaffolded).

## Affected Areas

- `pyproject.toml`, `uv.lock` — must gain `fastapi`, `uvicorn`, `pydantic-settings` (main deps) and `pytest`, `pytest-asyncio`, `httpx` (dev deps, for `TestClient`); `rapidfuzz` and `unidecode` must move from `dev` group to main `dependencies` (the container build pattern used by Module 1's Dockerfile is `uv sync --frozen --no-dev`, which would silently drop them at runtime otherwise).
- `spikes/matching/normalize.py`, `matchers.py`, `catalogue.py` — source of the algorithms to promote ("promote and clean, do not rewrite" per spike). Flat top-level imports (`from catalogue import ...`) assume `spikes/matching/` on `sys.path`; must become an installable package tree under `services/matcher/src/`.
- `spikes/matching/eval_set.json` — the acceptance-layer fixture (624 cases); needs a decision on where it lives for the service's test suite (copy vs. shared path reference).
- `data/bodegas-y-stock.sqlite` — read-only input; must be reachable both at `data/bodegas-y-stock.sqlite` (local `uv run` dev/test) and at `/data/bodegas-y-stock.sqlite` (docker `:ro` mount per stack doc), via env var `CATALOGUE_DB`, not a hardcoded path.
- New: `services/matcher/` (does not exist) — `src/main.py` (FastAPI app), `src/config.py` (pydantic-settings for `CATALOGUE_DB`, `MATCH_ACCEPT_SCORE`, `MATCH_AMBIGUITY_MARGIN`, `MATCH_MAX_CANDIDATES`, `MATCH_UNIT_RERANK`), a new decision function (`matched`/`ambiguous`/`no_match` per thresholds — **does not exist in the spike**, which only measured accuracy metrics, never emitted a status enum), a promoted unit-synonym module (matching map + the separate display map mentioned in the stack doc — **display map does not exist in code at all**), `Dockerfile`, `docker-compose.yml` (port 8002, `../../data:/data:ro` mount, healthcheck), `tests/`.
- `openspec/project.md`, `openspec/config.yaml` — stale stack/TDD state; a downstream phase (design or a fast-follow) should reconcile them with the now-decided Python/uv/pytest/FastAPI reality and `strict_tdd: true`.

## Approaches

1. **Promote and refactor the spike modules into an installable package, author the missing decision layer on top** — move `normalize.py`/`matchers.py`/`catalogue.py` algorithm code (unchanged logic) into `services/matcher/src/`, restructure imports as a real package, add pydantic-settings config, write a new status/threshold function (rank by `similarity`, detect ambiguity via `token_set_ratio` over top-5 per the "unresolved tension" plan), add FastAPI routes and a Dockerfile/compose matching the stack doc exactly, add pytest test suite driven by `eval_set.json`, move `rapidfuzz`/`unidecode` to main deps.
   - Pros: Preserves the measured 98.6%/100%-recall algorithm untouched (satisfies "do not rewrite"); matches the stack doc's explicit build order (normalizer → scorer → thresholds); keeps the durable eval harness reusable; smallest deviation from decided evidence.
   - Cons: Real packaging work (flat scripts → proper module tree); the composed matched/ambiguous/no_match decision, the second-scorer ambiguity check, and the unit display map are new code with no prior test coverage — need fresh TDD cycles, not copy-paste.
   - Effort: Medium.

2. **Rewrite matching using RapidFuzz's built-in scorers only, dropping the bespoke pg_trgm reimplementation.**
   - Pros: Less "research code" in production; smaller surface to maintain long-term.
   - Cons: **Directly contradicts the fixed, measured decision.** The winner was `pg_trgm similarity` (98.6% top-1); the best RapidFuzz scorer measured was `token_set_ratio` at 93.3% top-1, ~11 pp worse false-confidence on garbage than plain `similarity`. Silently swaps in a worse-measured matcher. Rejected.
   - Effort: Medium, wrong outcome.

3. **Wrap `spikes/matching/*.py` in place via `sys.path` manipulation, no restructuring.**
   - Pros: Zero diff to spike files, fastest to wire up.
   - Cons: Fragile packaging that breaks the Module 1-style Dockerfile pattern (`COPY src/ ./src/` never brings `spikes/` into the image); relies on path hacks instead of a real package; awkward to unit-test in isolation; poor long-term hygiene for a "definition of done" service.
   - Effort: Low short-term, high hidden cost. Rejected.

## Recommendation

Approach 1. It is the only option consistent with both the spike's explicit instruction ("promote and clean them, do not rewrite") and the measured accuracy numbers the whole proposal rests on. The proposal/design phase should treat the missing decision layer (threshold gate + second-scorer ambiguity check + unit synonym/display maps + FastAPI contract) as genuinely new, TDD-first work — it is not sitting in the spike anywhere, only described in prose.

## Risks

- **Dependency-location bug already latent in the repo**: `rapidfuzz`/`unidecode` are `dev`-group only; the stack doc's own Dockerfile pattern (`uv sync --frozen --no-dev`) would produce a container that fails at import time unless this is fixed as part of this change.
- **`unidecode` vs. actual code mismatch**: the stack doc says the winning matcher stack is "rapidfuzz + unidecode", but `spikes/matching/normalize.py`'s `strip_accents()` uses stdlib `unicodedata.normalize("NFKD", ...)`, not the `unidecode` package — nothing in the spike imports `unidecode` at all. The proposal/design must explicitly decide: drop the unused dependency, or replace the stdlib accent-strip with `unidecode` to match the documented stack. Left unresolved, this is silent drift between doc and code.
- **`openspec/config.yaml`/`project.md` staleness**: both still say `strict_tdd: false`, `test_command: null`, "Runtime/language: Not selected" — written before the uv/Python stack (already applied in a prior change) and before the spike's explicit "Strict TDD is enabled" decision. sdd-design/tasks should reconcile these before or alongside this change, or task verification will run against a config that contradicts the working agreement.
- **No test runner exists in the repo at all today** (`uv.lock` has no `pytest`). This change is the one that must introduce it — first RED test has no scaffolding to build on yet (no conftest, no test dir convention).
- **Definition-of-done ambiguity on `run_eval.py`**: the stack doc's DoD says "`spikes/matching/run_eval.py` runs against the **service** and reproduces the spike numbers" — the current script calls `matcher.rank()` in-process, never HTTP. Design must decide: adapt it into an HTTP client against the running service, or accept an equivalent in-process test against the service's own ranking function as satisfying that DoD line. Either way, today's script only reports top-1/recall/margin — it never exercises the three-way `matched`/`ambiguous`/`no_match` status contract, which is new assertion surface to add.
- **RF-11 blocker consequence for this service's contract (already decided, not re-litigated)**: `catalogue_id` in `POST /match` refers to one of the 8 stock tables, not a warehouse — any caller (Module 2/front-end) integrating against `GET /catalogues` must be built against stock-table identity, not warehouse identity. Restated here only because it changes what this service's own contract means to its consumers, not to reopen the product decision.
- **Small ambiguity-recall sample (n=10 clusters)** behind the "rank by similarity, detect ambiguity by token_set_ratio over top-5" plan — the spike itself flags this as the first thing to re-measure once real dictation exists; the service should keep threshold/second-scorer logic swappable via env config exactly as specified, not hardcoded.
- **Read-only catalogue mount correctness**: docker-compose mounts `../../data:/data:ro`; the service should open sqlite with `mode=ro` at the connection-string level (as `scripts/build_bodegas_sqlite.py`'s `--check` path already does), not rely solely on the filesystem mount, so a stray write attempt fails fast and explicitly rather than depending on host mount semantics.

## Ready for Proposal

Yes. The architecture, thresholds, contract, and stack are all already decided and documented (spikes 02/03/04/06) — nothing here reopens those. What sdd-propose/sdd-design must additionally settle, because it is genuinely unresolved: (1) dependency-group placement fix (rapidfuzz/unidecode → main deps) alongside adding fastapi/uvicorn/pydantic-settings/pytest/pytest-asyncio/httpx; (2) the `unidecode`-vs-`unicodedata` discrepancy; (3) reconciling `openspec/config.yaml`/`project.md` staleness (strict_tdd, stack description) with the now-real Python/uv/pytest reality; (4) the concrete shape of the new decision layer (status gate + second-scorer ambiguity + unit synonym/display maps) as TDD work with no existing test scaffold to inherit; (5) how `run_eval.py`'s DoD line ("runs against the service") gets satisfied concretely.
