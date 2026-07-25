# Benchmark corpus

Audio clips plus `labels.csv`. The runner processes whatever clips exist — there
is no minimum or hard-coded corpus size (REQ-BMK-1), so the corpus can grow one
clip at a time.

Audio files are **not** committed. Keep them out of git the same way `.env` is:
they are recordings of real people, and Ley 1581 applies to them too.

## Adding a clip

1. Drop the audio next to this file, named `<clip_id>.<ext>` (`webm`, `ogg`,
   `wav`, …). The runner finds it by `clip_id`, whatever the extension.
2. Append one row to `labels.csv`.
3. Re-run the harness — nothing else needs updating.

## `labels.csv` columns

| Column | Meaning |
|---|---|
| `clip_id` | Unique id; also the audio filename stem |
| `condition` | `clean` \| `noisy` \| `spontaneous` — the report splits every metric by this (REQ-BMK-6) |
| `transcript` | Reference transcript, verbatim, in es-CO. Empty for garbage clips |
| `items` | JSON array of the expected quantity tokens as strings, e.g. `["3","12"]` |
| `is_garbage` | `true` when the clip contains no inventory speech (silence, noise, filler) |

`garbage` is **not** a condition. A garbage clip carries a real condition
*plus* `is_garbage=true`, so the hallucination rate can also be read per
condition.

Example rows:

```csv
clip_id,condition,transcript,items,is_garbage
clean-01,clean,tres kilos de lechuga,"[""3""]",false
noisy-01,noisy,noventa canastas de mango,"[""90""]",false
garbage-01,noisy,,[],true
```

Note the CSV quoting: the `items` JSON is wrapped in double quotes and its own
quotes are doubled.

## Coverage worth aiming for

- Enough `clean` / `noisy` / `spontaneous` clips that each row of the report
  means something on its own.
- Quantities that expose near-misses (`90` vs `900`), which is the failure the
  digit-accuracy metric exists to catch.
- Every garbage clip you can record: silence, warehouse noise, and pure filler
  speech. The hallucination rate runs over **all** of them, never a sample
  (REQ-BMK-4).
- At least one clip recorded as chunked `MediaRecorder` timeslice blobs, which
  usually carry no duration header — that is the `audio_duration_ms: null` path.
