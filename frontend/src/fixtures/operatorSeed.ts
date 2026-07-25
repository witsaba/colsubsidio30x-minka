/**
 * Operator S3 seed data (design §6 "seed 45/107").
 *
 * There is deliberately NO plan table here. `PlansScreen` renders the 8 REAL
 * matcher catalogues from `lib/catalogues.ts`, which is the single source of
 * bodega names for the whole demo — operator AND auditor. A second table of
 * illustrative warehouse labels used to live here, imported by tests only, and
 * it drifted away from the shipped screen (verify report WARNING-2). Do not
 * reintroduce one: no bodega→catalogue mapping exists to invent (RF-11).
 */
import type { CountRecord } from '../lib/session/types';

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
