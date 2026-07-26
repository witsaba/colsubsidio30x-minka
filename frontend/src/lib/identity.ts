/**
 * Who the browser CLAIMS to be (design D2 — the named technical debt).
 *
 * There is no Supabase Auth session in this change: `profiles.id` is supplied by
 * the client and every operational route re-checks the claim against
 * `plan_operators` before it touches anything (`assertPlanAssignment`, RF-07).
 * So these constants are a REQUEST identity, never an authorisation — a wrong
 * value here gets a 403, not another operator's data.
 *
 * They are the demo identities seeded by tasks 1.4/1.5 and recorded in
 * `openspec/changes/supabase-operational-integration/design.md`. Keeping them in
 * ONE module is the point: when real auth lands, this file is what disappears,
 * and the compiler lists every call site that has to start reading a session.
 *
 * `PUBLIC_`-prefixed env is deliberate and safe — these are row identifiers, not
 * credentials. The service-role key lives only in `pages/api/_supabase.ts`.
 */

const env = import.meta.env as Record<string, string | undefined>;

/** `profiles.id` of the seeded demo operator `OP.001`. */
export const DEMO_OPERATOR_ID =
  env.PUBLIC_DEMO_OPERATOR_ID ?? '11111111-1111-4111-8111-111111111111';

/** `profiles.id` of the seeded demo auditor `AUD.001`. */
export const DEMO_AUDITOR_ID =
  env.PUBLIC_DEMO_AUDITOR_ID ?? '33333333-3333-4333-8333-333333333333';

/** `audit_plans.id` of the seeded demo plan `PLAN-DEMO-001`. */
export const DEMO_PLAN_ID = env.PUBLIC_DEMO_PLAN_ID ?? '44444444-4444-4444-8444-444444444444';
