/**
 * T13 repair — the transcript must survive the WHOLE resolution chain.
 *
 * The frozen `anomaly` and `search` overlay variants carry no transcript, so
 * before this fix an anomaly- or search-resolved advance into the combined
 * confirm sheet rendered `transcript: ''` — the operator lost what they had
 * just said exactly when they were asked to confirm it.
 *
 * The fix is one additive `SessionState.lastTranscript` field, set on
 * `PIPELINE_TRANSCRIPT` / `PIPELINE_RESOLVED` and read by every queue advance.
 * This file lives apart from `reducer.test.ts` (owned by T7) on purpose.
 */
import { describe, expect, test } from 'vitest';

import type { Candidate, MatchResponse } from '../../src/lib/api/types';
import type { Anomaly } from '../../src/lib/anomaly/engine';
import type { ExtractedItem } from '../../src/lib/extraction/adapter';
import type { ConfirmableItem, PipelineOutcome, QueueEntry } from '../../src/lib/pipeline';
import type { SessionState } from '../../src/lib/session/types';
import { initialSessionState, sessionReducer } from '../../src/lib/session/reducer';

const TRANSCRIPT = 'novecientos gramos de aceite de oliva extra virgen y dos cajas de tomate chonto';

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    nr_articulo: '10045',
    articulo: 'ACEITE DE OLIVA EXTRA VIRGEN',
    unidad: 'Liter',
    unidad_display: 'litros',
    score: 0.94,
    ...over,
  };
}

function matchResponse(): MatchResponse {
  return {
    status: 'matched',
    candidates: [candidate()],
    top_score: 0.94,
    margin: 0.31,
    request_id: 'req-match-1',
  };
}

function extracted(over: Partial<ExtractedItem> = {}): ExtractedItem {
  return { quantity: 900, unit: 'gramos', spokenName: 'aceite de oliva extra virgen', ...over };
}

function confirmable(over: Partial<ConfirmableItem> = {}): ConfirmableItem {
  return { extracted: extracted(), match: matchResponse(), picked: candidate(), ...over };
}

const anomaly: Anomaly = {
  kind: 'unidad',
  title: 'Revisa la unidad',
  reason: 'Dictaste gramos y el artículo se cuenta en litros.',
  hint: 'Confirma si son 900 gramos o 900 mililitros.',
};

function outcome(queue: QueueEntry[]): PipelineOutcome {
  return { transcript: TRANSCRIPT, queue };
}

/** Drive the real reducer from `count` + in-flight pipeline, exactly as the
 *  session does, so no state is hand-forged around the transition under test. */
function resolvedWith(queue: QueueEntry[]): SessionState {
  const counting: SessionState = {
    ...initialSessionState,
    screen: 'count',
    micPermission: 'granted',
    catalogueId: 'STOCK_RESTAURANTE_FUENTES_AYB',
    requestInFlight: true,
    overlay: { kind: 'processing', transcript: null },
  };
  return sessionReducer(counting, { type: 'PIPELINE_RESOLVED', outcome: outcome(queue) });
}

describe('transcript continuity through the resolution queue', () => {
  test('PIPELINE_TRANSCRIPT records the transcript on the state', () => {
    const counting: SessionState = {
      ...initialSessionState,
      screen: 'count',
      requestInFlight: true,
      overlay: { kind: 'processing', transcript: null },
    };
    const next = sessionReducer(counting, { type: 'PIPELINE_TRANSCRIPT', raw: TRANSCRIPT });

    expect(next.lastTranscript).toBe(TRANSCRIPT);
  });

  test('PIPELINE_RESOLVED records the outcome transcript on the state', () => {
    expect(resolvedWith([{ kind: 'confirmable', item: confirmable() }]).lastTranscript).toBe(TRANSCRIPT);
  });

  test('anomaly -> confirm keeps the transcript (ANOMALY_KEEP_NOTED)', () => {
    const state = resolvedWith([
      { kind: 'anomaly', item: confirmable(), anomaly },
      { kind: 'confirmable', item: confirmable({ extracted: extracted({ spokenName: 'tomate chonto' }) }) },
    ]);
    expect(state.overlay?.kind).toBe('anomaly');

    const next = sessionReducer(state, { type: 'ANOMALY_KEEP_NOTED', at: 1_700_000_000_000 });

    expect(next.overlay?.kind).toBe('confirm');
    if (next.overlay?.kind !== 'confirm') throw new Error('unreachable');
    expect(next.overlay.transcript).toBe(TRANSCRIPT);
  });

  test('anomaly -> confirm keeps the transcript (ANOMALY_REDICTATE)', () => {
    const state = resolvedWith([
      { kind: 'anomaly', item: confirmable(), anomaly },
      { kind: 'confirmable', item: confirmable() },
    ]);

    const next = sessionReducer(state, { type: 'ANOMALY_REDICTATE' });

    expect(next.overlay?.kind).toBe('confirm');
    if (next.overlay?.kind !== 'confirm') throw new Error('unreachable');
    expect(next.overlay.transcript).toBe(TRANSCRIPT);
  });

  test('search -> confirm keeps the transcript (SEARCH_PICKED)', () => {
    const state = resolvedWith([
      { kind: 'needs_search', item: extracted({ spokenName: 'tablas para picar blancas' }), candidates: [] },
    ]);
    expect(state.overlay?.kind).toBe('search');

    const next = sessionReducer(state, { type: 'SEARCH_PICKED', candidate: candidate() });

    expect(next.overlay?.kind).toBe('confirm');
    if (next.overlay?.kind !== 'confirm') throw new Error('unreachable');
    expect(next.overlay.transcript).toBe(TRANSCRIPT);
  });

  test('search -> confirm keeps the transcript (SEARCH_DISMISSED)', () => {
    const state = resolvedWith([
      { kind: 'needs_search', item: extracted(), candidates: [] },
      { kind: 'confirmable', item: confirmable() },
    ]);

    const next = sessionReducer(state, { type: 'SEARCH_DISMISSED' });

    expect(next.overlay?.kind).toBe('confirm');
    if (next.overlay?.kind !== 'confirm') throw new Error('unreachable');
    expect(next.overlay.transcript).toBe(TRANSCRIPT);
  });

  test('the transcript survives a full anomaly -> search -> confirm chain', () => {
    const state = resolvedWith([
      { kind: 'anomaly', item: confirmable(), anomaly },
      { kind: 'needs_search', item: extracted({ spokenName: 'tomate chonto' }), candidates: [] },
      { kind: 'confirmable', item: confirmable() },
    ]);

    const afterAnomaly = sessionReducer(state, { type: 'ANOMALY_REDICTATE' });
    expect(afterAnomaly.overlay?.kind).toBe('search');

    const afterSearch = sessionReducer(afterAnomaly, { type: 'SEARCH_DISMISSED' });
    expect(afterSearch.overlay?.kind).toBe('confirm');
    if (afterSearch.overlay?.kind !== 'confirm') throw new Error('unreachable');
    expect(afterSearch.overlay.transcript).toBe(TRANSCRIPT);
  });

  test('initial state carries no transcript yet', () => {
    expect(initialSessionState.lastTranscript).toBeNull();
  });
});
