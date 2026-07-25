# Stack — Module 3: Product matching service

Scope: **backend only**. The second module Braejan committed to (`01:10:22`).
Independent service, own stack, own `docker-compose`. Shares nothing with
Module 1 — they are deployed and versioned separately.

Read `02-product-matching.md` for the measured evidence behind these choices.
This document is the build spec.

## Stack

| Concern | Choice | Rationale |
| :--- | :--- | :--- |
| Runtime | Python 3.11+, managed by **`uv`** | Repository convention; the measured spike code is already Python |
| API framework | **FastAPI** + **uvicorn** | Same shape as Module 1 — one framework across both services the same person maintains |
| Matching | **rapidfuzz** + **unidecode** | Already in `uv.lock` from the spike. `rapidfuzz` is C++-backed; the trigram scorer is our own code |
| Catalogue source | **SQLite** (`data/bodegas-y-stock.sqlite`), read-only, loaded into memory at startup | The artefact already exists and is reproducible from the spreadsheet. Supabase becomes the source later without touching the matcher |
| Tests | **pytest** + the spike's labelled eval set | 624 cases already generated; the harness is the durable asset |
| Container | `python:3.12-slim`, `uv sync --frozen` | Same as Module 1 |

**Deliberately absent**: no Postgres search, no FTS5, no embeddings, no vector
store, no second datastore, no cache layer. Each catalogue is 56–345 rows and
the matcher measured p95 = 1.8 ms in process. There is nothing to optimise and
nothing to synchronise.

## Service contract

```
POST /match             {"spoken_name": "...", "catalogue_id": "...", "unit": "..."}
GET  /catalogues        list of loadable catalogue ids + row counts
GET  /health
```

Response:

```json
{
  "status": "matched",
  "candidates": [
    {"nr_articulo": "7003", "articulo": "ACHIOTE MOLIDO",
     "unidad": "Kilogram", "score": 0.87}
  ],
  "top_score": 0.87,
  "margin": 0.21,
  "request_id": "uuid"
}
```

`status` is one of three, and the caller must handle all three:

| status | Condition | What the app does |
| :--- | :--- | :--- |
| `matched` | `top_score ≥ 0.50` **and** `margin ≥ 0.08` | Record the SKU |
| `ambiguous` | `top_score ≥ 0.50` **and** `margin < 0.08` | Show 3–5 candidates, operator picks |
| `no_match` | `top_score < 0.50` | New / unmapped article flow |

**A confident wrong match is far worse than a `no_match`.** When tuning, bias
every threshold decision toward that asymmetry.

## Configuration

```
CATALOGUE_DB=/data/bodegas-y-stock.sqlite
MATCH_ACCEPT_SCORE=0.50
MATCH_AMBIGUITY_MARGIN=0.08
MATCH_MAX_CANDIDATES=5
MATCH_UNIT_RERANK=true
```

Thresholds are env vars, not constants. They were measured on **synthetic**
colloquial variants and will move once real transcripts exist — that re-tuning
must not require a rebuild.

## docker-compose

`services/matcher/docker-compose.yml`:

```yaml
services:
  matcher:
    build: .
    ports:
      - "8002:8002"
    volumes:
      - ../../data:/data:ro          # catalogue is read-only, always
    environment:
      CATALOGUE_DB: /data/bodegas-y-stock.sqlite
      MATCH_ACCEPT_SCORE: "0.50"
      MATCH_AMBIGUITY_MARGIN: "0.08"
      MATCH_MAX_CANDIDATES: "5"
      MATCH_UNIT_RERANK: "true"
    healthcheck:
      test: ["CMD", "python", "-c",
             "import urllib.request;urllib.request.urlopen('http://localhost:8002/health')"]
      interval: 10s
      timeout: 3s
      retries: 3
    restart: unless-stopped
```

The `:ro` mount is deliberate. The catalogue is an input; nothing in this
service may write to it.

`Dockerfile` is identical in shape to Module 1's, with port 8002 and
`src.main:app`.

## Build order — the normaliser first

The single largest measured accuracy gain of any transform was **not** the
scorer. It was normalisation. Build it first, as pure functions, tested
exhaustively:

1. Strip diacritics.
2. Strip packaging and size tokens: `50X38CM`, `X50 UN`, `FB`, `X 300 GR`.
3. Fold gender: `blanca` → `BLANCO`. Colours appear constantly in this
   catalogue and this is a guaranteed miss class without it.
4. Fold plurals.
5. Expand abbreviations: `P/PICAR` → `para picar`.
6. Survive the typos already in the data: `TABLA PICAR AMRILLA`.

Then the trigram scorer, then the thresholds. `spikes/matching/normalize.py`
and `matchers.py` already contain working implementations — **promote and
clean them, do not rewrite**.

## Ambiguity detection needs a second scorer

Measured: the ranking scorer wins top-1 (98.6 %) but flags only **40 %** of
labelled ambiguous clusters. `token_set_ratio` flags **100 %** but is five
points worse at top-1.

> Rank with trigram `similarity`. Detect ambiguity by running
> `token_set_ratio` over the top-5 only, and flag when *either* signal says the
> field is crowded.

Sample was n = 10 clusters. This is the first thing to re-measure against real
dictation.

## Units

`unidad` keeps the English source values as canonical — `Kilogram`, `Liter`,
`Portion`, `Unidad`, `NULL`. Two **separate** maps:

- **matching**: spoken Spanish → canonical (`"litros"` → `Liter`). A naive
  string comparison matched 0 of 430 rows; this map is mandatory.
- **display**: canonical → Spanish (`Kilogram` → kg). The UI is Spanish; an
  operator must never read "Kilogram". Share this map with Module 2 so unit
  warnings (RF-26b) read in Spanish.

`NULL` is a real fifth case. Never coerce it to `Unidad` — that turns missing
data into a false assertion in the exact field that triggers warnings.

## Hard rules from the measurements

- **Never use `WRatio`.** 43.8 % cross-catalogue leakage measured; it matched
  *"SALSA DE QUESO Y AJO"* to *"ACEITE DE AJONJOLI"* at 0.855 on the shared
  substring "AJO".
- **Never use stock level as a matching prior.** 5.6 % of rows carry negative
  stock and those are precisely the anomalies the product exists to surface.
  Down-weighting them would hide the signal.
- **No two-stage retrieval.** Measured 87.7 % vs 94.9 % — at 300 rows there is
  nothing to prune and stage 1 discards correct answers.
- Unit is a **secondary re-rank, never a hard gate** (−0.7 pp when misapplied).

## Known upstream blocker

`RF-11` — "the plan determines the warehouse **and its catalogue**" — is not
implementable: 8 category-level stock tables and a flat list of 48 warehouse
names with no join key. `catalogue_id` in this service's contract therefore
refers to a **stock table**, not a warehouse. Product decision pending; see
`03-integration-risks.md`.

## Working agreement

**Strict TDD is enabled**: failing test first. The 624-case eval set from
`spikes/matching/eval_set.json` is the acceptance layer; each normalisation
rule additionally needs its own unit test, because that is where the accuracy
actually comes from.

## Definition of done

- [ ] `docker compose up` yields a healthy service matching against a real
      catalogue.
- [ ] All three `status` values reachable and covered by tests.
- [ ] Normalisation rules unit-tested individually.
- [ ] `spikes/matching/run_eval.py` runs against the **service** and reproduces
      the spike numbers.
- [ ] Accuracy reported **split by has-code vs no-code** — 18.4 % of rows lack
      `nr_articulo` and the ambiguity clusters live in that population.
- [ ] Thresholds configurable without a rebuild.
