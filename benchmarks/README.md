# STT benchmark harness

This is the evidence behind the accuracy claim. It is not an afterthought — the
pitch rests on the numbers this harness produces, so it has to be reproducible
by anyone with the corpus.

It runs inside the STT service's uv environment (httpx and pytest are already
there), so there is no third lockfile to keep in sync.

## Commands

```bash
# tests
uv run --project services/stt pytest benchmarks/tests -q

# validate an external XLSX corpus without calling the service
uv run --project services/stt python benchmarks/run.py --dry-run \
  --corpus /path/to/BD_Pruebas

# run against a live service (CSV or XLSX)
BENCH_STT_URL=http://localhost:8001 \
  uv run --project services/stt python benchmarks/run.py \
  --corpus /path/to/BD_Pruebas

# regenerate the per-audio matrix and aggregate from a stored run
uv run --project services/stt python benchmarks/report.py \
  results.json --matrix benchmark_matrices/last.csv
```

`run.py` flags: `--corpus`, `--output`, `--concurrency` (default 4),
`--base-url` (defaults to `$BENCH_STT_URL`), `--dry-run`.

Precedence is flag > environment > default:

* `--corpus` / `$BENCHMARK_CORPUS` / `benchmarks/corpus/`
* `--base-url` / `$BENCH_STT_URL` / `http://localhost:8001`

Any path supplied as `--output` MUST live under a gitignored location
(`benchmarks/.gitignore`, root `.gitignore`). The runner refuses to write to a
path that is not covered before it talks to the service.

## Corpus layouts

The runner accepts two equivalent layouts:

1. **`benchmarks/corpus/labels.csv`** — the original CSV layout. Rows are
   paired with sibling audio files (`<clip_id>.<ext>`).
2. **External XLSX root** — a directory containing one or more
   `BD_AUDIOS.xlsx` workbooks (current schema: `ID_UNICO`, `TEXTO_AUDIO`,
   `ACERTIVIDAD`, `DIFICULTAD`, `JSON PRODUCTOS` — unchanged) each with a
   sibling `NOTAS_VOZ/` audio folder.

Schema and how to add rows: [`corpus/README.md`](corpus/README.md). The
external layout is discovered below `--corpus` recursively, so adding a new
contributor directory requires no code change.

## What is measured

1. **Digit accuracy** — every labelled quantity token, exact match. "Said 90,
   transcribed 900" is a discrete failure, not a fractional penalty. This is
   the primary claim.
2. **Hallucination rate on garbage clips** — the share of clips labelled
   `is_garbage` that produced inventory-shaped output. Computed over **all**
   garbage clips, never a sample. Only the CSV layout carries this label
   today: the XLSX loader sets `is_garbage: False` for every clip, so on an
   XLSX-only corpus the denominator is empty and the rate reports `n/a`.
   A garbage-marking mechanism for XLSX corpora is future work.
3. **WER** — token-level Levenshtein, secondary sanity signal only. It must
   not be quoted as the headline number.

Every metric is also split by clip condition (`clean` / `noisy` /
`spontaneous` / `unknown`); one blended number hides the case that matters.

## Current limitations with XLSX corpora

The XLSX loader hardcodes `items: []`, `is_garbage: False`, and
`condition: "unknown"` for every clip. On a real `BD_Pruebas` run this means:

* **Digit accuracy is `n/a`** — no labelled quantity tokens, so the
  denominator is 0.
* **Hallucination rate is `n/a`** — no clip is marked garbage.
* **The per-condition split collapses** to a single `unknown` bucket.

Only WER carries signal on an XLSX corpus today — and, as stated above, WER
must not be quoted as the headline number. Do not quote the harness as
producing the full metric set on `BD_Pruebas` until item labels, a garbage
signal, and conditions exist for the XLSX layout.

## How a hallucination is detected

A garbage clip counts as hallucinated when its transcript matches
QUANTITY-NEAR-ITEM: after normalisation (lowercase, unaccent, strip
punctuation), a quantity token — a number or a Spanish number word — is
followed within two tokens by an alphabetic token of length ≥ 3 that is not a
filler (`eh`, `este`, `pues`, `bueno`, …).

This is deliberate, not a proxy for "produced any text". A bare filler
transcript ("eh… este…") is a *correct* low-content transcription of a noisy
clip, not an invented inventory line; counting it would inflate the number we
are claiming to be low.

**Accepted false negative**: an item invented without any quantity token is
not counted. `report.py` prints this caveat with every table.

## Reading the output

```
condition    clips  failed  digit acc  digit n  garbage  halluc rate  WER (2nd)
-----------  -----  ------  ---------  -------  -------  -----------  ---------
clean        3      1       100.0%     1        1        0.0%         0.250
...
```

- `failed` — clips whose request did not return `200`. They are counted and
  excluded from scoring, never silently dropped.
- `digit n` — the number of labelled quantity tokens behind the accuracy
  figure. A high percentage over two tokens means very little; read it first.
- `n/a` — no data for that cell (e.g. a condition with no garbage clips).

The per-audio matrix CSV (`benchmark_matrices/<run>.csv` or `--matrix <path>`)
adds row-level fields: composite id, dataset, audio filename, condition,
verbatim `dificultad` and `acertividad`, vendor, expected / actual transcript,
per-row digit / WER / hallucinated flag, and the `error` column when a clip
failed.

## Reproducibility

Each `results.json` records `schema_version`, `normalizer_version`
(`stt-es-v1`), and a SHA-256 `config_fingerprint` over the non-secret
benchmark settings (corpus path, base URL, concurrency, normalizer version).
Re-running `report.py` against the same stored file is byte-identical; live
reruns may differ in `run_at`, `latency_ms`, vendor transcript, and
`stt_confidence`.

## Privacy

* Raw audio, workbooks, and transcript-bearing outputs land under
  `BD_Pruebas/` or `benchmarks/results.json` + `benchmark_matrices/`, all
  gitignored.
* The runner never logs transcript bodies at `INFO`. Add `LOG_LEVEL=DEBUG` if
  you need them during a test.
* `--output` (or default `results.json`) is privacy-checked against
  `git -C <repo> check-ignore`; refusing to write anywhere else is a
  fail-closed contract.
