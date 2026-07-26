/**
 * `AuditorRecordDto` -> `AuditorRecord` (REQ-AUD-3, task 5.6).
 *
 * The route answers with STORAGE values (numeric quantities, a list of
 * `record_anomalies` rows); the dashboard renders a DISPLAY shape. Keeping the
 * translation here as a total, pure function means the island only fetches and
 * hands over, and every mapping rule is asserted without rendering anything.
 *
 * What this function deliberately does NOT do is invent the fields the route
 * does not send. `system`, `time` and `consensus` have no source in
 * `count_records` today, so they render as `SYSTEM_UNKNOWN` rather than as a
 * plausible-looking zero.
 */
import type { AuditorRecordDto } from '../api/operational';
import type { AlertKind, AuditorAlert, AuditorRecord } from './types';
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

export function toAuditorRecord(dto: AuditorRecordDto, plan: string): AuditorRecord {
  const unit = dto.unitCode ?? '';
  return {
    id: dto.id,
    counted: { quantity: displayQuantity(dto.quantity), unit },
    // Same unit on purpose: `diffOf` short-circuits on the unknown quantity, so
    // the unit here is only what the cell prints under an em dash.
    system: { quantity: SYSTEM_UNKNOWN, unit },
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
    // Persisted `auditor_actions` are not read back yet (REQ-AUD-4 "survives
    // reload" is the remaining half); the island appends entries it has just
    // written and confirmed.
    trace: [],
  };
}

export function toAuditorRecords(
  dtos: readonly AuditorRecordDto[],
  plan: string,
): readonly AuditorRecord[] {
  return dtos.map((dto) => toAuditorRecord(dto, plan));
}
