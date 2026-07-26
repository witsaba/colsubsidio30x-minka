/**
 * The `Db` seam (design D1 / "Interfaces"): every route depends on this
 * interface and never on `supabase-js` directly, which is what makes the routes
 * testable without a network and without a service-role key.
 *
 * Two things are under test:
 *  - the stub used by every other server test really behaves like the query
 *    surface the routes use (filtering, insert, update, single);
 *  - `supabaseDb()` adapts a supabase-js client onto that interface without
 *    reaching for the environment itself — the client is INJECTED, so no module
 *    under `lib/` ever constructs a service-role client.
 */
import { describe, expect, it } from 'vitest';

import { DbUnavailableError, dataOrThrow, supabaseDb } from '../../src/lib/server/db';
import { createStubDb } from './stub-db';

describe('stub Db satisfies the query surface routes use', () => {
  it('filters selected rows by eq', async () => {
    const db = createStubDb({
      tables: {
        plan_operators: [
          { plan_id: 'plan-1', profile_id: 'op-1' },
          { plan_id: 'plan-2', profile_id: 'op-2' },
        ],
      },
    });

    const { data, error } = await db.from('plan_operators').select('*').eq('profile_id', 'op-2');

    expect(error).toBeNull();
    expect(data).toEqual([{ plan_id: 'plan-2', profile_id: 'op-2' }]);
  });

  it('returns the inserted row from insert().select().single() and persists it', async () => {
    const db = createStubDb();

    const { data, error } = await db
      .from('voice_consents')
      .insert({ profile_id: 'op-1', status: 'granted' })
      .select()
      .single();

    expect(error).toBeNull();
    expect(data).toMatchObject({ profile_id: 'op-1', status: 'granted' });
    expect(db.rows('voice_consents')).toHaveLength(1);
  });

  it('applies update patches only to matching rows and records the operation', async () => {
    const db = createStubDb({
      tables: {
        count_records: [
          { id: 'rec-1', is_deleted: false },
          { id: 'rec-2', is_deleted: false },
        ],
      },
    });

    await db.from('count_records').update({ is_deleted: true }).eq('id', 'rec-1');

    expect(db.rows('count_records')).toEqual([
      { id: 'rec-1', is_deleted: true },
      { id: 'rec-2', is_deleted: false },
    ]);
    expect(db.callsOf('update')).toHaveLength(1);
    expect(db.callsOf('delete')).toEqual([]);
  });

  it('surfaces injected failures as an error result instead of throwing', async () => {
    const db = createStubDb({ errors: { 'insert:export_lines': 'insert failed' } });

    const { data, error } = await db.from('export_lines').insert([{ line_number: 1 }]).select();

    expect(data).toBeNull();
    expect(error).toEqual({ message: 'insert failed' });
    expect(db.rows('export_lines')).toEqual([]);
  });

  it('single() reports an error when no row matches, maybeSingle() reports null', async () => {
    const db = createStubDb({ tables: { audit_plans: [] } });

    const strict = await db.from('audit_plans').select('*').eq('id', 'missing').single();
    const lenient = await db.from('audit_plans').select('*').eq('id', 'missing').maybeSingle();

    expect(strict.data).toBeNull();
    expect(strict.error?.message).toMatch(/no rows/i);
    expect(lenient.data).toBeNull();
    expect(lenient.error).toBeNull();
  });
});

/**
 * `dataOrThrow` — the unwrapper the routes read every result through.
 *
 * It exists because supabase-js signals failure in the RESOLVED value, so
 * `const { data } = await query` is valid TypeScript that compiles, runs, and
 * silently converts a 401, a dropped connection or an RLS denial into `null`.
 * Reading `data` through a function that cannot return on error removes the
 * option of forgetting: there is no `error` field left at the call site to skip.
 *
 * The `null` passthrough is deliberate and load-bearing. `maybeSingle()` uses
 * `null` to mean "no such row", which several routes translate into a real
 * answer (a 404, a `null` stock figure, an empty catalogue code). Collapsing
 * absence into a failure would break those as surely as the bug it replaces.
 */
describe('dataOrThrow', () => {
  it('returns the rows of a successful result', () => {
    expect(dataOrThrow({ data: [{ id: 'rec-1' }], error: null })).toEqual([{ id: 'rec-1' }]);
  });

  it('returns an empty list unchanged — a real empty result is an answer', () => {
    expect(dataOrThrow({ data: [], error: null })).toEqual([]);
  });

  it('passes a null through untouched, so "no such row" keeps its meaning', () => {
    expect(dataOrThrow({ data: null, error: null })).toBeNull();
  });

  it('throws DbUnavailableError when the result carries an error', () => {
    expect(() => dataOrThrow({ data: null, error: { message: 'JWT expired' } })).toThrow(
      DbUnavailableError,
    );
  });

  it('keeps the vendor message on the error for the server log', () => {
    expect(() => dataOrThrow({ data: null, error: { message: 'JWT expired' } })).toThrow(
      /JWT expired/,
    );
  });

  it('prefers the error over data, so a partial result is never mistaken for success', () => {
    expect(() => dataOrThrow({ data: [{ id: 'rec-1' }], error: { message: 'timeout' } })).toThrow(
      DbUnavailableError,
    );
  });
});

describe('supabaseDb', () => {
  it('delegates from() to the injected client with the table name', () => {
    const seen: string[] = [];
    const marker = { marker: true };
    const client = {
      from(table: string) {
        seen.push(table);
        return marker;
      },
    };

    const db = supabaseDb(client as never);

    expect(db.from('count_records')).toBe(marker);
    expect(seen).toEqual(['count_records']);
  });
});
