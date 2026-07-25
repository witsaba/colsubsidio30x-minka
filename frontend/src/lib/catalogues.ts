/**
 * The 8 REAL matcher stock tables (REQ-OCF-8, design §10, D13).
 *
 * These ids are the ones `GET /api/catalogues` actually serves and the only
 * values `MatchRequest.catalogue_id` may take — an invented id answers 404
 * (`unknown_catalogue`). Row counts come from the matcher's loaded tables.
 *
 * They are audit CATEGORIES, not the 48 bodegas: see `RF11_LIMITATION_NOTE`.
 */

export interface Catalogue {
  /** The real matcher table id sent as `catalogue_id`. */
  catalogueId: string;
  /** Human-readable Colombian Spanish label shown to operators and auditors. */
  label: string;
  /** Rows in the matcher's loaded table. */
  rows: number;
}

/** Largest first: the biggest table gives the demo scripts the best match odds. */
export const CATALOGUES: readonly Catalogue[] = [
  { catalogueId: 'stock_restaurante_fuentes_ayb', label: 'Restaurante Fuentes · AyB', rows: 344 },
  { catalogueId: 'stock_almacen_suministros', label: 'Almacén · Suministros', rows: 296 },
  { catalogueId: 'stock_almacen_ayb', label: 'Almacén · AyB', rows: 270 },
  { catalogueId: 'zoologico_suministros', label: 'Zoológico · Suministros', rows: 193 },
  { catalogueId: 'stock_restaurante_fuentes_sumin', label: 'Restaurante Fuentes · Suministros', rows: 133 },
  { catalogueId: 'stock_kiosco_taquilla_ayb', label: 'Kiosco Taquilla · AyB', rows: 58 },
  { catalogueId: 'stock_kiosco_piscigiros_ayb', label: 'Kiosco Piscigiros · AyB', rows: 56 },
  { catalogueId: 'zoologico', label: 'Zoológico · AyB', rows: 55 },
] as const;

/** Every real catalogue id, in the same size order as `CATALOGUES`. */
export const CATALOGUE_IDS: readonly string[] = CATALOGUES.map((c) => c.catalogueId);

/**
 * RF-11, stated rather than faked. Shown verbatim in the demo and in the
 * auditor `base` view.
 */
export const RF11_LIMITATION_NOTE =
  'La llave que une bodega y catálogo no existe en el archivo fuente, ' +
  'así que las categorías de auditoría son las 8 tablas de stock reales, ' +
  'no las 48 bodegas.';

const LABELS_BY_ID = new Map(CATALOGUES.map((c) => [c.catalogueId, c.label]));

/** True only for one of the 8 real matcher tables. */
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
