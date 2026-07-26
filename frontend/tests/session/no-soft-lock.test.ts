/**
 * The operator can never be trapped (verify report WARNING-3).
 *
 * `CountSession` blocks the mic and disables «Terminar conteo» whenever an
 * overlay is open. That is correct ONLY while every overlay the reducer can
 * produce also has a sheet rendered for it — an overlay with no UI is a
 * soft-lock: no mic, no finish, no way out. `EXCLUDE_OPENED` was exactly that,
 * shipped half-wired ahead of a stretch sheet that was never built.
 *
 * This suite explores the reducer from the initial state over EVERY event and
 * asserts that no reachable state is a dead end. It is drift-proof in both
 * directions: the event alphabet is checked against `session/types.ts`, and the
 * set of rendered overlays is scanned out of `CountSession.tsx`, so
 * reintroducing an unrendered overlay fails here instead of in the demo.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { UiError } from '../../src/lib/api/types';
import type { Candidate, MatchResponse } from '../../src/lib/api/types';
import type { Anomaly } from '../../src/lib/anomaly/engine';
import type { CapturedAudio } from '../../src/lib/audio/types';
import type { ExtractedItem } from '../../src/lib/extraction/adapter';
import type { ConfirmableItem, PipelineOutcome, QueueEntry } from '../../src/lib/pipeline';
import type { SessionEvent, SessionState } from '../../src/lib/session/types';
import { blocked, initialSessionState, sessionReducer } from '../../src/lib/session/reducer';

/* ------------------------------------------------------------------ sources */

const typesSource = readFileSync(resolve(process.cwd(), 'src/lib/session/types.ts'), 'utf8');
const sessionSource = readFileSync(
  resolve(process.cwd(), 'src/components/operator/CountSession.tsx'),
  'utf8',
);

/** Every `type: 'X'` literal declared on the `SessionEvent` union. */
const DECLARED_EVENT_TYPES = new Set(
  [...typesSource.matchAll(/\|\s*\{\s*type:\s*'([A-Z_]+)'/g)].map((m) => m[1] as string),
);

/** Every overlay kind `CountSession` actually renders a sheet for. */
const RENDERED_OVERLAY_KINDS = new Set(
  [...sessionSource.matchAll(/overlay\?\.kind === '([a-z]+)'/g)].map((m) => m[1] as string),
);

/* ----------------------------------------------------------------- builders */

const AT = Date.UTC(2026, 6, 25, 14, 30, 0);

const candidate = (): Candidate => ({
  nr_articulo: '10045',
  articulo: 'ACEITE DE OLIVA EXTRA VIRGEN',
  unidad: 'Liter',
  unidad_display: 'litros',
  score: 0.94,
});

const matchResponse = (): MatchResponse => ({
  status: 'matched',
  candidates: [candidate()],
  top_score: 0.94,
  margin: 0.31,
  request_id: 'req-1',
});

const extracted = (): ExtractedItem => ({
  quantity: 900,
  unit: 'gramos',
  spokenName: 'aceite de oliva extra virgen',
});

const confirmable = (): ConfirmableItem => ({
  extracted: extracted(),
  match: matchResponse(),
  picked: candidate(),
});

const anomaly: Anomaly = {
  kind: 'unidad',
  title: 'Revisa la unidad',
  reason: 'Dictaste gramos y el artículo se cuenta en litros.',
  hint: 'Confirma si son 900 gramos o 900 mililitros.',
};

const audio: CapturedAudio = {
  blob: new Blob(['x'], { type: 'audio/webm' }),
  mimeType: 'audio/webm',
  durationMs: 4_200,
};

const outcome = (queue: QueueEntry[]): PipelineOutcome => ({
  transcript: 'novecientos gramos de aceite de oliva',
  queue,
});

/**
 * The event alphabet the exploration walks. Kept in sync with `SessionEvent`
 * by the guard test below, so a new event cannot slip past unexplored.
 */
const EVERY_EVENT: SessionEvent[] = [
  { type: 'CONSENT_TOGGLED' },
  { type: 'MIC_REQUESTED' },
  { type: 'MIC_GRANTED' },
  { type: 'MIC_DENIED' },
  { type: 'PLAN_STARTED', catalogueId: 'stock_restaurante_fuentes_ayb' },
  // Session resume (REQ-OCF-13): it jumps straight to the count screen with
  // records already in the list, so the walk has to prove THAT entry point is
  // escapable too — not only the one that goes through consent and plans.
  {
    type: 'SESSION_RESUMED',
    catalogueId: 'stock_restaurante_fuentes_ayb',
    planId: 'plan-1',
    operatorId: 'op-1',
    warehouseId: 'wh-1',
    records: [],
  },
  { type: 'REC_STARTED' },
  { type: 'REC_STOPPED', audio },
  { type: 'REC_REJECTED', reason: 'too_large' },
  { type: 'PIPELINE_TRANSCRIPT', raw: 'novecientos gramos de aceite' },
  { type: 'PIPELINE_RESOLVED', outcome: outcome([{ kind: 'confirmable', item: confirmable() }]) },
  {
    type: 'PIPELINE_RESOLVED',
    outcome: outcome([{ kind: 'anomaly', item: confirmable(), anomaly }]),
  },
  {
    type: 'PIPELINE_RESOLVED',
    outcome: outcome([{ kind: 'needs_search', item: extracted(), candidates: [] }]),
  },
  { type: 'PIPELINE_FAILED', error: new UiError('vendor_error') },
  { type: 'CONFIRM_ACCEPTED', at: AT },
  { type: 'CONFIRM_REPEAT' },
  { type: 'ANOMALY_REDICTATE' },
  { type: 'ANOMALY_KEEP_NOTED', at: AT },
  { type: 'SEARCH_QUERY_CHANGED', query: 'aceite' },
  { type: 'SEARCH_RESULTS', candidates: [candidate()] },
  { type: 'SEARCH_PICKED', candidate: candidate() },
  { type: 'SEARCH_DISMISSED' },
  { type: 'RECORD_DELETED', id: 'nope' },
  // Persistence outcomes (D5): the walk must prove that a failed write cannot
  // strand the operator either — `sync` plus a banner is always escapable.
  { type: 'RECORD_PERSISTED', id: 'nope', serverId: 'srv-1' },
  { type: 'RECORD_PERSIST_FAILED', id: 'nope', error: new UiError('proxy_unreachable') },
  { type: 'COUNT_FINISHED' },
  { type: 'BACK_TO_PLANS' },
  { type: 'ERROR_DISMISSED' },
  // Present on purpose: if the S8 exclude events are ever reintroduced, the
  // alphabet guard forces them back into this walk.
];

/* -------------------------------------------------------------- exploration */

/**
 * Coarse fingerprint: the exploration cares about the SHAPE the operator is
 * trapped in, not about record contents, so collapsing the payloads keeps the
 * walk finite while preserving every distinct overlay/lock combination.
 */
const key = (s: SessionState): string =>
  [
    s.screen,
    s.overlay === null ? 'none' : s.overlay.kind,
    s.recording,
    s.requestInFlight,
    s.error === null ? 'ok' : 'err',
    Math.min(s.records.length, 2),
  ].join('|');

/** Every state reachable from the initial state over `EVERY_EVENT`. */
function reachableStates(): SessionState[] {
  const seen = new Map<string, SessionState>();
  let frontier: SessionState[] = [initialSessionState];
  seen.set(key(initialSessionState), initialSessionState);

  while (frontier.length > 0) {
    const next: SessionState[] = [];
    for (const state of frontier) {
      for (const event of EVERY_EVENT) {
        const candidateState = sessionReducer(state, event);
        const k = key(candidateState);
        if (seen.has(k)) continue;
        seen.set(k, candidateState);
        next.push(candidateState);
      }
    }
    frontier = next;
  }
  return [...seen.values()];
}

/** Mirrors `CountScreen`: «Terminar conteo» is disabled under these exact conditions. */
const finishDisabled = (s: SessionState): boolean => s.overlay !== null || s.requestInFlight;

describe('the operator is never trapped', () => {
  test('the exploration alphabet covers every declared SessionEvent', () => {
    // Widened to `Set<string>` on purpose: the declared alphabet is scraped out
    // of the source as raw strings, so the comparison must not be narrowed to
    // the literals that are still declared — that is exactly what is being
    // checked.
    const explored = new Set<string>(EVERY_EVENT.map((e) => e.type));
    expect(DECLARED_EVENT_TYPES.size).toBeGreaterThan(15);
    expect([...DECLARED_EVENT_TYPES].filter((t) => !explored.has(t))).toEqual([]);
  });

  test('every overlay the reducer can open has a sheet in CountSession', () => {
    const reached = new Set<string>(
      reachableStates().flatMap((s) => (s.overlay === null ? [] : [s.overlay.kind as string])),
    );

    // Non-trivial: the walk really does open the real overlays.
    expect(reached).toContain('processing');
    expect(reached).toContain('confirm');
    expect(reached).toContain('anomaly');
    expect(reached).toContain('search');
    expect(RENDERED_OVERLAY_KINDS.size).toBeGreaterThan(3);

    expect([...reached].filter((kind) => !RENDERED_OVERLAY_KINDS.has(kind))).toEqual([]);
  });

  test('no reachable state blocks the mic AND disables «Terminar conteo» with no sheet to escape through', () => {
    const trapped = reachableStates().filter(
      (s) =>
        s.screen === 'count' &&
        blocked(s) &&
        finishDisabled(s) &&
        (s.overlay === null || !RENDERED_OVERLAY_KINDS.has(s.overlay.kind)),
    );

    expect(trapped.map((s) => key(s))).toEqual([]);
  });

  test('every locked count state is locked by a sheet that is on screen', () => {
    const locked = reachableStates().filter((s) => s.screen === 'count' && finishDisabled(s));

    // Companion to the emptiness above: locking really does happen, and every
    // instance of it is accounted for by a rendered overlay or an in-flight
    // request that resolves on its own.
    expect(locked.length).toBeGreaterThan(0);
    for (const state of locked) {
      const escapable = state.overlay === null || RENDERED_OVERLAY_KINDS.has(state.overlay.kind);
      expect(escapable).toBe(true);
    }
  });
});
