/**
 * T7 — the pure operator session reducer (design §6, REQ-OCF-1/3/4/5/9).
 *
 * This suite is the operator app's brain under test. It is DOM-free and
 * clock-free: every timestamp is supplied explicitly, exactly as the frozen
 * `CONFIRM_ACCEPTED { at }` / `ANOMALY_KEEP_NOTED { at }` events require.
 */
import { describe, expect, test } from 'vitest';

import { UiError } from '../../src/lib/api/types';
import type { Candidate, MatchResponse } from '../../src/lib/api/types';
import type { Anomaly } from '../../src/lib/anomaly/engine';
import type { CapturedAudio } from '../../src/lib/audio/types';
import type { ExtractedItem } from '../../src/lib/extraction/adapter';
import type { ConfirmableItem, PipelineOutcome, QueueEntry } from '../../src/lib/pipeline';
import type { CountRecord, Overlay, SessionEvent, SessionState } from '../../src/lib/session/types';
import { blocked, initialSessionState, sessionReducer } from '../../src/lib/session/reducer';

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

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

function matchResponse(over: Partial<MatchResponse> = {}): MatchResponse {
  return {
    status: 'matched',
    candidates: [candidate()],
    top_score: 0.94,
    margin: 0.31,
    request_id: 'req-match-1',
    ...over,
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

function outcome(queue: QueueEntry[], transcript = 'novecientos gramos de aceite de oliva'): PipelineOutcome {
  return { transcript, queue };
}

function record(over: Partial<CountRecord> = {}): CountRecord {
  return {
    id: 'r-seed-1',
    quantity: 12,
    unitDisplay: 'unidades',
    unitCode: null,
    articulo: 'GASEOSA 350ML',
    nrArticulo: '20031',
    spokenName: 'gaseosas',
    state: 'ok',
    createdAt: 1_700_000_000_000,
    ...over,
  };
}

/** A state parked on the count screen, mic granted, plan chosen. */
function counting(over: Partial<SessionState> = {}): SessionState {
  return {
    ...initialSessionState,
    screen: 'count',
    consentChecked: true,
    micPermission: 'granted',
    catalogueId: 'stock_restaurante_fuentes_ayb',
    ...over,
  };
}

const audio: CapturedAudio = { blob: new Blob(['x']), mimeType: 'audio/webm', durationMs: 4200 };

const AT = 1_800_000_000_000;

/* -------------------------------------------------------------------------- */
/* S1 — consent gate and microphone permission                                */
/* -------------------------------------------------------------------------- */

describe('S1 consent gate', () => {
  test('CONSENT_TOGGLED flips the checkbox', () => {
    const s1 = sessionReducer(initialSessionState, { type: 'CONSENT_TOGGLED' });
    expect(s1.consentChecked).toBe(true);
    expect(sessionReducer(s1, { type: 'CONSENT_TOGGLED' }).consentChecked).toBe(false);
  });

  test('MIC_REQUESTED is a no-op while consent is unchecked', () => {
    const s = initialSessionState;
    expect(s.consentChecked).toBe(false);
    expect(sessionReducer(s, { type: 'MIC_REQUESTED' })).toBe(s);
  });

  test('MIC_REQUESTED never mutates state even once consent is checked (it is an effect trigger)', () => {
    const s = { ...initialSessionState, consentChecked: true };
    expect(sessionReducer(s, { type: 'MIC_REQUESTED' })).toBe(s);
  });

  test('MIC_GRANTED advances to plans', () => {
    const s = sessionReducer({ ...initialSessionState, consentChecked: true }, { type: 'MIC_GRANTED' });
    expect(s.micPermission).toBe('granted');
    expect(s.screen).toBe('plans');
  });

  test('MIC_DENIED stays on permiso with the designed fallback note', () => {
    const s = sessionReducer({ ...initialSessionState, consentChecked: true }, { type: 'MIC_DENIED' });
    expect(s.micPermission).toBe('denied');
    expect(s.screen).toBe('permiso');
  });

  test('no overlay can be opened from permiso or done (REQ-OCF-1)', () => {
    for (const screen of ['permiso', 'done'] as const) {
      const s = { ...initialSessionState, screen };
      expect(sessionReducer(s, { type: 'REC_STARTED' }).overlay).toBeNull();
      expect(sessionReducer(s, { type: 'REC_STOPPED', audio }).overlay).toBeNull();
    }
  });
});

/* -------------------------------------------------------------------------- */
/* S2 — plans                                                                 */
/* -------------------------------------------------------------------------- */

describe('S2 plans', () => {
  test('PLAN_STARTED carries the real catalogue_id onto the count screen (REQ-OCF-8)', () => {
    const s = sessionReducer(
      { ...initialSessionState, screen: 'plans', micPermission: 'granted', consentChecked: true },
      { type: 'PLAN_STARTED', catalogueId: 'stock_almacen_ayb' },
    );
    expect(s).toMatchObject({ screen: 'count', overlay: null, catalogueId: 'stock_almacen_ayb' });
  });

  test('PLAN_STARTED is ignored from permiso', () => {
    const s = initialSessionState;
    expect(sessionReducer(s, { type: 'PLAN_STARTED', catalogueId: 'zoologico' })).toBe(s);
  });
});

/* -------------------------------------------------------------------------- */
/* S3 — recording guards                                                      */
/* -------------------------------------------------------------------------- */

describe('S3 recording guards', () => {
  test('REC_STARTED records when every guard passes', () => {
    expect(sessionReducer(counting(), { type: 'REC_STARTED' }).recording).toBe(true);
  });

  test('REC_STARTED is refused without microphone permission', () => {
    const s = counting({ micPermission: 'denied' });
    expect(sessionReducer(s, { type: 'REC_STARTED' })).toBe(s);
  });

  test('REC_STARTED is refused while an overlay is open', () => {
    const s = counting({ overlay: { kind: 'confirm', transcript: 't', items: [confirmable()] } });
    expect(sessionReducer(s, { type: 'REC_STARTED' })).toBe(s);
  });

  test('REC_STARTED is refused while a request is in flight', () => {
    const s = counting({ requestInFlight: true });
    expect(sessionReducer(s, { type: 'REC_STARTED' })).toBe(s);
  });

  test('REC_STOPPED opens the processing overlay and marks the request in flight', () => {
    const s = sessionReducer(counting({ recording: true }), { type: 'REC_STOPPED', audio });
    expect(s.recording).toBe(false);
    expect(s.requestInFlight).toBe(true);
    expect(s.overlay).toEqual({ kind: 'processing', transcript: null });
  });

  test('REC_STOPPED without an active recording is a no-op', () => {
    const s = counting();
    expect(sessionReducer(s, { type: 'REC_STOPPED', audio })).toBe(s);
  });

  test('REC_REJECTED surfaces an error and never uploads (D10)', () => {
    const large = sessionReducer(counting({ recording: true }), { type: 'REC_REJECTED', reason: 'too_large' });
    expect(large.requestInFlight).toBe(false);
    expect(large.recording).toBe(false);
    expect(large.overlay).toBeNull();
    expect(large.error?.code).toBe('payload_too_large');

    const short = sessionReducer(counting({ recording: true }), { type: 'REC_REJECTED', reason: 'too_short' });
    expect(short.error?.code).toBe('invalid_audio');
  });

  test('ERROR_DISMISSED clears the banner and is identity when there is none', () => {
    const withError = counting({ error: new UiError('vendor_timeout') });
    expect(sessionReducer(withError, { type: 'ERROR_DISMISSED' }).error).toBeNull();
    const clean = counting();
    expect(sessionReducer(clean, { type: 'ERROR_DISMISSED' })).toBe(clean);
  });
});

/* -------------------------------------------------------------------------- */
/* S4 — pipeline and queue routing                                            */
/* -------------------------------------------------------------------------- */

describe('S4 pipeline routing', () => {
  const processing = counting({ requestInFlight: true, overlay: { kind: 'processing', transcript: null } });

  test('PIPELINE_TRANSCRIPT reveals the transcript progressively', () => {
    const s = sessionReducer(processing, { type: 'PIPELINE_TRANSCRIPT', raw: 'doce gaseosas' });
    expect(s.overlay).toEqual({ kind: 'processing', transcript: 'doce gaseosas' });
    expect(s.requestInFlight).toBe(true);
  });

  test('PIPELINE_TRANSCRIPT is ignored when no processing overlay is open', () => {
    const s = counting();
    expect(sessionReducer(s, { type: 'PIPELINE_TRANSCRIPT', raw: 'x' })).toBe(s);
  });

  test('three confirmables recombine into ONE confirm overlay', () => {
    const items = [confirmable(), confirmable(), confirmable()];
    const s = sessionReducer(processing, {
      type: 'PIPELINE_RESOLVED',
      outcome: outcome(items.map((item) => ({ kind: 'confirmable', item }))),
    });
    expect(s.requestInFlight).toBe(false);
    expect(s.overlay?.kind).toBe('confirm');
    expect(s.overlay?.kind === 'confirm' && s.overlay.items).toHaveLength(3);
    expect(s.overlay?.kind === 'confirm' && s.overlay.transcript).toBe(
      'novecientos gramos de aceite de oliva',
    );
  });

  test('an anomaly entry wins over searches and confirmables', () => {
    const s = sessionReducer(processing, {
      type: 'PIPELINE_RESOLVED',
      outcome: outcome([
        { kind: 'anomaly', item: confirmable(), anomaly },
        { kind: 'needs_search', item: extracted(), candidates: [] },
        { kind: 'confirmable', item: confirmable() },
      ]),
    });
    expect(s.overlay?.kind).toBe('anomaly');
    expect(s.overlay?.kind === 'anomaly' && s.overlay.queue).toHaveLength(2);
  });

  test('a needs_search entry opens the search overlay (REQ-OCF-6, D8)', () => {
    const s = sessionReducer(processing, {
      type: 'PIPELINE_RESOLVED',
      outcome: outcome([
        { kind: 'needs_search', item: extracted({ spokenName: 'lechuga' }), candidates: [candidate()] },
        { kind: 'confirmable', item: confirmable() },
      ]),
    });
    expect(s.overlay?.kind).toBe('search');
    expect(s.overlay?.kind === 'search' && s.overlay.query).toBe('lechuga');
    expect(s.overlay?.kind === 'search' && s.overlay.candidates).toHaveLength(1);
  });

  test('an empty queue closes the overlay without creating records', () => {
    const s = sessionReducer(processing, { type: 'PIPELINE_RESOLVED', outcome: outcome([]) });
    expect(s.overlay).toBeNull();
    expect(s.records).toHaveLength(0);
    expect(s.requestInFlight).toBe(false);
  });

  test('PIPELINE_FAILED clears the overlay and raises the authored error banner', () => {
    const s = sessionReducer(processing, { type: 'PIPELINE_FAILED', error: new UiError('vendor_timeout', 'rq-9') });
    expect(s.requestInFlight).toBe(false);
    expect(s.overlay).toBeNull();
    expect(s.error?.code).toBe('vendor_timeout');
    expect(s.error?.requestId).toBe('rq-9');
  });
});

/* -------------------------------------------------------------------------- */
/* S5 — confirmation is yes/no only (REQ-OCF-3, RF-33, QA-22)                  */
/* -------------------------------------------------------------------------- */

describe('S5 confirmation', () => {
  const items = [confirmable(), confirmable({ extracted: extracted({ quantity: 12, spokenName: 'gaseosas' }) })];
  const confirming = counting({ overlay: { kind: 'confirm', transcript: 'dos cosas', items } });

  test('CONFIRM_ACCEPTED appends one record per item and bumps progress', () => {
    const s = sessionReducer(confirming, { type: 'CONFIRM_ACCEPTED', at: AT });
    expect(s.records).toHaveLength(2);
    expect(s.progress.counted).toBe(counting().progress.counted + 2);
    expect(s.overlay).toBeNull();
    // Optimistic persistence (design D5): a confirmed record enters `sync` and
    // only becomes `ok` once `RECORD_PERSISTED` reports the server accepted it.
    expect(s.records.every((r) => r.state === 'sync')).toBe(true);
    expect(new Set(s.records.map((r) => r.id)).size).toBe(2);
  });

  test('CountRecord.createdAt comes from the event, never from a clock', () => {
    const s = sessionReducer(confirming, { type: 'CONFIRM_ACCEPTED', at: AT });
    expect(s.records.map((r) => r.createdAt)).toEqual([AT, AT]);
  });

  test('records carry only unidad_display and keep null SKU/unit honest (REQ-OCF-7)', () => {
    const nulled = counting({
      overlay: {
        kind: 'confirm',
        transcript: 't',
        items: [confirmable({ picked: candidate({ nr_articulo: null, unidad: 'Kilogram', unidad_display: null }) })],
      },
    });
    const [r] = sessionReducer(nulled, { type: 'CONFIRM_ACCEPTED', at: AT }).records;
    expect(r?.nrArticulo).toBeNull();
    // REQ-OCF-7 is about what is RENDERED: `unitDisplay` is the only unit any
    // screen reads, and a null one renders nothing rather than a guess. The
    // render-path guard lives where rendering happens
    // (`count-session.test.tsx`: the English unit never reaches the DOM).
    expect(r?.unitDisplay).toBeNull();
  });

  test('records carry the canonical unit code for the SERVER write only (REQ-SDA-4)', () => {
    // `POST /api/records` writes `count_records.unit_code` and re-validates the
    // unit against the catalogue. The Spanish `unidad_display` is a rendering,
    // not an identity, so the record has to keep the canonical code too — it is
    // simply never read by a screen.
    const s = sessionReducer(
      counting({
        overlay: {
          kind: 'confirm',
          transcript: 't',
          items: [confirmable({ picked: candidate({ unidad: 'Kilogram', unidad_display: 'kilos' }) })],
        },
      }),
      { type: 'CONFIRM_ACCEPTED', at: AT },
    );

    expect(s.records[0]?.unitCode).toBe('Kilogram');
    expect(s.records[0]?.unitDisplay).toBe('kilos');
  });

  test('a dictation the matcher could not give a unit keeps a null unit code', () => {
    const s = sessionReducer(
      counting({
        overlay: {
          kind: 'confirm',
          transcript: 't',
          items: [confirmable({ picked: candidate({ unidad: null, unidad_display: null }) })],
        },
      }),
      { type: 'CONFIRM_ACCEPTED', at: AT },
    );

    expect(s.records[0]?.unitCode).toBeNull();
  });

  test('newest records come first', () => {
    const seeded = counting({
      overlay: { kind: 'confirm', transcript: 't', items: [confirmable()] },
      records: [record({ id: 'old' })],
    });
    const s = sessionReducer(seeded, { type: 'CONFIRM_ACCEPTED', at: AT });
    expect(s.records).toHaveLength(2);
    expect(s.records[s.records.length - 1]?.id).toBe('old');
  });

  test('CONFIRM_REPEAT discards the whole sheet — no record, mic back to idle', () => {
    const s = sessionReducer(confirming, { type: 'CONFIRM_REPEAT' });
    expect(s.records).toHaveLength(0);
    expect(s.progress.counted).toBe(counting().progress.counted);
    expect(s.overlay).toBeNull();
    expect(s.recording).toBe(false);
  });

  test('the confirm overlay is yes/no only — nothing else resolves it', () => {
    for (const event of [
      { type: 'ANOMALY_REDICTATE' },
      { type: 'ANOMALY_KEEP_NOTED', at: AT },
      { type: 'SEARCH_PICKED', candidate: candidate() },
      { type: 'SEARCH_DISMISSED' },
      { type: 'COUNT_FINISHED' },
    ] satisfies SessionEvent[]) {
      expect(sessionReducer(confirming, event)).toBe(confirming);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* S6 — anomaly block (REQ-OCF-5, RF-28, RF-29)                               */
/* -------------------------------------------------------------------------- */

describe('S6 anomaly block', () => {
  const anomalyOverlay = counting({
    overlay: { kind: 'anomaly', item: confirmable(), anomaly, queue: [{ kind: 'confirmable', item: confirmable() }] },
  });

  test('blocked is DERIVED from the overlay and from anom_open records, never stored', () => {
    expect(blocked(counting())).toBe(false);
    expect(blocked(anomalyOverlay)).toBe(true);
    expect(blocked(counting({ records: [record({ state: 'anom_open' })] }))).toBe(true);
    expect(blocked(counting({ records: [record({ state: 'anom_noted' })] }))).toBe(false);
    expect('blocked' in counting()).toBe(false);
  });

  test('RF-28: while blocked, REC_STARTED is rejected', () => {
    expect(sessionReducer(anomalyOverlay, { type: 'REC_STARTED' })).toBe(anomalyOverlay);
    const flagged = counting({ records: [record({ state: 'anom_open' })] });
    expect(sessionReducer(flagged, { type: 'REC_STARTED' })).toBe(flagged);
    expect(sessionReducer(flagged, { type: 'REC_STARTED' }).recording).toBe(false);
  });

  test('RF-29: the block never cuts an in-flight recording', () => {
    const recordingWhileFlagged = counting({ recording: true, records: [record({ state: 'anom_open' })] });
    expect(blocked(recordingWhileFlagged)).toBe(true);
    const stopped = sessionReducer(recordingWhileFlagged, { type: 'REC_STOPPED', audio });
    expect(stopped.recording).toBe(false);
    expect(stopped.requestInFlight).toBe(true);
    expect(stopped.overlay).toEqual({ kind: 'processing', transcript: null });
  });

  test('RF-29: an anomaly arriving mid-recording does not terminate the recording', () => {
    const midRecording = counting({
      recording: true,
      requestInFlight: true,
      overlay: { kind: 'processing', transcript: null },
    });
    const s = sessionReducer(midRecording, {
      type: 'PIPELINE_RESOLVED',
      outcome: outcome([{ kind: 'anomaly', item: confirmable(), anomaly }]),
    });
    expect(s.overlay?.kind).toBe('anomaly');
    expect(blocked(s)).toBe(true);
    // The anomaly applies at the boundary: the in-flight recording survives it.
    expect(s.recording).toBe(true);
  });

  test('ANOMALY_REDICTATE drops the item and pops the queue', () => {
    const s = sessionReducer(anomalyOverlay, { type: 'ANOMALY_REDICTATE' });
    expect(s.records).toHaveLength(0);
    expect(s.overlay?.kind).toBe('confirm');
    expect(s.overlay?.kind === 'confirm' && s.overlay.items).toHaveLength(1);
    expect(blocked(s)).toBe(false);
  });

  test('ANOMALY_KEEP_NOTED appends a kept record carrying the anomaly, then pops the queue', () => {
    const s = sessionReducer(anomalyOverlay, { type: 'ANOMALY_KEEP_NOTED', at: AT });
    expect(s.records).toHaveLength(1);
    // Optimistic (design D5): `sync` until the server confirms, then `anom_noted`.
    expect(s.records[0]?.state).toBe('sync');
    expect(s.records[0]?.anomaly).toEqual(anomaly);
    expect(s.records[0]?.createdAt).toBe(AT);
    expect(s.progress.counted).toBe(counting().progress.counted + 1);
    expect(s.overlay?.kind).toBe('confirm');
    expect(blocked(s)).toBe(false);
  });

  test('resolving the last anomaly with an empty queue closes the overlay and unblocks the mic', () => {
    const last = counting({ overlay: { kind: 'anomaly', item: confirmable(), anomaly, queue: [] } });
    const s = sessionReducer(last, { type: 'ANOMALY_REDICTATE' });
    expect(s.overlay).toBeNull();
    expect(blocked(s)).toBe(false);
    expect(sessionReducer(s, { type: 'REC_STARTED' }).recording).toBe(true);
  });

  test('back-to-back anomalies chain through the queue', () => {
    const chained = counting({
      overlay: {
        kind: 'anomaly',
        item: confirmable(),
        anomaly,
        queue: [{ kind: 'anomaly', item: confirmable(), anomaly }],
      },
    });
    const s = sessionReducer(chained, { type: 'ANOMALY_REDICTATE' });
    expect(s.overlay?.kind).toBe('anomaly');
    expect(blocked(s)).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* S7 — manual search                                                         */
/* -------------------------------------------------------------------------- */

describe('S7 manual search', () => {
  const searching = counting({
    overlay: {
      kind: 'search',
      item: extracted({ spokenName: 'lechuga' }),
      candidates: [],
      query: 'lechuga',
      queue: [{ kind: 'confirmable', item: confirmable() }],
    },
  });

  test('SEARCH_QUERY_CHANGED updates only the query', () => {
    const s = sessionReducer(searching, { type: 'SEARCH_QUERY_CHANGED', query: 'lechuga bata' });
    expect(s.overlay?.kind === 'search' && s.overlay.query).toBe('lechuga bata');
    expect(s.overlay?.kind === 'search' && s.overlay.candidates).toHaveLength(0);
  });

  test('SEARCH_RESULTS replaces the candidate list', () => {
    const s = sessionReducer(searching, { type: 'SEARCH_RESULTS', candidates: [candidate(), candidate()] });
    expect(s.overlay?.kind === 'search' && s.overlay.candidates).toHaveLength(2);
  });

  test('SEARCH_PICKED makes the item confirmable and appends it to the queue', () => {
    const picked = candidate({ nr_articulo: '77', articulo: 'LECHUGA BATAVIA', unidad_display: 'kg' });
    const s = sessionReducer(searching, { type: 'SEARCH_PICKED', candidate: picked });
    expect(s.overlay?.kind).toBe('confirm');
    const sheetItems = s.overlay?.kind === 'confirm' ? s.overlay.items : [];
    expect(sheetItems).toHaveLength(2);
    expect(sheetItems.some((i) => i.picked.nr_articulo === '77')).toBe(true);
    expect(s.records).toHaveLength(0);
  });

  test('SEARCH_DISMISSED drops the item and advances the queue («Ninguno · volver a dictar»)', () => {
    const s = sessionReducer(searching, { type: 'SEARCH_DISMISSED' });
    expect(s.overlay?.kind).toBe('confirm');
    expect(s.overlay?.kind === 'confirm' && s.overlay.items).toHaveLength(1);
    expect(s.records).toHaveLength(0);
  });

  test('dismissing the only search entry returns to idle', () => {
    const only = counting({
      overlay: { kind: 'search', item: extracted(), candidates: [], query: '', queue: [] },
    });
    expect(sessionReducer(only, { type: 'SEARCH_DISMISSED' }).overlay).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Records — voice creates only (REQ-OCF-4, RF-20, RF-21)                      */
/* -------------------------------------------------------------------------- */

describe('voice creates only', () => {
  const existing = record({ id: 'keep-me', quantity: 12 });

  test('no event mutates an existing record', () => {
    const events: SessionEvent[] = [
      { type: 'CONSENT_TOGGLED' },
      { type: 'MIC_REQUESTED' },
      { type: 'MIC_GRANTED' },
      { type: 'MIC_DENIED' },
      { type: 'PLAN_STARTED', catalogueId: 'zoologico' },
      { type: 'REC_STARTED' },
      { type: 'REC_STOPPED', audio },
      { type: 'REC_REJECTED', reason: 'too_large' },
      { type: 'PIPELINE_TRANSCRIPT', raw: 'trece gaseosas' },
      { type: 'PIPELINE_RESOLVED', outcome: outcome([{ kind: 'confirmable', item: confirmable() }]) },
      { type: 'PIPELINE_FAILED', error: new UiError('garbage') },
      { type: 'CONFIRM_ACCEPTED', at: AT },
      { type: 'CONFIRM_REPEAT' },
      { type: 'ANOMALY_REDICTATE' },
      { type: 'ANOMALY_KEEP_NOTED', at: AT },
      { type: 'SEARCH_QUERY_CHANGED', query: 'gaseosa' },
      { type: 'SEARCH_RESULTS', candidates: [candidate()] },
      { type: 'SEARCH_PICKED', candidate: candidate() },
      { type: 'SEARCH_DISMISSED' },
      { type: 'COUNT_FINISHED' },
      { type: 'BACK_TO_PLANS' },
      { type: 'ERROR_DISMISSED' },
    ];

    for (const event of events) {
      const start = counting({
        recording: true,
        records: [existing],
        overlay: { kind: 'confirm', transcript: 't', items: [confirmable()] },
      });
      const next = sessionReducer(start, event);
      const survivor = next.records.find((r) => r.id === 'keep-me');
      if (survivor) {
        expect(survivor).toBe(existing);
        expect(survivor.quantity).toBe(12);
      }
    }
  });

  test('the only removal path is RECORD_DELETED (touch), which decrements progress', () => {
    const s = counting({ records: [existing], progress: { counted: 46, total: 107 } });
    const after = sessionReducer(s, { type: 'RECORD_DELETED', id: 'keep-me' });
    expect(after.records).toHaveLength(0);
    expect(after.progress.counted).toBe(45);
  });

  test('RECORD_DELETED on an unknown id is a no-op', () => {
    const s = counting({ records: [existing] });
    expect(sessionReducer(s, { type: 'RECORD_DELETED', id: 'nope' })).toBe(s);
  });

  test('RECORD_DELETED never drives progress below zero', () => {
    const s = counting({ records: [existing], progress: { counted: 0, total: 107 } });
    expect(sessionReducer(s, { type: 'RECORD_DELETED', id: 'keep-me' }).progress.counted).toBe(0);
  });

  test('deleting an anom_open record unblocks the mic (delete-then-redictate, RF-21)', () => {
    const s = counting({ records: [record({ id: 'bad', state: 'anom_open' })] });
    expect(blocked(s)).toBe(true);
    const after = sessionReducer(s, { type: 'RECORD_DELETED', id: 'bad' });
    expect(blocked(after)).toBe(false);
    expect(sessionReducer(after, { type: 'REC_STARTED' }).recording).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Blind counting (REQ-OCF-2, RF-18, QA-12)                                    */
/* -------------------------------------------------------------------------- */

describe('blind counting invariant', () => {
  /** Every key the operator state tree may expose, structurally. */
  function keysOf(value: unknown, acc = new Set<string>()): Set<string> {
    if (value === null || typeof value !== 'object') return acc;
    if (Array.isArray(value)) {
      value.forEach((v) => keysOf(v, acc));
      return acc;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      acc.add(k);
      keysOf(v, acc);
    }
    return acc;
  }

  test('no state reachable by the operator carries theoretical/system stock', () => {
    const flow: SessionEvent[] = [
      { type: 'CONSENT_TOGGLED' },
      { type: 'MIC_GRANTED' },
      { type: 'PLAN_STARTED', catalogueId: 'stock_restaurante_fuentes_ayb' },
      { type: 'REC_STARTED' },
      { type: 'REC_STOPPED', audio },
      { type: 'PIPELINE_TRANSCRIPT', raw: 'doce gaseosas' },
      {
        type: 'PIPELINE_RESOLVED',
        outcome: outcome([
          { kind: 'anomaly', item: confirmable(), anomaly },
          { kind: 'needs_search', item: extracted(), candidates: [candidate()] },
          { kind: 'confirmable', item: confirmable() },
        ]),
      },
      { type: 'ANOMALY_KEEP_NOTED', at: AT },
      { type: 'SEARCH_PICKED', candidate: candidate() },
      { type: 'CONFIRM_ACCEPTED', at: AT },
      { type: 'COUNT_FINISHED' },
    ];

    const forbidden = /stock|teoric|teóric|system|sistema|esperad|expected|saldo|existencia|kardex/i;
    let state = initialSessionState;
    for (const event of flow) {
      state = sessionReducer(state, event);
      for (const key of keysOf(state)) {
        expect(key).not.toMatch(forbidden);
      }
    }
    expect(state.screen).toBe('done');
    expect(state.records.length).toBeGreaterThan(0);
  });

  test('a CountRecord exposes only counted quantities, never a reference value', () => {
    const s = sessionReducer(
      counting({ overlay: { kind: 'confirm', transcript: 't', items: [confirmable()] } }),
      { type: 'CONFIRM_ACCEPTED', at: AT },
    );
    // `unitCode` joins the whitelist: it is the unit the operator DICTATED,
    // carried for the server write, not a reference value from the system.
    expect(Object.keys(s.records[0] ?? {}).sort()).toEqual(
      [
        'articulo',
        'createdAt',
        'id',
        'nrArticulo',
        'quantity',
        'spokenName',
        'state',
        'unitCode',
        'unitDisplay',
      ].sort(),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* S9 — «Terminar conteo» (REQ-OCF-9, D9 — authored control)                   */
/* -------------------------------------------------------------------------- */

describe('S9 finish count', () => {
  test('COUNT_FINISHED reaches done from count', () => {
    const s = sessionReducer(counting({ records: [record()] }), { type: 'COUNT_FINISHED' });
    expect(s.screen).toBe('done');
    expect(s.overlay).toBeNull();
    expect(s.records).toHaveLength(1);
  });

  test('COUNT_FINISHED is refused while any overlay is open', () => {
    const overlays: NonNullable<Overlay>[] = [
      { kind: 'processing', transcript: null },
      { kind: 'confirm', transcript: 't', items: [confirmable()] },
      { kind: 'anomaly', item: confirmable(), anomaly, queue: [] },
      { kind: 'search', item: extracted(), candidates: [], query: '', queue: [] },
    ];
    for (const overlay of overlays) {
      const s = counting({ overlay });
      expect(sessionReducer(s, { type: 'COUNT_FINISHED' })).toBe(s);
      expect(sessionReducer(s, { type: 'COUNT_FINISHED' }).screen).toBe('count');
    }
  });

  test('COUNT_FINISHED is refused while a request is in flight', () => {
    const s = counting({ requestInFlight: true });
    expect(sessionReducer(s, { type: 'COUNT_FINISHED' })).toBe(s);
  });

  test('COUNT_FINISHED is refused outside the count screen', () => {
    for (const screen of ['permiso', 'plans', 'done'] as const) {
      const s = { ...initialSessionState, screen };
      expect(sessionReducer(s, { type: 'COUNT_FINISHED' })).toBe(s);
    }
  });

  test('BACK_TO_PLANS returns from done and freezes the summary records', () => {
    const done = sessionReducer(counting({ records: [record()] }), { type: 'COUNT_FINISHED' });
    const back = sessionReducer(done, { type: 'BACK_TO_PLANS' });
    expect(back.screen).toBe('plans');
    expect(back.overlay).toBeNull();
    expect(back.records).toHaveLength(1);
  });

  test('BACK_TO_PLANS is refused from count', () => {
    const s = counting();
    expect(sessionReducer(s, { type: 'BACK_TO_PLANS' })).toBe(s);
  });
});

/* -------------------------------------------------------------------------- */
/* Totality                                                                   */
/* -------------------------------------------------------------------------- */

describe('the reducer is total', () => {
  const everyEvent: SessionEvent[] = [
    { type: 'CONSENT_TOGGLED' },
    { type: 'MIC_REQUESTED' },
    { type: 'MIC_GRANTED' },
    { type: 'MIC_DENIED' },
    { type: 'PLAN_STARTED', catalogueId: 'zoologico' },
    { type: 'REC_STARTED' },
    { type: 'REC_STOPPED', audio },
    { type: 'REC_REJECTED', reason: 'too_short' },
    { type: 'PIPELINE_TRANSCRIPT', raw: 'x' },
    { type: 'PIPELINE_RESOLVED', outcome: outcome([]) },
    { type: 'PIPELINE_FAILED', error: new UiError('aborted') },
    { type: 'CONFIRM_ACCEPTED', at: AT },
    { type: 'CONFIRM_REPEAT' },
    { type: 'ANOMALY_REDICTATE' },
    { type: 'ANOMALY_KEEP_NOTED', at: AT },
    { type: 'SEARCH_QUERY_CHANGED', query: 'q' },
    { type: 'SEARCH_RESULTS', candidates: [] },
    { type: 'SEARCH_PICKED', candidate: candidate() },
    { type: 'SEARCH_DISMISSED' },
    { type: 'RECORD_DELETED', id: 'r-seed-1' },
    { type: 'COUNT_FINISHED' },
    { type: 'BACK_TO_PLANS' },
    { type: 'ERROR_DISMISSED' },
  ];

  const states: SessionState[] = [
    initialSessionState,
    { ...initialSessionState, screen: 'plans', consentChecked: true, micPermission: 'granted' },
    counting(),
    counting({ recording: true }),
    counting({ requestInFlight: true, overlay: { kind: 'processing', transcript: null } }),
    counting({ overlay: { kind: 'confirm', transcript: 't', items: [confirmable()] } }),
    counting({ overlay: { kind: 'anomaly', item: confirmable(), anomaly, queue: [] } }),
    counting({ overlay: { kind: 'search', item: extracted(), candidates: [], query: '', queue: [] } }),
    counting({ records: [record({ state: 'anom_open' })] }),
    { ...counting({ records: [record()] }), screen: 'done' },
  ];

  test('every (state, event) pair returns a valid state and never throws', () => {
    const screens = new Set(['permiso', 'plans', 'count', 'done']);
    for (const state of states) {
      for (const event of everyEvent) {
        const next = sessionReducer(state, event);
        expect(screens.has(next.screen)).toBe(true);
        expect(Array.isArray(next.records)).toBe(true);
        expect(typeof next.progress.counted).toBe('number');
        expect(next.progress.counted).toBeGreaterThanOrEqual(0);
        expect(typeof blocked(next)).toBe('boolean');
        // Overlays only over `count` (REQ-OCF-1).
        if (next.screen !== 'count') expect(next.overlay).toBeNull();
      }
    }
  });

  test('an unknown event returns the identical state object', () => {
    const s = counting();
    expect(sessionReducer(s, { type: 'NOT_A_REAL_EVENT' } as unknown as SessionEvent)).toBe(s);
  });

  test('the reducer never mutates the input state', () => {
    const s = counting({ records: [record()], overlay: { kind: 'confirm', transcript: 't', items: [confirmable()] } });
    const snapshot = JSON.stringify(s);
    for (const event of everyEvent) sessionReducer(s, event);
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});

/* -------------------------------------------------------------------------- */
/* Persistence events (REQ-OCF-13, design D5)                                  */
/* -------------------------------------------------------------------------- */

describe('optimistic record persistence', () => {
  const anomaly: Anomaly = {
    kind: 'cantidad',
    title: 'Cantidad fuera de lo habitual',
    reason: 'r',
    hint: 'h',
  };

  function withPending(overrides: Partial<CountRecord> = {}) {
    return counting({ records: [record({ id: 'rec-1', state: 'sync', ...overrides })] });
  }

  test('RECORD_PERSISTED settles a clean record as ok and stores the server id', () => {
    const s = sessionReducer(withPending(), {
      type: 'RECORD_PERSISTED',
      id: 'rec-1',
      serverId: 'srv-9',
    });
    expect(s.records[0]?.state).toBe('ok');
    expect(s.records[0]?.serverId).toBe('srv-9');
    expect(s.error).toBeNull();
  });

  test('RECORD_PERSISTED settles a flagged record as anom_noted, keeping the anomaly', () => {
    const s = sessionReducer(withPending({ anomaly }), {
      type: 'RECORD_PERSISTED',
      id: 'rec-1',
      serverId: 'srv-9',
    });
    expect(s.records[0]?.state).toBe('anom_noted');
    expect(s.records[0]?.anomaly).toEqual(anomaly);
  });

  test('RECORD_PERSISTED for an unknown id returns the identical state', () => {
    const s = withPending();
    expect(sessionReducer(s, { type: 'RECORD_PERSISTED', id: 'ghost', serverId: 'x' })).toBe(s);
  });

  test('RECORD_PERSIST_FAILED keeps the record in sync and raises the error banner', () => {
    const error = new UiError('proxy_unreachable');
    const s = sessionReducer(withPending(), { type: 'RECORD_PERSIST_FAILED', id: 'rec-1', error });
    expect(s.records[0]?.state).toBe('sync');
    expect(s.error).toBe(error);
  });

  test('a failed persist never removes the record — the count is not lost', () => {
    const s = sessionReducer(withPending(), {
      type: 'RECORD_PERSIST_FAILED',
      id: 'rec-1',
      error: new UiError('vendor_error'),
    });
    expect(s.records).toHaveLength(1);
    expect(s.progress.counted).toBe(withPending().progress.counted);
  });

  test('PLAN_STARTED stores the plan and operator alongside the catalogue', () => {
    const s = sessionReducer(counting({ screen: 'plans' }), {
      type: 'PLAN_STARTED',
      catalogueId: 'cat-1',
      planId: 'plan-1',
      operatorId: 'op-1',
      warehouseId: 'wh-1',
    });
    expect(s.planId).toBe('plan-1');
    expect(s.operatorId).toBe('op-1');
    expect(s.warehouseId).toBe('wh-1');
    expect(s.catalogueId).toBe('cat-1');
  });
});

/* -------------------------------------------------------------------------- */
/* Record ids are idempotency keys, so they must never be reused              */
/* -------------------------------------------------------------------------- */

describe('record ids survive deletion (REQ-SDA-4, RF-20/21)', () => {
  test('a record created after a delete does NOT reuse the deleted record’s id', () => {
    // The id is sent as `count_records.client_record_id`, which is unique and is
    // how a retried POST resolves to an existing row. Deriving it from
    // `records.length` made a delete-then-redictate mint the SAME key, so the
    // redictation would resolve to the soft-deleted row instead of creating one.
    const sheet = { kind: 'confirm' as const, transcript: 't', items: [confirmable()] };

    const first = sessionReducer(counting({ overlay: sheet }), { type: 'CONFIRM_ACCEPTED', at: AT });
    const firstId = first.records[0]!.id;

    const emptied = sessionReducer(first, { type: 'RECORD_DELETED', id: firstId });
    expect(emptied.records).toEqual([]);

    const second = sessionReducer({ ...emptied, overlay: sheet }, { type: 'CONFIRM_ACCEPTED', at: AT });

    expect(second.records).toHaveLength(1);
    expect(second.records[0]!.id).not.toBe(firstId);
  });

  test('two items confirmed in one sheet still get distinct ids', () => {
    const s = sessionReducer(
      counting({
        overlay: { kind: 'confirm', transcript: 't', items: [confirmable(), confirmable()] },
      }),
      { type: 'CONFIRM_ACCEPTED', at: AT },
    );

    expect(s.records).toHaveLength(2);
    expect(s.records[0]!.id).not.toBe(s.records[1]!.id);
  });
});
