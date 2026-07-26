# Benchmark corpus

The runner processes whatever clips exist — there is no minimum or hard-coded
corpus size (REQ-BMK-1). Two layouts are supported and they round-trip into
the same `CorpusClip` shape.

## Layout 1: `benchmarks/corpus/labels.csv`

Audio clips sit next to `labels.csv`. The runner finds each clip by `clip_id`,
whatever the audio extension (`.webm`, `.ogg`, `.wav`, `.mp3`).

### `labels.csv` columns

| Column | Meaning |
|---|---|
| `clip_id` | Unique id; also the audio filename stem |
| `condition` | `clean` \| `noisy` \| `spontaneous` — the report splits every metric by this (REQ-BMK-6) |
| `transcript` | Reference transcript, verbatim, in es-CO. Empty for garbage clips |
| `items` | JSON array of the expected quantity tokens as strings, e.g. `["3","12"]` |
| `is_garbage` | `true` when the clip contains no inventory speech (silence, noise, filler) — explicit no-speech signal (REQ-BMK-10) |

Example rows:

```csv
clip_id,condition,transcript,items,is_garbage
clean-01,clean,tres kilos de lechuga,"[""3""]",false
noisy-01,noisy,noventa canastas de mango,"[""90""]",false
garbage-01,noisy,,[],true
```

Note the CSV quoting: the `items` JSON is wrapped in double quotes and its own
quotes are doubled.

## Layout 2: external XLSX root (`BD_AUDIOS.xlsx` + `NOTAS_VOZ/`)

Pointer the runner at any directory holding one or more `BD_AUDIOS.xlsx`
workbooks. Each workbook lives in its own contributor folder (so local
`ID_UNICO=1` repeats across folders without collision) and has a sibling
`NOTAS_VOZ/` audio folder.

```
BD_Pruebas/
├── Braejan/
│   ├── BD_AUDIOS.xlsx   # schema unchanged: see below
│   └── NOTAS_VOZ/
│       ├── 1.ogg
│       └── ...
└── Daniel/
    ├── BD_AUDIOS.xlsx
    └── NOTAS_VOZ/
        └── ...
```

### Workbook schema (unchanged)

| Column | Meaning |
|---|---|
| `ID_UNICO` | Unique id within this dataset. Floats (`1.0`) and unpadded strings (`"1"`) are normalised to the same display form |
| `TEXTO_AUDIO` | Verbatim ground-truth transcript (es-CO); empty for pure silence |
| `ACERTIVIDAD` | Opaque metadata. Recorded verbatim and never used to filter, classify, or score (REQ-BMK-8) |
| `DIFICULTAD` | Opaque metadata, one of `FACIL` / `MEDIO` / `DIFICIL`. Recorded verbatim (REQ-BMK-7) |
| `JSON PRODUCTOS` | Opaque payload; never parsed for STT scoring |

`JSON PRODUCTOS` is downstream product-extraction ground truth and stays out of
scope for the STT benchmark. The loader requires it to be present (so the
schema is frozen) but never reads it.

### Mapping rules

| Condition | Outcome |
|---|---|
| Workbook row missing matching audio | `CorpusValidationError` (loader refuses to start) |
| Workbook row matches multiple audio extensions (`.ogg` + `.webm`) | `CorpusValidationError` |
| Audio file in `NOTAS_VOZ/` not referenced by any `ID_UNICO` | `CorpusValidationError` (unlabeled) |
| Audio with a non-audio extension (`.txt`, `.html`, …) | `CorpusValidationError` |
| Duplicate composite id inside one workbook | `CorpusValidationError` (deterministic, named) |

### Adding clips

* Drop a workbook + `NOTAS_VOZ/` folder into the corpus root and rerun —
  the loader discovers it. N is not hard-coded; one row + one matching file
  = one new clip with zero code changes.
* For the same-clip-id-across-datasets case, use the composite id
  `<relative-dataset>/<display-id>` (e.g. `Braejan/00001`) to disambiguate.

## Acoustic `condition`

Acoustic `condition` (`clean` / `noisy` / `spontaneous`) is **optional**. The
CSV layout supplies it through the `condition` column; the XLSX layout has no
way to supply it today, so the loader records `condition="unknown"` for every
XLSX clip and the per-condition split collapses to that single bucket. The
runner never infers `condition` from `DIFICULTAD`.

## Hallucination signal

Hallucination rate is gated by the explicit `is_garbage` signal, which only
the CSV layout carries. The XLSX loader sets `is_garbage: False` for every
clip, so on an XLSX-only corpus the hallucination rate reports `n/a`; an
XLSX garbage-marking mechanism is future work (see the harness README's
"Current limitations with XLSX corpora"). Relevance classes like `irrelevante`, `filler`,
`cancion`, `mixto`, `silencio` are recorded verbatim in the matrix but do NOT
change whether a clip is transcribed or scored — every voice-bearing clip is
POSTed to `/transcribe` and compared against `TEXTO_AUDIO`.

## Coverage worth aiming for

- Inventory clips with quantities that expose near-misses (`90` vs `900`)
  — digit accuracy exists to catch exactly that failure.
- Garbage clips: silence, warehouse noise, and pure filler. The hallucination
  rate runs over **all** of them, never a sample.
- Each `ACERTIVIDAD` class once (irrelevante / filler / cancion / mixto /
  silencio) so the matrix shows that the runner actually submits and scores
  them, never filters by class.

## Privacy

* Audio, workbooks, and `BD_Pruebas/` itself live outside Git
  (root `.gitignore` covers it).
* `benchmarks/results.json`, `benchmark_matrices/`, and `benchmarks/matrix.csv`
  / `summary.txt` are gitignored via `benchmarks/.gitignore`.
* The runner never logs transcripts at `INFO`; use `LOG_LEVEL=DEBUG` when
  debugging audio rejection paths.
