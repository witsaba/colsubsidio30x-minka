/**
 * `withFallback` — per-utterance degradation to the deterministic mock
 * (REQ-EXT-7).
 *
 * The decorator exists so neither side has to know about the other: the HTTP
 * adapter stays testable in isolation, and `runPipeline` keeps its rule of
 * never catching or rewrapping an error.
 *
 * The sharpest line under test is the one that does NOT fall back: an empty
 * result is a legitimate upstream verdict, and replaying it through the mock
 * would answer a question the service already answered.
 */
import { describe, expect, it, vi } from 'vitest';

import { withFallback } from '../../src/lib/extraction/fallback';
import { UiError } from '../../src/lib/api/types';
import type { ExtractedItem, ExtractionAdapter } from '../../src/lib/extraction/adapter';

function item(over: Partial<ExtractedItem> = {}): ExtractedItem {
  return { quantity: 3, unit: 'kilos', spokenName: 'lechuga batavia', ...over };
}

/** An adapter that always resolves to the given items. */
function resolving(items: ExtractedItem[]): ExtractionAdapter {
  return { extract: vi.fn(async () => items) };
}

/** An adapter that always rejects with the given error. */
function rejecting(error: unknown): ExtractionAdapter {
  return {
    extract: vi.fn(async () => {
      throw error;
    }),
  };
}

describe('withFallback — the primary answers', () => {
  it('passes the primary result through untouched', async () => {
    const items = [item(), item({ quantity: 12, unit: 'botellas', spokenName: 'aceite vegetal' })];
    const primary = resolving(items);
    const fallback = resolving([item({ spokenName: 'MOCK' })]);

    await expect(withFallback(primary, fallback).extract('x')).resolves.toEqual(items);
    expect(fallback.extract).not.toHaveBeenCalled();
  });

  it('hands the primary the verbatim transcript', async () => {
    const primary = resolving([item()]);

    await withFallback(primary, resolving([])).extract('  DOS  CAJAS de Tomate Chonto ');

    expect(primary.extract).toHaveBeenCalledWith('  DOS  CAJAS de Tomate Chonto ');
  });

  it('does NOT fall back when the primary resolves to []', async () => {
    // An empty consensus is an answer: the flow must reach `nothing_extracted`
    // («repite»), not a mock re-run that second-guesses a genuine 200.
    const primary = resolving([]);
    const fallback = resolving([item({ spokenName: 'MOCK' })]);

    await expect(withFallback(primary, fallback).extract('hola buenos dias')).resolves.toEqual([]);
    expect(fallback.extract).not.toHaveBeenCalled();
  });
});

describe('withFallback — the primary throws', () => {
  it('returns the fallback result instead of propagating the error', async () => {
    const mockItems = [item({ spokenName: 'from the mock' })];
    const primary = rejecting(new UiError('vendor_error'));
    const fallback = resolving(mockItems);

    await expect(withFallback(primary, fallback).extract('x')).resolves.toEqual(mockItems);
    expect(fallback.extract).toHaveBeenCalledTimes(1);
  });

  it('replays the SAME transcript through the fallback', async () => {
    const primary = rejecting(new UiError('aborted'));
    const fallback = resolving([item()]);

    await withFallback(primary, fallback).extract('tres kilos de lechuga batavia');

    expect(fallback.extract).toHaveBeenCalledWith('tres kilos de lechuga batavia');
  });

  it.each([
    ['a UiError', new UiError('proxy_unreachable')],
    ['a plain TypeError', new TypeError('fetch failed')],
    ['a non-Error throw', 'boom'],
  ])('falls back on %s — any throw counts', async (_label, thrown) => {
    const fallback = resolving([item({ spokenName: 'recovered' })]);

    const items = await withFallback(rejecting(thrown), fallback).extract('x');

    expect(items).toEqual([item({ spokenName: 'recovered' })]);
  });

  it('is per-utterance: a later success is NOT short-circuited by an earlier failure', async () => {
    // No circuit breaker on purpose. One slow Gemini call must not pin the rest
    // of the demo to the mock.
    const good = [item({ spokenName: 'real' })];
    const extract = vi
      .fn<(raw: string) => Promise<ExtractedItem[]>>()
      .mockRejectedValueOnce(new UiError('vendor_error'))
      .mockResolvedValueOnce(good);
    const composed = withFallback({ extract }, resolving([item({ spokenName: 'mock' })]));

    await expect(composed.extract('first')).resolves.toEqual([item({ spokenName: 'mock' })]);
    await expect(composed.extract('second')).resolves.toEqual(good);
    expect(extract).toHaveBeenCalledTimes(2);
  });

  it('propagates a fallback throw: with both sides down there is nothing to hide', async () => {
    const composed = withFallback(rejecting(new UiError('vendor_error')), rejecting(new Error('mock died')));

    await expect(composed.extract('x')).rejects.toThrow('mock died');
  });
});
