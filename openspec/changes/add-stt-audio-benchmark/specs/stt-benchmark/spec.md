# Delta for stt-benchmark

## MODIFIED Requirements

### Requirement: REQ-BMK-1 Corpus format

The corpus SHALL live in `benchmarks/corpus/` as audio clips plus a `labels.csv` with at least: `clip_id`, reference `transcript`, expected `items`, `is_garbage` flag, and clip `condition` (`clean` | `noisy` | `spontaneous`). The harness MUST run on whatever clips exist — no hard-coded corpus size. The runner MUST ALSO accept an external corpus root that contains one or more `BD_AUDIOS.xlsx` workbooks (current schema: `ID_UNICO`, `TEXTO_AUDIO`, `ACERTIVIDAD`, `DIFICULTAD`, `JSON PRODUCTOS` — unchanged) and a sibling `NOTAS_VOZ/` folder per dataset. Every workbook row MUST map to exactly one audio file; the loader MUST reject duplicate composite IDs, missing audio, multiple extension matches, and unlabeled audio deterministically.
(Previously: single `labels.csv` only; no XLSX schema; no composite IDs; no mapping validation.)

#### Scenario: Harness accepts a partial labels.csv corpus

- GIVEN a corpus containing only three labeled clips
- WHEN the runner executes
- THEN all three clips are processed and no error is raised about corpus size

#### Scenario: External XLSX corpus loads with the current schema (two datasets)

- GIVEN an external root with two `BD_AUDIOS.xlsx` workbooks (current schema), each with 19 rows, and a sibling `NOTAS_VOZ/` folder per dataset
- WHEN the runner loads
- THEN 38 clips are produced and no schema migration is required

#### Scenario: Unlabeled audio fails deterministically

- GIVEN a dataset whose `NOTAS_VOZ/` contains an `.ogg` not referenced by any `ID_UNICO`
- WHEN the loader runs
- THEN the loader raises a deterministic error naming the unlabeled file

### Requirement: REQ-BMK-2 Concurrent runner writes results.json

`benchmarks/run.py` SHALL send corpus clips to the running STT service concurrently and SHALL write one `results.json` containing, per clip, the service response and the clip's labels. The runner MUST accept `--corpus` (or `BENCHMARK_CORPUS`) pointing at either a `labels.csv` directory or an external XLSX root, and MUST submit every valid clip to `/transcribe` regardless of `ACERTIVIDAD` value.
(Previously: single corpus layout; no CLI/env selector; no assertion that every valid clip is submitted independent of `ACERTIVIDAD`.)

#### Scenario: Runner produces results for every clip

- GIVEN a corpus of labeled clips and a reachable STT service (mocked or live)
- WHEN `run.py` executes
- THEN `results.json` contains one entry per corpus clip, each pairing labels with the frozen response fields

#### Scenario: irrelevante clips are submitted and scored verbatim

- GIVEN a clip with `ACERTIVIDAD=irrelevante` and verbatim `TEXTO_AUDIO`
- WHEN the runner executes
- THEN the clip is POSTed and recorded with verbatim expected vs. actual transcripts

#### Scenario: --corpus accepts an external XLSX root

- GIVEN an external root `--corpus /path/to/BD_Pruebas`
- WHEN the runner executes
- THEN one entry per discovered valid clip is written to `results.json`

## ADDED Requirements

### Requirement: REQ-BMK-7 Per-audio matrix CSV

`benchmarks/report.py` SHALL emit a private per-audio matrix CSV alongside the aggregate. The matrix MUST contain exactly one row per loaded/submitted clip (including non-200 outcomes); no clip from the loaded set is dropped or counted twice. Each row MUST include: composite `id`, dataset, relative audio filename, `condition` (`unknown` when absent), `dificultad` (verbatim), `acertividad` (verbatim), `status`, `latency_ms`, vendor, expected transcript (preserved from labels), actual transcript (empty when `status != 200`), `digit_correct`, `digit_total`, WER, and `hallucinated` flag. For rows with `status != 200`, the matrix MUST preserve the expected ground truth, leave the actual transcript empty, and populate the error field. Loader validation errors (missing audio, duplicate composite IDs, multiple extension matches, unlabeled audio) MUST fail before the run and produce no `results.json` and no matrix; a partial benchmark MUST NOT be emitted unless a future design explicitly adds a separate validation report.

#### Scenario: One matrix row per loaded/submitted clip, including non-200 outcomes

- GIVEN a loaded set of 38 clips
- WHEN the runner completes and the matrix renders
- THEN the matrix contains exactly 38 rows, one per loaded clip, regardless of how many returned `status != 200`

#### Scenario: Failed clips preserve expected ground truth and report error

- GIVEN a clip whose POST returned 502
- WHEN the matrix renders
- THEN the clip appears with `status=502`, `expected` populated from labels, `actual` empty, and `error` populated

#### Scenario: Loader validation errors fail before run

- GIVEN a dataset whose `NOTAS_VOZ/` contains an `.ogg` not referenced by any `ID_UNICO`
- WHEN the loader runs
- THEN the loader raises a deterministic error and no `results.json` or matrix is produced

### Requirement: REQ-BMK-8 Opaque ACERTIVIDAD and DIFICULTAD metadata

`ACERTIVIDAD` and `DIFICULTAD` MUST be treated as opaque metadata. The benchmark MUST NOT maintain a hard-coded allow-list of `ACERTIVIDAD` values; unknown values MUST be recorded verbatim and MUST never gate submission, scoring, or filtering.

#### Scenario: Unknown ACERTIVIDAD is preserved verbatim

- GIVEN a workbook with a row whose `ACERTIVIDAD` is a value not previously seen
- WHEN the runner executes
- THEN the clip is submitted, scored, and the unknown value appears verbatim in the matrix

### Requirement: REQ-BMK-9 Optional acoustic condition

Acoustic `condition` (`clean` | `noisy` | `spontaneous`) is optional. When no benchmark field/config supplies it, the matrix MUST record `condition=unknown`. The benchmark MUST NEVER infer `condition` from `DIFICULTAD` or any other label.

#### Scenario: Missing condition is recorded as unknown

- GIVEN a clip with no `condition` field provided (no benchmark config, no `labels.csv` column)
- WHEN the matrix renders
- THEN the row's `condition` is `unknown`

### Requirement: REQ-BMK-10 Explicit no-speech signal

The benchmark MUST distinguish acoustic no-speech from semantic relevance. Acoustic no-speech MUST be signalled by an explicit benchmark field/config or `labels.csv` `is_garbage`; relevance classes (`irrelevante`, `cancion`, `filler`, `mixto`) MUST NOT be inferred from `ACERTIVIDAD`.

#### Scenario: irrelevante clip is voice-bearing and transcript-scored with no relevance judgment

- GIVEN a clip with `ACERTIVIDAD=irrelevante` and verbatim `TEXTO_AUDIO`
- WHEN the runner executes
- THEN the clip is submitted and transcript-scored verbatim; the benchmark records the voice-bearing nature and makes no inventory relevance judgment

### Requirement: REQ-BMK-11 Stable normalization and run metadata

`results.json` MUST capture run metadata: `run_at`, `vendor`, `base_url`, normaliser version, and any benchmark config fingerprint. Deterministic reproducibility is defined as regenerating the matrix and aggregate report from the same stored `results.json` with the same versioned normalizer and config fingerprint. Live run metadata (`latency_ms`, vendor transcript, `stt_confidence`) supports cross-run comparison but does NOT promise identical outputs across live reruns.

#### Scenario: Reproducible report from a stored results.json

- GIVEN a stored `results.json` with a captured normaliser version and config fingerprint
- WHEN the report command is rerun against the same file
- THEN the regenerated matrix and aggregate report match the previous output byte-for-byte

#### Scenario: Live reruns may differ; metadata captured for comparison

- GIVEN a live run against the STT service
- WHEN the same command is rerun live
- THEN `run_at`, `latency_ms`, vendor transcript, and `stt_confidence` MAY differ; the captured metadata is sufficient to compare the two runs

### Requirement: REQ-BMK-12 Gitignored sensitive outputs

Transcript-bearing outputs (matrix CSV, `results.json`) MUST land under the gitignored external root or `benchmarks/.gitignore`. Privacy tests MUST assert transcript text never appears in INFO logs.

#### Scenario: Matrix path is outside Git

- GIVEN a generated per-audio matrix CSV
- WHEN the repo is inspected
- THEN the matrix file path is covered by `benchmarks/.gitignore` or root `.gitignore`
