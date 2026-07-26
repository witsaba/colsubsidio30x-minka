/**
 * REQ-SDA-1 — the Supabase client is server-only and fails loudly.
 *
 * Two properties are load-bearing and both are asserted here:
 *
 *  1. A missing `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` must THROW at
 *     client construction. A client built against `undefined` would fail later,
 *     mid-request, as an opaque network error.
 *  2. No `PUBLIC_`-prefixed environment name may ever be read. In Astro, a
 *     `PUBLIC_` variable is inlined into the browser bundle, so reading the
 *     service-role key through one would ship it to every operator's phone.
 *     The env object is replaced by a recording Proxy so the assertion observes
 *     the ACTUAL reads the module performs, not the source text.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  SUPABASE_SERVICE_ROLE_KEY_ENV,
  SUPABASE_URL_ENV,
  resetSupabaseClient,
  supabase,
} from '../../src/pages/api/_supabase';

const realEnv = process.env;

/** Replace `process.env` with a Proxy that records every key that is read. */
function recordingEnv(values: Record<string, string | undefined>): string[] {
  const reads: string[] = [];
  process.env = new Proxy(values, {
    get(target, prop) {
      if (typeof prop === 'string') reads.push(prop);
      return (target as Record<string, unknown>)[prop as string];
    },
  }) as NodeJS.ProcessEnv;
  return reads;
}

describe('supabase() server client factory', () => {
  beforeEach(() => {
    resetSupabaseClient();
  });

  afterEach(() => {
    process.env = realEnv;
    resetSupabaseClient();
  });

  it('throws naming the missing variable when the URL is absent', () => {
    recordingEnv({ [SUPABASE_SERVICE_ROLE_KEY_ENV]: 'service-role-key' });

    expect(() => supabase()).toThrowError(/SUPABASE_URL/);
  });

  it('throws naming the missing variable when the service-role key is absent', () => {
    recordingEnv({ [SUPABASE_URL_ENV]: 'https://project.supabase.co' });

    expect(() => supabase()).toThrowError(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it('never reads a PUBLIC_-prefixed environment name', () => {
    const reads = recordingEnv({
      [SUPABASE_URL_ENV]: 'https://project.supabase.co',
      [SUPABASE_SERVICE_ROLE_KEY_ENV]: 'service-role-key',
    });

    supabase();

    expect(reads).toContain(SUPABASE_URL_ENV);
    expect(reads).toContain(SUPABASE_SERVICE_ROLE_KEY_ENV);
    expect(reads.filter((name) => name.startsWith('PUBLIC_'))).toEqual([]);
  });

  it('returns the same client instance on repeated calls (per-process singleton)', () => {
    recordingEnv({
      [SUPABASE_URL_ENV]: 'https://project.supabase.co',
      [SUPABASE_SERVICE_ROLE_KEY_ENV]: 'service-role-key',
    });

    expect(supabase()).toBe(supabase());
  });

  it('exports env names that are not PUBLIC_-prefixed', () => {
    expect(SUPABASE_URL_ENV).toBe('SUPABASE_URL');
    expect(SUPABASE_SERVICE_ROLE_KEY_ENV).toBe('SUPABASE_SERVICE_ROLE_KEY');
  });
});
