# Supabase backend

The database behind the two front ends in the design export: the operator's
push-to-talk counting app and the auditor's review tablet. It holds the
`BODEGAS Y STOCK.xlsx` workbook, the catalogue derived from it, and the whole
counting/review/export lifecycle.

Project ref: `blvdxsoaopcvtzawvgbt` · `https://blvdxsoaopcvtzawvgbt.supabase.co`

---

## The two invariants

Almost every design decision below follows from one of these. If you are about
to add a table, a policy, or a view, check it against both.

**RF-18 — blind counting.** An operator must never be able to reach the
theoretical stock figure, because seeing it would steer the count. This is not
enforced by "remember not to select that column". It is enforced structurally:
the theoretical quantity lives in its own table (`warehouse_stock_balances`)
whose only SELECT policy requires staff, and the learned bands live in another
(`product_count_ranges`) with the same rule. The operator-facing catalogue table
has no quantity column at all. When an anomaly has to tell the operator "this is
normally 20 to 40", the band is copied onto the anomaly row; the theoretical
figure behind it goes to `anomaly_evidence`, which is staff-only.

**RF-07 — plan-scoped access.** An operator reaches a plan only through a row in
`plan_operators`. `public.has_plan_access(uuid)` is the single expression of
this and every plan-scoped policy calls it.

Both are proven, not asserted — see [Verifying the guarantees](#verifying-the-guarantees).

---

## Layout

### `source` — the workbook, verbatim

Not exposed through the API; `usage` is granted to `service_role` only, and RLS
is on with no policies (deny-all) as a second lock. Keeping the raw rows means
any derivation can be re-run or audited without going back to the `.xlsx`.

| Table | Rows | What it is |
| --- | --- | --- |
| `ingest_runs` | 1 | One row per upload: filename, SHA-256, per-sheet counts. One is `is_active`. |
| `workbook_sheets` | 9 | Sheet names verbatim, including the double space in `STOCK ALMACEN  SUMINISTROS` and the `CANTIDA` header typo. |
| `bodegas_disponibles` | 48 | Sheet 1, the warehouse-name list. |
| `stock_rows` | 1 413 | Sheets 2–9 unified, with `sheet_id` as the discriminator. |

Two things about this data that are easy to get wrong:

- **`cantidad` is not a quantity.** In every sheet it is the printed row number,
  1..N. The balance is `sd` (*saldo disponible*). The column is loaded as
  `row_ordinal` to stop the mistake recurring.
- **`sd` goes negative** on 79 rows. That is a real defect in the client's data
  and RF-26(d) makes it a finding, so it is stored as-is, never clamped.

### `public` — the application

**Catalogue** — `units` (5), `warehouses` (56), `products` (936),
`warehouse_products` (1 405), `warehouse_stock_balances` (1 405),
`product_count_ranges` (1 405).

**Identity** — `profiles`, `voice_consents`.

**Counting** — `audit_plans`, `plan_operators`, `voice_captures`,
`count_records`, `count_exclusions`.

**Review** — `record_anomalies`, `anomaly_evidence`, `auditor_actions`,
`recount_requests`.

**Export** — `export_batches`, `export_lines`.

**Views** (all `security_invoker`, so RLS applies as the caller) —
`v_warehouse_catalogue`, `v_plan_progress`, `v_operator_anomalies`,
`v_auditor_review`, `v_oracle_export_preview`, `v_current_voice_consent`.

---

## The one unresolved data question

The workbook contains **two warehouse registries that do not reconcile**:

- sheet `BODEGAS DISPONIBLES` lists 48 warehouse names (`almacen general`,
  `zoologico piscilago`, `movil taquilla`, …);
- eight further sheets carry stock under different names
  (`STOCK ALMACEN AYB`, `STOCK KIOSCO PISCIGIROS AYB`, …).

Only one pair matches outright (`ZOOLOGICO SUMINISTROS` ↔ `zoologico
suministros`). `STOCK KIOSCO TAQUILLA AYB` could plausibly be any of three
listed bodegas; `STOCK RESTAURANTE FUENTES AYB` matches none.

**The loader does not guess.** Both registries are loaded, `source_kind`
records which is which, and `merged_into_warehouse_id` is left null. Only the 8
`stock_sheet` warehouses carry stock, so those are the ones a plan can be
written against today.

**This needs a human answer from Colsubsidio.** Once they confirm the mapping,
set `merged_into_warehouse_id` — no migration required.

---

## Applying and loading

Migrations are in `supabase/migrations/`, applied in filename order. They are
already applied to the project above; this is how to reproduce on a fresh one.

```sh
supabase link --project-ref <ref>
supabase db push
```

Then load the workbook. The loader keeps a single definition of the catalogue:
Python parses and **validates**, Postgres derives.

```sh
uv run python scripts/supabase_seed.py \
  --xlsx docs/sources/bodegas-y-stock.xlsx \
  --out-dir supabase/seed
```

That writes numbered statements to `supabase/seed/`. Apply them in order
(`psql -f`, or the Supabase SQL editor). Every one is idempotent — re-running
the whole set against a loaded database is a no-op, and re-running after the
workbook changes updates in place under a new `ingest_run`.

The largest statements carry the 1 413 raw rows. If your transport has a payload
ceiling, lower `--chunk-size`.

The loader refuses to proceed on a contradiction rather than picking a winner:
a product name carrying two different codes, or two different units, raises
`DerivationError` and stops the load. The current workbook is clean on both
counts — 936 distinct names, each with exactly one code and one unit — so those
branches exist for the *next* upload.

### Keeping the SQLite mirror honest

`data/bodegas-y-stock.sqlite` is the local read-only mirror the matcher service
uses. Both come from the same `load_xlsx()`, so they cannot drift on parsing.
After a reload, confirm they agree:

```sql
select count(*)                          as rows,        -- 1413
       count(*) filter (where sd < 0)    as negative,    -- 79
       count(*) filter (where nr_articulo is null) as no_code,  -- 260
       round(sum(sd), 4)                 as sum_sd       -- 566151.1755
from source.stock_rows;
```

---

## Front-end recipes

### Gate the microphone (RF-22, Ley 1581 de 2012)

```ts
const { data } = await supabase
  .from('v_current_voice_consent')
  .select('may_record, policy_version, decided_at')
  .maybeSingle()

// No row at all means never asked — show the authorisation screen.
const mayRecord = data?.may_record ?? false
```

Recording consent is an insert, never an update — the table is append-only, so
a later revocation is a new row and the history survives:

```ts
await supabase.from('voice_consents').insert({
  profile_id: user.id,
  status: 'granted',
  policy_version: '2026-07-31',
})
```

### The operator's plan list (RF-11)

```ts
const { data: plans } = await supabase
  .from('v_plan_progress')
  .select('*')
  .in('status', ['scheduled', 'active'])
  .order('plan_id')
```

RLS already limits this to assigned plans — no `.eq('operator_id', …)` needed,
and adding one would be a second, weaker copy of the rule.

### Load a warehouse catalogue (RF-11, blind-safe)

```ts
const { data: catalogue } = await supabase
  .from('v_warehouse_catalogue')
  .select('product_id, sku, product_name, unit_code, unit_label')
  .eq('warehouse_id', plan.warehouse_id)
```

Safe to cache offline in full: the view has no quantity column.

### Manual search when nothing matched (RF-15, RF-16)

```ts
const { data: matches } = await supabase.rpc('search_warehouse_catalogue', {
  p_warehouse_id: plan.warehouse_id,
  p_query: 'tabla para picar blanca',
  p_limit: 5,
})
```

Trigram similarity over the accent-folded name, scoped to the one warehouse, so
a match can never come from a warehouse the operator is not counting. Returns
`{product_id, sku, name, unit_code, similarity}` ordered by similarity.

### Save a dictated audio (RF-14, RF-33)

One capture, N records — the three-item audio in the mockup becomes three rows
pointing at the same capture. Insert the capture, then its records:

```ts
const { data: capture } = await supabase
  .from('voice_captures')
  .insert({
    plan_id: plan.id,
    profile_id: user.id,
    transcript: 'tres kilos de lechuga batavia, doce botellas de aceite…',
    duration_ms: 4200,
    models_total: 3,
    models_agreed: 3,
    client_capture_id: localId,          // idempotency key, see below
  })
  .select('id')
  .single()

await supabase.from('count_records').insert(
  confirmedItems.map((item) => ({
    plan_id: plan.id,
    warehouse_id: plan.warehouse_id,
    product_id: item.productId,
    capture_id: capture.id,
    quantity: item.qty,
    unit_code: item.unit,
    source: 'voice',
    dictated_text: item.phrase,
    counted_by: user.id,
    client_record_id: item.localId,
  })),
)
```

**Offline sync (RNF-08).** Mint `client_capture_id` / `client_record_id` on the
tablet. They are unique, so replaying a queue after reconnecting collides
instead of duplicating. Use `.upsert(..., { onConflict: 'client_record_id', ignoreDuplicates: true })`
when flushing the queue.

### Correct a record (RF-20, RF-21)

Voice only ever creates. Correction is delete-and-redo, and the database
enforces it — an operator UPDATE that changes `quantity`, `unit_code`,
`product_id` or `counted_by` raises `restrict_violation`.

```ts
// Retire the wrong one...
await supabase.from('count_records')
  .update({ is_deleted: true, deleted_at: new Date().toISOString(), deleted_by: user.id })
  .eq('id', wrongRecordId)

// ...then dictate again and insert a fresh row.
```

A partial unique index allows only one live record per product per plan, so the
redo must retire the old row first.

### The operator's anomaly screen (RF-28)

```ts
const { data: open } = await supabase
  .from('v_operator_anomalies')
  .select('*')
  .eq('plan_id', plan.id)
  .eq('status', 'open')
```

`expected_min` / `expected_max` are on the row so the alert can say "normally 20
to 40" — but `system_qty` is not, and the operator cannot reach
`anomaly_evidence` to find it.

### The auditor's review grid (RF-08, RF-32)

```ts
const { data: rows } = await supabase
  .from('v_auditor_review')
  .select('*')
  .eq('plan_id', plan.id)
  .order('counted_at', { ascending: false })
```

Gives counted vs. theoretical, the difference, the transcript, the model
consensus and the open-anomaly count in one read. `difference` is deliberately
`null` when the units disagree — 900 g against a 4 L balance has no meaningful
arithmetic answer, and *that* is the finding.

### Approve, correct, request a recount (RF-09, RF-32)

Every decision is an insert into `auditor_actions`, which is append-only: a
reversal is another row, and a correction records both the old and new values.

```ts
await supabase.from('auditor_actions').insert({
  record_id: record.id,
  anomaly_id: anomaly?.id,
  action: 'correct',
  actor_id: user.id,
  previous_quantity: record.counted_qty,
  new_quantity: 4,
  reason: 'Conteo en litros confirmado con el chef de turno',
})
```

### Close and export (RF-30, CU-09)

The mockup's *cierre con candado*: the file is not generated while an anomaly is
open. The check constraint on `export_batches` makes the override explicit —
`open_anomaly_count > 0` requires `forced = true`, so a forced export is visible
in the record rather than indistinguishable from a clean one.

```ts
const { data: preview } = await supabase
  .from('v_oracle_export_preview')
  .select('subinventory, item, count_qty, uom, counter')
  .eq('plan_id', plan.id)
```

Materialise into `export_lines` to freeze the file. Those rows are text
snapshots, not joins, so a reprint reproduces the original even after a
warehouse is renamed.

---

## Roles

`profiles.role` is one of `operator`, `cost_lead`, `auditor`.

| | operator | cost_lead | auditor |
| --- | --- | --- | --- |
| Catalogue (names, units) | read | read | read + write |
| Theoretical stock, learned ranges | **no access** | read | read + write |
| Plans | assigned only | all + write | all + write |
| Count records | insert + soft-delete own, read whole plan | all | all |
| Anomalies | read (no evidence) | read + write | read + write |
| Auditor decisions | read own | read | insert |
| Export | — | — | full |

New users default to `operator`; a trigger on `auth.users` creates the profile.
Promote by updating `profiles.role` as an auditor. Note there is deliberately no
"update own profile" policy — `role` is a column on that table, so a self-update
policy would be a self-promotion policy.

Set `counter_code` (e.g. `PABLO.R`) on each profile: it is what the Oracle export
writes in its `COUNTER` column.

---

## Verifying the guarantees

The RLS rules are testable without a running app. This runs as an operator and
should report zeros in the first two columns:

```sql
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"<operator-uuid>","role":"authenticated"}';

select
  (select count(*) from public.warehouse_stock_balances) as theoretical_visible,  -- 0
  (select count(*) from public.product_count_ranges)     as ranges_visible,       -- 0
  (select count(*) from public.warehouse_products)       as catalogue_visible,    -- their warehouse
  (select count(*) from public.audit_plans)              as plans_visible;        -- their plans
rollback;
```

Verified on this project: an operator assigned to one plan sees 0 theoretical
rows, 0 ranges, 55 catalogue rows and 1 plan; an auditor sees 1 405 / 1 405 /
1 405 and every plan. An operator UPDATE changing a quantity raises
`restrict_violation`; the soft delete succeeds.

---

## Type generation

Types are not committed, because a stale generated file is worse than none.
Generate them into the front-end project as a build step:

```sh
npx supabase gen types typescript --project-id blvdxsoaopcvtzawvgbt > src/lib/database.types.ts
```

---

## Known advisor output

Two families of lint remain, both intentional:

- **`rls_enabled_no_policy` (INFO) on the four `source.*` tables.** RLS on with
  no policy is deny-all, which is the intent. Adding a policy would weaken it.
- **`authenticated_security_definer_function_executable` (WARN) on
  `is_staff`, `is_auditor`, `current_app_role`, `has_plan_access`.** Policy
  expressions are evaluated as the querying role, so `authenticated` must hold
  EXECUTE or every policy calling them fails. Each returns only facts about the
  caller, which the caller already knows. `anon` and `PUBLIC` have been revoked.

Everything else the linter raised has been fixed: `PUBLIC` EXECUTE on the
SECURITY DEFINER helpers (revoking from `anon` alone does not do it — Postgres
grants EXECUTE to `PUBLIC` by default), overlapping permissive policies, and the
foreign keys worth indexing.

---

## Not in this schema, on purpose

- **No audio.** RNF-04 says voice is not stored; there is no column and no
  bucket. `voice_captures` keeps the transcript and the per-model results, which
  is what the auditor's trace panel shows.
- **No ERP integration.** RNF-09 makes the tool autonomous: it eats the
  workbook and emits a load file. Oracle stays the owner of transfers, sales and
  write-offs.
- **No learned ranges yet.** RF-03 wants statistical parameters per product, but
  one snapshot is not a history. `product_count_ranges` is populated with a
  bracket (half to double the balance; zero to a floor when the balance is
  non-positive) and `method = 'bootstrap_from_snapshot'` says so. Recompute from
  real counts and flip the method — do not mistake a bootstrap for evidence.
