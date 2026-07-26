/**
 * `AuditorRecordDto` -> `AuditorRecord` (REQ-AUD-3, task 5.6).
 *
 * The route answers with STORAGE values (numeric quantities, a list of
 * `record_anomalies` rows); the dashboard renders a DISPLAY shape. Keeping the
 * translation here as a total, pure function means the island only fetches and
 * hands over, and every mapping rule is asserted without rendering anything.
 *
 * What this function deliberately does NOT do is invent the fields the route
 * does not send. `time` and `consensus` have no source in `count_records`
 * today, so they render as `SYSTEM_UNKNOWN` rather than as a plausible-looking
 * zero. `system` (task 6.6) and `trace` (task 6.7) DO have one now — the
 * theoretical balance and the persisted `auditor_actions` — and a record still
 * missing either keeps the unknown marker, because absent data and unwired data
 * must not look the same.
 */
import type { AuditorActionEntryDto, AuditorRecordDto } from '../api/operational';
import type { AlertKind, AuditorAlert, AuditorRecord, TraceEntry } from './types';
import { SYSTEM_UNKNOWN } from './types';

/** Server anomaly `type` -> the badge kind the dashboard draws. */
const KIND_OF: Readonly<Record<string, AlertKind>> = {
  unit_mismatch: 'unidad',
  atypical_quantity: 'cantidad',
  negative_balance: 'negativo',
};

const OPEN = 'open';
const VERIFIED = 'verified';

/** es-CO renders `6,5`; the Oracle file renders `6.5`. This is the UI half. */
function displayQuantity(quantity: number): string {
  return Number.isFinite(quantity) ? String(quantity).replace('.', ',') : SYSTEM_UNKNOWN;
}

/**
 * The one alert a record carries, if any.
 *
 * Only an `open` anomaly counts: a resolved one is history, and letting it drive
 * the badge would keep a settled record in "Requieren mirada" forever.
 */
function alertOf(dto: AuditorRecordDto): AuditorAlert | null {
  for (const anomaly of dto.anomalies) {
    if (anomaly.status !== OPEN) continue;
    const kind = KIND_OF[anomaly.type];
    if (kind === undefined) continue;
    return { kind, title: anomaly.title, detail: anomaly.title };
  }
  return null;
}

/**
 * Auditor vocabulary for each stored verb (task 6.7).
 *
 * The same words `AuditorReview` writes when it signs a fresh action, so a
 * reloaded trail and a just-signed one read identically. An unknown verb keeps
 * its stored value rather than being dropped: an unreadable line in the trail is
 * still evidence, a missing one is not.
 */
const ACTION_LABEL: Readonly<Record<string, string>> = {
  approve: 'Aprobó el registro',
  correct: 'Corrigió la cantidad',
  reject: 'Rechazó el registro',
  request_recount: 'Pidió reconteo',
};

/**
 * The stored UTC timestamp in the operation's own zone.
 *
 * `America/Bogota` is pinned rather than left to the browser: the trail states
 * when something happened in the bodega, and an auditor opening it from another
 * timezone must read the same hour the counter lived.
 */
function displayTime(iso: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return SYSTEM_UNKNOWN;
  return at.toLocaleTimeString('es-CO', {
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/Bogota',
  });
}

function toTraceEntry(action: AuditorActionEntryDto): TraceEntry {
  return {
    user: action.auditor ?? SYSTEM_UNKNOWN,
    time: displayTime(action.createdAt),
    action: ACTION_LABEL[action.action] ?? action.action,
    // Absent, not empty: approving needs no justification, and a blank "Motivo"
    // cell would suggest one was expected and left out.
    ...(action.note === null || action.note === '' ? {} : { reason: action.note }),
  };
}

/**
 * The system side of "Contado vs Sistema" (REQ-AUD-2, task 6.6).
 *
 * A record with no balance row keeps `SYSTEM_UNKNOWN`, so `diffOf` still answers
 * "Sistema sin dato" — the absence is reported, never filled with a zero.
 */
function systemMeasure(dto: AuditorRecordDto, countedUnit: string) {
  if (dto.systemQty === null || dto.systemQty === undefined) {
    // Same unit on purpose: `diffOf` short-circuits on the unknown quantity, so
    // the unit here is only what the cell prints under an em dash.
    return { quantity: SYSTEM_UNKNOWN, unit: countedUnit };
  }
  return {
    quantity: displayQuantity(dto.systemQty),
    unit: dto.systemUnitCode ?? countedUnit,
  };
}

export function toAuditorRecord(dto: AuditorRecordDto, plan: string): AuditorRecord {
  const unit = dto.unitCode ?? '';
  return {
    id: dto.id,
    counted: { quantity: displayQuantity(dto.quantity), unit },
    system: systemMeasure(dto, unit),
    articulo: dto.articulo,
    sku: dto.nrArticulo ?? '',
    operator: dto.countedBy ?? SYSTEM_UNKNOWN,
    time: SYSTEM_UNKNOWN,
    alert: alertOf(dto),
    // No column records how the article was resolved; claiming "Búsqueda
    // manual" without evidence would put a provenance badge on a voice match.
    manualSearch: false,
    verified: dto.status === VERIFIED,
    plan,
    dictated: dto.spokenName,
    consensus: SYSTEM_UNKNOWN,
    // Newest first, which is the order the island prepends into: a reloaded
    // trail and a just-signed one are indistinguishable on screen (RF-32).
    trace: [...(dto.actions ?? [])].reverse().map(toTraceEntry),
  };
}

export function toAuditorRecords(
  dtos: readonly AuditorRecordDto[],
  plan: string,
): readonly AuditorRecord[] {
  return dtos.map((dto) => toAuditorRecord(dto, plan));
}
