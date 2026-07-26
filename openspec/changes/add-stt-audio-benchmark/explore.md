## Exploration: Reusable STT audio benchmark (`add-stt-audio-benchmark`)

### Current State
The repository already contains the correct foundation, so this change should **extend and correct the existing `benchmarks/` harness rather than create a second benchmark module**. The archived `implement-stt-service` change delivered a concurrent `run.py`, deterministic metrics in `metrics.py`, an aggregate `report.py`, strict-TDD tests, and the canonical `labels.csv` contract (`clip_id`, `condition`, `transcript`, `items`, `is_garbage`). It sends every labeled clip to the live `POST /transcribe` endpoint and stores the expected labels beside the six-field STT response in `results.json`.

The current harness already supports corpus growth without hard-coded counts and resolves `<clip_id>.<ext>`, but it is not sufficient for Daniel's requested workflow:

- It reads only `labels.csv` with audio in the same directory; the private corpus uses per-contributor `BD_AUDIOS.xlsx` files and sibling `NOTAS_VOZ/` directories.
- `BD_Pruebas` currently contains two structurally identical datasets, each with 19 spreadsheet rows and 19 `.ogg` files. Within each dataset, numeric `ID_UNICO` values map one-to-one to filename stems, with no missing, duplicate, or unlabeled files. IDs repeat across datasets, so a corpus-wide identifier must include the dataset's relative path/name.
- The workbook schema is `ID_UNICO`, `TEXTO_AUDIO`, `ACERTIVIDAD`, `DIFICULTAD`, and `JSON PRODUCTOS`. The current data uses three difficulty labels, while `ACERTIVIDAD` is currently populated with one relevance class. `JSON PRODUCTOS` is downstream extraction ground truth and is not an STT scoring input.
- `_audio_path()` silently selects the first match when multiple files share a stem, and `_transcribe_clip()` sends every extension as `audio/webm`; this is incorrect for the existing `.ogg` corpus.
- `results.json` contains expected and actual transcripts, but `report.py` renders only aggregate rows. It does not produce Daniel's complete per-audio accuracy matrix.
- The existing `is_garbage` benchmark label conflates “no inventory speech” with acoustic garbage. That model cannot represent the clarified boundary: irrelevant speech, songs, filler, and mixed relevant/irrelevant speech must still be transcribed and compared with ground truth. Only downstream logic decides relevance.

This boundary agrees with `stt-transcription` REQ-STT-4: `raw_transcript` is the vendor transcript without downstream interpretation or ITN. The benchmark must not skip, redact, classify away, or alter voiced content before scoring. The PRD remains authoritative for es-CO, the 4–6% WER target, no production audio persistence, and the reliability-matrix requirement. Audio and transcript-bearing result artifacts are private test data and must remain outside Git.

### Affected Areas
- `benchmarks/run.py` — extend corpus loading to the existing external workbook/audio-folder layout; enforce strict one-row/one-file mapping; derive correct media types; keep processing every available row.
- `benchmarks/metrics.py` — add per-clip full-transcript comparison while preserving digit accuracy, garbage hallucination rate, and secondary WER required by the current specification; do not condition scoring on semantic relevance.
- `benchmarks/report.py` — emit a complete row-level matrix plus aggregate views, including failures rather than silently excluding them.
- `benchmarks/tests/test_run.py` — strict-TDD coverage for workbook discovery, composite IDs, mapping failures, `.ogg` MIME handling, arbitrary corpus growth, and all-row execution.
- `benchmarks/tests/test_metrics.py` — strict-TDD coverage proving irrelevant, filler, song, and mixed-content clips are transcript-scored and never filtered by relevance.
- `benchmarks/README.md` and `benchmarks/corpus/README.md` — document the external corpus workflow, privacy boundary, schema mapping, repeatable commands, and output handling.
- `benchmarks/.gitignore` and root `.gitignore` — ensure generated matrices/results and all `BD_Pruebas` audio/workbooks remain outside Git; the raw corpus is already ignored at root.
- `services/stt/pyproject.toml` / `services/stt/uv.lock` — add `openpyxl` to the benchmark/test environment if direct `.xlsx` support is selected, while retaining the standalone STT uv-project convention.
- `openspec/specs/stt-benchmark/spec.md` — a future delta should extend the existing benchmark capability instead of defining a duplicate capability, especially around external spreadsheets, strict mapping, complete matrix output, and semantic-relevance neutrality.

### Approaches
1. **Extend the existing harness with an external XLSX corpus adapter (recommended)** — accept `BD_Pruebas` (or any equivalent external root), discover dataset workbooks and audio folders, normalize each local `ID_UNICO`, and derive a stable composite key such as `<relative-dataset>/<normalized-id>`.
   - Pros: Uses the corpus exactly as maintained by the team; adding rows/files requires no code changes; preserves the proven concurrent runner and metrics; avoids copying private binaries; naturally supports multiple contributors with repeated local IDs.
   - Cons: Adds workbook parsing and schema-validation logic; requires an `openpyxl` dev dependency in the STT uv environment; spreadsheet column semantics must be explicitly mapped rather than guessed.
   - Effort: Medium

2. **Convert each workbook to the existing `labels.csv` format before every run** — keep `run.py` unchanged and add a separate conversion/import step.
   - Pros: Minimal changes to the current runner; keeps `labels.csv` as the only runtime contract; straightforward to test.
   - Cons: Creates two sources of truth; risks stale CSV after spreadsheet edits; adds an extra operator step and generated transcript-bearing files; does not satisfy “append audios and rerun the exact same test” as directly as the XLSX adapter; still needs MIME and complete-matrix fixes.
   - Effort: Medium

3. **Build a separate BD_Pruebas-specific benchmark** — create a new runner/report dedicated to the current workbook layout.
   - Pros: Fastest narrow path for the current files.
   - Cons: Duplicates concurrency, service-contract handling, metrics, tests, and documentation; invites metric drift; contradicts the archived benchmark capability and the request for a reusable module.
   - Effort: Medium initially, High maintenance

### Recommendation
Extend the existing `benchmarks/` capability with a pluggable corpus loader and keep `labels.csv` backward compatible. The XLSX loader should discover each `BD_AUDIOS.xlsx` plus its `NOTAS_VOZ/`, normalize numeric spreadsheet IDs without changing source files, and require **exactly one** matching audio stem per row. It should also fail validation on duplicate composite IDs, missing audio, multiple extension matches, unlabeled audio, missing required ground truth, or unsupported media; deterministic failure is preferable to a misleading partial matrix.

Treat `TEXTO_AUDIO` as verbatim ground truth for every clip containing voice or song lyrics, regardless of `ACERTIVIDAD`. Preserve relevance/difficulty fields only as matrix dimensions/metadata; never use them to decide whether a clip is submitted or transcript-scored. Introduce an explicit distinction between acoustic no-speech clips and semantic content classes rather than overloading `is_garbage`. Silence/noise may retain hallucination scoring, while irrelevant speech, filler, songs, and mixed speech receive the same expected-vs-actual transcript comparison as inventory speech. `JSON PRODUCTOS` remains out of scope because it belongs to the downstream brain/extraction benchmark.

Keep `results.json` as the immutable run evidence and add a generated, private per-clip matrix (for example CSV) containing stable ID, relative filename, non-sensitive scenario labels, request status/vendor/latency, expected-vs-actual transcript fields, and per-row metrics. Aggregate reporting should retain the current specification's digit accuracy and hallucination claims, with WER present as the secondary metric, while adding enough per-row evidence to show exactly where each run fails. Outputs that contain transcripts must default under the ignored external corpus/output location or be covered by explicit ignore rules.

Implementation should follow strict TDD and the existing command convention (`uv run --project services/stt ...`; service regression suite: `cd services/stt && uv run pytest`). No production STT endpoint or relevance behavior needs to change for this benchmark extension.

### Risks
- The spreadsheet's `ACERTIVIDAD` name and allowed values are not a stable semantic contract yet; current files only exercise one relevance value. The proposal/spec should define allowed content classes without rewriting private workbooks prematurely.
- `DIFICULTAD` (`FACIL`/`MEDIO`/`DIFICIL`) is not equivalent to the current acoustic `condition` (`clean`/`noisy`/`spontaneous`). Preserve both concepts or define an explicit mapping; do not silently translate one into the other.
- Repeated local IDs across contributor folders make bare `ID_UNICO` globally ambiguous; composite IDs are required for reproducible reruns.
- Expected and actual transcripts are personal data. A complete matrix is necessarily sensitive even when raw audio is ignored, so result location, Git ignores, console output, and CI artifact policy require explicit privacy tests.
- Songs, filler, and mixed speech expose normalization/scoring-policy questions (punctuation, casing, repeated words, partial lyrics). WER normalization must be fixed and documented before comparing historical runs.
- Vendor/model/config changes can move benchmark numbers. Run metadata should capture enough non-secret configuration to distinguish corpus regression from vendor/config drift.
- The current corpus was recorded and labeled by the same small group; reported numbers describe this corpus only and do not independently establish population-level es-CO accuracy.

### Ready for Proposal
Yes. Frame `add-stt-audio-benchmark` as a **MODIFIED/extended `stt-benchmark` capability**, not a new STT implementation: direct external spreadsheet ingestion, strict deterministic row/file mapping, correct audio media types, all-content transcription with no relevance filtering, and a complete private per-audio accuracy matrix. Keep raw/private corpus migration and downstream product extraction/relevance evaluation out of scope.
