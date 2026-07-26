/**
 * The 8 REAL matcher catalogues (REQ-OCF-8, design §10, D13).
 *
 * These ids are the ones `GET /api/catalogues` actually serves and the only
 * values `MatchRequest.catalogue_id` may take — an invented id answers 404
 * (`unknown_catalogue`). Row counts come from the matcher's loaded catalogue.
 *
 * They are `warehouses.code` values read from Supabase. They REPLACED the
 * eight lowercase SQLite table names this file used to carry
 * (`stock_restaurante_fuentes_ayb` and friends); the matcher's SQLite
 * catalogue was retired and the break was taken deliberately clean, with no
 * server-side alias. Sending a legacy name is now a 404, so never reintroduce
 * one — `tests/catalogues/catalogues.test.ts` pins all eight strings and
 * rejects every retired name.
 *
 * They are audit CATEGORIES, not the 48 bodegas: see `RF11_LIMITATION_NOTE`.
 */

export interface Catalogue {
  /** The real matcher catalogue id (`warehouses.code`) sent as `catalogue_id`. */
  catalogueId: string;
  /** Human-readable Colombian Spanish label shown to operators and auditors. */
  label: string;
  /** Rows in the matcher's loaded table. */
  rows: number;
}

/** Largest first: the biggest catalogue gives the demo scripts the best match odds. */
export const CATALOGUES: readonly Catalogue[] = [
  { catalogueId: 'STOCK_RESTAURANTE_FUENTES_AYB', label: 'Restaurante Fuentes · AyB', rows: 344 },
  { catalogueId: 'STOCK_ALMACEN_SUMINISTROS', label: 'Almacén · Suministros', rows: 296 },
  { catalogueId: 'STOCK_ALMACEN_AYB', label: 'Almacén · AyB', rows: 270 },
  // `ZOOLOGICO_SUMINISTROS_2`, with the `_2`, is the real code — this is the
  // one id that is NOT the old table name upper-cased. Supabase already held a
  // `ZOOLOGICO_SUMINISTROS` code when this warehouse was loaded, so the loader
  // disambiguated it. Do not "fix" the suffix: without it these 193 rows 404.
  { catalogueId: 'ZOOLOGICO_SUMINISTROS_2', label: 'Zoológico · Suministros', rows: 193 },
  { catalogueId: 'STOCK_RESTAURANTE_FUENTES_SUMIN', label: 'Restaurante Fuentes · Suministros', rows: 133 },
  { catalogueId: 'STOCK_KIOSCO_TAQUILLA_AYB', label: 'Kiosco Taquilla · AyB', rows: 58 },
  { catalogueId: 'STOCK_KIOSCO_PISCIGIROS_AYB', label: 'Kiosco Piscigiros · AyB', rows: 56 },
  { catalogueId: 'ZOOLOGICO', label: 'Zoológico · AyB', rows: 55 },
] as const;

/**
 * The one bodega the demo actually counts — the largest food table, so the
 * demo scripts have the best match odds.
 *
 * It is exported so the auditor's seeded fixtures can DERIVE the name of the
 * warehouse under review instead of hardcoding a second one. The operator half
 * is the source of truth for naming because it is the half backed by real
 * matcher data; nothing here invents a bodega→catalogue mapping (RF-11 has
 * none — see `RF11_LIMITATION_NOTE`).
 */
export const DEMO_CATALOGUE_ID = 'STOCK_RESTAURANTE_FUENTES_AYB';

/** Every real catalogue id, in the same size order as `CATALOGUES`. */
export const CATALOGUE_IDS: readonly string[] = CATALOGUES.map((c) => c.catalogueId);

/**
 * RF-11, stated rather than faked. Shown verbatim in the demo and in the
 * auditor `base` view.
 */
export const RF11_LIMITATION_NOTE =
  'La llave que une bodega y catálogo no existe en el archivo fuente, ' +
  'así que las categorías de auditoría son los 8 catálogos de stock reales, ' +
  'no las 48 bodegas.';

const LABELS_BY_ID = new Map(CATALOGUES.map((c) => [c.catalogueId, c.label]));

/** True only for one of the 8 real matcher catalogues. */
export function isCatalogueId(value: string): boolean {
  return LABELS_BY_ID.has(value);
}

/**
 * The friendly label for a catalogue. Unknown ids fall back to the raw id: a
 * configuration mistake must stay visible, never be papered over with a
 * plausible-looking name.
 */
export function labelFor(catalogueId: string): string {
  return LABELS_BY_ID.get(catalogueId) ?? catalogueId;
}
