/**
 * Response helpers shared by the Supabase-backed API routes.
 *
 * The error envelope matches the one the Python services and the proxy already
 * emit (`{error:{code,message}}`), so `lib/api/client.ts`'s existing taxonomy
 * decodes these routes without a second mechanism (REQ-PRX-2).
 */

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
