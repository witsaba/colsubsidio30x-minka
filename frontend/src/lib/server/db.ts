/**
 * The server-side data seam (design D1, "Interfaces / Contracts").
 *
 * Routes and `lib/server/*` modules depend on `Db`, never on `supabase-js`
 * directly. That buys two things:
 *
 *   1. Testability — every server test drives a real in-memory double
 *      (`tests/server/stub-db.ts`) instead of a network, mirroring the
 *      prop-injection seam the components already use.
 *   2. Safety — this module NEVER constructs a client and never reads the
 *      environment. The service-role client is built exclusively by
 *      `pages/api/_supabase.ts` and handed in, so nothing under `lib/` can pull
 *      a secret into a bundle even if a component imported it by mistake.
 *
 * The interface is deliberately the SMALLEST subset of the supabase-js query
 * builder the routes actually use. Widening it is a decision, not an accident:
 * anything added here must also be implemented in the stub.
 */

/** A database row as it crosses the seam: untyped columns, decoded by callers. */
export type DbRow = Record<string, any>;

export interface DbError {
  message: string;
}

export interface DbResult<T> {
  data: T | null;
  error: DbError | null;
}

/**
 * A chainable query. It is `PromiseLike` rather than `Promise` because that is
 * exactly what supabase-js returns — the builder is awaited to execute it.
 */
export interface DbQuery<T = DbRow> extends PromiseLike<DbResult<T[]>> {
  select(columns?: string): DbQuery<T>;
  insert(rows: DbRow | DbRow[]): DbQuery<T>;
  update(values: DbRow): DbQuery<T>;
  /**
   * Present so tests can PROVE it is never called on `count_records`
   * (RF-21: deletion is a soft flag, the original row is never destroyed).
   */
  delete(): DbQuery<T>;
  eq(column: string, value: unknown): DbQuery<T>;
  in(column: string, values: readonly unknown[]): DbQuery<T>;
  order(column: string, options?: { ascending?: boolean }): DbQuery<T>;
  limit(count: number): DbQuery<T>;
  /** Errors when no row matched. */
  single(): PromiseLike<DbResult<T>>;
  /** Resolves `data: null` when no row matched. */
  maybeSingle(): PromiseLike<DbResult<T>>;
}

export interface Db {
  from<T = DbRow>(table: string): DbQuery<T>;
}

/** Minimal shape of the supabase-js client this adapter needs. */
interface SupabaseLike {
  from(table: string): unknown;
}

/**
 * Adapt an already-constructed supabase-js client onto `Db`.
 *
 * The cast is the entire adapter: the supabase-js builder already implements
 * this surface structurally, but its generated generics describe the whole
 * PostgREST API. Narrowing here is what makes the stub a legitimate substitute.
 */
export function supabaseDb(client: SupabaseLike): Db {
  return {
    from: <T = DbRow>(table: string) => client.from(table) as DbQuery<T>,
  };
}
