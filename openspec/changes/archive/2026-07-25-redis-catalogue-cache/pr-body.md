# feat(matcher)!: read the catalogue from Supabase, cache it in Redis, delete SQLite

> **`size:exception` accepted by the user up front.** The forecast was ~1,300-1,600 authored
> lines against a 400-line review budget; measured, the change is 48 files, +7,541/-2,423
> (goldens and `uv.lock` included). The 3-PR chain (Supabase source / Redis cache / deployment)
> was offered and **explicitly rejected**: a Supabase source alone leaves the matcher with no
> working catalogue, so the slices are not independently deployable. One PR is the deliberate
> choice, not an oversight. See the reading order at the bottom.

---

## BREAKING — two of them

### 1. `catalogue_id` is now a warehouse code, not a SQLite table name

`POST /match` and `GET /catalogues` used to speak the 8 SQLite table names
(`stock_almacen_ayb`, …). They now speak `warehouses.code` from Supabase
(`STOCK_ALMACEN_AYB`, …).

| Old `catalogue_id` | New `catalogue_id` | Rows |
|---|---|---|
| `stock_almacen_ayb` | `STOCK_ALMACEN_AYB` | 270 |
| `stock_almacen_suministros` | `STOCK_ALMACEN_SUMINISTROS` | 296 |
| `stock_kiosco_piscigiros_ayb` | `STOCK_KIOSCO_PISCIGIROS_AYB` | 56 |
| `stock_kiosco_taquilla_ayb` | `STOCK_KIOSCO_TAQUILLA_AYB` | 58 |
| `stock_restaurante_fuentes_ayb` | `STOCK_RESTAURANTE_FUENTES_AYB` | 344 |
| `stock_restaurante_fuentes_sumin` | `STOCK_RESTAURANTE_FUENTES_SUMIN` | 133 |
| `zoologico` | `ZOOLOGICO` | 55 |
| `zoologico_suministros` | **`ZOOLOGICO_SUMINISTROS_2`** | 193 |

Note the last row: it is **not** a plain `upper()`. The Supabase code carries a `_2` suffix from
a load-time code collision. A naive uppercase mapping silently loses 193 rows.

**The frontend migration ships inside this PR.** The original plan was to coordinate with the
then-unmerged `feat/voice-counter-frontend` branch so it would adopt the new ids before merging.
That branch merged first (PR #13), carrying the legacy vocabulary onto `main`: `catalogues.ts`
hardcoded all 8 SQLite table names and `DEMO_CATALOGUE_ID = 'stock_restaurante_fuentes_ayb'`.
The mitigation therefore expired rather than failed — it was a deadline, not a plan.

`sdd-verify` caught it, and WU-12 closed it here: this PR merges `origin/main` and migrates the
frontend to the warehouse codes in the same breath, so **no consumer is left speaking the retired
vocabulary at any commit on `main`**. `frontend/tests/catalogues/catalogues.test.ts` now pins the
exact 8 ids and separately rejects every retired SQLite name, so the mapping cannot silently
regress. An unknown `catalogue_id` is still an HTTP 4xx and never a `no_match`, so any consumer
outside this repository fails loudly rather than quietly mismatching.

### 2. `unidad_display` is non-null again on `/match` responses

The cutover accidentally nulled it; the last-but-one commit restored it (see "A bug this change
introduced and fixed before merge"). If any consumer started coding around
`unidad_display == null` during the life of this branch, it needs to know the field is populated
again. Values are unchanged from before the cutover: `kg`, `lt`, `und`, `porcion es`.

---

## What changed and why

Supabase is now the catalogue **source of truth**. The matcher reads
`warehouse_products` joined to `products`/`warehouses` over PostgREST (plain `httpx`, no SDK),
holds the result in memory, and stores a versioned snapshot in Redis on a 3 h TTL. The SQLite
catalogue is gone from the matcher runtime: no `CATALOGUE_DB`, no `./data:/data:ro` mount, no
`sqlite3` import.

The requirement this change exists to satisfy is a **warm process start that performs zero
Supabase calls**. It is asserted directly, not inferred:

```
test_load_index.py::TestWarmStart::test_a_fresh_snapshot_performs_zero_supabase_calls
    source.calls == 0
    source.queried_tables == set()
```

Verified by mutation: disabling the fresh-snapshot branch turns 5 tests red, that one with
`assert 1 == 0`.

Around it:

- **Fallback chain** (fresh snapshot → Supabase → stale snapshot + WARNING → abort). Startup
  never serves an empty catalogue.
- **Background refresh** on the TTL with ±10% jitter, a `SET NX PX` stampede lock, and an
  **atomic swap** — a concurrent `/match` never observes a half-built index. That is pinned by a
  real 8-thread race test, not a shape assertion.
- **Zero per-request I/O** stays true: `test_match_performs_no_redis_or_supabase_call` records
  both counters after startup and re-checks them after 20 `POST /match`.
- **Redis is a soft dependency.** No `depends_on` in either direction. The matcher boots without
  Redis by reading Supabase, and if Redis dies afterwards `/match` keeps serving from the
  last-good in-process index. Losing Redis costs one Supabase read per boot and nothing else.

---

## Corrections to the original plan that reviewers should know about

**It is 8 warehouse codes, not 56.** The proposal, spec and design were all written around
"8 SQLite tables → 56 warehouses" as a cardinality break. Live inspection killed that:
`warehouses` has 56 rows, but only **8** carry any `warehouse_products`, and those 8 map 1:1 onto
the old SQLite tables (upper-cased, plus the `ZOOLOGICO_SUMINISTROS_2` special case). The change
is a *rename*, not a fan-out. Commit `91ef3a0` corrects the planning artifacts in place.

**REQ-CSS-4 no longer claims a least-privilege credential, because there isn't one.** The design
offered "the `anon` key is acceptable if RLS provably denies `warehouse_stock_balances`". That
fallback does not exist: the `anon` role holds **no `GRANT` on any catalogue table**, so PostgREST
answers `401` / `42501` (*"Grant the required privileges to the current role…"*) on all five
tables — it reads nothing, not merely less. Every read policy targets the `authenticated` role,
and `warehouse_products_read` additionally requires `private.is_staff()`.

The user chose the **`service_role` key**. That key **bypasses RLS entirely**, so the matcher
*could* read `warehouse_stock_balances` (the RF-18 protected `theoretical_qty`). The
least-privilege claim is therefore withdrawn rather than quietly restated, and the spec wording
moved from *"the credential cannot read the table"* to *"the service never queries the table, and
the snapshot never carries its data"*. Isolation is now enforced by the service and its tests —
see the security section below.

**The 1,405-vs-1,461 row gap was not data loss.** Supabase returns 1,405 rows where the SQLite
file held 1,461, which looked like dedup dropping 56 products, and WU-6 was planned around
dropping unmappable eval cases. Measured: the retired SQLite file holds the *same* 1,405 product
rows plus 8 spreadsheet header rows (`articulo IS NULL`) that the loader always discarded and
which are never gold. **Zero eval cases were dropped**; all 430 variants remapped (345 by
`nr_articulo`, 85 by exact `articulo`). The drop-and-report machinery in
`scripts/remap_eval_set.py` was kept anyway, so a future export that really does lose rows fails
loudly instead of silently.

---

## A bug this change introduced and fixed before merge

Swapping the source silently changed the **vocabulary** of a string column, not just the row
identities. `Row.unidad` came from the workbook labels under SQLite (`Kilogram`, `Liter`,
`Unidad`, `Portion` — Supabase keeps those in `units.source_label`), but
`warehouse_products.unit_code` carries **codes** (`KG`, `LT`, `UND`, `POR`, `CAJA`).
`matcher/units.py` still spoke labels, so:

- `UNIT_DISPLAY.get("KG")` was `None` → **`unidad_display` was `null` on every `/match` response**
  (a live REQ-ENG-5 defect on the shipped API surface); and
- `_unit_rerank`'s `c.unidad == canonical` could never be true → **`MATCH_UNIT_RERANK` was inert**
  while the setting still read `true`.

Fixed in `d908946` by rekeying both maps to the codes — a pure restoration, every synonym set and
display string preserved verbatim.

**Why the eval baseline could not catch it**: `resolve_unit("Kilogram")` already returned `None`,
so the re-rank was inert on *both* sides of the measurement. The accuracy number was identical
whether the feature worked or not. Worse, the test fixtures (`conftest.FIXTURE_CATALOGUE`,
`test_decision.py`, `test_units.py`, `test_http.py`) all asserted the workbook labels too, so the
entire suite agreed with the broken map. Two anti-drift guards were added
(`test_neither_map_is_keyed_on_a_retired_workbook_label`, and a companion pinning that a
retired-label row is now correctly *inert*).

Deliberately **not** decided here: Supabase carries a distinct `CAJA` unit code the workbook never
had. Whether a spoken "caja" should resolve to `CAJA` rather than `UND` — and how RF-15 resolves a
dictated box to a stocked unit — is a domain question, recorded in `units.py` and listed as a
follow-up. `caja`/`cajas` still resolves to `UND`, exactly as before.

---

## Accuracy — the honest three-way table

| Metric | Old SQLite (2026-07-24) | Post-remap (WU-6) | Post-tie-break (WU-11, shipped) |
|---|---|---|---|
| overall top-1 (n=430) | 424/430 = **0.98605** | 423/430 = 0.98372 | 423/430 = **0.98372** |
| `has_code` top-1 (n=345) | 340/345 = 0.98551 | 344/345 = 0.99710 | 344/345 = **0.99710** |
| `no_code` top-1 (n=85) | 84/85 = **0.98824** | 79/85 = 0.92941 | 79/85 = **0.92941** |
| recall@3, every cohort | 1.0000 | 1.0000 | **1.0000** |
| garbage false-confidence (n=184) | 1/184 = 0.00543 | 1/184 = 0.00543 | 1/184 = **0.00543** |

**The movement is a tie-cluster artefact of row order.** Replaying the same suite against rows
read straight out of the retired SQLite file reproduces 424/430 = 0.98605 *exactly*, so the
engine did not change and the two catalogues hold identical rows — only the row **order** did
(`rowid` → `warehouse_products.id` UUID). Six of the seven misses are exact score ties where
rank 1 was decided by catalogue order alone; the losing tie-cluster moved out of `has_code` and
into `no_code`.

**WU-11 made ranking order-independent — and did not recover the `no_code` cohort.** `rank()` now
sorts by `(-score, uid)`, consulting `uid` only between exactly-equal scores; the scoring function
is untouched. Column 3 is byte-identical to column 2 because the snapshot already arrives sorted
by `warehouse_products.id`, so an ascending-`uid` tie-break re-elects the same winners the UUID
order already elected. **No baseline constant changed value** — only its provenance note was
rewritten. Nothing was tuned to make a number look better.

The win is real and measured even though the figures did not move.
`TestMeasurementIsOrderIndependent::test_a_shuffled_catalogue_reports_the_same_accuracy` replays
all 624 cases over a shuffled catalogue. **Mutation-verified**: reverting `rank()` to the plain
score sort makes that shuffle report **428/430 = 0.99535** instead of 0.98372 — before this
commit, row order alone was worth about a full accuracy point in either direction. That
non-determinism is the defect being closed, not the accuracy figure.

**`recall@3` is unchanged at 1.0000 because gold stays inside the top 3 in every single miss** — rank 2 in six of the seven, rank 3 in the four-way `kyocera toner tk 538ic` colour tie (the per-case profile is tabulated in `test_eval_accuracy.py`). A
tie-break buys determinism, not correctness. Picking the *right* member of a tie cluster — names
differing only by a gram weight the trigram metric cannot see — is a scoring problem and is out of
scope. It is listed as a follow-up.

---

## Security: what is verified, and what is not

`SUPABASE_KEY` is the `service_role` key. It carries **full database access and bypasses RLS**.
Never log it, never commit it, never paste it into an issue or a PR.

**Enforced in CI, offline:**

- `test_supabase_source.py::TestQueryShape::test_it_never_queries_warehouse_stock_balances` — the
  client provably never *constructs* a query whose path or query string mentions
  `warehouse_stock_balances`, `theoretical_qty`, or `stock`. Only `warehouse_products` is ever
  requested.
- `test_supabase_source.py::TestQueryShape::test_it_queries_only_the_warehouse_products_endpoint`.
- `test_snapshot_codec.py::TestSnapshotContentSafety::test_the_encoded_bytes_name_no_stock_field`
  plus `test_eval_fixture.py::test_it_names_no_stock_field` — no stock field can enter Redis, and
  the checked-in 1,405-row fixture provably carries none.
- `test_supabase_source.py::test_the_error_message_never_leaks_the_credential` — the key is in
  every request header, so an exception message is the natural leak path. It is closed.
- `SUPABASE_KEY` ships blank in `.env.example`; its `_KEY` suffix puts it under the existing
  secret convention, so `setup-env.sh` masks it with zero changes to that script.

**Not verified, and honestly so (task 9.3):** REQ-CSS-4's original second scenario — *"the
matcher's credential cannot read `warehouse_stock_balances`"* — **cannot be run and is now moot**.
It was written for a least-privilege key. No `service_role` key is provisioned in this local
environment, and `service_role` bypasses RLS by definition, so the intended
`curl … /warehouse_stock_balances` → `401/403` evidence would fail by design rather than pass. The
credential-denial control does not exist; the service-level controls above are the only controls,
which is precisely why they are tested rather than asserted in prose. Restoring a genuine
credential-level denial requires the scoped catalogue-reader role listed as a follow-up.

---

## Test state

```
uv run pytest        →   1 failed, 542 passed, 1 skipped
npm test (frontend)  →   667 passed
```

Baseline on `origin/main` @ `d60e934` was **4 failed, 368 passed**. After merging `origin/main`
@ `3ea308d` (WU-12) the branch stood at 1 failed / 540 passed / 1 skipped; WU-13 added the two
port-conformance tests. `origin/main` measured on its own in a clean detached worktree is
**1 failed, 385 passed** — the *same* deliberate failure and no others, so nothing was inherited
or created by the merge that is unaccounted for.

**The one failure is deliberate and must stay red.**
`tests/deployment/test_root_compose.py::TestSecretSafeEnvWorkflow::test_no_committed_file_carries_a_credential_shaped_default`
fires on `GOOGLE_CLOUD_PROJECT=gen-lang-client-0715489298` at `.env.example:103` (and the same id
embedded in a filename at line 109). That is a **pre-existing** committed credential-shaped
default, and it is a working default for a live Google Cloud deploy. Changing or blanking it here
risks breaking a deploy this change has no business touching, so it was left exactly as found and
raised as a separate security follow-up. **2 or more failures is a regression; 0 failures means
someone edited `.env.example:103`, which is also wrong.**

**The one skip is deliberate**: `TestAgainstARunningDaemon` in the compose smoke suite is
credential-gated and skips with a named reason unless `SUPABASE_URL`/`SUPABASE_KEY` are exported —
required by REQ-UCD-7 as modified here. This gate is not cosmetic: the first run after the compose
edit **recreated a developer's running, healthy matcher container** into one that could not boot
without `SUPABASE_KEY`. `scripts/smoke-compose.sh` gained a `preflight_matcher` for the same
reason.

Zero `skip`/`xfail` markers remain in `services/matcher/tests/eval/`; a guard test
(`test_the_eval_suite_is_not_skipped`) makes sure the temporary WU-5 skip can never return.

**No test in this change requires network access.** Supabase is driven entirely through
`httpx.MockTransport`, Redis through `fakeredis`, and the eval suite off a checked-in,
hash-pinned fixture snapshot.

## `uv.lock`

`uv.lock` grows **+826 lines / 27 newly locked packages** — but only **3** belong to this change
(`redis`, `fakeredis`, `sortedcontainers`). The other **24** are `product_identification`
transitive dependencies that PR #12 added to `pyproject.toml` but never locked; any `uv run` in
the workspace materialises them. Expected, not a mistake.

## Also fixed in passing

Three pre-existing failures from PR #12's compose drift, all in `tests/deployment/`:

1. `test_compose_config.py::TestRenderedContract::test_it_validates`
2. `test_root_compose.py::TestSoleSurface::test_the_root_file_defines_every_service` — the
   expected service set was still `{stt, matcher}`; it is now
   `{stt, matcher, product_identification, redis}`.
3. `test_root_compose.py::TestSoleSurface::test_operator_docs_never_point_at_a_service_local_compose`
   — `services/product_identification/README.md` pointed at a service-local compose file that does
   not exist in the tree.

`scripts/setup-env.sh` is untouched (`git diff --exit-code` clean) — the template drives it.

## Named follow-ups

| # | Item |
|---|---|
| 1 | **The `CAJA` unit domain question (RF-15)** — should a dictated "caja" resolve to the `CAJA` unit code rather than `UND`? Recorded in `units.py`, deliberately not decided here. |
| 2 | **A scoped catalogue-reader role** — `GRANT SELECT` + read policies on exactly `warehouses`, `products`, `warehouse_products`, `units`, restoring genuine least privilege and retiring `service_role` from the matcher. Touches the Data Engineer's schema. |
| 3 | **Delete `scripts/build_bodegas_sqlite.py` and `data/`** — no service reads them at runtime any more. Deliberately out of scope here (see the proposal's Out of Scope) so the cutover diff stays reviewable. |
| 4 | **`.env.example:103`** — the pre-existing `GOOGLE_CLOUD_PROJECT` credential-shaped default and the matching filename at line 109. |
| 5 | **The `no_code` scoring-precision gap** — tie clusters of names differing only by a gram weight the trigram metric cannot see. Gold is at rank 2 in six of the seven misses and rank 3 in the seventh, so this is a scoring problem, not a ranking one. |
| 6 | **Cold-start stampede across replicas.** `load_index` (`catalogue.py:105-147`) never takes the `SET NX PX` lock — only the periodic refresh path does. N replicas booting against a cold Redis therefore each read Supabase independently. **Blast radius today: zero** — compose runs a single instance per service, so there is exactly one booting replica. It matters the moment the matcher scales horizontally, which is precisely when a cold Redis is most likely (a deploy restarts everything at once). Surfaced by the R4 resilience lens; deliberately not fixed here because taking a lock on the startup path adds a failure mode to boot for no present benefit. |
| 7 | **`/health` cannot see catalogue staleness.** `HealthResponse` carries only `status`, `catalogues` and `rows`. If Supabase becomes permanently unreachable *after* startup, every refresh fails behind `refresh()`'s catch-all, which logs one WARNING per ~3 h cycle, while `/health` keeps answering `200 {"status":"ok"}` indefinitely over an ever-staler catalogue. Nothing is broken — stale-while-refresh is the intended REQ-RCC-3 behaviour — but it is invisible to a health check and easy to miss in logs at that cadence. `MatcherService` already tracks `_index.source` and `_index.loaded_at`; exposing them (and letting an operator alert on age) is the whole fix. Surfaced by the R4 resilience lens. |

## Post-review work carried in this PR (WU-12, WU-13)

This branch was reviewed by the 4R lenses and by `sdd-verify` *before* the last two work units,
and both of them are answers to that review rather than new feature work.

**WU-12 — integration.** `sdd-verify` returned FAIL on two CRITICALs, neither a defect inside this
change's diff: `origin/main` had moved 39 commits ahead, taking the `feat/voice-counter-frontend`
merge (which invalidated BREAKING #1's mitigation) and a `frontend` compose service (which
collided with the service-set equality assertions) with it. Fixed by merging `origin/main`,
resolving every conflict toward the union, and migrating the frontend to the warehouse codes.

**WU-13 — the single bounded correction transaction.** One behavioural commit and one prose
commit closing every remaining WARNING:

- The `SnapshotCache` Protocol required a `ttl_seconds` argument the only production call site
  never passes. Because the Protocol is `runtime_checkable`, a strictly-conforming adapter would
  pass `isinstance`, then raise `TypeError` inside `_guarded`, which swallows it — the refresh lock
  would be silently never taken and every replica would stampede Supabase. Port corrected, and
  pinned by a test whose double is generated *from* the Protocol signature.
- REQ-API-8 ("`SUPABASE_KEY` never appears in an exception message") was documented but never
  asserted on the real crash path. The subprocess exit-3 test — the only place a full chained
  traceback is actually rendered — now runs with a sentinel key and asserts its absence from
  stderr and stdout. No live leak exists; this is regression safety.
- Prose corrections: `config.py` no longer calls the credential "least-privilege" (it is
  `service_role`); the remap script's row-gap theory is replaced with the measured 8-header-row
  finding; REQ-RCC-4 no longer claims a per-process single-flight that is neither implemented nor
  needed; the accuracy provenance note now tabulates the real per-case miss profile instead of
  claiming "rank 2 in every miss"; and the withdrawn credential plan is marked as withdrawn in
  `proposal.md`, `design.md` and `tasks.md` rather than still reading as live.

## Reviewer guidance

Suggested reading order — the commits are ordered to be read, and each one leaves the suite at
its expected state:

| # | Commit | What to look for |
|---|---|---|
| 1 | `415e3d5` | deps only |
| 2 | `0397b4c` | **start here.** `ports.py` + the snapshot codec — the whole contract in one small file |
| 3 | `ba0af53` | Redis adapter; every `RedisError` swallowed by design |
| 4 | `ecf6846` | Supabase source: the query, the `Range` pagination loop, the error taxonomy |
| 5 | `c677827` | `load_index` — the four-step fallback chain and the zero-call warm start |
| 6 | `91a0e73` | **the big one.** The cutover: service/main/config rewired, SQLite deleted |
| 7 | `91ef3a0` | planning artifacts corrected (8 not 56; the credential decision) |
| 8 | `716295a` | background refresh + atomic swap; read the 8-thread race test |
| 9 | `97611ed` | compose, `.env.example`, deployment tests |
| 10 | `1d09f5d` | eval remap and the re-pinned baselines — the accuracy story |
| 11 | `d908946` | the unit-vocabulary bug and its fix |
| 12 | `47e0d61` | the deterministic tie-break |
| 13 | `17f694a` | WU-9 — docs sweep: the SQLite catalogue retired from every live document |
| 14 | `f106a04` | WU-12a — merge `origin/main` (39 commits ahead). Mechanical: every conflict resolved toward the **union**, nothing of main's dropped. Compose now declares all five services |
| 15 | `4d3697f` | WU-12b — **the frontend `catalogue_id` migration**, which is what makes BREAKING #1 safe to merge. Read `frontend/src/lib/catalogues.ts` against its test |
| 16 | `ba23975` | WU-13 — `SnapshotCache` port/adapter signature fix + the REQ-API-8 credential-absence assertion on the real crash path |
| 17 | *(this commit)* | WU-13 — prose only: the `service_role` docstring, the corrected row-gap and miss-profile notes, REQ-RCC-4, and this PR body |

If you have time for only two: **`0397b4c`** (the contract) and **`91a0e73`** (the cutover).
Commits 14-17 are post-review integration and correction work; 16 is the only one of them that
changes runtime behaviour.
