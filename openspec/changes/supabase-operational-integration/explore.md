# Exploration: Frontend × PRD × Supabase alignment

Change: `supabase-operational-integration` · Engram twin: `sdd/supabase-operational-integration/explore` (obs #153)

## Current State (confirmed by direct source reading, not assumption)

- Live Supabase project `blvdxsoaopcvtzawvgbt` has a full, populated operational schema (12 migrations), matching the design in `docs/database/DATABASE_ARCHITECTURE.md` / `SUPABASE_SCHEMA_COMPARISON.md` / `TECHNICAL_DATA_SPECIFICATION.md` / `DATA_AUDIT_REPORT.md`. Catalogue tables (`products`, `warehouses`, `warehouse_products`, `warehouse_stock_balances`, `product_count_ranges`, `units`) are populated 100% from `bodegas-y-stock.xlsx` (936 products, 56 warehouses, 1405 stock rows, verified by the audit doc). Operational tables (`voice_consents`, `voice_captures`, `count_records`, `record_anomalies`, `anomaly_evidence`, `audit_plans`, `plan_operators`, `auditor_actions`, `export_batches`, `export_lines`, `recount_requests`, `count_exclusions`, `profiles`) exist with RLS enabled but **zero rows and zero application code writing to or reading from them.**
- This schema was built on the closed/archived `feat/supabase-backend` branch (PR #9) and was **never merged to `main`**. No file in `frontend/` or `services/` references Supabase in any way — `frontend/package.json` has no `@supabase/*` dependency, `grep -ri supabase frontend/src` returns zero hits outside a comment.
- `main`'s actual data flow (docker-compose.yml + service source, verified directly):
  - `matcher` (:8002) loads `data/bodegas-y-stock.sqlite` read-only at startup (`services/matcher/src/matcher/catalogue.py` — `open_readonly`, `mode=ro` URI) into 8 in-memory `STOCK_TABLES`. Zero Supabase/network reads at request time. This catalogue-read path is explicitly **out of scope** for this exploration — the parallel `redis-catalogue-cache` change already owns migrating it to Supabase+Redis. Do not re-scope it here.
  - `stt` (:8001) and `product_identification` (:8003) are both stateless; `product_identification` is dual-model Gemini (Flash+Pro), not the PRD's three-model consensus — a pre-existing PRD/code mismatch, independent of Supabase.
  - `frontend` (Astro+Preact, PR #13/#14) only proxies to `stt`/`matcher` (`frontend/src/pages/api/_upstream.ts` — `STT_BASE_URL`, `MATCHER_BASE_URL`; no `PRODUCT_IDENTIFICATION_BASE_URL` env at all, confirming Module 2 is not wired — `CountSession` defaults `extraction = mockExtractionAdapter`).
- Frontend behavior, verified file by file:
  - `/conteo` (`CountSession.tsx`, `lib/session/{types,reducer}.ts`): S1 consent is `consentChecked: boolean` local reducer state only — no write to `voice_consents`, ever. S2 "plans" (`PlansScreen`) renders the 8 real matcher catalogues directly (`frontend/src/fixtures/operatorSeed.ts` comment: *"There is deliberately NO plan table here... no bodega→catalogue mapping exists to invent (RF-11)"*) — i.e. it is warehouse selection, not audit-plan selection, which is precisely the flow error the PRD's own §6.1 Figure 2 callout says is wrong. No read from `audit_plans`/`plan_operators`. Records accumulate in `SessionState.records` (in-memory reducer state, seeded with 3 fixture rows from `operatorSeed.ts`) — the `sync` `RecordState` is explicitly commented *"in-session 'pending upload' ONLY... must never be presented as offline capability"* — there is no upload; nothing ever POSTs to any records endpoint. Delete-and-redo (`RECORD_DELETED`) mutates only local state, never writes to `count_records`/`auditor_actions`.
  - `/auditor` (`AuditorReview.tsx`, `fixtures/auditorSeed.ts`): 8 hardcoded `AUDITOR_RECORDS`, all local `useState`. Approve/Correct/Recount actions (`sign()`) append a `TraceEntry` to component state only — lost on reload, never written to `auditor_actions`/`record_anomalies`. "Exportar a Oracle" is a no-op modal (`onConfirm={closeModal}`) — no file is generated, no `export_batches`/`export_lines` write, the "1.482 registros..." export summary text is a hardcoded string, not computed.
  - No auth/login exists anywhere in the app. RLS policies in the live schema are built around `auth.uid()`/`profiles`.

## PRD Traceability (RF/RNF → schema/code reality)

Legend: (a) satisfied by live schema+data · (b) schema exists but NOT wired to any application code · (c) not represented in the schema at all.

| RF | Requirement | Status |
|---|---|---|
| RF-01 | Upload Excel as DB | (b) — `products`/`warehouses` etc. exist and are populated, but via a manual migration+seed done for the old backend, not via any live "auditor uploads Excel" app flow. That flow does not exist in `main` at all. |
| RF-02 | Characterise data on upload | (b) — no code |
| RF-03 | Compute statistical parameters | (a) schema (`product_count_ranges`, 1405 rows pre-populated) / (b) no code recomputes it on new data |
| RF-04 | Auditor creates uncatalogued products | (b) — `products` table supports it; no CRUD UI exists |
| RF-05 | User management (create/enable/disable operators) | (b)/(c) — `profiles` table exists (0 rows) but there is zero auth/identity system to back it; no UI |
| RF-06 | Create audit plan (1 warehouse + period + operators) | (b) — `audit_plans`/`plan_operators` exist (0 rows); frontend has no plan-creation UI |
| RF-07 | Restrict operator to assigned plans | (b)/(c) — structurally requires identity, which doesn't exist; RLS designed for this is unusable without auth |
| RF-08 | Auditor sees all records per operator w/ anomalies | (b) — `AuditorReview` is 100% fixture, no read from `count_records`/`record_anomalies` |
| RF-09 | Two anomaly-resolution flows (on-site / in-office) | (b) — UI exists (approve/correct/recount modals) but is local-state only, no persistence |
| RF-10 | Per-operator statistical comparison signals | (c) — no dedicated view/table in the schema either; not represented anywhere |
| RF-11 | Operator selects audit plan (not warehouse) | (b) — implemented as raw warehouse/catalogue selection, explicitly *not* plan-based (fixture comment confirms this is a known simplification) |
| RF-12 | Push-to-talk capture | Satisfied — real, `stt` wired |
| RF-13 | Cap voice note duration | Satisfied — client-side, real |
| RF-14 | Multi-item split | Partially — via `mockExtractionAdapter`, not the real `product_identification` service (not a Supabase gap, but a real-vs-mock gap) |
| RF-15 | Fuzzy SKU match | Satisfied — real, `matcher` wired (via SQLite, not Supabase — out of scope per boundary) |
| RF-16 | Manual search fallback | Satisfied — real, `SearchSheet` wired to `matcher` |
| RF-17 | ITN | Client-side, real (not evaluated in depth here) |
| RF-18 | Blind counting | Satisfied by omission — frontend never fetches theoretical stock at all |
| RF-19 | Records accumulate visible | UI satisfied; persistence NOT — reducer state only, lost on reload |
| RF-20 | Voice creates only | Satisfied — enforced by design |
| RF-21 | Delete-and-redo correction | UI satisfied; NOT written to `count_records.is_deleted`/`auditor_actions` |
| RF-22 | Onboarding | Not a DB concern |
| RF-33 | Pre-save confirmation | Satisfied — real, `ConfirmSheet`, no DB |
| RF-23 | Three-model consensus JSON | (b)/(c) — `voice_captures` table exists (0 rows) designed for this; but `product_identification` is dual-model and not even wired to the frontend by default |
| RF-24 | Reprocess on discrepancy | (b)/(c) — same as RF-23 |
| RF-25 | Async validation via trigger | (b) — `product_count_ranges`/`record_anomalies` exist and are populated/ready; frontend uses a client-side fixture rules engine (`anomalyRules.ts`) instead of any DB trigger, and nothing ever writes a `count_records` row for the trigger to fire against |
| RF-26 | Validation checks (unit/quantity/negative balance) | (b) — same fixture-engine situation; negative-balance check would need `warehouse_stock_balances` (populated) but nothing reads it |
| RF-27 | Warning vs error distinction | (b) — implemented in client fixture types only |
| RF-28 | Preventive block | UI satisfied (client-only); no `record_anomalies` row created |
| RF-29 | Block never cuts in-flight audio | Satisfied — client-only |
| RF-30 | Oracle export file | (b)/(c) — `export_batches`/`export_lines`/`v_oracle_export_preview` exist (0 rows), fully unused; frontend's "Exportar a Oracle" button is a no-op |
| RF-31 | Reconciliation report | (b) — no computation exists; modal text is a hardcoded string |
| RF-32 | Audit trail per record | (b) — `TraceEntry` is local component state only, not `auditor_actions` |

RNF-04 (voice not stored) is structurally satisfied — no audio persistence path exists anywhere, real or fixture. RNF-08 (offline-first) was explicitly **cut** from the frontend scope (comments in `RecordList.tsx` and `types.ts` confirm S8/offline capability was removed as stretch scope) — this is a scope decision already made in the frontend proposal, not a Supabase gap, but the PRD (§8 caveat) still lists it as unratified; worth flagging to the user as a PRD update opportunity, separate from this change.

## Affected Areas (if this change proceeds)

- `frontend/package.json` — needs `@supabase/supabase-js` (server-side only, per existing `_upstream.ts` same-origin-proxy pattern)
- `frontend/src/pages/api/` — new server routes for consent write, plan read, count-record write, auditor read/write, export generation (mirrors existing `transcribe.ts`/`match.ts`/`catalogues.ts` proxy pattern)
- `frontend/src/components/operator/CountSession.tsx`, `lib/session/{types,reducer}.ts` — session reducer needs real persistence side-effects instead of pure in-memory state
- `frontend/src/components/auditor/AuditorReview.tsx`, `fixtures/auditorSeed.ts` — needs real Supabase reads replacing the 8 hardcoded records, real writes for approve/correct/recount
- Supabase RLS policies (already applied) — need either a real auth flow or a documented server-role access pattern; current `auth.uid()`-based policies are inert without one
- Explicitly OUT of scope: `services/matcher/src/matcher/catalogue.py` / `service.py` and any catalogue/product-read wiring — owned by the parallel `redis-catalogue-cache` change

## Open Design Decision — Auth / RLS Access Pattern (NOT decided here)

1. **Server-side Supabase client, service-role-equivalent, no real auth** — Astro API routes broker every read/write server-side (mirrors the existing `stt`/`matcher` proxy pattern exactly). Pros: zero new UI, ships fast, consistent with current architecture. Cons: RLS becomes structurally inert (never evaluated under a real `auth.uid()`), all access-control (RF-05, RF-07 "operator sees only assigned plans") has to be re-implemented in application code instead of the DB, service-role key must never reach the browser (Supabase skill's checklist).
2. **Real Supabase Auth**, mapping operator/auditor to `profiles`, using `anon`/`authenticated` roles so the already-authored RLS policies actually enforce blind counting and plan scoping as designed. Pros: matches the schema's design intent 1:1, RF-05/RF-07 get real enforcement. Cons: real scope increase — login/session UI, credential distribution to operators/auditors, not currently in the PRD's stated MVP scope (no RF mentions login) though RF-05/07 structurally imply *some* identity.
3. **Hybrid**: server-side client using a scoped/service role now (Option 1), RLS policies stay enabled as defense-in-depth for future direct-client access, explicit technical debt note that RF-07 enforcement is app-level not row-level until real auth is built later.

This exploration deliberately does not pick one — it needs to be resolved at `sdd-propose`.

## Ready for Proposal

Yes, with one explicit precondition: the auth/RLS access-pattern decision above must be made (or explicitly deferred with Option 3) at `sdd-propose` time, since it changes the shape of every server route this change would add. The RF-to-schema mapping above is complete enough to scope proposal work items. Recommend scoping the proposal narrowly (e.g., consent write + plan read + count-record write first, defer export/audit-trail to a follow-up slice) given the size of the gap — though the user has pre-accepted `size:exception` for a single PR with no line cap, so narrow-slicing is a recommendation for review quality, not a hard constraint here.

## Risks

- Reviving Supabase wiring risks silently colliding with the concurrent `redis-catalogue-cache` change's Supabase client setup for `products`/`warehouse_products` — coordinate the Supabase client bootstrap (env vars, client factory) so both changes share one client module instead of each introducing its own.
- RF-23/RF-24 (three-model consensus) cannot be satisfied by this change alone — `product_identification` is dual-model and not even wired into the frontend; this is a separate, larger gap this exploration surfaces but does not scope to fix.
- The live schema's RLS policies have not been re-verified against `supabase-postgres-best-practices`/`supabase` skill checklist items (UPDATE needs SELECT+WITH CHECK, `TO authenticated` alone is not authorization, etc.) — that audit should happen as part of `sdd-propose`/`sdd-design`, not skipped because the schema already exists.
