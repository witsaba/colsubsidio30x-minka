# stt-benchmark Specification

## Purpose

Benchmark harness that produces the measurable evidence behind the accuracy claims: corpus format, concurrent runner, and a metrics report split by clip condition.

## Requirements

### Requirement: REQ-BMK-1 Corpus format

The corpus SHALL live in `benchmarks/corpus/` as audio clips plus a `labels.csv` with at least: `clip_id`, reference `transcript`, expected `items`, `is_garbage` flag, and clip `condition` (`clean` | `noisy` | `spontaneous`). The harness MUST run on whatever clips exist — no hard-coded corpus size.

#### Scenario: Harness accepts a partial corpus

- GIVEN a corpus containing only three labeled clips
- WHEN the runner executes
- THEN all three clips are processed and no error is raised about corpus size

### Requirement: REQ-BMK-2 Concurrent runner writes results.json

`benchmarks/run.py` SHALL send corpus clips to the running STT service concurrently and SHALL write one `results.json` containing, per clip, the service response and the clip's labels.

#### Scenario: Runner produces results for every clip

- GIVEN a corpus of labeled clips and a reachable STT service (mocked or live)
- WHEN `run.py` executes
- THEN `results.json` contains one entry per corpus clip, each pairing labels with the frozen response fields

### Requirement: REQ-BMK-3 Digit accuracy metric

The report SHALL score digit accuracy as exact match per quantity token against the labeled items. A near-miss (e.g. said `90`, transcribed `900`) MUST count as a full failure for that token, not a fractional penalty.

#### Scenario: Near-miss digit counts as failure

- GIVEN a clip labeled with quantity token `90` and a result transcribing `900`
- WHEN the report computes digit accuracy
- THEN that token scores as incorrect

### Requirement: REQ-BMK-4 Hallucination rate over all garbage clips

The report SHALL compute the garbage-clip hallucination rate — any inventory-shaped output from a clip labeled `is_garbage` — over ALL garbage clips in the corpus, never a sample.

#### Scenario: Every garbage clip is scored

- GIVEN a corpus with N clips labeled `is_garbage: true`
- WHEN the report computes the hallucination rate
- THEN its denominator is exactly N

### Requirement: REQ-BMK-5 WER as secondary metric

The report SHALL include Word Error Rate as a secondary sanity signal, and MUST NOT present WER as the primary accuracy claim.

#### Scenario: WER present but secondary

- GIVEN a completed `results.json`
- WHEN the report renders
- THEN WER appears alongside — not in place of — digit accuracy and hallucination rate

### Requirement: REQ-BMK-6 Report split by clip condition

`benchmarks/report.py` SHALL render a metrics table from `results.json` split by clip condition (`clean` / `noisy` / `spontaneous`), in addition to any overall totals.

#### Scenario: Metrics reported per condition

- GIVEN results covering clips of all three conditions
- WHEN `report.py` renders the table
- THEN digit accuracy and hallucination metrics are shown per condition, not only as one blended number
