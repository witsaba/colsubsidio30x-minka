```yaml
schema: gentle-ai.verify-result/v1
evidence_revision: sha256:65d1a4793eca04d38b9c44579510921be4c1f6fd477a2be25bb781db5491ffb4
verdict: pass
blockers: 0
critical_findings: 0
requirements: 14/14
scenarios: 26/26
test_command: uv run pytest
test_exit_code: 0
test_output_hash: sha256:911645c0520e42d44bd06b3072d6a4a9a10d4eeea6c2a15ac3b904b95dce5b5e
build_command: uv sync --frozen --no-dev --package matcher --dry-run
build_exit_code: 0
build_output_hash: sha256:e8884deb42a347d7e245783fd748f18888777a006a2b7232b592c51b51f119ba
```

## Verification Report

**Change**: `add-matching-service`
**Version**: spec rev 4 (rev 2 MATCH_TSR_MARGIN amendment; rev 3 W1 raw-ranking amendment; rev 4 Judgment Day hardening — see Addendum rev 2 below for the 14/14 re-verification)
**Mode**: Strict TDD
**Worktree**: `colsubsidio30x-minka-worktrees/add-matching-service`, branch `feat/add-matching-service` (uncommitted, unmodified by this phase)
**Verified**: 2026-07-24

> Independent re-execution. Every number below was re-measured in this phase; none was copied from `apply-progress`.

### Completeness

| Metric | Value |
|--------|-------|
| Tasks total | 12 |
| Tasks complete | 12 |
| Tasks incomplete | 0 |
| Requirements | 12 (REQ-ENG-1..6, REQ-API-1..6) |
| Scenarios | 18 |

All twelve `tasks.md` checkboxes are `[x]` and each maps to code that exists in the worktree.

### Build & Tests Execution

**Build** (frozen-lock integrity gate, the exact resolution the image performs): PASSED

```text
$ uv sync --frozen --no-dev --package matcher --dry-run
Would use project environment at: .venv
Would uninstall 15 packages
exit 0
```

**Tests**: 232 passed / 0 failed / 0 skipped / 1 warning

```text
$ uv run pytest
======================== 232 passed, 1 warning in 2.66s ========================
exit 0
```

The single warning is an upstream `StarletteDeprecationWarning` from `fastapi.testclient` — test-only, not project code.

Every focused command in `tasks.md` was re-run independently:

| Task | Command | Result |
|---|---|---|
| T1 | `uv run pytest services/matcher/tests/unit` | 176 passed |
| T2 | `uv run pytest .../test_normalize.py` | 32 passed |
| T3 | `uv run pytest .../test_scoring.py` | 15 passed |
| T4 | `uv run pytest .../test_units.py` | 26 passed |
| T5 | `uv run pytest .../test_config.py` | 21 passed |
| T6 | `uv run pytest .../test_decision.py` | 39 passed |
| T7 | `uv run pytest .../test_service.py` | 25 passed |
| T8 | `uv run pytest services/matcher/tests/api` | 41 passed |
| T9 | `uv run pytest services/matcher/tests/eval` | 15 passed |
| T10 | `uv run pytest .../test_container.py` | 15 passed |
| T9 | `sha256sum` eval copy vs spike | identical `5a05cb27…d243bf` |
| T12 | `git grep -n unidecode -- pyproject.toml` | no match (clean) |
| T11 | grep `test_command: null` / `Not selected` | no match (clean) |
| T10 | `docker compose config` | exit 0, valid |
| T10 | `docker compose up -d` | **BLOCKED** — socket permission denied |

**Coverage**: not available — no `pytest-cov`/`coverage` in the dev group. Not a failure.

### Runtime Evidence Obtained In This Phase

Beyond the test suite, the service was exercised over a **real HTTP socket** using the exact command the container's `CMD` runs:

```text
$ uv run uvicorn matcher.main:app --host 127.0.0.1 --port 8002
GET  /health      -> HTTP 200  {"status":"ok","catalogues":8,"rows":1405}
GET  /catalogues  -> HTTP 200  8 entries, ids == STOCK_TABLES, all counts > 0
POST /match "achiote molido"  -> matched   top_score 1.0, 5 candidates, uuid4 request_id
POST /match "aceite de oliva" -> ambiguous top_score 1.0 (crowded token_set_ratio)
POST /match "zzzzqqq xkcd"    -> no_match  top_score 0.0476
POST /match catalogue_id="not_a_table" -> HTTP 404 (no "status" key in body)
POST /match spoken_name="   "          -> HTTP 422
```

This upgrades REQ-API-1/2/3 from TestClient-only to real-socket evidence, and narrows REQ-API-6's gap to image build + compose orchestration + healthcheck loop only.

### Spec Compliance Matrix

| Requirement | Scenario | Test / Evidence | Result |
|---|---|---|---|
| REQ-ENG-1 | Each rule testable in isolation | `test_normalize.py` (32 tests, 6 rules) + `test_packaging.py::test_unidecode_is_absent...` | ⚠️ PARTIAL |
| REQ-ENG-2 | Ranked candidates with margin | `test_scoring.py` (15) + live `POST /match` | ✅ COMPLIANT |
| REQ-ENG-3 | Clear winner is matched | `test_decision.py::test_clear_winner_is_matched` (0.87/0.21) | ✅ COMPLIANT |
| REQ-ENG-3 | Crowded field is ambiguous | `test_wide_margin_but_crowded_tsr_is_ambiguous` | ✅ COMPLIANT |
| REQ-ENG-3 | Uncrowded stays matched | `test_uncrowded_tsr_stays_matched`, `test_crowding_uses_its_own_threshold` | ✅ COMPLIANT |
| REQ-ENG-3 | Low score is no_match | `test_low_top_score_is_no_match`, `test_no_match_asserts_no_sku` | ✅ COMPLIANT |
| REQ-ENG-4 | Threshold change flips decision | `test_raising_accept_score_flips_matched_to_no_match` (0.55 → 0.60) | ✅ COMPLIANT |
| REQ-ENG-5 | Unit re-ranks but never excludes | `test_rerank_never_removes_a_candidate`, `test_http.py::test_known_unit_does_not_remove_candidates` | ✅ COMPLIANT |
| REQ-ENG-5 | NULL unit survives | `test_null_unidad_surfaces_as_none_not_unidad` + live wire `"nr_articulo":null` | ✅ COMPLIANT |
| REQ-ENG-6 | Regression gate | `test_eval_accuracy.py` — top1 0.9860 ≥ 0.986, recall@3 1.0000, split reported | ✅ COMPLIANT |
| REQ-API-1 | Matched response shape | `TestMatchResponseShape` (14) + live curl | ✅ COMPLIANT |
| REQ-API-1 | All three statuses over HTTP | `TestAllThreeStatusesReachable` (6) + live curl | ✅ COMPLIANT |
| REQ-API-1 | Unknown catalogue is 4xx | `TestClientErrors` (7) + live curl HTTP 404 | ✅ COMPLIANT |
| REQ-API-2 | Catalogue listing | `TestCatalogues` (6) + live curl (8 / 1405 rows) | ✅ COMPLIANT |
| REQ-API-3 | Health after startup | `TestHealth` (5) + live curl HTTP 200 | ✅ COMPLIANT |
| REQ-API-4 | Invalid config fails fast | `TestStartupFailsFast` (3) + `test_config.py` (21) | ✅ COMPLIANT |
| REQ-API-5 | `mode=ro` enforced | `test_write_is_rejected`, `test_ddl_is_rejected`, `test_missing_file_is_not_created` | ✅ COMPLIANT |
| REQ-API-6 | Compose brings up healthy service | 15 contract tests + `docker compose config` OK; **container never run** | ⚠️ PARTIAL |

**Compliance summary**: 16/18 scenarios COMPLIANT, 2 PARTIAL, 0 UNTESTED, 0 FAILING.

### Per-Requirement Verdict

| Requirement | Verdict | Basis |
|---|---|---|
| REQ-ENG-1 Spanish normalization pipeline | **PARTIAL** | All 6 rules exist as tested pure functions and `unidecode` is provably absent, but the composite scenario fails 2 of 3 THEN clauses (see W1/W5) |
| REQ-ENG-2 Trigram ranking | **PARTIAL** | Scorer is pg_trgm-faithful, all three prohibitions hold, scenario passes — but ranking runs over **raw** names, not normalized ones (see W1) |
| REQ-ENG-3 Three-way decision layer | **PASS** | 39 tests; crowding is an independent threshold over top-5; both comparisons strict `<` |
| REQ-ENG-4 Env-configurable thresholds | **PASS** | 21 config tests; exact-default and env-override coverage; bounded fields fail fast |
| REQ-ENG-5 Unit maps and unit re-rank | **PASS** | Two separate maps; re-rank never removes or gates; NULL `unidad` never coerced |
| REQ-ENG-6 Eval reproduces spike accuracy | **PASS** | Re-measured: top1 0.9860, recall@3 1.0000, cohorts reported and pinned |
| REQ-API-1 POST /match contract | **PASS** | All 3 scenarios green in TestClient *and* over a real socket |
| REQ-API-2 GET /catalogues | **PASS** | 8 ids == `STOCK_TABLES`, 1405 rows, all positive |
| REQ-API-3 GET /health | **PASS** | HTTP 200 live; suitable for the compose probe |
| REQ-API-4 pydantic-settings, fail fast | **PASS** | Startup aborts on bad env and on missing DB; no service left behind |
| REQ-API-5 Read-only in-memory catalogue | **PASS** | `mode=ro` URI; DML and DDL both rejected; serves after the file is deleted |
| REQ-API-6 Container on port 8002 | **PARTIAL** | Artefact contract fully verified statically and `compose config` validates; the container was never built or run (see W2) |

**9 PASS / 3 PARTIAL / 0 FAIL.**

### Correctness (Static Evidence)

| Requirement clause | Status | Notes |
|---|---|---|
| `unidecode` MUST NOT be a dependency | ✅ | Absent from `pyproject.toml`, `services/matcher/pyproject.toml`, `uv.lock` (0 occurrences), and all source; `find_spec("unidecode") is None` asserted |
| Accent stripping uses stdlib `unicodedata` | ✅ | `strip_accents` verified by source inspection in-test |
| MUST NOT use `WRatio` | ✅ | Only a docstring mention explaining non-promotion; no call site |
| MUST NOT use `sd` as a matching prior | ✅ | `rank()` reads only `.articulo`; `test_rank_ignores_stock_level_as_a_matching_prior` proves a `sd=9999` row loses to a `sd=0` exact match |
| MUST NOT use two-stage retrieval | ✅ | Single linear pass in `rank()`; no FTS5/bm25 code |
| `MATCH_TSR_MARGIN` independent of `MATCH_AMBIGUITY_MARGIN` | ✅ | Separate `Settings` field asserted non-identical; `match_tsr_margin=0.0` flips crowding off without touching the trigram margin |
| Acceptance gate applies to raw similarity | ✅ | Status computed before `_unit_rerank`; `test_status_uses_raw_pre_rerank_scores` |
| Ranking runs over **normalized** names | ❌ | `rank()` scores raw `articulo`; the REQ-ENG-1 pipeline has no production caller |

### Coherence (Design)

| Decision | Followed? | Notes |
|---|---|---|
| D1 uv workspace + hatchling member | ✅ Yes | Root is `package = false` workspace root; `matcher` is a workspace source |
| D2 promote `normalize`/`scoring`/`catalogue` | ⚠️ Partial | Promoted verbatim, but `normalize` arrived unwired; `catalogue.py` gained `open_readonly()` + `CatalogueUnavailableError` beyond D2's "two edits" (additive, pre-disclosed, required by REQ-API-4/5) |
| D3 pure `decide()` + band-limited re-rank | ✅ Yes | Frozen dataclasses, no I/O, band = `top_score − MATCH_AMBIGUITY_MARGIN` |
| D4 byte-copy eval set + hash guard | ✅ Yes | sha256 identical to the spike file; `run_eval.py` untouched |
| D5 compose build context at repo root | ✅ Yes | `context: ../..`, `dockerfile: services/matcher/Dockerfile` — confirmed by `docker compose config` |

### TDD Compliance

| Check | Result | Details |
|---|---|---|
| TDD Evidence reported | ✅ | Full cycle table present in `apply-progress` |
| All tasks have tests | ✅ | 10/10 code tasks; T11/T12 are docs/config with no runtime behavior (correctly `N/A`) |
| RED confirmed (test files exist) | ✅ | 10/10 test files present and executable |
| GREEN confirmed (tests pass now) | ✅ | 10/10 re-run individually; per-task counts match the reported numbers exactly |
| Triangulation adequate | ✅ | Every task multi-case (3–41); no single-case task |
| Safety Net for modified files | ✅ | T8/T9/T10 record prior-suite green (161/202/217); T1–T7 are genuinely new files (all untracked, absent from `main`) |

**TDD Compliance: 6/6 checks passed.** Reported RED failure modes are plausible and specific (`ModuleNotFoundError: matcher.<mod>`, `Failed to spawn: pytest`, `15 errors` on missing artefacts), and every reported GREEN count reproduces exactly.

### Test Layer Distribution

| Layer | Tests | Files | Tools |
|---|---|---|---|
| Unit | 176 | 8 | pytest |
| HTTP / API | 41 | 1 | pytest + `fastapi.testclient` |
| Eval / acceptance | 15 | 1 | pytest over the real catalogue |
| **Total** | **232** | **10** | |

Real SQLite and the real 1,405-row catalogue are used throughout; **zero mocks in the entire suite**.

### Changed File Coverage

Coverage analysis skipped — no coverage tool detected (`pytest-cov`/`coverage` absent from the dev group).

### Assertion Quality

No tautologies, no assertion-free production paths, no mock-heavy tests, no smoke-only tests.

| File | Line | Assertion | Issue | Severity |
|---|---|---|---|---|
| `tests/eval/test_eval_accuracy.py` | 196 | `test_report_is_emitted` | No `assert` — reporting side effect only (satisfies REQ-ENG-6's "report" clause) | SUGGESTION |
| `tests/unit/test_decision.py` | 226 | `pytest.raises(Exception)` | Over-broad; prefer `dataclasses.FrozenInstanceError` | SUGGESTION |
| `tests/api/test_http.py` | 175, 183 | `all(...)` / `for` over `entries` | Vacuous if `entries` were empty — but companion `test_lists_the_eight_stock_tables` pins `len == 8` | SUGGESTION |
| `tests/unit/test_units.py` | 41 | `resolve_unit(spoken) in CANONICAL_UNITS` | Set-membership rather than exact value — companion exact test exists | SUGGESTION |

**Assertion quality**: 0 CRITICAL, 0 WARNING, 4 SUGGESTION. Test quality is high: the pg_trgm assertions use the PostgreSQL documentation's own worked examples as an external oracle rather than snapshots of the implementation's output.

### Quality Metrics

**Linter**: ➖ Not available (no ruff/flake8/black)
**Type checker**: ➖ Not available (no mypy/pyright)

### Scope Check

Nothing outside the change scope was touched.

```text
$ git diff --stat main
 pyproject.toml                       |  15 +-
 spikes/06-stack-module-3-matching.md |   2 +-
 uv.lock                              | 411 ++++++++++++++++++++++++++++++++++-
 3 files changed, 417 insertions(+), 11 deletions(-)
```

Untracked additions are confined to `services/matcher/**` and the two `openspec/` files T11 creates. The `spikes/` edit is exactly the single T12 stack-row correction. No unrelated file was modified. This phase modified nothing in the worktree (re-confirmed after all commands ran).

### Issues Found

**CRITICAL**: None.

**WARNING**:

- **W1 — The REQ-ENG-1 normalization pipeline is promoted but never wired into the ranking path.** `normalize_for_match`, `strip_packaging`, `flip_gender`, `pluralize_es`, and `expand_abbrev` have **zero callers in production code**. `TrigramSimilarityMatcher.rank()` scores the raw `articulo` against the raw query; only pg_trgm's internal lower-casing and word-splitting apply. Consequences, all measured in this phase:
  - REQ-ENG-1's only scenario fails 2 of its 3 THEN clauses: `normalize_for_match("TABLA P/PICAR BLANCA X 300 GR")` → `"TABLA P PICAR BLANCA"` — packaging removed, but gender **not** folded and the abbreviation **not** expanded.
  - REQ-ENG-2's "over normalized names" clause is not met.
  - 411 of 1,405 catalogue rows (29.25%) carry packaging tokens that are never stripped; 59 rows (4.20%) carry accents that the trigram path never strips (`trgm_similarity("azucar morena", "AZÚCAR MORENA")` = 0.647 vs 1.0 unaccented).
  - **This costs at least one of the six top-1 misses.** For eval case `"cola cola"`: as shipped, gold `COCA COLA 400 CC` scores 0.3750 and loses to `COLA Y POLA` at 0.4545. With packaging stripping wired in, gold scores 0.6667 and wins.
  - Mitigating: accents cause **no** measured miss — the accented-gold cohort is 8/8 top-1 — and REQ-ENG-6's numeric gate is met without the pipeline. The eval set contains 0 accented queries, so the accented-query path is structurally untested.
  - This requires an explicit decision: either wire the pipeline into ranking (and re-measure), or amend REQ-ENG-1/REQ-ENG-2 to describe what actually ships. It should not be archived silently either way.

- **W2 — REQ-API-6 container runtime is unproven** (pre-disclosed, environment limitation, not a code defect). `docker compose up -d` → `permission denied ... unix:///var/run/docker.sock`; the invoking user's groups are `braejan adm sudo lpadmin`, with no `docker`. Static evidence is complete (15 contract tests, `docker compose config` exit 0 confirming port 8002, `read_only: true` on the `/data` bind, all five `MATCH_*` pins, `/health` probe with `retries: 3`, `restart: unless-stopped`) and the exact container entrypoint was proven live on 8002 in this phase. Unproven: image build, compose orchestration, and the healthcheck transition to `healthy`.

- **W3 — The T3 audit command in `tasks.md` is vacuous and yields a false "clean".** `git grep -n "WRatio\|word_similarity\|\bsd\b" -- services/matcher/src` returns nothing because every file under `services/matcher/src` is **untracked** — `git grep` searches the index. Re-run as a filesystem grep, the real result is: `WRatio` clean (docstring only), `sd` clean (never a prior), but `trgm_word_similarity` **does exist** in `normalize.py:63`. Anyone re-running the documented command gets a misleading pass. Use `grep -rn` until the files are committed.

- **W4 — Dead code ships in the container image.** `trgm_word_similarity` (a self-described non-bit-exact approximation of pg_trgm `word_similarity`) plus the five unwired normalization helpers have no callers. `trgm_word_similarity` in particular is a research artefact carrying its own accuracy caveat; it is reachable by import from the shipped package.

- **W5 — The spec text itself still records the wrong normalization behavior.** REQ-ENG-1 states gender folding is `blanca` → `BLANCO` and abbreviation expansion is `P/PICAR` → `para picar`. Measured behavior is the opposite direction (`BLANCO` → `blanca`, lower-cased) and `P/PICAR` → `PARAPICAR` (no space). The apply phase corrected `tasks.md` for this but the **spec** was never corrected, so the authoritative requirement still asserts behavior no code produces.

- **W6 — The repository has no `.gitignore`, and 21 untracked `__pycache__/*.pyc` files sit in the worktree.** `git check-ignore` confirms they are not ignored, so a `git add -A` before commit would stage 21 compiled binaries. (`.venv/` and `.pytest_cache/` are safe only because uv and pytest write self-ignoring `.gitignore` files inside them.) Stage explicitly, or add a `.gitignore`, before the commit step.

**SUGGESTION**:

- The Dockerfile pins Python dependencies with `--frozen` but pulls the uv binary from `ghcr.io/astral-sh/uv:latest` — an unpinned tag undercuts the reproducibility the frozen lock provides. Pin a uv version.
- `apply-progress` states the re-rank band "structurally holds < 2 candidates" for `matched`. Not exact: when `margin == MATCH_AMBIGUITY_MARGIN` exactly, a `matched` result can have a 2-candidate band and be reordered. Harmless — nothing is removed, so the "never a gate" guarantee holds — but the stated invariant is imprecise.
- REQ-ENG-6 says "eval over the 624-case `eval_set.json`". Accuracy is computed over the 430 `variant` cases inside that 624-case file (the remainder are 184 garbage + 10 ambiguous, scored separately). This matches `run_eval.py`, but the spec phrasing invites misreading.
- Consider adding `pytest-cov` and a linter/type-checker to the dev group; changed-file coverage and type errors could not be measured at all.
- Four minor assertion-strength items listed in the Assertion Quality table.

### Verdict

**PASS WITH WARNINGS**

The suite is genuinely green (232/232, exit 0, independently re-run), Strict TDD was followed with credible RED evidence for all ten code tasks, all twelve tasks match code state, scope is clean, and 16 of 18 spec scenarios are backed by passing tests plus real runtime evidence. Nothing here blocks archive on quality grounds. Two requirements are PARTIAL for substantive reasons that must be decided explicitly rather than absorbed: the normalization pipeline ships unwired (W1/W5 — a spec-versus-code divergence with a measured, reproducible cost of at least one eval case), and the container was never run (W2 — an environment limitation, with the entrypoint itself now proven live on 8002).

### Follow-ups

1. **Decide W1 explicitly** — wire `normalize_for_match` into `rank()` and re-measure the eval, or amend REQ-ENG-1/REQ-ENG-2 to match shipped behavior. Do not archive without a recorded decision.
2. **Correct the spec text (W5)** — REQ-ENG-1's gender-folding and abbreviation-expansion examples are backwards relative to measured behavior.
3. **Close REQ-API-6 (W2)** — `sudo usermod -aG docker $USER`, re-login, then `docker compose up -d && docker compose ps` (expect `healthy`) and the T10 `POST /match` curl. Everything else for this requirement is already proven.
4. **Fix the T3 audit command (W3)** in `tasks.md` — use `grep -rn`, or re-run `git grep` only after the files are tracked.
5. **Remove or justify the dead code (W4)** — especially `trgm_word_similarity`, which carries an explicit accuracy caveat and ships in the image.
6. **Add a `.gitignore` (W6)** before committing, or stage paths explicitly — 21 `.pyc` files would otherwise land in the commit.
7. Pin the uv image tag in the Dockerfile.

---

## W1 Resolution — A/B Measurement (follow-up, same phase)

W1 asked for a decision. It has been measured rather than argued. Script:
`scratchpad/ab_normalize.py` (read-only; nothing in the worktree was modified).

**Harness validation**: config A reproduces all five pinned baselines exactly
(424/430, 340/345, 84/85, 1/184, 10/10) and the unit-re-rank replication matches
`decide()`'s ordering on all 624 cases in both configs (0 mismatches). The numbers
below are therefore trustworthy.

| Metric | A — raw ranking (as shipped) | B — normalized ranking |
|---|---|---|
| overall top-1 | **0.9860** (424/430) | 0.9837 (423/430) |
| overall recall@3 | 1.0000 | 1.0000 |
| has_code top-1 | **0.9855** (340/345) | 0.9797 (338/345) |
| no_code top-1 | 0.9882 (84/85) | **1.0000** (85/85) |
| garbage false-confidence | 0.0054 (1/184) | 0.0054 (1/184) |
| ambiguous flag_recall | 1.0000 (10/10) | 1.0000 (10/10) |

**Outcome changes A→B**: 43 of 624 cases, all `variant`. 1 top-1 win, 2 top-1
losses, 40 status-only changes.

- **Win (1)**: `"cola cola"` → gold `COCA COLA 400 CC`. A: `no_match`, top-1 miss.
  B: `ambiguous`, top-1 hit. This is the case predicted in W1.
- **Losses (2)**: both `VASO 7 OZ POLIBOARD PAQ*50 UN`. Normalization collapses it
  and `VASO 12OZ POLIBOARD PAQ*50 UN` onto the **identical** string
  `VASO POLIBOARD PAQ`. Top-1 becomes an arbitrary catalogue-order tiebreak.
  **50 rows across 7 tables collide this way.**
- **Auto-accept effect**: 27 cases promoted to `matched`, **all 27 with a correct
  top-1 and zero new confident errors**; 8 correct auto-accepts lost. Net **+19
  correct auto-accepts** (+4.4 pp of the variant population).

**Confound, and it matters**: `spikes/matching/gen_eval_set.py` generates the 430
variant queries by applying `strip_packaging`, `flip_gender`, `pluralize_es`,
`expand_abbrev`, and `strip_accents` to the catalogue text. B shares that code, so
this eval structurally **favours B** — and B still lost on top-1. A's advantage is
more robust than the one-case margin suggests, and B's +19 auto-accept lift is
likely overstated on real dictation.

**Spike provenance**: the spike's measured 98.6% configuration ranked **raw** text —
`TrigramSimilarityMatcher.rank()` scored `trgm_similarity(case["query"], r.articulo)`
with no normalization; the only spike matcher that called `normalize_for_match` was
"Hybrid normaliser + Jaccard", which scored **85.8%** (second-worst of seven).

### Recommendation: KEEP A, amend the spec

B costs a top-1 case, permanently destroys product identity for 50 rows (size and
pack-count tokens are exactly what distinguishes SKUs in an inventory system), and
would force **weakening REQ-ENG-6's own acceptance gate** from 98.6% to ≤98.37%.
Its one real benefit — 19 net correct auto-accepts — is obtainable without the
identity loss and should be pursued separately as a measured change (e.g. score
`max(raw, normalized)`, or re-tune `MATCH_ACCEPT_SCORE`), not by replacing the
ranking input.

Spec lines to amend (`specs/product-matching-engine/spec.md`):

1. **Line 11** — `gender folding (blanca → BLANCO)` → measured behaviour is
   `BLANCO → blanca` (lower-cased); `abbreviation expansion (P/PICAR → para picar)`
   → measured behaviour is `P/PICAR → PARAPICAR` (no space). Also reword
   "The engine SHALL normalize names", which implies a ranking-time transform.
2. **Lines 13–18** — the scenario's THEN clause ("packaging tokens are removed,
   gender is folded, and the abbreviation is expanded") describes a composite
   pipeline that does not exist. `normalize_for_match` applies accent-strip →
   upper → packaging-strip → punctuation collapse only. Reframe to the measured
   composite plus the per-rule testability guarantee.
3. **Line 22** — "over **normalized names**" → "over raw catalogue `articulo` text,
   relying on pg_trgm's internal lower-casing and word-splitting", matching the
   spike's measured 98.6% configuration.

With A retained, W4 sharpens: `normalize_for_match`, `strip_packaging`,
`flip_gender`, `pluralize_es`, `expand_abbrev`, and `trgm_word_similarity` have no
production role at all (their spike role was eval-variant generation in a research
file that was not promoted). Either drop them from the shipped package or document
them as reserved. `strip_accents`, `trigrams`, and `trgm_similarity` stay — they are
live.

**Had B been chosen**, these floors would need re-pinning in
`tests/eval/test_eval_accuracy.py`: `TOP1_FLOOR` 0.986 → ≤0.9837 (**fails as
written**), `HAS_CODE_TOP1_BASELINE` 340/345 → 338/345 (down),
`NO_CODE_TOP1_BASELINE` 84/85 → 85/85 (up). `COHORT_RECALL3_BASELINE` and
`FALSE_CONFIDENCE_CEILING` would be unchanged. REQ-ENG-6's "98.6% top-1" text would
also require amendment — which is the strongest argument against B.

---

## Addendum — rev 2 (2026-07-25): post-Judgment-Day verification of spec rev 4

Spec rev 4 added two requirements (`REQ-API-7`, `REQ-API-8`) and amended `REQ-ENG-2`,
`REQ-API-1/4/5/6` after the Judgment Day hardening round (commits `7bcacfd..7fb58f6`,
ledger: `judgment-day-ledger.md`). This addendum extends verification coverage from
12 to 14 requirements. Verdict: **PASS** on all 14.

| Requirement | Verdict | Evidence |
| --- | --- | --- |
| REQ-API-7 startup retry on transient catalogue unavailability | PASS | `tests/api/test_startup_retry.py` (retry-then-recover, wait timing, warning/error logs, exhaustion → exit 3 via real subprocess, `STARTUP_RETRIES=0` opt-out, misconfig never retried); live drill: 3 warned attempts → `ERROR … aborted after 4 attempts` → exit code 3; Docker `restart: unless-stopped` verified via `docker inspect` |
| REQ-API-8 observability with log privacy | PASS | `tests/api/test_logging.py` (startup summary, per-decision line with request_id/status/score/latency, 404 warning, `TestNoTranscriptEverReachesTheLog` at all levels); live container logs matched all three line shapes with 0 occurrences of spoken text (Ley 1581) |
| REQ-API-1 (amended: field length bounds 300/100/50) | PASS | `tests/unit/test_schemas.py`, `tests/api/test_http.py` 422 boundary tests; live 5000-char request → 422 `string_too_long` |
| REQ-API-4 (amended: +2 startup knobs) | PASS | `tests/unit/test_config.py` defaults/env-override/negative-rejection |
| REQ-API-5 (amended: fetch-time corruption contract) | PASS | `tests/unit/test_service.py` fake-fetchall + real page-corruption repro → contextual `CatalogueUnavailableError` |
| REQ-API-6 (amended: PYTHONUNBUFFERED, start_period, .dockerignore) | PASS | `tests/unit/test_container.py` artefact assertions; live compose rebuild healthy in ~12s |
| REQ-ENG-2 (amended: bounded trigram cache 4096) | PASS | `tests/unit/test_normalize.py` maxsize + eviction-correctness tests; 20k-unique-query soak: `currsize=4096` stable |

Full suite: **298 passed** (was 232 at rev 1). Eval gate byte-identical
(top-1 0.9860, recall@3 1.0000, n=430). Adversarial coverage: dual blind judges,
scoped re-judgment clean, terminal **APPROVED** (see ledger). Native bounded review
transaction: **absent** — the gentle-ai authority store reported
`corrupted_or_unverifiable_authority` for the committed tree (documented in the
ledger); the Judgment Day transaction is the review of record for the delta.
