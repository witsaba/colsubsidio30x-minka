/**
 * Operator S2/S3 seed data (design §6 "seed 45/107", §10, D13).
 *
 * The plan cards keep the design's illustrative names as LABELS while carrying
 * a real matcher `catalogue_id`, with that id rendered verbatim in a mono
 * sub-line. No bodega→catalogue mapping is invented (RF-11 does not have one).
 */
import type { CountRecord } from '../lib/session/types';

export interface OperatorPlan {
  id: string;
  /** Illustrative plan name from the design contract. */
  label: string;
  /** The REAL matcher catalogue this plan counts against. */
  catalogueId: string;
  /** Honest mono sub-line: always the literal `catalogueId`. */
  subline: string;
  /** Secondary line on the card, e.g. the shift window. */
  detail: string;
  /** The one card the demo starts from. */
  active: boolean;
}

/** Largest food catalogue backs the active card — best odds for the scripts. */
export const OPERATOR_PLANS: readonly OperatorPlan[] = [
  {
    id: 'plan-cocina-principal',
    label: 'Cocina Principal',
    catalogueId: 'stock_restaurante_fuentes_ayb',
    subline: 'stock_restaurante_fuentes_ayb',
    detail: 'Turno de la mañana · 107 artículos',
    active: true,
  },
  {
    id: 'plan-almacen-general',
    label: 'Almacén General',
    catalogueId: 'stock_almacen_ayb',
    subline: 'stock_almacen_ayb',
    detail: 'Programado para mañana',
    active: false,
  },
  {
    id: 'plan-zoologico',
    label: 'Zoológico',
    catalogueId: 'zoologico',
    subline: 'zoologico',
    detail: 'Programado para el viernes',
    active: false,
  },
] as const;

/** The count already carried into the session by the seeded records. */
export const OPERATOR_SEED_PROGRESS = { counted: 45, total: 107 } as const;

const SEED_DAY = Date.UTC(2026, 6, 25, 12, 0, 0);

/** Three settled records so S3 never opens on an empty list. Newest first. */
export const OPERATOR_SEED_RECORDS: readonly CountRecord[] = [
  {
    id: 'seed-3',
    quantity: 12,
    unitDisplay: 'unidades',
    articulo: 'GASEOSA POSTOBON 400 ML',
    nrArticulo: '100482',
    spokenName: 'doce gaseosas',
    state: 'ok',
    createdAt: SEED_DAY + 8 * 60_000,
  },
  {
    id: 'seed-2',
    quantity: 4,
    unitDisplay: 'kilos',
    articulo: 'ARROZ BLANCO GRANO LARGO',
    nrArticulo: '100113',
    spokenName: 'cuatro kilos de arroz',
    state: 'ok',
    createdAt: SEED_DAY + 5 * 60_000,
  },
  {
    id: 'seed-1',
    quantity: 3,
    unitDisplay: 'litros',
    articulo: 'ACEITE DE OLIVA EXTRA VIRGEN',
    nrArticulo: '100207',
    spokenName: 'tres litros de aceite de oliva',
    state: 'ok',
    createdAt: SEED_DAY + 1 * 60_000,
  },
] as const;
