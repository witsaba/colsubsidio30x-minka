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

export interface ArticleIdentity {
  /** Already a `products.id`; used as-is when present. */
  productId?: string | null;
  /** The matcher's catalogue code, resolved against `PRODUCT_LOOKUP_COLUMN`. */
  nrArticulo?: string | null;
}

/**
 * Resolve an article to a `products.id`, or null when nothing matches.
 *
 * An explicit `productId` short-circuits: it is already the answer, and looking
 * it up again would be a query whose only possible outcome is the input.
 */
export async function resolveProductId(db: Db, article: ArticleIdentity): Promise<string | null> {
  if (article.productId) return article.productId;
  if (!article.nrArticulo) return null;

  const { data } = await db
    .from('products')
    .select('id')
    .eq(PRODUCT_LOOKUP_COLUMN, article.nrArticulo)
    .maybeSingle();

  return data ? String(data.id) : null;
}
