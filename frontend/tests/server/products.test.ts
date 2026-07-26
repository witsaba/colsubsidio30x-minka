/**
 * Task 6.10 RED — `resolveProductId` must not depend on `products.sku` alone.
 *
 * `sku` is NULL for ~18.4% of the real catalogue (learnings obs #129, the same
 * fact that forced task 5.11's export `COALESCE(sku, name_normalized)` fix).
 * With a sku-only lookup, roughly one article in five can never be counted:
 * `POST /api/records` and `POST /api/anomaly-check` both answer
 * `400 "No encontramos ese artículo en el catálogo"` for them.
 *
 * `products.name_normalized` is the catalogue's own natural key — accent-folded
 * and upper-cased (see `docs/database/03_teammate_seed.sql`: `'caf. Velas
 * suministros'` is stored as `'CAF. VELAS SUMINISTROS'`). The matcher already
 * carries the catalogue name it picked, so the fallback is a real second key,
 * not a guess.
 *
 * The FAILURE contract does not change: an article that matches neither key
 * still resolves to `null`, so an unresolvable count still fails loudly at the
 * write instead of being counted against nothing.
 */
import { describe, expect, it } from 'vitest';

import { DbUnavailableError } from '../../src/lib/server/db';
import { resolveProductId } from '../../src/lib/server/products';
import { createStubDb } from './stub-db';

/** A catalogue with BOTH shapes: one product with a sku, three without. */
function catalogue(options: { errors?: Record<string, string> } = {}) {
  return createStubDb({
    errors: options.errors,
    tables: {
      products: [
        { id: 'p-sku', sku: '100482', name_normalized: 'GASEOSA POSTOBON 400 ML' },
        { id: 'p-noSku', sku: null, name_normalized: 'ACEITE' },
        { id: 'p-accents', sku: null, name_normalized: 'JABON LIQUIDO LIMON' },
        { id: 'p-punct', sku: null, name_normalized: 'CAF. VELAS SUMINISTROS' },
      ],
    },
  });
}

describe('resolveProductId — sku is the primary key', () => {
  it('resolves the matcher nr_articulo against products.sku', async () => {
    const db = catalogue();
    expect(await resolveProductId(db, { nrArticulo: '100482' })).toBe('p-sku');
  });

  it('short-circuits on an explicit productId without querying at all', async () => {
    const db = catalogue();
    expect(await resolveProductId(db, { productId: 'p-already-known' })).toBe('p-already-known');
    expect(db.calls).toHaveLength(0);
  });

  it('does not spend a second query on the name when the sku already matched', async () => {
    const db = catalogue();
    await resolveProductId(db, { nrArticulo: '100482', articulo: 'GASEOSA POSTOBON 400 ML' });
    expect(db.calls).toHaveLength(1);
  });
});

describe('resolveProductId — name_normalized fallback (task 6.10)', () => {
  it('resolves a sku-less product from the catalogue name the matcher picked', async () => {
    const db = catalogue();
    expect(await resolveProductId(db, { nrArticulo: '999999', articulo: 'ACEITE' })).toBe('p-noSku');
  });

  it('resolves a sku-less product when the caller carries no nr_articulo at all', async () => {
    const db = catalogue();
    expect(await resolveProductId(db, { articulo: 'CAF. VELAS SUMINISTROS' })).toBe('p-punct');
  });

  it('folds accents and case the way the catalogue stored the name', async () => {
    const db = catalogue();
    expect(await resolveProductId(db, { articulo: 'Jabón Líquido Limón' })).toBe('p-accents');
  });

  it('falls back to the spoken name when the matcher gave no catalogue name', async () => {
    const db = catalogue();
    expect(await resolveProductId(db, { spokenName: 'aceite' })).toBe('p-noSku');
  });

  it('prefers the catalogue name over the spoken name when both are present', async () => {
    const db = catalogue();
    expect(
      await resolveProductId(db, { articulo: 'ACEITE', spokenName: 'CAF. VELAS SUMINISTROS' }),
    ).toBe('p-noSku');
  });

  it('queries name_normalized, not name', async () => {
    const db = catalogue();
    await resolveProductId(db, { articulo: 'ACEITE' });
    const columns = db.calls.flatMap((call) => call.filters.map((f) => f.column));
    expect(columns).toContain('name_normalized');
    expect(columns).not.toContain('name');
  });
});

describe('resolveProductId — the failure contract is unchanged', () => {
  it('returns null when neither the sku nor the name matches anything', async () => {
    const db = catalogue();
    expect(await resolveProductId(db, { nrArticulo: '999999', articulo: 'NO EXISTE' })).toBeNull();
  });

  it('returns null when the caller supplies no identity at all', async () => {
    const db = catalogue();
    expect(await resolveProductId(db, {})).toBeNull();
    expect(db.calls).toHaveLength(0);
  });

  it('does not resolve a blank name to an arbitrary product', async () => {
    const db = catalogue();
    expect(await resolveProductId(db, { articulo: '   ' })).toBeNull();
  });
});

/**
 * `null` means "not in the catalogue" — it may not also mean "we could not look"
 * (`dataOrThrow`, `lib/server/db.ts`).
 *
 * Both routes turn `null` into `400 "No encontramos ese artículo en el catálogo."`
 * — a statement about the CATALOGUE, and one the operator acts on by re-dictating
 * an article that is in fact perfectly present. Reading `data?.[0]` out of a
 * failed result made an unreadable `products` table say exactly that, on every
 * article, for as long as the outage lasted.
 *
 * The propagated `DbUnavailableError` becomes a 502 at the route: honest, and
 * retryable with the same dictation. The `null` contract above is unchanged.
 */
describe('resolveProductId — an unreadable catalogue is not an unknown article', () => {
  it('refuses to answer when the sku lookup itself fails', async () => {
    const db = catalogue({ errors: { 'select:products': 'JWT expired' } });

    await expect(resolveProductId(db, { nrArticulo: '100482' })).rejects.toBeInstanceOf(
      DbUnavailableError,
    );
  });

  it('refuses to answer when the name_normalized fallback lookup fails', async () => {
    const db = catalogue({ errors: { 'select:products': 'connection reset' } });

    await expect(resolveProductId(db, { articulo: 'ACEITE' })).rejects.toBeInstanceOf(
      DbUnavailableError,
    );
  });

  it('still short-circuits an explicit productId without ever asking the catalogue', async () => {
    // An outage cannot break the one path that needs no query at all.
    const db = catalogue({ errors: { 'select:products': 'JWT expired' } });

    await expect(resolveProductId(db, { productId: 'p-already-known' })).resolves.toBe(
      'p-already-known',
    );
    expect(db.calls).toHaveLength(0);
  });
});
