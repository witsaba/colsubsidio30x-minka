/**
 * In-memory `Db` double shared by every server-side test (design "Testing
 * Strategy": stub `Db` objects are the server twin of the component prop seams).
 *
 * It is deliberately a small real implementation rather than a pile of
 * `vi.fn()`s: route tests need to assert BOTH the effect (which rows exist
 * afterwards) and the shape of the access (which operations were issued, in
 * which order, against which table). A mock-per-method stub can only do the
 * second, and the RF-21 soft-delete guard needs the first.
 *
 * Supported surface — exactly what `Db` declares, no more:
 *   from(table).select(cols).eq(col, val).in(col, vals).order(col).limit(n)
 *   from(table).insert(rows).select().single()
 *   from(table).update(values).eq(col, val)
 *   from(table).delete()            ← recorded so tests can prove it is UNUSED
 */
import type { Db, DbQuery, DbResult, DbRow } from '../../src/lib/server/db';

export type StubOperation = 'select' | 'insert' | 'update' | 'delete';

export interface StubCall {
  table: string;
  op: StubOperation;
  /** Equality/`in` filters accumulated on the builder, in application order. */
  filters: Array<{ column: string; value: unknown }>;
  /** Rows for an insert, patch values for an update; `null` for reads. */
  payload: unknown;
}

export interface StubDbOptions {
  /** Seed rows keyed by table name. Mutated in place by inserts and updates. */
  tables?: Record<string, DbRow[]>;
  /**
   * Failure injection keyed by `"<op>:<table>"` (e.g. `"insert:export_lines"`).
   * The matching operation resolves `{ data: null, error }` instead of running.
   */
  errors?: Record<string, string>;
}

export interface StubDb extends Db {
  /** Every operation issued, in order. */
  readonly calls: StubCall[];
  /** Current contents of a table, after any inserts/updates. */
  rows(table: string): DbRow[];
  /** Calls filtered by operation — the usual assertion shortcut. */
  callsOf(op: StubOperation): StubCall[];
}

function matches(row: DbRow, filters: StubCall['filters']): boolean {
  return filters.every(({ column, value }) =>
    Array.isArray(value) ? value.includes(row[column]) : row[column] === value,
  );
}

export function createStubDb(options: StubDbOptions = {}): StubDb {
  const tables: Record<string, DbRow[]> = {};
  for (const [name, rows] of Object.entries(options.tables ?? {})) {
    tables[name] = rows.map((row) => ({ ...row }));
  }
  const errors = options.errors ?? {};
  const calls: StubCall[] = [];

  function tableRows(table: string): DbRow[] {
    tables[table] ??= [];
    return tables[table];
  }

  function build(table: string): DbQuery<DbRow> {
    const call: StubCall = { table, op: 'select', filters: [], payload: null };
    calls.push(call);

    let pendingInsert: DbRow[] | null = null;
    let pendingUpdate: DbRow | null = null;
    let limit: number | null = null;

    function settle(): DbResult<DbRow[]> {
      const failure = errors[`${call.op}:${table}`];
      if (failure) return { data: null, error: { message: failure } };

      if (pendingInsert) {
        const created = pendingInsert.map((row, i) => ({
          id: row.id ?? `${table}-stub-${tableRows(table).length + i + 1}`,
          ...row,
        }));
        tableRows(table).push(...created);
        return { data: created, error: null };
      }

      if (pendingUpdate) {
        const updated: DbRow[] = [];
        for (const row of tableRows(table)) {
          if (!matches(row, call.filters)) continue;
          Object.assign(row, pendingUpdate);
          updated.push(row);
        }
        return { data: updated, error: null };
      }

      const found = tableRows(table).filter((row) => matches(row, call.filters));
      return { data: limit === null ? found : found.slice(0, limit), error: null };
    }

    async function one(required: boolean): Promise<DbResult<DbRow>> {
      const { data, error } = settle();
      if (error) return { data: null, error };
      const row = data?.[0] ?? null;
      if (!row && required) return { data: null, error: { message: 'No rows found' } };
      return { data: row, error: null };
    }

    const query: DbQuery<DbRow> = {
      select() {
        return query;
      },
      insert(rows) {
        call.op = 'insert';
        pendingInsert = (Array.isArray(rows) ? rows : [rows]) as DbRow[];
        call.payload = pendingInsert;
        return query;
      },
      update(values) {
        call.op = 'update';
        pendingUpdate = { ...(values as DbRow) };
        call.payload = pendingUpdate;
        return query;
      },
      delete() {
        call.op = 'delete';
        return query;
      },
      eq(column, value) {
        call.filters.push({ column, value });
        return query;
      },
      in(column, values) {
        call.filters.push({ column, value: [...values] });
        return query;
      },
      order() {
        return query;
      },
      limit(n) {
        limit = n;
        return query;
      },
      single: () => one(true),
      maybeSingle: () => one(false),
      then: (resolve, reject) => Promise.resolve(settle()).then(resolve, reject),
    };

    return query;
  }

  return {
    from: build as Db['from'],
    calls,
    rows: (table) => tableRows(table),
    callsOf: (op) => calls.filter((call) => call.op === op),
  };
}
