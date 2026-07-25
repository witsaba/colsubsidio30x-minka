# Handoff — from spike to implementation

Written 2026-07-24 at the close of the spike session. Read this first if you are
picking the work up cold.

## Where the work lives

| | |
| :--- | :--- |
| Branch | `spike/stt-and-match` |
| Worktree | `colsubsidio30x-minka-worktrees/spike-stt-match` |
| State | **Uncommitted.** `spikes/` is untracked; `pyproject.toml` + `uv.lock` modified (dev deps `rapidfuzz`, `unidecode`) |

**First action in the next session**: decide whether to commit this spike as a
work unit and open a PR, or carry it forward uncommitted. Nothing has been
committed, so nothing is lost if the direction changes — but nothing is
protected either.

## What is decided (do not relitigate without new evidence)

1. **STT — Deepgram Nova-3, `language=es`**, `numerals=true`,
   `mip_opt_out=true`. Fallback: Groq `whisper-large-v3-turbo`. ElevenLabs is
   out on zero-retention (Enterprise-gated). → `01-speech-to-text.md`
2. **Matching — in-process trigram matcher** over the in-memory catalogue. No
   Postgres search, no FTS5 primary, no embeddings, no second datastore.
   Thresholds: accept at `sim ≥ 0.50 AND margin ≥ 0.08`; disambiguate below the
   margin; new-article below 0.50. → `02-product-matching.md`
3. **MVP scope is es-CO only.** No multilingual mode, no code-switching, no i18n
   layer. Spanish UI, Spanish warnings.
4. **`unidad` keeps its English source values as canonical.** Two separate maps:
   matching (spoken es → canonical) and display (canonical → Spanish). `NULL` is
   a real fifth case, never coerced to `Unidad`.
5. **ITN ("novecientos" → 900) belongs to Module 2**, not to STT. Module 1
   returns what was said.

## Build order

### Module 1 — speech-to-text
1. Verify the vendor preconditions **before writing integration code**:
   `mip_opt_out=true` is accepted and does not change the billed rate; Groq's
   ZDR toggle works. If Deepgram's opt-out needs a plan we lack → switch to Groq
   immediately, do not shop for a third vendor under time pressure.
2. Thin service: audio in → `{raw_transcript, is_garbage, stt_confidence,
   audio_duration_ms, stt_vendor}` out. Freeze this contract with Daniel.
3. Push 3–5 raw MediaRecorder blobs recorded **in timeslice chunks** through the
   API early. Chunked webm often lacks a duration header and breaks server-side
   decoders — a build risk independent of vendor choice.
4. Benchmark harness scoring two things only: digit accuracy (every "said 90,
   transcribed 900") and hallucination rate on garbage clips. WER is a secondary
   sanity signal, not the metric.

### Module 3 — matching
1. **The Spanish normaliser first.** It produced the largest measured accuracy
   gain of any transform: accent strip + packaging/size-token removal
   (`50X38CM`, `X50 UN`, `FB`), gender folding (`blanca` → `BLANCO`), plurals,
   abbreviations (`P/PICAR`), plus the typos already in the catalogue
   (`TABLA PICAR AMRILLA`). Pure functions, exhaustively unit-testable, and no
   library gives you this.
2. Trigram scorer + thresholds. `spikes/matching/normalize.py` and
   `matchers.py` already contain a working implementation — promote and clean
   rather than rewrite.
3. Ambiguity detection as a **second scorer** over the top-5 (`token_set_ratio`
   flagged 100 % of labelled clusters vs 40 % for `similarity`). This is the
   first thing to tune with real dictation.
4. Unit as a secondary re-rank, never a hard gate (measured −0.7 pp when
   misapplied).

## Must run against real data before believing any number

Everything measured so far used **synthetic** colloquial variants. The harness
is the durable asset, not the percentages.

- Re-run `spikes/matching/run_eval.py` against **real STT transcripts** as soon
  as the audio corpus exists. Real ASR error patterns (phonetic confusions,
  dropped short words, digit misrecognition) may behave differently from
  generated variants.
- Re-measure ambiguity recall: n = 10 clusters is too small for the 40 %/100 %
  split to be trusted.
- Report matching accuracy **split by has-code vs no-code** — 18.4 % of rows
  have no `nr_articulo` and the ambiguity clusters live in that population.

```bash
uv run python spikes/matching/gen_eval_set.py
uv run python spikes/matching/run_eval.py
uv run python spikes/matching/threshold_experiment.py
uv run python spikes/matching/extra_experiments.py
```

## Blockers that are not Braejan's to fix alone

1. **RF-11 is not implementable with the current data.** 8 category-level stock
   tables + a flat list of 48 warehouse names, **no join key**. "Select a
   warehouse → its catalogue loads" cannot be built. Needs a product decision:
   scope the demo to one stock table and rename the step "select audit
   category". → `03-integration-risks.md`
2. **The benchmark corpus is unowned**, and the plan (family reads a script,
   same person labels it) is self-grading. Assign an owner; split recording from
   labelling.
3. **The Module 1 → Module 2 contract** is undefined. Freeze it at the 06:00
   sync — it is the seam most likely to break during Saturday integration.
4. **The consensus math ("three models ≈ 99.9 %") does not hold as stated** —
   three LLMs on the same transcript and prompt do not fail independently.
   Replace with the measured agreement rate.

## Still unverified

- Whether `mip_opt_out=true` changes Deepgram's billed rate.
- Voxtral Transcribe 2's retention terms and Spanish numeral handling — it was
  deprioritised for lack of due diligence, not because it is new (that reason
  was wrong: it shipped 2026-02-04).
- Gemini audio-native numeric accuracy in Spanish.
- `word_similarity()` in the spike is a whole-word approximation of Postgres'
  sliding-extent C implementation; `similarity()` is exact.
- No live Postgres or Supabase latency was ever measured.
