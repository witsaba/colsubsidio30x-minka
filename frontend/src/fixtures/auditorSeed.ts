/**
 * Auditor seed data — design contract §3, transcribed verbatim (REQ-AUD-1..3).
 *
 * The auditor dashboard runs entirely on these fixtures tonight: the live
 * operator->auditor handoff (`POST /api/records`) is explicitly stretch (S4).
 * That makes this file product data, not test scaffolding, so nothing here may
 * be invented — every quantity, SKU, name, hour and copy string comes from the
 * design export.
 *
 * DECIMAL SEPARATORS ARE DELIBERATELY INCONSISTENT and must stay that way:
 *   - the Spanish UI renders `6,5` (comma) because that is es-CO;
 *   - the Oracle `Import Count Sequences` row renders `6.5` (period) because
 *     that file is MACHINE-TARGETED — Oracle My Inventory parses `COUNT_QTY`
 *     with a period. Normalising the two to one form would break either the
 *     locale or the import.
 *
 * Quantities are stored as PRE-FORMATTED STRINGS rather than numbers. The seed
 * is display data whose formatting is part of the contract (`6,5`, `−2` with a
 * real U+2212 minus sign as in the design); parsing helpers live in `diffOf`.
 *
 * ONE EXCEPTION to "transcribed verbatim": the bodega UNDER REVIEW is named by
 * `labelFor(DEMO_CATALOGUE_ID)`, not by the design's illustrative "Cocina
 * Principal". The operator half counts a REAL matcher catalogue, and the demo
 * showed two different names for one bodega across its two halves. The other
 * seven rows stay illustrative — only the active bodega has to be coherent.
 */
import { DEMO_CATALOGUE_ID, labelFor } from '../lib/catalogues';

/**
 * The bodega the operator actually counted, named exactly as the operator saw
 * it. Single source: `lib/catalogues.ts`.
 */
export const REVIEWED_WAREHOUSE_NAME = labelFor(DEMO_CATALOGUE_ID);

/**
 * The display types and their pure derivations now live in
 * `src/lib/auditor/types.ts` (task 5.6): the dashboard reads LIVE records, so
 * the shape is no longer a property of this fixture. They are re-exported here
 * so the seed and its test keep one import, and so `cierre.astro` / `base.astro`
 * are unaffected.
 */
export type {
  AlertKind,
  AuditorAlert,
  AuditorRecord,
  Badge,
  BadgeKind,
  Diff,
  Measure,
  Tone,
  TraceEntry,
  Warehouse,
  WarehouseState,
} from '../lib/auditor/types';
export { badgeOf, diffOf, isOpenAlert, openAlertCount, SYSTEM_UNKNOWN } from '../lib/auditor/types';

import type { AuditorRecord, Tone, Warehouse } from '../lib/auditor/types';

const PLAN = `${REVIEWED_WAREHOUSE_NAME} · 31 jul`;
/** Mocked, never computed: module 2 (3-model consensus) does not exist (C4). */
const CONSENSUS = '3 de 3';

export const AUDITOR_RECORDS: readonly AuditorRecord[] = [
  {
    id: 'aud-1',
    counted: { quantity: '900', unit: 'g' },
    system: { quantity: '4', unit: 'L' },
    articulo: 'ACEITE DE OLIVA EXTRA VIRGEN 500ML',
    sku: 'MP-10077',
    operator: 'Pablo R.',
    time: '8:23',
    alert: {
      kind: 'unidad',
      title: 'Unidad fuera del catálogo',
      detail:
        'Este artículo se cuenta en litros. El contador dictó gramos: 900 g no es convertible sin la equivalencia del producto.',
    },
    manualSearch: false,
    verified: false,
    plan: PLAN,
    dictated: 'novecientos gramos de aceite de oliva extra virgen',
    consensus: CONSENSUS,
    trace: [],
  },
  {
    id: 'aud-2',
    counted: { quantity: '305', unit: 'und' },
    system: { quantity: '32', unit: 'und' },
    articulo: 'GASEOSA PERSONAL 400ML',
    sku: 'MP-10505',
    operator: 'Pablo R.',
    time: '8:31',
    alert: {
      kind: 'cantidad',
      title: 'Cantidad 10× sobre el rango',
      detail:
        'El rango histórico de esta bodega es 20 a 40 unidades. Vale la pena un reconteo antes de cerrar.',
    },
    manualSearch: false,
    verified: false,
    plan: PLAN,
    dictated: 'trescientas cinco unidades de gaseosa personal',
    consensus: CONSENSUS,
    trace: [],
  },
  {
    id: 'aud-3',
    counted: { quantity: '0', unit: 'und' },
    // U+2212 MINUS SIGN, as printed in the design — not an ASCII hyphen.
    system: { quantity: '−2', unit: 'und' },
    articulo: 'SALSA DE SOYA 1L',
    sku: 'MP-10333',
    operator: 'Marta G.',
    time: '8:36',
    alert: {
      kind: 'negativo',
      title: 'El sistema arrastra saldo negativo',
      detail:
        'El teórico está en −2. El conteo en 0 confirma el error previo: hay que ajustar el saldo, no el conteo.',
    },
    manualSearch: false,
    verified: false,
    plan: PLAN,
    dictated: 'cero unidades de salsa de soya',
    consensus: CONSENSUS,
    trace: [],
  },
  {
    id: 'aud-4',
    counted: { quantity: '3', unit: 'kg' },
    system: { quantity: '3,2', unit: 'kg' },
    articulo: 'LECHUGA BATAVIA',
    sku: 'MP-10221',
    operator: 'Pablo R.',
    time: '8:21',
    alert: null,
    manualSearch: false,
    verified: false,
    plan: PLAN,
    dictated: 'tres kilos de lechuga batavia',
    consensus: CONSENSUS,
    trace: [],
  },
  {
    id: 'aud-5',
    counted: { quantity: '12', unit: 'und' },
    system: { quantity: '12', unit: 'und' },
    articulo: 'ACEITE VEGETAL GIRASOL 3L',
    sku: 'MP-10038',
    operator: 'Pablo R.',
    time: '8:21',
    alert: null,
    manualSearch: false,
    verified: false,
    plan: PLAN,
    dictated: 'doce botellas de aceite vegetal',
    consensus: CONSENSUS,
    trace: [],
  },
  {
    id: 'aud-6',
    counted: { quantity: '6,5', unit: 'kg' },
    system: { quantity: '6,5', unit: 'kg' },
    articulo: 'ARROZ BLANCO PREPARADO',
    sku: 'PT-20877',
    operator: 'Marta G.',
    time: '8:14',
    alert: null,
    manualSearch: false,
    verified: false,
    plan: PLAN,
    dictated: 'seis kilos y medio de arroz blanco preparado',
    consensus: CONSENSUS,
    trace: [],
  },
  {
    id: 'aud-7',
    counted: { quantity: '24', unit: 'und' },
    system: { quantity: '24', unit: 'und' },
    articulo: 'PECHUGA POLLO FILETE X 180G',
    sku: 'MP-10412',
    operator: 'Marta G.',
    time: '8:12',
    alert: null,
    manualSearch: false,
    verified: false,
    plan: PLAN,
    dictated: 'veinticuatro unidades de pechuga de pollo filete',
    consensus: CONSENSUS,
    trace: [],
  },
  {
    id: 'aud-8',
    counted: { quantity: '5', unit: 'und' },
    system: { quantity: '5', unit: 'und' },
    articulo: 'TABLA ACRILICA PICAR BLANCO 50X38CM FB',
    sku: 'DT-30112',
    operator: 'Pablo R.',
    time: '8:33',
    alert: null,
    manualSearch: true,
    verified: false,
    plan: PLAN,
    dictated: 'cinco tablas para picar blancas',
    consensus: CONSENSUS,
    trace: [],
  },
] as const;

export const AUDITOR_WAREHOUSES: readonly Warehouse[] = [
  { id: 'w-almacen', name: 'Almacén General', percentage: 100, counted: 412, total: 412, state: 'cerrada', stateLabel: 'Cerrada · Jorge M.', selected: false },
  { id: 'w-cocina', name: REVIEWED_WAREHOUSE_NAME, percentage: 78, counted: 84, total: 107, state: 'en-curso', stateLabel: 'En curso · Pablo R.', selected: true },
  { id: 'w-restaurante', name: 'Restaurante Principal', percentage: 100, counted: 96, total: 96, state: 'cerrada', stateLabel: 'Cerrada · Marta G.', selected: false },
  { id: 'w-cafeteria', name: 'Cafetería Primer Piso', percentage: 0, counted: 0, total: 62, state: 'programada', stateLabel: 'Programada 11:00', selected: false },
  { id: 'w-bar', name: 'Bar Piscina', percentage: 100, counted: 48, total: 48, state: 'cerrada', stateLabel: 'Cerrada · Luis P.', selected: false },
  { id: 'w-panaderia', name: 'Panadería', percentage: 100, counted: 71, total: 71, state: 'cerrada', stateLabel: 'Cerrada · Ana T.', selected: false },
  { id: 'w-aseo', name: 'Bodega Aseo', percentage: 100, counted: 58, total: 58, state: 'cerrada', stateLabel: 'Cerrada · Jorge M.', selected: false },
  { id: 'w-zoologico', name: 'Bodega Zoológico', percentage: 0, counted: 0, total: 39, state: 'programada', stateLabel: 'Programada 14:00', selected: false },
] as const;

/** Header of the left pane: "Bodegas · 5 de 8 cerradas". */
export const WAREHOUSES_CLOSED = AUDITOR_WAREHOUSES.filter((w) => w.state === 'cerrada').length;

/* ------------------------------------------------------------ Oracle file */

/**
 * One line of the Oracle My Inventory `Import Count Sequences` file.
 *
 * `countQty` is a string on purpose: this is the MACHINE-TARGETED format, so it
 * uses a period decimal separator (`6.5`) while the same record renders `6,5`
 * in the Spanish UI. See the file header note.
 */
export interface OracleExportRow {
  subinventory: string;
  item: string;
  countQty: string;
  uom: string;
  counter: string;
}

export const ORACLE_EXPORT_ROWS: readonly OracleExportRow[] = [
  { subinventory: 'COCINA_PPAL', item: 'MP-10221', countQty: '3', uom: 'KG', counter: 'PABLO.R' },
  { subinventory: 'COCINA_PPAL', item: 'MP-10038', countQty: '12', uom: 'UND', counter: 'PABLO.R' },
  { subinventory: 'COCINA_PPAL', item: 'PT-20877', countQty: '6.5', uom: 'KG', counter: 'MARTA.G' },
  { subinventory: 'COCINA_PPAL', item: 'MP-10412', countQty: '24', uom: 'UND', counter: 'MARTA.G' },
  { subinventory: 'COCINA_PPAL', item: 'DT-30112', countQty: '5', uom: 'UND', counter: 'PABLO.R' },
  { subinventory: 'ALM_GENERAL', item: 'MP-10505', countQty: '32', uom: 'UND', counter: 'JORGE.M' },
  { subinventory: 'ALM_GENERAL', item: 'MP-10077', countQty: '4', uom: 'LT', counter: 'JORGE.M' },
  { subinventory: 'BAR_PISCINA', item: 'BB-40021', countQty: '18', uom: 'UND', counter: 'LUIS.P' },
  { subinventory: 'PANADERIA', item: 'PT-20455', countQty: '46', uom: 'UND', counter: 'ANA.T' },
] as const;

/* --------------------------------------------------------- close (V2) data */

export interface Kpi {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}

export const CLOSE_KPIS: readonly Kpi[] = [
  { label: 'Bodegas cerradas', value: '5 / 8', detail: '2 en curso · 1 programada', tone: 'neutral' },
  { label: 'Registros verificados', value: '1.482', detail: 'de 1.489 capturados', tone: 'info' },
  { label: 'Alertas abiertas', value: '3', detail: 'requieren decisión del auditor', tone: 'warn' },
  { label: 'Diferencia vs. sistema', value: '1,8%', detail: 'histórico del mes: 4,1%', tone: 'neutral' },
] as const;

export interface LabelledValue {
  label: string;
  value: string;
  tone: Tone;
}

export const CONCILIATION_ROWS: readonly LabelledValue[] = [
  { label: 'Artículos contados', value: '1.489', tone: 'neutral' },
  { label: 'Coinciden con el sistema', value: '1.402', tone: 'ok' },
  { label: 'Con diferencia', value: '87', tone: 'warn' },
  { label: 'Ajustes por reconteo', value: '9', tone: 'neutral' },
  { label: 'Tiempo de la toma', value: '3 h 12 min', tone: 'neutral' },
] as const;

/* ---------------------------------------------------------- base (V3) data */

export const WORKBOOK_STATS: readonly LabelledValue[] = [
  { label: 'Bodegas', value: '8', tone: 'neutral' },
  { label: 'SKU', value: '1.482', tone: 'neutral' },
  { label: 'Unidades de medida', value: '4', tone: 'neutral' },
  { label: 'Sin código único', value: '18%', tone: 'neutral' },
] as const;

export interface LearnedRange {
  articulo: string;
  unit: string;
  range: string;
}

export const LEARNED_RANGES: readonly LearnedRange[] = [
  { articulo: 'ACEITE DE OLIVA EXTRA VIRGEN 500ML', unit: 'L', range: '2 – 8' },
  { articulo: 'GASEOSA PERSONAL 400ML', unit: 'UND', range: '20 – 40' },
  { articulo: 'LECHUGA BATAVIA', unit: 'KG', range: '1,5 – 6' },
  { articulo: 'ARROZ BLANCO PREPARADO', unit: 'KG', range: '3 – 12' },
  { articulo: 'PECHUGA POLLO FILETE X 180G', unit: 'UND', range: '12 – 40' },
] as const;

export interface TeamMember {
  initials: string;
  name: string;
  role: string;
}

export const COUNT_TEAM: readonly TeamMember[] = [
  { initials: 'VR', name: 'Viviana Ríos', role: 'Auditora · cierra la toma' },
  { initials: 'PR', name: 'Pablo Ruiz', role: `Chef · ${REVIEWED_WAREHOUSE_NAME}` },
  { initials: 'MG', name: 'Marta Gómez', role: 'Auxiliar · verifica cocina' },
  { initials: 'JM', name: 'Jorge Mesa', role: 'Líder de costos · asigna' },
] as const;

/** The signed-in auditor; her initials fill the nav-rail avatar. */
export const AUDITOR_NAME = 'Viviana Ríos';
export const AUDITOR_INITIALS = 'VR';
/** Header eyebrow, shared by the three views. */
export const AUDITOR_EYEBROW = 'Toma física · 31 julio 2026';
