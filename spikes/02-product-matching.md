# Spike 02 — Product matching (Module 3)

Owner: Braejan. Decision date: 2026-07-24. Status: **decided on measured
evidence.** Experiment: `spikes/matching/`.

## Decision

**Build an in-process trigram matcher over the in-memory catalogue.** No
Postgres search, no FTS5 as the primary path, no embeddings, no second
datastore.

Pipeline: Spanish normaliser → pg_trgm-style trigram similarity over the
catalogue rows already loaded in memory → accept / disambiguate / no-match by
threshold.

This **overturns** the initial recommendation (Supabase `pg_trgm`) and also
sets aside the meeting hypothesis (SQLite FTS5). Both were beaten on measured
accuracy by something simpler.

## Measured results

624 labelled cases generated from the real catalogue: 430 colloquial variants
(accent-strip, gender flip, pluralisation, abbreviation expansion, token
reorder, single-char typo), 10 hand-picked real ambiguity clusters, 184 garbage
queries (unrelated words, items from a *different* catalogue, empty strings).
Catalogues: the 8 real stock tables, 55–345 rows each.

| Matcher | Top-1 | Recall@3 | Ambiguity recall (n=10) | False-confident on garbage | p50 / p95 |
| :--- | ---: | ---: | ---: | ---: | ---: |
| **pg_trgm `similarity` (in-process)** | **98.6 %** | **100 %** | 40 % | 2.2 % | 0.60 / 1.82 ms |
| pg_trgm `word_similarity` | 94.9 % | 99.8 % | 90 % | 9.2 % | 4.0 / 12.5 ms |
| RapidFuzz `token_set_ratio` | 93.3 % | 100 % | **100 %** | 10.9 % | 1.17 / 2.9 ms |
| RapidFuzz `WRatio` | 93.0 % | 97.2 % | 50 % | **34.8 %** | 1.56 / 4.0 ms |
| Hybrid normaliser + Jaccard | 85.8 % | 92.8 % | 60 % | 0 % | 0.24 / 0.63 ms |
| FTS5 unicode61 + bm25 | 84.7 % | 92.3 % | 40 % | 0 % | 0.10 / 0.26 ms |
| FTS5 trigram + bm25 | 80.9 % | 90.0 % | 40 % | 0 % | 0.15 / 0.41 ms |

Everything is sub-15 ms on a few hundred rows. **Latency is not a criterion
here** — accuracy and false-confidence are.

## The argument that collapsed

The first recommendation's central claim was: bm25 is unbounded and
corpus-dependent, so ambiguity thresholds need per-catalogue recalibration,
whereas `similarity()`'s bounded [0,1] score gives a portable threshold — and
therefore we must go to Postgres.

Measured coefficient of variation of the median top1−top2 margin across the 8
catalogues:

| Scorer | CV | After min-max normalising the returned candidate list |
| :--- | ---: | ---: |
| bm25 unicode61 (raw) | 0.54 | **0.10** |
| bm25 trigram (raw) | 0.33 | **0.08** |
| pg_trgm `similarity` | 0.13 | — |

Raw bm25 margins really do swing ~4.5× across catalogues. **But one line of
min-max normalisation over the scorer's own returned list fixes it — to a CV
better than pg_trgm's.** There was never a threshold-portability reason to add
a datastore. Record this so nobody re-litigates it.

Caveat, measured: normalisation fixes *relative margin* portability but is
dangerous as an *absolute* gate — on garbage queries the normalised top-1 sits
≥ 0.95 in 94–100 % of cases. Normalise for the margin, gate on the raw score.

Also measured: **every** scorer shows margins shrinking as the catalogue grows.
That is real semantic crowding — more rows, more genuine near-duplicates — not
a corpus-statistics artefact.

## Thresholds to implement

```
accept automatically   if raw similarity ≥ 0.50 AND (top1 − top2) ≥ 0.08
disambiguate (show 3–5) if similarity ≥ 0.50 AND (top1 − top2) < 0.08
no match → new-article  if similarity < 0.50
```

Both figures are stable across catalogues of 55–344 rows (CV 0.13). Re-tune
once real dictation exists.

## One unresolved tension — tune this first tomorrow

`similarity` wins top-1 (98.6 %) but flags only **40 %** of the labelled
ambiguous clusters. `token_set_ratio` flags **100 %** of them but is 5 points
worse at top-1 and leaks 5× more on garbage.

Ambiguity detection is a **product requirement**, not a nice-to-have — it is
the achiote case Daniel raised (`00:27:48`) and the reason the disambiguation
screen exists at all. So:

> **Rank with `similarity`; detect ambiguity with a second scorer.** Run
> `token_set_ratio` over the top-5 only, and flag ambiguity if *either* signal
> says the field is crowded.

Sample is small (n = 10 clusters) — this is the first thing to re-measure once
the corpus of real dictation exists.

## The Spanish normaliser is where the accuracy actually came from

The single largest measured gain of any transform was accent-stripping plus
packaging/size-token removal (`50X38CM`, `X50 UN`, `FB`). Build it first, test
it exhaustively — it is pure functions, trivially unit-testable, and it is the
part no library gives you.

Must handle: diacritics; gender agreement (`blanca` → `BLANCO`); plurals;
abbreviations (`P/PICAR` → `para picar`); embedded dimension tokens; the real
typos already in the catalogue (`TABLA PICAR AMRILLA`).

## Findings from the real data

- **Unit as a disambiguation signal: narrow, not general.** Only 2 of the 10
  real ambiguity clusters have candidates with different `unidad`; the other 8
  are unit-homogeneous, so filtering is a no-op there. Measured lift: +2.1 pp
  on FTS5, +0.7 pp on token_set, **−0.7 pp** on similarity (already near
  ceiling). Use it as a secondary re-rank, never a hard gate.
  **Critical detail: unit labels in the catalogue are English** (`Kilogram`,
  `Liter`, `Portion`) while operators speak Spanish. A naive `"litros" ==
  "Liter"` comparison matched **0 of 430** rows. An explicit synonym map is
  mandatory — this also affects Module 2's unit validation (RF-26b).

  > **Decision, 2026-07-24**: the English labels stay as they come from the
  > spreadsheet. `unidad` keeps its source values — `Kilogram`, `Liter`,
  > `Portion`, `Unidad`, and `NULL` — as the **canonical** value. No data
  > migration, no rewriting the source. The synonym map is applied at
  > comparison time only: spoken Spanish → canonical label.
  >
  > Two consequences to honour:
  > 1. The canonical set is closed and tiny (4 values + `NULL`). Treat `NULL`
  >    explicitly — it must never be silently coerced into `Unidad`.
  > 2. **Canonical value ≠ display label.** The UI is Spanish; an operator must
  >    never read "Kilogram" on screen. Keep one display map (`Kilogram` → kg,
  >    `Liter` → L, `Portion` → porción, `Unidad` → unidad) separate from the
  >    matching map. Shared with Module 2 so warnings read in Spanish too.
- **Never use stock level as a matching prior.** 5.6 % of rows carry negative
  stock, 0 % are zero. Those negative rows are exactly the anomalies the product
  exists to surface; down-weighting them as "unlikely" would hide the signal.
  If a tie-break is ever needed, use dictation recency/frequency, and only to
  order the display.
- **Cross-catalogue leakage is real and scorer-dependent**: 1.6 % for
  `similarity`, 3.1 % `word_similarity`, 4.7 % `token_set_ratio`, **43.8 % for
  `WRatio`** — which confidently matched *"SALSA DE QUESO Y AJO"* to *"ACEITE
  DE AJONJOLI"* (shared substring "AJO") at 0.855. **Do not use `WRatio`.**
- **Two-stage retrieval measurably loses**: FTS5 recall@15 → rerank scored
  87.7 % top-1 vs 94.9 % brute-force, because 7.4 % of correct answers are
  pruned at stage 1. At 55–345 rows there is nothing to prune for. Don't build it.
- **18.4 % of rows have no `nr_articulo`** — name-only matching is the primary
  path for ~1 in 5 items, and worse in some catalogues (38.6 %). Report
  benchmark accuracy **split by has-code vs no-code**, or a juror will do that
  arithmetic less charitably.

## Engram (`Gentleman-Programming/engram`, commit `763a6ba`) — what transfers

Audited the Go source directly, since this team already uses it and it solves a
structurally similar retrieval problem.

**It is lexical FTS5 + BM25. There are no embeddings.** `observations_fts` is
an external-content FTS5 table (`internal/store/store.go:731-740`) queried with
hand-weighted `bm25(observations_fts, 5.0, 1.0, 0.0, 0.0, 0.0, 3.0)` — title
weighted 5×, topic_key 3×, content 1× (`store.go:3173-3179`). The
`embedding`/`embedding_model`/`embedding_created_at` columns exist but **no code
reads or writes them** (`store.go:877-890`) — schema-reserved, unimplemented.
What Engram calls "semantic" is an optional shell-out to a `claude` CLI for
relation classification, off by default.

**Steal:** the FTS5 input sanitiser (`sanitizeFTS`, `store.go:6585-6598`, and
its OR-mode sibling `sanitizeFTSCandidates`, `relations.go:1039-1052`) — each
token individually quoted and internal quotes doubled, which neutralises FTS5's
hostile operator syntax (`*`, `AND`, `NEAR`) in ~15 lines. Also the idea of
weighting a name field far above descriptive fields.

**Do not copy:** its ambiguity mechanism. `FindCandidates` returns everything
above a **fixed absolute BM25 floor of −2.0** (`relations.go:330-335`) capped at
top-3, and treats "any candidate survived" as `judgment_required`. It never
compares top-1 to top-2. That is "surface broadly and force a decision", which
is right for memory hygiene and wrong for us — it would prompt for
disambiguation whenever recall is broad, and stay silent about *how* close the
candidates are. **The margin logic we need does not exist in Engram; we build
it.**

**Warning worth inheriting:** Engram declares no `tokenize=` clause, so its
accent folding is an accident of the compiled SQLite default. Empirically
(tested against its pinned `modernc.org/sqlite v1.45.0`) `jamon` does match
`JAMÓN` — but `achiote` does **not** match `ACHIOTES`; FTS5 has no stemmer in
any language. If we ever use FTS5, pin
`tokenize='unicode61 remove_diacritics 2'` explicitly.

## On "FTS5 es realmente búsqueda vectorial" (`01:10:22`)

Worth correcting so the build isn't misdirected: FTS5 is a lexical inverted
index ranked by BM25 — no learned embeddings, no dense vectors, no ANN. The
confusion is understandable and historically grounded: classical IR's *vector
space model* represents documents as sparse TF-IDF vectors and BM25 descends
from that lineage, so "vector" isn't invented — it is just a different, older
sense of the word. But 2026 "vector search" means dense learned embeddings
compared by cosine distance (`pgvector`, `sqlite-vec`), which is a different
retrieval paradigm. Practical consequence: FTS5 will not know that two phrases
mean the same thing unless the characters overlap.

For the record, the option we chose is lexical too. The decision is not "use
vectors instead" — it is "use the lexical scorer with the better-calibrated
margin, in-process". Embeddings were evaluated and rejected on merit:
they are *strongest* at semantic similarity, which means they blur exactly the
pairs we must keep apart (ACHIOTE vs ACHIOTE MOLIDO are semantically near
identical and operationally different).

## What the experiment could not settle

- **No live Postgres was available.** `similarity()` is an exact
  reimplementation of the documented formula (verified against `show_trgm()`
  examples); `word_similarity()` approximates the real C sliding-extent search
  with whole-word windows and may diverge on partial-word matches.
- Supabase network latency was never measured — the "no round trip" argument is
  architectural, not benchmarked.
- **Variant generation is synthetic.** It is a reasonable proxy for colloquial
  dictation, but real STT error patterns (phonetic confusions, dropped short
  words, digit misrecognition) may behave differently. Re-run this harness
  against real transcripts as soon as the audio corpus exists — the harness is
  the reusable asset here, more than the numbers.
- n = 10 ambiguity clusters. Too small to be confident about the 40 %/100 %
  split above.
- Some measured "cross-catalogue leakage" is a real data-modelling gap, not a
  matcher bug: the same physical product exists under different SKUs in
  different warehouses with no canonical cross-warehouse product ID.
