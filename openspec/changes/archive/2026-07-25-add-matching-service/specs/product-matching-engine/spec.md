# product-matching-engine Specification

> rev 4 (2026-07-25): Judgment Day round-1 hardening (JD-1..JD-4, JD-U) — see judgment-day-ledger.md

## Purpose

Defines the matching core promoted from `spikes/matching/`: Spanish normalization, pg_trgm-faithful trigram ranking, the three-way `matched`/`ambiguous`/`no_match` decision layer, and unit synonym/display maps. A confident wrong match is worse than `no_match`; every threshold decision is biased toward that asymmetry.

## Requirements

### Requirement: Spanish normalization pipeline (REQ-ENG-1)

The engine SHALL ship the promoted normalization helpers as individually unit-testable pure functions with characterization tests: diacritic stripping, packaging/size token stripping (`50X38CM`, `X50 UN`, `FB`, `X 300 GR`), gender folding (`BLANCO` → `blanca`, masculine → feminine, lower-cased), plural folding, abbreviation expansion (`P/PICAR` → `PARAPICAR`, no space), and tolerance of catalogue typos (`TABLA PICAR AMRILLA`). These helpers are utilities, not a ranking-time transform: accent stripping is used inside the rapidfuzz `token_set_ratio` processor; the remaining helpers are reserved for future measured changes and MUST NOT be wired into the ranking path without a new measured decision (see REQ-ENG-2). Accent stripping SHALL use stdlib `unicodedata`; the `unidecode` package MUST NOT be a dependency.

#### Scenario: Each helper is testable in isolation

- GIVEN the input `TABLA P/PICAR BLANCA X 300 GR`
- WHEN `normalize_for_match` runs
- THEN the result is accent-stripped, upper-cased, packaging-stripped, and punctuation-collapsed — `TABLA P PICAR BLANCA` — with no abbreviation expansion and no gender or plural folding
- AND each helper has its own passing unit test

### Requirement: Trigram ranking (REQ-ENG-2)

The engine SHALL rank candidates with the promoted pg_trgm-faithful `similarity` scorer over raw catalogue `articulo` text, relying on pg_trgm's internal lower-casing and word-splitting — the spike's measured 98.6% configuration, confirmed by A/B measurement (normalized ranking measured worse and collapses 50 SKU rows into identical strings) — returning up to `MATCH_MAX_CANDIDATES` candidates with scores and the margin between top-1 and top-2. The acceptance gate SHALL apply to the raw `similarity` score. The engine MUST NOT use `WRatio`, MUST NOT use stock level (`sd`) as a matching prior, and MUST NOT use two-stage retrieval. The trigram extraction cache SHALL be bounded (`lru_cache(maxsize=4096)`): `trigrams()` is called with untrusted per-request `spoken_name` text, so an unbounded cache would pin every string a caller ever sent and grow the resident set until the process is OOM-killed; 4096 keeps the ~1405 hot catalogue `articulo` strings resident with headroom.

#### Scenario: Ranked candidates with margin

- GIVEN a catalogue of rows and the query `achiote molido`
- WHEN ranking runs
- THEN at most `MATCH_MAX_CANDIDATES` candidates are returned, ordered by `similarity` descending, with `top_score` and `margin` computed

#### Scenario: Trigram cache is bounded

- GIVEN more than 4096 distinct untrusted query strings scored across requests
- WHEN `trigrams` caches their trigram sets
- THEN the cache holds at most 4096 entries and process memory does not grow unboundedly

### Requirement: Three-way decision layer (REQ-ENG-3)

A pure decision function over the ranked candidates SHALL emit exactly one status: `matched` when `top_score ≥ MATCH_ACCEPT_SCORE` and neither ambiguity signal fires; `ambiguous` when `top_score ≥ MATCH_ACCEPT_SCORE` and either `margin < MATCH_AMBIGUITY_MARGIN` or the crowding check fires; `no_match` when `top_score < MATCH_ACCEPT_SCORE`. The crowding check SHALL compute `token_set_ratio` over the top-5 candidates and fire when the margin between the two highest `token_set_ratio` scores satisfies `(tsr_1 − tsr_2) < MATCH_TSR_MARGIN`. `MATCH_TSR_MARGIN` SHALL be an independent threshold and MUST NOT be folded into `MATCH_AMBIGUITY_MARGIN`.

#### Scenario: Clear winner is matched

- GIVEN `top_score = 0.87` and `margin = 0.21` and no crowding
- WHEN the decision runs with defaults
- THEN status is `matched`

#### Scenario: Crowded field is ambiguous even with a wide margin

- GIVEN `top_score ≥ 0.50`, `margin ≥ 0.08`, and the two highest `token_set_ratio` scores over the top-5 satisfy `(tsr_1 − tsr_2) < 0.08` (default `MATCH_TSR_MARGIN`)
- WHEN the decision runs
- THEN status is `ambiguous`

#### Scenario: Uncrowded field stays matched

- GIVEN `top_score ≥ 0.50`, `margin ≥ 0.08`, and `(tsr_1 − tsr_2) ≥ MATCH_TSR_MARGIN` over the top-5
- WHEN the decision runs
- THEN status is `matched`

#### Scenario: Low score is no_match

- GIVEN `top_score = 0.31`
- WHEN the decision runs with defaults
- THEN status is `no_match` and no SKU is asserted

### Requirement: Env-configurable thresholds (REQ-ENG-4)

Thresholds SHALL be read from environment configuration with defaults `MATCH_ACCEPT_SCORE=0.50`, `MATCH_AMBIGUITY_MARGIN=0.08`, `MATCH_TSR_MARGIN=0.08`, `MATCH_MAX_CANDIDATES=5`, `MATCH_UNIT_RERANK=true`; changing them MUST NOT require a rebuild. `MATCH_TSR_MARGIN` is an independent knob (default derived by symmetry, flagged for re-measurement on real dictation).

#### Scenario: Threshold change flips the decision

- GIVEN a case decided `matched` with defaults at `top_score = 0.55`
- WHEN the engine is restarted with `MATCH_ACCEPT_SCORE=0.60` and the same input
- THEN status is `no_match` without any code or image change

### Requirement: Unit maps and unit re-rank (REQ-ENG-5)

The engine SHALL keep two separate maps: a matching map (spoken Spanish → canonical, e.g. `"litros"` → `Liter`) and a display map (canonical → Spanish, e.g. `Kilogram` → `kg`). When `MATCH_UNIT_RERANK` is true and the request carries a unit, unit agreement SHALL act only as a secondary re-rank among candidates — never a hard gate that excludes candidates. A `NULL` `unidad` MUST never be coerced to `Unidad` or any other value.

#### Scenario: Unit re-ranks but never excludes

- GIVEN two candidates above the accept score whose units differ and a request unit of `litros`
- WHEN `MATCH_UNIT_RERANK=true`
- THEN the `Liter` candidate MAY be re-ranked upward
- AND no candidate is removed because of unit mismatch

#### Scenario: NULL unit survives

- GIVEN a candidate row whose `unidad` is SQL NULL
- WHEN it appears in results
- THEN its unit is reported as null, not `Unidad`

### Requirement: Eval reproduces spike accuracy (REQ-ENG-6)

An in-process eval over the 624-case `spikes/matching/eval_set.json` driving the engine's own ranking function SHALL reproduce the spike numbers — 98.6% top-1 and 100% recall@3 overall — and SHALL report accuracy split by has-code (target row has `nr_articulo`) vs no-code (`nr_articulo` NULL) populations.

#### Scenario: Regression gate

- GIVEN the 624-case eval set and the real catalogue
- WHEN the eval test runs via `uv run pytest`
- THEN overall top-1 accuracy is ≥ 98.6% and recall@3 is 100%
- AND the report states both metrics separately for has-code and no-code cases
