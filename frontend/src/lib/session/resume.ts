/**
 * Session resume after a reload (REQ-OCF-13, task 6.11).
 *
 * THE PROBLEM this module exists for: `CountRecord.id` is client-minted
 * (`rec-${at}-${seq}`) and is sent as the unique `count_records.client_record_id`.
 * A reload used to start from `initialSessionState` — consent screen, empty
 * list — so re-dictating an already-counted shelf minted a NEW key and wrote a
 * SECOND row for one physical count. Double-counted inventory is precisely the
 * failure class this whole feature exists to prevent.
 *
 * Two halves, both pure so the component test never has to reason about them:
 *
 *   1. WHICH plan was being counted. The records survive in Supabase; the plan
 *      scope lived only in the reducer, which the reload destroyed. Four ids go
 *      to `sessionStorage` — ids the browser was already handed by
 *      `GET /api/plans`. Deliberately NOTHING else: no quantity, no count, and
 *      above all no theoretical stock. RF-18 blindness cannot be laundered
 *      through storage, and a projection with four fields makes that checkable.
 *      `sessionStorage` rather than `localStorage` because a resume belongs to
 *      the tab that was counting, not to the device forever.
 *
 *   2. The translation back into the reducer's own record shape, including the
 *      anomaly copy — rebuilt from the same static table `httpEngine` uses, so
 *      a restored anomaly reads identically to a fresh one and still carries no
 *      figure the server could have leaked into it.
 */
import { ANOMALY_COPY } from '../anomaly/httpEngine';
import type { RestoredRecordDto } from '../api/operational';
import type { CountRecord } from './types';

export const RESUME_STORAGE_KEY = 'minka.conteo.resume';

/** The plan scope, and only the plan scope. */
export interface ResumeContext {
  catalogueId: string;
  planId: string;
  operatorId: string;
  warehouseId: string;
}

const SCOPE_KEYS = ['catalogueId', 'planId', 'operatorId', 'warehouseId'] as const;

function defaultStorage(): Storage | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    // Storage can throw outright when the browser blocks it (private mode,
    // third-party cookie policies). A resume is an improvement, never a
    // requirement: failing here must not take the count screen down with it.
    return null;
  }
}

/**
 * Read the stored scope, or null when there is nothing trustworthy to resume.
 *
 * Every failure mode collapses to null on purpose — absent, corrupt, or only
 * partially written. A half-scoped resume would open the count screen against a
 * plan the writes cannot be attributed to, which is worse than starting over.
 */
export function readResumeContext(storage: Storage | null = defaultStorage()): ResumeContext | null {
  if (!storage) return null;

  let parsed: unknown;
  try {
    const raw = storage.getItem(RESUME_STORAGE_KEY);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Record<string, unknown>;
  if (SCOPE_KEYS.some((key) => typeof candidate[key] !== 'string' || candidate[key] === '')) {
    return null;
  }

  return {
    catalogueId: String(candidate.catalogueId),
    planId: String(candidate.planId),
    operatorId: String(candidate.operatorId),
    warehouseId: String(candidate.warehouseId),
  };
}

/** Store the scope, or clear it with `null` when the count is over. */
export function writeResumeContext(
  context: ResumeContext | null,
  storage: Storage | null = defaultStorage(),
): void {
  if (!storage) return;
  try {
    if (context === null) {
      storage.removeItem(RESUME_STORAGE_KEY);
      return;
    }
    // Explicit projection, not a spread: a caller handing in a wider object must
    // not be able to widen what reaches storage.
    storage.setItem(
      RESUME_STORAGE_KEY,
      JSON.stringify({
        catalogueId: context.catalogueId,
        planId: context.planId,
        operatorId: context.operatorId,
        warehouseId: context.warehouseId,
      }),
    );
  } catch {
    // Quota or a blocked store. Same reasoning as above: never fatal.
  }
}

/**
 * A persisted count, as the reducer's list holds it.
 *
 * The state is always settled (`ok` / `anom_noted`) and `serverId` is always
 * present, so `CountSession`'s persistence effect — which fires only for `sync`
 * records with no `serverId` — cannot write a restored row a second time.
 */
export function toCountRecord(dto: RestoredRecordDto): CountRecord {
  const copy = dto.anomaly ? ANOMALY_COPY[dto.anomaly.type as keyof typeof ANOMALY_COPY] : undefined;
  return {
    id: dto.id,
    serverId: dto.serverId,
    quantity: dto.quantity,
    unitDisplay: dto.unitDisplay,
    unitCode: dto.unitCode,
    articulo: dto.articulo,
    nrArticulo: dto.nrArticulo,
    spokenName: dto.spokenName,
    state: dto.state,
    ...(dto.anomaly && copy
      ? { anomaly: { kind: copy.kind, title: dto.anomaly.title, reason: copy.reason, hint: copy.hint } }
      : {}),
    createdAt: Date.parse(dto.createdAt) || 0,
  };
}
