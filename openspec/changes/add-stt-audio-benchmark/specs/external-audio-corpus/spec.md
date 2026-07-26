# external-audio-corpus Specification

## Purpose

Pluggable loader that ingests external STT benchmark corpora laid out as per-contributor `BD_AUDIOS.xlsx` workbooks with sibling `NOTAS_VOZ/` audio folders. Provides deterministic composite IDs, strict one-row/one-audio mapping, correct MIME, and opaque treatment of `ACERTIVIDAD` / `DIFICULTAD` metadata. Consumed by `stt-benchmark`.

## Requirements

### Requirement: REQ-CORPUS-1 Schema unchanged

The loader MUST accept the current `BD_AUDIOS.xlsx` schema (`ID_UNICO`, `TEXTO_AUDIO`, `ACERTIVIDAD`, `DIFICULTAD`, `JSON PRODUCTOS`) without modification. No new columns are required. `JSON PRODUCTOS` is treated as opaque payload and MUST NOT be parsed for STT scoring.

#### Scenario: Current two-dataset corpus loads without schema migration

- GIVEN an external root containing two `BD_AUDIOS.xlsx` workbooks (current schema), each with 19 rows, and a sibling `NOTAS_VOZ/` folder per dataset
- WHEN the loader runs
- THEN 38 clips are produced and no schema migration is performed

### Requirement: REQ-CORPUS-2 Corpus-size-agnostic discovery

The loader MUST discover every dataset root below the external path and emit one clip per discovered row. N is not hard-coded; future additions produce additional clips with zero code changes.

#### Scenario: Two-dataset corpus yields 38 clips corpus-size-agnostically

- GIVEN an external root with two 19-row workbooks (38 rows total)
- WHEN the loader runs
- THEN 38 clips are produced without any hard-coded count

#### Scenario: Adding rows or files increases N

- GIVEN the two-dataset corpus (38 clips)
- WHEN two more rows are appended to one workbook and a matching audio file is added
- THEN the loader produces 40 clips

### Requirement: REQ-CORPUS-3 Deterministic composite IDs

The loader MUST build each clip's id as `<relative-dataset>/<normalized-id>`. Numeric `ID_UNICO` values MUST be normalized to a canonical form (e.g. `00019`) without modifying source files. Duplicate composite IDs MUST raise a deterministic error.

#### Scenario: Repeated local IDs across datasets are distinct

- GIVEN two datasets both containing `ID_UNICO=19`
- WHEN the loader runs
- THEN the two clips have distinct composite IDs (e.g. `dataset-a/00019`, `dataset-b/00019`)

#### Scenario: Duplicate composite ID fails the loader

- GIVEN a dataset whose workbook contains two rows producing the same composite ID
- WHEN the loader runs
- THEN the loader raises a deterministic error naming both colliding rows

### Requirement: REQ-CORPUS-4 Strict one-row/one-audio mapping

Every workbook row MUST map to exactly one audio file in the sibling `NOTAS_VOZ/` folder. The loader MUST reject: missing audio, multiple extension matches, and audio files not referenced by any row.

#### Scenario: Missing audio fails the loader

- GIVEN a row whose `ID_UNICO` has no matching audio file
- WHEN the loader runs
- THEN the loader raises a deterministic error naming the missing id

#### Scenario: Multiple extension matches fail the loader

- GIVEN a row whose `ID_UNICO` matches both `00019.ogg` and `00019.webm`
- WHEN the loader runs
- THEN the loader raises a deterministic error

#### Scenario: Unlabeled audio fails the loader

- GIVEN a `NOTAS_VOZ/` containing an `.ogg` not referenced by any row
- WHEN the loader runs
- THEN the loader raises a deterministic error naming the unlabeled file

### Requirement: REQ-CORPUS-5 Correct MIME per extension

The loader MUST derive a value-side `audio/*` MIME from the file extension using a fixed table (`.ogg`, `.webm`, `.wav`, `.mp3`). Files without an `audio/*` MIME MUST be rejected.

#### Scenario: `.ogg` is sent as `audio/ogg`

- GIVEN a clip whose audio is `.ogg`
- WHEN the runner POSTs it to `/transcribe`
- THEN the multipart `Content-Type` is `audio/ogg`

#### Scenario: Non-audio file is rejected

- GIVEN a clip whose audio file has a non-`audio/*` extension
- WHEN the loader runs
- THEN the loader raises a deterministic error

### Requirement: REQ-CORPUS-6 Opaque ACERTIVIDAD and DIFICULTAD metadata

`ACERTIVIDAD` and `DIFICULTAD` MUST be passed through verbatim. The loader MUST NOT maintain a hard-coded allow-list of `ACERTIVIDAD` values. Unknown values MUST be recorded verbatim and MUST never gate submission, scoring, or filtering.

#### Scenario: Unknown ACERTIVIDAD is preserved verbatim

- GIVEN a row with `ACERTIVIDAD="nuevo-tipo"`
- WHEN the loader runs
- THEN the clip carries `acertividad="nuevo-tipo"` verbatim

### Requirement: REQ-CORPUS-7 Optional acoustic condition

An optional benchmark config MAY supply acoustic `condition` (`clean` | `noisy` | `spontaneous`) per dataset. When absent, every clip carries `condition="unknown"`. The loader MUST NEVER infer `condition` from `DIFICULTAD` or any other label.

#### Scenario: Absent condition is unknown

- GIVEN a dataset with no condition config
- WHEN the loader runs
- THEN every clip carries `condition="unknown"`

#### Scenario: Condition is never derived from DIFICULTAD

- GIVEN a row with `DIFICULTAD="DIFICIL"` and no explicit condition
- WHEN the loader runs
- THEN the clip carries `condition="unknown"` (not e.g. `noisy`)
