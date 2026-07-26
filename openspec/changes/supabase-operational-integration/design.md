# Design: Supabase Operational Integration

## Technical Approach

Extend the existing same-origin proxy architecture (`frontend/src/pages/api/`) with server-side Supabase-backed routes. A server-only client factory (`_supabase.ts`, mirroring `_upstream.ts`) brokers every read/write; the browser never holds a Supabase key. Route handlers stay thin (like `match.ts`); all decidable logic lives in injectable modules under `frontend/src/lib/server/`, tested with stub DB objects — the server-side twin of the component prop-seam pattern.

## Architecture Decisions

| # | Decision | Choice | Rejected | Rationale |
|---|----------|--------|----------|-----------|
| D1 | Client bootstrap | `frontend/src/pages/api/_supabase.ts`, lazy per-process singleton `supabase()`; env `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` (never `PUBLIC_`-prefixed) | Client in `lib/` importable by browser code | `_`-prefix keeps it un-routable and physically inside the server-only directory; env resolved from `process.env` like `sttBase()`. **Merge-time note**: `redis-catalogue-cache` may introduce Supabase env vars for the matcher — reconcile names in `docker-compose.yml` at merge; same values may be shared, names must not diverge semantically. |
| D2 | RF-07 enforcement | Route-level: every record write must carry `(plan_id, operator_id)` present in `plan_operators` with the plan active; `/api/plans` filters by `operator_id` | Trusting RLS | No `auth.uid()` session exists; RLS stays enabled as defense-in-depth only. Operator identity is client-supplied (query param persisted from plan selection) — unauthenticated identity is the named technical debt, assignment validation is real. |
| D3 | Blind counting (RF-18) | Operator-facing routes serialize an allowlisted verdict shape only; `sd`/theoretical balance never appears in any operator route response. RED test asserts absence | Filtering in UI | Access control at the boundary, not the renderer (obs #129 learning). |
| D4 | Anomaly engine | Widen `AnomalyEngine.check` to `Promise<Anomaly \| null>`; new `httpAnomalyEngine` calls `POST /api/anomaly-check`; fixture engine wraps sync result | New parallel seam | `lib/anomaly/engine.ts` was designed for exactly this swap ("zero call-site changes"). `/api/records` re-runs the same server validation on write — the client's verdict is never trusted for `record_anomalies`. |
| D5 | Record persistence | Optimistic: reducer appends with existing `sync` state; `CountSession` fires POST; new events `RECORD_PERSISTED` (flips to `ok`/`anom_noted`, stores server id) / `RECORD_PERSIST_FAILED` (stays `sync` + error banner). Client-minted UUID sent as idempotency key | Blocking writes; offline queue | Matches the reducer's pure-state + component-side-effect split (`runChain` precedent); `sync` state already exists with exactly this meaning. Consent write is blocking: `MIC_GRANTED` dispatched only after `POST /api/consent` succeeds (S1 is legally significant). |
| D6 | Delete-and-redo (RF-20/21) | `DELETE /api/records/[id]` sets `is_deleted = true`; redo is a new POST row | Hard delete | Original never destroyed; audit trail intact. |
| D7 | Auditor writes | Pessimistic: `TraceEntry` appended to local state only after `POST /api/auditor/actions` returns 2xx; recount also inserts `recount_requests` | Optimistic | Auditor signatures must not exist locally without existing in `auditor_actions`. |
| D8 | Export | One `POST /api/export`: inserts `export_batches` + `export_lines` from verified records, responds `text/csv` attachment (Import Count Sequences) with batch id header; browser saves blob | Separate generate + download routes | Atomic; no orphan batches. |
| D9 | Schema truth | Live schema (MCP `list_tables`) is the column source of truth at apply time; docs (`docs/database/*.md`) are reference only | Coding from docs | No-assumptions rule; docs describe an archived branch's design. |
| D10 | Empty operational tables | Additive demo seed rows for `audit_plans`/`plan_operators`/`profiles` (SQL via MCP, not a migration) | Seeding in app code | `/api/plans` returns nothing otherwise (RF-06 UI is out of scope). Catalogue tables untouched. |

## Data Flow

    ConsentScreen ─POST /api/consent──────────────▶ voice_consents
    PlansScreen ◀─GET /api/plans?operator=──────── audit_plans ⋈ plan_operators
    pipeline ─POST /api/anomaly-check─▶ validation(product_count_ranges,
                                        warehouse_stock_balances) ─▶ verdict only
    CONFIRM/KEEP_NOTED ─POST /api/records─▶ re-validate ─▶ count_records
                                                           (+ record_anomalies)
    RECORD_DELETED ─DELETE /api/records/[id]─▶ is_deleted = true
    AuditorReview ◀─GET /api/auditor/records── count_records ⋈ record_anomalies
    approve/correct/recount ─POST /api/auditor/actions─▶ auditor_actions (+recount_requests)
    Exportar ─POST /api/export─▶ export_batches + export_lines ─▶ CSV download

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `frontend/package.json` | Modify | Pinned `@supabase/supabase-js` |
| `frontend/src/pages/api/_supabase.ts` | Create | Server-only client factory (D1) |
| `frontend/src/pages/api/{consent,plans,anomaly-check,export}.ts`, `records/index.ts`, `records/[id].ts`, `auditor/{records,actions}.ts` | Create | Thin route handlers, `prerender = false` |
| `frontend/src/lib/server/{db.ts,validation.ts,authz.ts,export.ts}` | Create | `Db` interface + supabase impl; anomaly validation; plan-scope check; CSV formatting — all stub-testable |
| `frontend/src/lib/api/operational.ts` | Create | Browser client fns (reuse exported `request<T>` from `client.ts`) |
| `frontend/src/lib/api/client.ts` | Modify | Export `request` helper |
| `frontend/src/lib/anomaly/engine.ts`, `fixtureEngine.ts`, `lib/pipeline.ts` | Modify | Async `check` (D4) |
| `frontend/src/lib/session/{types,reducer}.ts` | Modify | `planId`/`operatorId` on state; `RECORD_PERSISTED`/`RECORD_PERSIST_FAILED`; `sync` initial record state |
| `frontend/src/components/operator/{CountSession,ConsentScreen,PlansScreen}.tsx` | Modify | Persistence seams (props defaulted to real fns), real plan fetch, blocking consent |
| `frontend/src/components/auditor/AuditorReview.tsx` | Modify | Fetch on mount + loading/error states; pessimistic action writes; real export download |
| `frontend/src/fixtures/auditorSeed.ts` | Modify | Types move to `lib/auditor/types.ts`; fixture data becomes test-only |

## Interfaces / Contracts

```ts
// lib/server/db.ts — routes depend on this, tests stub it
export interface Db {
  from(table: string): /* minimal supabase-js query surface used */;
}
// POST /api/records body
{ clientRecordId: string; planId: string; operatorId: string; catalogueId: string;
  quantity: number; unit: string | null; articulo: string; nrArticulo: string | null;
  spokenName: string; }
// verdict (only anomaly shape operators ever receive)
{ verdict: 'ok' | 'warning' | 'error'; anomaly: Anomaly | null }
```

## Testing Strategy

| Layer | What | Approach |
|-------|------|----------|
| Unit | `lib/server/*` validation, authz, export formatting | Stub `Db` objects (server twin of prop seams) |
| Unit | `lib/api/operational.ts` | Existing `stubFetchJson`/`stubFetchRejecting` harness from `client.test.ts` |
| Component | CountSession persistence, AuditorReview fetch/actions/loading/error | Prop-injected doubles (`count-session.test.tsx` pattern) |
| RED guards | RF-18: no `sd` in operator responses; RF-07: unassigned plan rejected 403; RF-21: delete is soft | Route-logic unit tests |

RLS audit (verification task, not redesign): query `pg_policies` + MCP `get_advisors`; checklist: UPDATE has SELECT + `WITH CHECK`; `TO authenticated` paired with ownership predicate; no `for all` double-evaluation; no `user_metadata` in policies; helper fns in non-exposed schema; views `security_invoker`. Fix genuine gaps only; document results.

## Threat Matrix

All rows N/A — no shell, subprocess, VCS/PR automation, or executable-file classification. New HTTP routes derive targets only from env (SSRF guard precedent, REQ-PRX-5); adversarial data-exposure cases covered by RED guards above.

## Migration / Rollout

No schema changes. Demo operational seed (D10) is additive data. Rollback = revert PR; operational rows may remain or be truncated.

## Open Questions

- [ ] Does the live `count_records` schema carry a client-id/idempotency column with a unique index? Verify at apply (D9); if absent, flag duplicate-on-retry risk as follow-up.
- [ ] Exact "Import Count Sequences" CSV column layout — confirm against `v_oracle_export_preview` view definition at apply.
