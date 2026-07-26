# Proposal: Extend STT audio benchmark with external BD_Pruebas corpus

## Intent

`benchmarks/` (REQ-BMK-1..6) only ingests `labels.csv` + co-located audio. Daniel's `BD_Pruebas/` uses per-contributor `BD_AUDIOS.xlsx` + sibling `NOTAS_VOZ/` with repeated local `ID_UNICO`. Extend the existing capability to ingest that corpus directly, score every clip (voice/song/filler/irrelevante/mixto) against verbatim ground truth, and emit a complete per-audio matrix — adding rows/audios and rerunning the same command requires zero code changes. Audio, workbooks, and transcript-bearing outputs stay outside Git.

## Scope

**In Scope**: pluggable XLSX corpus loader accepting the current `BD_AUDIOS.xlsx` schema (`ID_UNICO`, `TEXTO_AUDIO`, `ACERTIVIDAD`, `DIFICULTAD`, `JSON PRODUCTOS` — no schema migration required); backward-compatible `labels.csv` path; composite ID `<relative-dataset>/<normalized-id>`; strict one-row/one-file mapping; deterministic failure on duplicates, missing audio, multiple extension matches, or unknown media; correct MIME per extension (`.ogg/.webm/.wav/.mp3`); all-content transcription (every clip with audio POSTs to `/transcribe` and is expected-vs-actual compared); acoustic no-speech / hallucination classification driven by an explicit benchmark field/config or existing `labels.csv` `is_garbage` (never inferred from `ACERTIVIDAD`); per-audio matrix CSV + aggregate report retaining digit accuracy, hallucination rate, WER; `BENCHMARK_CORPUS` env / `--corpus` flag.

**Out of Scope**: production STT behaviour, vendor selection, ITN, relevance classification; `JSON PRODUCTOS` / downstream product extraction; migrating raw audio or workbooks into Git; rewriting `BD_AUDIOS.xlsx`; a hard-coded `ACERTIVIDAD` taxonomy; auto-deriving acoustic `condition` from `DIFICULTAD`.

## Bounded assumptions (automatic decisions)

- **ACERTIVIDAD is opaque metadata.** The benchmark MUST NOT maintain a hard-coded allow-list of `ACERTIVIDAD` values (would block future growth without code changes). The loader validates presence/non-empty if appropriate; unknown values are recorded verbatim in the matrix and never used to filter, classify, or alter scoring. Acoustic no-speech / hallucination classification comes from an explicit benchmark field/config or `labels.csv` `is_garbage`, never from `ACERTIVIDAD`.
- **DIFICULTAD preserved as source metadata.** `DIFICULTAD` (`FACIL`/`MEDIO`/`DIFICIL`) is recorded per-row in the matrix. Acoustic `condition` (`clean`/`noisy`/`spontaneous`) is **optional and unknown by default**; when absent the matrix records `condition = unknown`; an explicit optional mapping/config may supply it; never required, never inferred from `DIFICULTAD`.
- **Loader accepts the current workbook schema unchanged.** No new columns are required to score the existing 38 rows.

## Capabilities

### New Capabilities
- `external-audio-corpus`: XLSX + folder loader with composite IDs, correct MIME, strict mapping. Optional config may supply acoustic `condition`; ACERTIVIDAD treated as opaque metadata.

### Modified Capabilities
- `stt-benchmark`: external corpus support, full per-audio matrix, all-content scoring, optional acoustic `condition` (recorded as `unknown` when absent), ACERTIVIDAD preserved as opaque metadata, kept `labels.csv` backward compatibility.

## Approach

Extend `benchmarks/run.py` with `load_corpus(root)` dispatching to `load_xlsx_corpus` or `load_labels_csv`. Normalize numeric `ID_UNICO` without editing sources; build composite keys from dataset's relative path. Derive MIME from suffix (`audio/*` enforced). Add `openpyxl` to `services/stt` dev deps. Extend `benchmarks/metrics.py` with per-clip full-transcript comparison (case/punctuation/whitespace-normalised Levenshtein) alongside the existing digit/hallucination/WER pipeline; hallucination classification is driven by explicit `is_garbage` (or its XLSX equivalent field/config) — never by `ACERTIVIDAD`. Extend `benchmarks/report.py` to emit a per-row matrix CSV (id, dataset, audio, condition, dificultad, acertividad, status, latency_ms, vendor, expected, actual, digit_correct, digit_total, wer, hallucinated) plus the existing aggregate. Strict TDD: failing tests first for workbook discovery, composite IDs, mapping failures, MIME handling, all-row execution, scoring neutrality on `ACERTIVIDAD`, and `condition = unknown` when absent. Privacy tests assert outputs never contain transcripts at INFO and land under the gitignored external root.

## Affected Areas

- `benchmarks/run.py` (modified) — pluggable XLSX loader, composite IDs, MIME, strict mapping; optional `condition` config.
- `benchmarks/metrics.py` (modified) — per-clip full-transcript compare; keep digit/hallucination/WER; explicit `is_garbage` signal.
- `benchmarks/report.py` (modified) — per-audio matrix CSV + aggregate.
- `benchmarks/tests/test_run.py`, `benchmarks/tests/test_metrics.py` (modified) — strict-TDD.
- `benchmarks/README.md`, `benchmarks/corpus/README.md` (modified) — external workflow, schema, repeatable command.
- `benchmark_matrices/`, `benchmarks/.gitignore` (new) — gitignored output location.
- `services/stt/pyproject.toml`, `services/stt/uv.lock` (modified) — `openpyxl` dev dep.
- `openspec/specs/stt-benchmark/spec.md` (modified delta) — external corpus, matrix, optional `condition`, opaque `ACERTIVIDAD` requirements.
- `openspec/specs/external-audio-corpus/spec.md` (new) — new capability spec.

## Risks

- **Schema drift** (Med) — fail fast on unknown *required* columns; `ACERTIVIDAD`/`DIFICULTAD` are recognised but accepted verbatim.
- **Local-ID collisions** (Low) — composite `<dataset>/<id>`; duplicate detection raises.
- **Hallucination signal ambiguity** (Med) — explicit benchmark field/config or `is_garbage`; never inferred from `ACERTIVIDAD`.
- **Missing acoustic `condition`** (Low) — recorded as `unknown`; aggregate split still works; optional config supplies it.
- **Transcript outputs leak into Git** (Med) — root + `benchmarks/.gitignore`; privacy tests.
- **Vendor/config drift** (Med) — `run_at`, `vendor`, `base_url`, version captured.
- **WER normalisation drift** (Med) — fixed normaliser used in tests + report.
- **`.ogg` MIME mis-detection** (Low) — explicit suffix→MIME table; non-`audio/*` rejected.

## Rollback Plan

Revert the PR (single PR, ≤5000 changed lines). `load_corpus(root)` falls back to `labels.csv` whenever no `BD_AUDIOS.xlsx` is present; `--corpus` accepts either layout. No production STT changes; rollback local to `benchmarks/` + docs/spec deltas.

## Dependencies

- `openpyxl` (dev-only) added to `services/stt` pyproject; uv-managed.
- External `BD_Pruebas/` corpus (root `.gitignore`).
- Living STT service on `BENCH_STT_URL` (default `http://localhost:8001`).

## Success Criteria

- [ ] Loader accepts the current `BD_AUDIOS.xlsx` schema unchanged; the existing 38 rows run end-to-end without modifying any workbook.
- [ ] One result row and one matrix row per valid discovered clip — N is not hard-coded; future additions to the corpus produce additional rows with zero code changes.
- [ ] Per-audio matrix CSV records expected/actual transcript, per-row metrics, status, `ACERTIVIDAD` (verbatim), `DIFICULTAD` (verbatim), and `condition` (`unknown` if absent); aggregate retains digit accuracy, hallucination rate, WER.
- [ ] Strict-TDD tests prove irrelevante/filler/cancion/mixto clips are POSTed and scored, never filtered by `ACERTIVIDAD`; hallucination classification is driven by explicit signal, not `ACERTIVIDAD`.
- [ ] Transcript-bearing outputs verified gitignored; privacy tests assert no transcript in console at INFO.
- [ ] Adding valid rows/audios to existing workbooks and rerunning the same command requires zero code changes.
