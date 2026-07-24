# Tasks: Convert `bodegas-y-stock.xlsx` to SQLite

All threat-matrix rows in design §15 are N/A; no RED-test tasks or test framework are required. Each task is one reviewable work-unit commit and must leave the checkout coherent.

## Phase 1: Foundation

- [x] **T1 — Establish uv tooling.** Add `pyproject.toml`, generated `uv.lock`, and `Makefile` with a placeholder `build-sqlite` target; delete none. Satisfies REQ-BLD-4/5; design §2, §11, §12. **Verify:** `uv sync` succeeds and `test -s uv.lock`. **Rollback:** `git rm pyproject.toml uv.lock Makefile`.

## Phase 2: Parsing and database

- [ ] **T2 — Add configured xlsx loader.** Add `scripts/build_bodegas_sqlite.py` with constants, `SHEET_CONFIG`, `compute_sha256`, `snake_case`, text/type coercion, `load_xlsx`, PII-safe parsing, and `--dry-run`; add/modify/delete: script only. Satisfies REQ-DB-5/6/8/9 and REQ-BLD-3/6/8/10; design §3, §5, §6, §8, §10. **Verify:** remove any output DB, run `uv run python scripts/build_bodegas_sqlite.py --dry-run`, confirm 9 sheet counts and `Σ=1461`, with no DB created. **Rollback:** `git rm scripts/build_bodegas_sqlite.py`.

- [ ] **T3 — Write the SQLite artefact.** Modify `scripts/build_bodegas_sqlite.py` with `build_database`/`main`, typed table DDL, sorted table/index creation, `_meta`, idempotent replacement, drift warning, and exit handling; add generated `data/bodegas-y-stock.sqlite`; delete none. Satisfies REQ-DB-1/2/3/4/10 and REQ-BLD-1/2/9; design §4, §7, §9, §10. **Verify:** full build succeeds; `sqlite3 data/bodegas-y-stock.sqlite ".tables"` shows 10 tables, `_meta` count is 1, table counts sum to 1,461, and union `sd < 0` count is 79. **Rollback:** `git checkout <T2-commit> -- scripts/build_bodegas_sqlite.py; git rm data/bodegas-y-stock.sqlite`.

## Phase 3: CLI integration

- [ ] **T4 — Implement `--check`.** Modify `scripts/build_bodegas_sqlite.py` with `run_check` and mutually exclusive CLI wiring; modify `Makefile` with `check-sqlite`; delete none. Satisfies REQ-BLD-6/7/9; design §3.7, §5, §10, §11. **Verify:** fresh `make check-sqlite` exits 0; alter/revert the xlsx and confirm exit 1; delete the DB (or its `_meta` row) and confirm exit 2 per the `--check` exit-code matrix (0 fresh / 1 drift / 2 no-meta) — the spec and design do NOT define an exit 3 case for `--check`; rebuild. **Rollback:** `git checkout <T3-commit> -- scripts/build_bodegas_sqlite.py Makefile`.

## Phase 4: Documentation and release audit

- [ ] **T5 — Document and polish the single-PR deliverable.** Add `data/README.md` with regeneration, schema, duplicate-row/PII notes, and sample queries; modify `Makefile` with final `build-sqlite`, `check-sqlite`, `clean-sqlite`; modify `docs/sources/README.md` by exactly two lines; delete none. Satisfies REQ-BLD-1/4/5 and REQ-DB-1/3; design §2, §11, §13, §14. **Verify:** `make clean-sqlite && make build-sqlite && make check-sqlite`; audit implementation paths with `git grep -nE 'requirements\.txt|xlrd|xlsx2csv|wb\.properties|core_properties' -- scripts pyproject.toml Makefile` (no matches), and inspect `uv.lock`/deps. **Rollback:** `git rm data/README.md; git checkout <T4-commit> -- Makefile docs/sources/README.md`.

## Review Workload Forecast

Estimated authored diff: ~380 lines (excluding generated `uv.lock`/SQLite bytes); well under the 800-line review budget. The 400-line risk is Low because there are five bounded work units, no test framework, migration, or broad application wiring.

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low
Delivery strategy: single-pr
Suggested split: one PR containing T1 → T2 → T3 → T4 → T5; retain the five commits for review and rollback.
