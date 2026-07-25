# STT benchmark harness

This is the evidence behind the accuracy claim. It is not an afterthought — the
pitch rests on the numbers this harness produces, so it has to be reproducible
by anyone with the corpus.

It runs inside the STT service's uv environment (httpx and pytest are already
there), so there is no third lockfile to keep in sync.

## Commands

```bash
# tests
uv run --project services/stt pytest benchmarks/tests

# validate the corpus without calling the service
uv run --project services/stt python benchmarks/run.py --dry-run

# run against a live service
BENCH_STT_URL=http://localhost:8001 \
  uv run --project services/stt python benchmarks/run.py

# render the table
uv run --project services/stt python benchmarks/report.py benchmarks/results.json
```

`run.py` flags: `--corpus`, `--output`, `--concurrency` (default 4),
`--base-url` (defaults to `$BENCH_STT_URL`), `--dry-run`.

## Corpus

Format and how to add clips: [`corpus/README.md`](corpus/README.md). The runner
works on whatever clips exist — there is no minimum corpus size, so the harness
is useful from the third clip onward.

## What is measured

1. **Digit accuracy** — every labelled quantity token, exact match. "Said 90,
   transcribed 900" is a discrete failure, not a fractional penalty. This is the
   primary claim.
2. **Hallucination rate on garbage clips** — the share of clips labelled
   `is_garbage` that produced inventory-shaped output. Computed over **all**
   garbage clips, never a sample.
3. **WER** — token-level Levenshtein, secondary sanity signal only. It must not
   be quoted as the headline number.

Every metric is also split by clip condition (`clean` / `noisy` /
`spontaneous`); one blended number hides the case that matters.

## How a hallucination is detected

A garbage clip counts as hallucinated when its transcript matches
QUANTITY-NEAR-ITEM: after normalisation (lowercase, unaccent, strip
punctuation), a quantity token — a number or a Spanish number word — is followed
within two tokens by an alphabetic token of length ≥ 3 that is not a filler
(`eh`, `este`, `pues`, `bueno`, …).

This is deliberate, not a proxy for "produced any text". A bare filler
transcript ("eh… este…") is a *correct* low-content transcription of a noisy
clip, not an invented inventory line; counting it would inflate the number we
are claiming to be low.

**Accepted false negative**: an item invented without any quantity token is not
counted. `report.py` prints this caveat with every table.

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
