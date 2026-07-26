/**
 * Article identity resolution — the seam between the matcher and Supabase.
 *
 * The matcher answers with catalogue rows keyed by `nr_articulo`; every
 * operational table keys products by a Supabase uuid. The browser has neither
 * the product table nor any business holding it, so the translation happens
 * server-side, once, here — `POST /api/records` and `POST /api/anomaly-check`
 * both call it so a count and its anomaly can never disagree about which
 * product they are talking about.
 */
import type { Db } from './db';

/**
 * The column on `products` that carries the matcher's `nr_articulo`.
 *
 * NOTE (task 1.1 follow-up): `v_oracle_export_preview` proves `products.sku`
 * exists and is null for ~18% of the catalogue, but that the matcher's
 * `nr_articulo` IS that same code is still UNVERIFIED against live data (task
 * 6.4). It is a single constant on purpose: reconciling is a one-line change,
 * and an unresolvable article fails loudly rather than being counted against
 * nothing.
 */
export const PRODUCT_LOOKUP_COLUMN = 'sku';

/**
 * The catalogue's own natural key, and the reason `sku` alone is not enough.
 *
 * `sku` is NULL for ~18.4% of the real catalogue (learnings obs #129 — the same
 * fact that forced the export `COALESCE(sku, name_normalized)` fix in task
 * 5.11). A sku-only lookup therefore makes roughly one article in five
 * impossible to count. `name_normalized` is populated for every row and is
 * stored accent-folded and upper-cased by the ingest, so it is a real second
 * key rather than a fuzzy guess.
 */
export const PRODUCT_NAME_COLUMN = 'name_normalized';

export interface ArticleIdentity {
  /** Already a `products.id`; used as-is when present. */
  productId?: string | null;
  /** The matcher's catalogue code, resolved against `PRODUCT_LOOKUP_COLUMN`. */
  nrArticulo?: string | null;
  /** The catalogue name the matcher picked — the `name_normalized` fallback. */
  articulo?: string | null;
  /** What the operator actually said; used only when `articulo` is absent. */
  spokenName?: string | null;
}

/**
 * Reproduce the ingest's normalization: strip diacritics, upper-case, collapse
 * whitespace. Punctuation is preserved because the catalogue preserves it
 * (`'caf. Velas suministros'` is stored as `'CAF. VELAS SUMINISTROS'`).
 */
export function normalizeProductName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();
}

async function findByColumn(db: Db, column: string, value: string): Promise<string | null> {
  // `limit(1)` rather than `maybeSingle()`: two catalogue rows may legitimately
  // share a normalized name, and PostgREST turns that into an ERROR for
  // `maybeSingle`, which would fail the count instead of resolving it.
  const { data } = await db.from('products').select('id').eq(column, value).limit(1);
  const row = data?.[0];
  return row ? String(row.id) : null;
}

/**
 * Resolve an article to a `products.id`, or null when nothing matches.
 *
 * Order of keys: explicit uuid, then `sku`, then the normalized catalogue name.
 * An explicit `productId` short-circuits — it is already the answer, and looking
 * it up again would be a query whose only possible outcome is the input. The
 * name is only consulted when the code did not resolve, so the common path
 * still costs exactly one query.
 *
 * The failure contract is deliberately unchanged: an article matching neither
 * key still returns `null` (never throws, never guesses), so the route answers
 * a loud 400 rather than counting against the wrong product.
 */
export async function resolveProductId(db: Db, article: ArticleIdentity): Promise<string | null> {
  if (article.productId) return article.productId;

  if (article.nrArticulo) {
    const bySku = await findByColumn(db, PRODUCT_LOOKUP_COLUMN, article.nrArticulo);
    if (bySku) return bySku;
  }

  const name = normalizeProductName(article.articulo || article.spokenName || '');
  if (!name) return null;

  return findByColumn(db, PRODUCT_NAME_COLUMN, name);
}
