# Tasks: Add STT Audio Benchmark

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 1,200–1,800 |
| 400-line budget risk | High |
| Project budget | 5,000 lines |
| Chained PRs recommended | No; authorized |
| Suggested split | Single PR, work-unit commits |
| Delivery strategy | exception-ok (single-pr-default) |
| Chain strategy | size-exception |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Likely PR | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|---|
| 1 | Benchmark extension | PR 1 | `uv run --project services/stt pytest benchmarks/tests -q` | uv `benchmarks/run.py --dry-run --corpus <fixture>` | Benchmark, docs, ignores, STT dev dependency |

## Phase 1: Loader Foundation

- [x] 1.1 **RED** Create `benchmarks/tests/test_corpus_loader.py`: XLSX/CSV discovery, 38→40 growth, canonical/composite IDs, opaque metadata, unknown condition, schema, duplicate/missing/multi-match/unlabeled/unsafe-ID/unsupported-MIME failures. Evidence: unit command fails; dependency: none.
- [x] 1.2 **GREEN** Create `benchmarks/corpus_loader.py`: `CorpusClip`, adapters, sorted validation, NFC/integral IDs, MIME table, compatible `load_corpus`. Evidence: 1.1 passes; dependency: 1.1.
- [x] 1.3 **RED** Add `openpyxl` availability/lock regression to `test_corpus_loader.py`. Evidence: fails; dependency: 1.1.
- [x] 1.4 **GREEN** Run `uv add --project services/stt --dev openpyxl`; update `services/stt/pyproject.toml` and `services/stt/uv.lock`. Evidence: 1.3 passes; dependency: 1.3.

## Phase 2: Runner and Privacy

- [x] 2.1 **RED** Extend `benchmarks/tests/test_run.py`: flag>env>default, dry-run, validation short-circuit, every content class scored, multipart MIME, ordered one-result-per-clip, transport/non-200 retention, no transcript at INFO. Evidence: integration fails; dependency: 1.2.
- [x] 2.2 **RED** Create `benchmarks/tests/test_report.py` threat tests: absolute/relative ignored paths use shell-free `git -C <repo> check-ignore`; unignored/Git failure aborts before network/write. Evidence: fails; dependency: none.
- [x] 2.3 **GREEN** Create `benchmarks/artifacts.py`; modify `benchmarks/run.py` for ignore checks, atomic writes, precedence, all-content MIME POSTs, concurrency 4, v2 metadata/fingerprint. Evidence: 2.1–2.2 pass; dependencies: 2.1–2.2.

## Phase 3: Scoring and Reports

- [x] 3.1 **RED** Extend `benchmarks/tests/test_metrics.py`: `stt-es-v1`, full-content WER, explicit garbage hallucination, ACERTIVIDAD neutrality, unknown condition, legacy digit/WER/hallucination regressions. Evidence: unit fails; dependency: 1.2.
- [x] 3.2 **GREEN** Modify `benchmarks/metrics.py` while retaining aggregates. Evidence: 3.1 passes; dependency: 3.1.
- [x] 3.3 **RED** Extend `test_report.py`: fixed matrix columns/order, all failures retained, expected/empty-actual/error, byte-identical matrix/aggregate regeneration from stored JSON. Evidence: integration fails; dependency: 3.2.
- [x] 3.4 **GREEN** Modify `benchmarks/report.py` to regenerate matrix and aggregate solely from v2 results through atomic artifacts. Evidence: 3.3 passes; dependency: 3.3.

## Phase 4: Privacy, Docs, Acceptance

- [x] 4.1 **RED** Assert ignores for `BD_Pruebas/`, audio/workbooks, results, matrix, summary in `test_report.py`. Evidence: fails; dependency: 2.3.
- [x] 4.2 **GREEN** Update `.gitignore` and `benchmarks/.gitignore`; keep private inputs/outputs untracked. Evidence: ignore tests pass; dependency: 4.1.
- [x] 4.3 Update `benchmarks/README.md` and `benchmarks/corpus/README.md`: Python+uv workflow, layouts, metadata/normalizer, privacy, regeneration, no relevance inference. Evidence: documented dry-run/report execute; dependencies: 3.4, 4.2.
- [x] 4.4 **RED→GREEN optional** Create env-gated `benchmarks/tests/test_acceptance_private.py`; skip without `BENCHMARK_ACCEPTANCE_CORPUS`, otherwise assert 38 clips without mutation/commit. Evidence: acceptance passes/skips; dependencies: 1.4, 4.2.
- [x] 4.5 Run focused and full benchmark tests plus CSV regressions; record RED/GREEN outputs and verify `git status` excludes private/generated files. Dependency: all tasks.
