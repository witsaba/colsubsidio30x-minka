# Design: Add STT Audio Benchmark

## Technical Approach

Extend the existing `benchmarks` harness with `corpus_loader.py`. CSV and XLSX adapters normalize to the current clip-dict contract, preserving `benchmarks.run.load_corpus` and `run_benchmark`. Discover sorted `**/BD_AUDIOS.xlsx` below the supplied root. The current private fixture has two contributor directories, each with `Sheet1`, 19 rows, and sibling `NOTAS_VOZ/1.ogg` through `19.ogg`. Require the `JSON PRODUCTOS` header but never parse it. Treat `ACERTIVIDAD` and `DIFICULTAD` as opaque; submit and score every clip, with no relevance semantics.

## Architecture Decisions

| Decision | Choice | Alternative rejected | Rationale |
|---|---|---|---|
| Loader boundary | `CorpusClip` `TypedDict`; separate CSV/XLSX adapters. | New result classes. | Existing callers index dictionaries; additive fields preserve APIs. |
| IDs/mapping | Integral numeric values (`1.0`, `"1"`, `00001`) share match key `1`; display key is `00001`. Non-numeric IDs are trimmed NFC text. Composite ID is safe relative-dataset/display-ID. | Raw Excel text or filename padding. | Actual workbook IDs are floats while files are unpadded; canonicalizing both sides handles this and prevents cross-dataset collisions. Reject separators/control text and duplicates. |
| Validation | Collect sorted schema, duplicate, missing, multi-match, unsupported-MIME, and unlabeled-file errors; raise `CorpusValidationError` before client/health/network or writes. | Partial execution/report. | The corpus is an atomic evidence set; no results or matrix may represent invalid input. |
| Results/report | One result per loaded clip, including transport/non-200 failures. `report.py results.json` regenerates fixed-order matrix CSV and aggregate text from stored results only. | Re-discovery during reporting. | Gather preserves order and stored results are the reproducibility boundary. |
| Privacy/config | `artifacts.py` performs atomic writes, non-secret SHA-256 fingerprinting, and fail-closed `git -C <repo> check-ignore`. | Trusting caller paths. | Root `BD_Pruebas/` is ignored; add and enforce `benchmarks/benchmark_matrices/`. |

## Data Flow

```text
--corpus/BENCHMARK_CORPUS -> discover/validate -> ordered clips
 -> concurrent /transcribe POSTs (fixed MIME) -> one result per clip
 -> results.json (normalizer/config metadata) -> report.py -> matrix + aggregate
```

MIME is fixed and case-insensitive: `.ogg=audio/ogg`, `.webm=audio/webm`, `.wav=audio/wav`, `.mp3=audio/mpeg`; other extensions fail. `1.0`, `"1"`, and `1.ogg` therefore match, while the composite remains `dataset/00001`.

## File Changes

| File | Action | Description |
|---|---|---|
| `benchmarks/corpus_loader.py` | Create | Adapters, discovery, canonical IDs, MIME and deterministic validation. |
| `benchmarks/artifacts.py` | Create | Safe output paths, ignore enforcement, atomic writes, fingerprint. |
| `benchmarks/run.py` | Modify | Dispatch, CLI/env precedence, per-clip failures, v2 metadata; retain signatures. |
| `benchmarks/metrics.py`, `benchmarks/report.py` | Modify | `stt-es-v1` normalizer, per-clip metrics, matrix/aggregate regeneration. |
| `benchmarks/tests/test_corpus_loader.py`, `benchmarks/tests/test_report.py`, `benchmarks/tests/test_acceptance_private.py` | Create | RED-first loader, report/privacy, and env-gated 38-clip acceptance tests. |
| `benchmarks/tests/test_run.py`, `benchmarks/tests/test_metrics.py`, `benchmarks/README.md`, `benchmarks/corpus/README.md` | Modify | Runner/metric regression tests and workflows. |
| `benchmarks/.gitignore`, `services/stt/pyproject.toml`, `services/stt/uv.lock` | Modify | Ignore matrix/summary outputs; add dev-only `openpyxl`. |

## Interfaces / Contracts

`load_corpus(path) -> list[dict]` remains public. Extended clips add `dataset`, `mime_type`, `dificultad`, and `acertividad` beside existing keys. Precedence is flag > environment > default: `--corpus`/`BENCHMARK_CORPUS`, `--base-url`/`BENCH_STT_URL`; `--dry-run` stays network-free. `--output` is privacy-checked before network; concurrency remains 4. Matrix has fixed columns including `error`; failures preserve `expected`, use empty `actual`, and are never dropped. Results record `schema_version=2`, normalizer version, and a fingerprint of only non-secret benchmark settings.

## Testing Strategy

Strict TDD writes RED tests before each production unit:

| Layer | Coverage | Exact command |
|---|---|---|
| Unit | IDs, schema/mapping, MIME, opaque fields, normalizer/fingerprint | `uv run --project services/stt pytest benchmarks/tests/test_corpus_loader.py benchmarks/tests/test_metrics.py -q` |
| Integration | All-row POSTs, multipart MIME, service failures, precedence, validation short-circuit, deterministic matrix | `uv run --project services/stt pytest benchmarks/tests/test_run.py benchmarks/tests/test_report.py -q` |
| E2E acceptance | Private corpus supplied by env and skipped otherwise; proves current 38 without committed files | `BENCHMARK_ACCEPTANCE_CORPUS=/absolute/BD_Pruebas uv run --project services/stt pytest benchmarks/tests/test_acceptance_private.py -q` |
| Full | All benchmark tests | `uv run --project services/stt pytest benchmarks/tests -q` |

## Threat Matrix

| Boundary | Status and response | RED test |
|---|---|---|
| Documentation-like paths | N/A — no executable classification. | None |
| Git repository selection | Applicable — normalize absolute/relative paths against the fixed repo root; call `git -C <repo> check-ignore --quiet -- <relative>` without shell. Ignored proceeds; unignored/git failure aborts before network/write. | Assert argv and safe/fail-closed behavior for both path forms. |
| Commit state | N/A — no staging/commit. | None |
| Push state | N/A — no ref resolution. | None |
| PR commands | N/A — no PR automation. | None |

## Migration / Rollout

No corpus migration or private-file commit. The additive v2 results are still consumable by the old aggregate path; explicit old `--output` remains supported. Delivery is auto/hybrid in one PR capped at 5,000 changed lines; work-unit commits keep tests with behavior. Rollback is a single-PR revert; production STT is untouched. Dependency plan: `uv add --project services/stt --dev openpyxl`.

## Open Questions

None.
