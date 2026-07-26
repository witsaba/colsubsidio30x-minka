/**
 * Browser client for the Supabase-backed routes (REQ-SDA-1..5, REQ-AUD-3/4).
 *
 * Same rules as `client.ts`, which this module reuses rather than reimplements:
 * every call is same-origin `/api/*`, no Supabase key or URL ever exists in the
 * browser, and every transport outcome collapses into a `UiError` the UI
 * already knows how to render.
 *
 * These functions are what the components receive as INJECTED props, defaulted
 * to the real implementations — the same seam pattern the pipeline already uses,
 * so component tests never touch the network.
 */
import { request, MATCH_TIMEOUT_MS } from './client';
import { UiError } from './types';

const CONSENT_URL = '/api/consent';
const EXPORT_URL = '/api/export';
const PLANS_URL = '/api/plans';
const RECORDS_URL = '/api/records';
const AUDITOR_RECORDS_URL = '/api/auditor/records';
const AUDITOR_ACTIONS_URL = '/api/auditor/actions';

/** Every operational route answers from Postgres in single-digit milliseconds. */
const OPERATIONAL_TIMEOUT_MS = MATCH_TIMEOUT_MS;

function jsonInit(method: string, body: unknown): RequestInit {
  return { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) };
}

/* -------------------------------------------------------------------------- */
/* Consent (REQ-SDA-2)                                                        */
/* -------------------------------------------------------------------------- */

export interface ConsentInput {
  operatorId: string;
  policyVersion?: string;
}

/**
 * BLOCKING by contract (design D5): the caller must not advance past S1 until
 * this resolves. A rejection is a `UiError` and keeps the operator on the
 * consent screen with a retry.
 */
export function postConsent(input: ConsentInput): Promise<{ id: string }> {
  return request<{ id: string }>(CONSENT_URL, jsonInit('POST', input), OPERATIONAL_TIMEOUT_MS);
}

/* -------------------------------------------------------------------------- */
/* Plans (REQ-SDA-3)                                                          */
/* -------------------------------------------------------------------------- */

export interface PlanSummary {
  id: string;
  name: string;
  warehouseId: string;
  catalogueId: string | null;
}

export function fetchPlans(operatorId: string, opts?: { signal?: AbortSignal }): Promise<PlanSummary[]> {
  const url = `${PLANS_URL}?operator=${encodeURIComponent(operatorId)}`;
  return request<PlanSummary[]>(url, { method: 'GET' }, OPERATIONAL_TIMEOUT_MS, opts?.signal);
}

/* -------------------------------------------------------------------------- */
/* Count records (REQ-SDA-4)                                                  */
/* -------------------------------------------------------------------------- */

export interface CreateRecordInput {
  /** Client-minted idempotency key: a retry must not count the shelf twice. */
  clientRecordId: string;
  planId: string;
  operatorId: string;
  /**
   * The article, as EITHER identity. The browser normally has only the
   * matcher's `nrArticulo`; the route resolves it to a `products.id`
   * (`lib/server/products.ts`) because shipping the product table to the device
   * is not a trade this app makes.
   */
  productId?: string | null;
  nrArticulo?: string | null;
  quantity: number;
  unitCode: string | null;
  spokenName: string;
}

/** The blind verdict shape — never carries a bound or a theoretical stock. */
export interface CreatedRecord {
  id: string;
  verdict: 'ok' | 'warning' | 'error';
  anomaly: { type: string; severity: string; title: string } | null;
}

export function createRecord(input: CreateRecordInput): Promise<CreatedRecord> {
  return request<CreatedRecord>(RECORDS_URL, jsonInit('POST', input), OPERATIONAL_TIMEOUT_MS);
}

/** Soft delete (RF-21). A redo is a NEW `createRecord`, never an update. */
export function deleteRecord(
  id: string,
  input: { operatorId: string; reason?: string },
): Promise<{ id: string; deleted: boolean }> {
  return request<{ id: string; deleted: boolean }>(
    `${RECORDS_URL}/${encodeURIComponent(id)}`,
    jsonInit('DELETE', input),
    OPERATIONAL_TIMEOUT_MS,
  );
}

/* -------------------------------------------------------------------------- */
/* Auditor (REQ-AUD-3/4)                                                      */
/* -------------------------------------------------------------------------- */

export interface AuditorRecordDto {
  id: string;
  quantity: number;
  unitCode: string | null;
  articulo: string;
  nrArticulo: string | null;
  spokenName: string;
  status: string;
  countedBy: string | null;
  anomalies: Array<{ type: string; severity: string; title: string; status: string }>;
}

export function fetchAuditorRecords(
  planId: string,
  opts?: { signal?: AbortSignal },
): Promise<AuditorRecordDto[]> {
  const url = `${AUDITOR_RECORDS_URL}?plan=${encodeURIComponent(planId)}`;
  return request<AuditorRecordDto[]>(url, { method: 'GET' }, OPERATIONAL_TIMEOUT_MS, opts?.signal);
}

export interface AuditorActionInput {
  auditorId: string;
  recordId: string;
  action: 'approve' | 'correct' | 'reject' | 'request_recount';
  newQuantity?: number;
  newUnitCode?: string;
  note?: string;
}

/**
 * PESSIMISTIC by contract (design D7): the caller draws the trace entry only
 * after this resolves, so a signature never exists on screen without existing
 * in `auditor_actions`.
 */
export function postAuditorAction(input: AuditorActionInput): Promise<{ id: string; action: string }> {
  return request<{ id: string; action: string }>(
    AUDITOR_ACTIONS_URL,
    jsonInit('POST', input),
    OPERATIONAL_TIMEOUT_MS,
  );
}

/* -------------------------------------------------------------------------- */
/* Oracle export (REQ-OE-1/2)                                                 */
/* -------------------------------------------------------------------------- */

export interface ExportDownload {
  /** The exact bytes the auditor saves, and the ones `export_lines` holds. */
  csv: string;
  /** `export_batches.id` — what makes the saved file reconcilable later. */
  batchId: string;
  filename: string;
}

const FILENAME = /filename="?([^";]+)"?/i;

/**
 * `POST /api/export` — the only route in this client that does NOT answer JSON,
 * so it cannot reuse `request<T>`. The error taxonomy is reproduced rather than
 * approximated: a non-2xx is a `UiError` and produces NO file, which is exactly
 * what REQ-OE-2 demands (a CSV with no persisted batch behind it is
 * unreconcilable).
 */
export async function downloadExport(input: {
  planId: string;
  auditorId: string;
}): Promise<ExportDownload> {
  let response: Response;
  try {
    response = await fetch(EXPORT_URL, {
      ...jsonInit('POST', input),
      signal: AbortSignal.timeout(OPERATIONAL_TIMEOUT_MS),
    });
  } catch {
    throw new UiError('proxy_unreachable');
  }

  if (!response.ok) throw new UiError('vendor_error');

  const csv = await response.text();
  // An empty body means the route produced no lines at all. Handing the auditor
  // a blank file would look like a successful export of nothing.
  if (csv.trim() === '') throw new UiError('vendor_error');

  const disposition = response.headers.get('content-disposition') ?? '';
  const named = FILENAME.exec(disposition);

  return {
    csv,
    batchId: response.headers.get('x-export-batch-id') ?? '',
    filename: named?.[1] ?? `export-${input.planId}.csv`,
  };
}

/**
 * Save an export to disk. Isolated from the component so the island's tests
 * assert WHAT would be saved without a DOM download ever firing.
 */
export function saveExportFile(download: ExportDownload): void {
  const url = URL.createObjectURL(new Blob([download.csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = download.filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
