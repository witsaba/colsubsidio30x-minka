/**
 * Server-only Supabase client factory (design D1, REQ-SDA-1).
 *
 * This module mirrors `_upstream.ts`: the `_` prefix keeps it out of Astro's
 * file-based router, and it lives physically inside `pages/api/` — the
 * server-only directory — so it can never be pulled into a browser bundle by a
 * component import.
 *
 * The key handled here is the SERVICE ROLE key: it bypasses RLS entirely. Two
 * rules follow from that and are both enforced by `tests/server/supabase-client.test.ts`:
 *
 *   - the variable names are NOT `PUBLIC_`-prefixed. Astro inlines every
 *     `PUBLIC_` variable into the client bundle, so a `PUBLIC_SUPABASE_*` name
 *     would ship the key to every operator's phone;
 *   - a missing variable throws immediately, naming itself. Building a client
 *     against `undefined` merely defers the failure into the middle of a
 *     request as an opaque network error.
 *
 * MERGE NOTE (design D1, task 6.2): the parallel `redis-catalogue-cache` change
 * may introduce its own Supabase environment variables for the matcher service.
 * These two names are the canonical ones for this repository — reconcile at
 * merge time in `docker-compose.yml` / `.env.example` rather than letting two
 * semantically identical names diverge.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export const SUPABASE_URL_ENV = 'SUPABASE_URL';
export const SUPABASE_SERVICE_ROLE_KEY_ENV = 'SUPABASE_SERVICE_ROLE_KEY';

/**
 * Read one required variable from the running process's environment.
 *
 * Resolved per call (never at module load) for the same reason `sttBase()` is:
 * the value must come from the process actually serving the request.
 */
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Falta la variable de entorno ${name}. El acceso a Supabase es exclusivamente del servidor.`,
    );
  }
  return value;
}

let cached: SupabaseClient | null = null;

/**
 * Lazy per-process singleton. Lazy because the env is only guaranteed to be
 * populated at request time; singleton because supabase-js keeps a connection
 * pool that should not be rebuilt per request.
 *
 * `persistSession` / `autoRefreshToken` are off: there is no user session on
 * the server, and any storage the client attempted would be process-global
 * state shared across unrelated requests.
 */
export function supabase(): SupabaseClient {
  if (cached) return cached;
  cached = createClient(requireEnv(SUPABASE_URL_ENV), requireEnv(SUPABASE_SERVICE_ROLE_KEY_ENV), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}

/** Test seam: drop the memoised client so env permutations can be exercised. */
export function resetSupabaseClient(): void {
  cached = null;
}
