/**
 * Response helpers shared by the Supabase-backed API routes.
 *
 * The error envelope matches the one the Python services and the proxy already
 * emit (`{error:{code,message}}`), so `lib/api/client.ts`'s existing taxonomy
 * decodes these routes without a second mechanism (REQ-PRX-2).
 */
import { DbUnavailableError } from './db';


export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

export function failure(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

/** 400 — the request itself is malformed; nothing was attempted. */
export function badRequest(message: string): Response {
  return failure(400, 'validation', message);
}

/**
 * 403 — the caller may not act on this plan (RF-07). Deliberately distinct
 * from 400: it means the request was well formed and was REFUSED.
 */
export function forbidden(message: string): Response {
  return failure(403, 'forbidden', message);
}

/** 500 — the database refused the write. Never swallowed into a 2xx. */
export function serverError(message: string): Response {
  return failure(500, 'vendor_error', message);
}

/**
 * 502 — the database could not be ASKED (`DbUnavailableError`).
 *
 * Distinct from 500 (`serverError`: a write we attempted and lost) and, far more
 * importantly, distinct from `200 []`. An empty list is a claim about the
 * warehouse; this is a statement about the server. `PlansScreen` and
 * `AuditorReview` both keep an error state precisely so those two never share a
 * rendering, and `lib/api/operational.ts` raises a `UiError` on any non-2xx, so
 * a 502 reaches that state end to end.
 *
 * The vendor message stays in the server log; the operator gets one sentence in
 * the register the screens already use ("No pudimos …", tú-form, an action).
 */
const DB_UNAVAILABLE_MESSAGE = 'No pudimos consultar la base de datos. Intenta otra vez.';

export function databaseUnavailable(): Response {
  return failure(502, 'db_unavailable', DB_UNAVAILABLE_MESSAGE);
}

/**
 * Run a route body, converting a `DbUnavailableError` into its 502.
 *
 * The catch lives in ONE place rather than at each of the ~30 read sites: the
 * defect being fixed here was a check that every site was free to omit, and a
 * per-site check is the same shape of promise. Any other exception is re-thrown
 * untouched — this converts a known failure, it does not swallow surprises.
 */
export async function respondingToDbFailure(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof DbUnavailableError)) throw error;
    console.error('database unavailable', { message: error.message });
    return databaseUnavailable();
  }
}

/** Parse a JSON body, returning `null` rather than throwing on garbage. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await request.json();
    return typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function requireString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function requireNumber(body: Record<string, unknown>, key: string): number | null {
  const value = body[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function optionalString(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
