/**
 * Auditor dashboard DISPLAY types and their pure derivations (REQ-AUD-1..5).
 *
 * These used to live in `src/fixtures/auditorSeed.ts`, next to the eight seed
 * records the dashboard ran on. Task 5.6 makes the dashboard read live rows from
 * `GET /api/auditor/records`, so the shape is no longer a property of the
 * fixture: the fixture is now one PRODUCER of this shape (in tests), and
 * `lib/auditor/records.ts` is the other (in production).
 *
 * Nothing here touches the network or the DOM — badge, alert and diff selection
 * are total functions of one record, which is why they are tested directly.
 */

/** The three alert rules the anomaly engine fires. */
export type AlertKind = 'unidad' | 'cantidad' | 'negativo';

/** Every badge the record list can show (REQ-AUD-3). */
export type BadgeKind = AlertKind | 'verificado' | 'manual' | 'sin-novedad';

/** Semantic tone; components map it to the token ramp, never to a hex. */
export type Tone = 'warn' | 'info' | 'neutral' | 'ok';

export interface AuditorAlert {
  kind: AlertKind;
  title: string;
  detail: string;
}

/** A quantity as shown: a pre-formatted es-CO number plus its display unit. */
export interface Measure {
  quantity: string;
  unit: string;
}

/**
 * Stands in for a value the system genuinely does not have.
 *
 * `GET /api/auditor/records` now joins `warehouse_stock_balances` (task 6.6), so
 * a theoretical stock reaches the pane whenever one exists. This marker is what
 * a record with NO balance row gets. Rendering `0` or an empty cell there would
 * both be lies of a different kind — one invents a stock, the other hides that a
 * stock exists.
 */
export const SYSTEM_UNKNOWN = '—';

/** One signed line of the RF-32 trace. */
export interface TraceEntry {
  /** Auditor who acted — "firmada con usuario". */
  user: string;
  /** Wall-clock time of the action — "y hora". */
  time: string;
  /** What was done, in the auditor's own vocabulary. */
  action: string;
  /** "y motivo" — optional because approving needs no justification. */
  reason?: string;
}

export interface AuditorRecord {
  id: string;
  /** What the operator counted (RF-18 blind counting binds the OPERATOR only). */
  counted: Measure;
  /** Theoretical stock. The AUDITOR may see this; `/conteo` never may (C6). */
  system: Measure;
  articulo: string;
  sku: string;
  operator: string;
  time: string;
  /** Open alert, or `null` for a clean record. */
  alert: AuditorAlert | null;
  /** True when the article was resolved through the manual-search sheet (S7). */
  manualSearch: boolean;
  /** Flipped by "Aprobar registro"; also what closes an open alert. */
  verified: boolean;
  /** RF-32 detail rows. */
  plan: string;
  dictated: string;
  consensus: string;
  trace: readonly TraceEntry[];
}

/** A record still needs the auditor's eyes while its alert is unresolved. */
export function isOpenAlert(record: AuditorRecord): boolean {
  return record.alert !== null && !record.verified;
}

/** Drives the header pill "{n} alertas abiertas" and the export gate. */
export function openAlertCount(records: readonly AuditorRecord[]): number {
  return records.filter(isOpenAlert).length;
}

export interface Badge {
  kind: BadgeKind;
  label: string;
  tone: Tone;
}

const BADGES: Readonly<Record<BadgeKind, Badge>> = {
  unidad: { kind: 'unidad', label: 'Unidad', tone: 'warn' },
  cantidad: { kind: 'cantidad', label: 'Cantidad atípica', tone: 'warn' },
  negativo: { kind: 'negativo', label: 'Saldo negativo', tone: 'warn' },
  verificado: { kind: 'verificado', label: 'Verificado', tone: 'info' },
  manual: { kind: 'manual', label: 'Búsqueda manual', tone: 'neutral' },
  'sin-novedad': { kind: 'sin-novedad', label: 'Sin novedad', tone: 'neutral' },
};

/**
 * The single badge a record shows (REQ-AUD-3).
 *
 * Precedence — "Verificado" wins over everything, because an approved record is
 * settled regardless of why it was flagged; then the open alert; then the
 * provenance note; then the quiet default.
 */
export function badgeOf(record: AuditorRecord): Badge {
  if (record.verified) return BADGES.verificado;
  if (record.alert !== null) return BADGES[record.alert.kind];
  if (record.manualSearch) return BADGES.manual;
  return BADGES['sin-novedad'];
}

export interface Diff {
  label: string;
  tone: Tone;
}

/** Parse an es-CO display quantity ("6,5", "−2") back into a number. */
function parseEsNumber(value: string): number {
  return Number(value.replace('−', '-').replace(',', '.'));
}

/**
 * The detail pane's diff line (REQ-AUD-2).
 *
 * An absent system value is reported FIRST: with no theoretical stock there is
 * no difference to state, and "Diferencia" would be a claim about a number that
 * was never read. A unit mismatch comes next, before a numeric one: when the
 * units disagree the two quantities are not comparable at all.
 */
export function diffOf(record: AuditorRecord): Diff {
  if (record.system.quantity === SYSTEM_UNKNOWN) {
    return { label: 'Sistema sin dato', tone: 'neutral' };
  }
  if (record.counted.unit !== record.system.unit) {
    return { label: 'Unidad distinta', tone: 'warn' };
  }
  if (parseEsNumber(record.counted.quantity) !== parseEsNumber(record.system.quantity)) {
    return { label: 'Diferencia', tone: 'warn' };
  }
  return { label: 'Sin diferencia', tone: 'ok' };
}

/* ------------------------------------------------------------- warehouses */

export type WarehouseState = 'cerrada' | 'en-curso' | 'programada';

export interface Warehouse {
  id: string;
  name: string;
  percentage: number;
  counted: number;
  total: number;
  state: WarehouseState;
  /** Verbatim second line: state plus operator, or the scheduled hour. */
  stateLabel: string;
  /** The bodega the review view opens on. */
  selected: boolean;
}
