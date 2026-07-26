# Supabase Data Access Specification

## Purpose

Server-side Supabase access for operational data: consent, plans, count records, and auditor actions, brokered exclusively by Astro API routes. Out of scope: catalogue reads (owned by `redis-catalogue-cache`), real Supabase Auth (named technical debt).

## Requirements

### Requirement: REQ-SDA-1 — Server-only Supabase client

All operational reads/writes MUST go through server-side API routes using a service-role client. The service-role key MUST live only in server-only env (never a `PUBLIC_`-prefixed variable) and MUST NOT reach the browser in any bundle, response, or header. The package version MUST be pinned.

#### Scenario: Key never reaches the client

- GIVEN the built frontend bundle and any API response
- WHEN they are inspected
- THEN the service-role key appears nowhere client-visible

### Requirement: REQ-SDA-2 — S1 consent persisted

Accepting the S1 consent screen MUST persist a `voice_consents` row before counting begins. A failed write MUST surface a retryable error and MUST NOT let the flow advance as if consent were recorded.

#### Scenario: Consent survives reload

- GIVEN an operator accepts consent
- WHEN the app is reloaded
- THEN the `voice_consents` row still exists

#### Scenario: Write failure blocks advance

- GIVEN the consent write fails
- WHEN the operator accepts
- THEN an error with retry is shown AND `plans` is not reached

### Requirement: REQ-SDA-3 — Plan-based selection reads

The operator plan list MUST come from `audit_plans` joined with `plan_operators`, listing only plans assigned to the identified operator. Raw warehouse/catalogue listing MUST NOT be the selection source. (RF-11)

#### Scenario: Only assigned plans listed

- GIVEN plans exist for several operators
- WHEN the identified operator loads selection
- THEN only that operator's assigned plans render

### Requirement: REQ-SDA-4 — Count record writes with redo semantics

Each confirmed voice count MUST insert a `count_records` row. Records are voice-CREATED only. Delete-and-redo MUST set `is_deleted = true` on the old row AND insert a new row — counted values are never UPDATEd in place. (RF-20/21)

#### Scenario: Redo is soft-delete plus insert

- GIVEN a persisted record
- WHEN the operator deletes and re-dictates
- THEN the original row has `is_deleted = true` AND a new row exists AND no counted value on the original row changed

### Requirement: REQ-SDA-5 — Route-level authorization (RF-07)

Because no real auth session exists, every operational route MUST enforce plan scoping in route logic: a write or read against a plan not assigned to the requesting operator identity MUST be rejected with an authorization error and MUST NOT touch the database. RLS remains enabled as defense-in-depth only, never the enforcement layer.

#### Scenario: Unassigned plan write rejected

- GIVEN operator A is not in `plan_operators` for plan P
- WHEN a count-record write for plan P arrives identified as operator A
- THEN the route rejects it AND no `count_records` row is created
