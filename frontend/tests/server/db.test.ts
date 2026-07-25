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

import { supabaseDb } from '../../src/lib/server/db';
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
