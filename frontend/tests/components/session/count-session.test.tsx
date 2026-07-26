/**
 * T20 RED — `CountSession`, the single composition root, plus the S9 done
 * screen and the `/conteo` route (REQ-OCF-1, REQ-OCF-9, REQ-OCF-12, REQ-VC-7,
 * D3, D4).
 *
 * This is the only file in the operator vertical slice that exercises the whole
 * machine at once: real reducer, real `runPipeline`, the real shipped extraction
 * composition, real `FixtureAnomalyEngine`, real screens and sheets. Only the
 * genuine boundaries are stubbed — the microphone, the recorder and the HTTP
 * calls — because those are exactly what the browser owns and a test cannot.
 *
 * Extraction is deliberately NOT injected anywhere in this file: `fetch` is the
 * only seam, so every test also proves the default wiring. Unless a test scripts
 * `/api/extract`, the extractor is unreachable and the mock fallback carries the
 * utterance — which is exactly what the demo host does when Vertex is down.
 *
 * The demo narrative is the acceptance bar, so the happy path here walks it end
 * to end: consent -> plans -> press-and-hold -> transcribe -> extract -> match
 * -> confirm -> record -> «Terminar conteo» -> done.
 */
import { act, fireEvent, render, waitFor, within } from '@testing-library/preact';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import { CountSession } from '../../../src/components/operator/CountSession';
import { fixtureAnomalyEngine } from '../../../src/lib/anomaly/fixtureEngine';
import type { AnomalyEngine } from '../../../src/lib/anomaly/engine';
import type {
  CreateRecordInput,
  CreatedRecord,
  PlanSummary,
} from '../../../src/lib/api/operational';
import { UiError } from '../../../src/lib/api/types';
import type {
  Candidate,
  MatchRequest,
  MatchResponse,
  TranscribeResponse,
} from '../../../src/lib/api/types';
import type { CapturedAudio, RecorderHandle } from '../../../src/lib/audio/types';
import type { MicrophoneResult } from '../../../src/lib/audio/capture';
import { CATALOGUES } from '../../../src/lib/catalogues';
import { blobOfSize, fakeMediaStream } from '../../setup';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                   */
/* -------------------------------------------------------------------------- */

const FIRST = CATALOGUES[0]!;

const SCRIPT_1 = 'tres kilos de lechuga batavia';
const SCRIPT_2 = 'novecientos gramos de aceite de oliva extra virgen';
const SCRIPT_3 = 'cinco tablas para picar blancas';

function transcribeResponse(raw: string, patch: Partial<TranscribeResponse> = {}): TranscribeResponse {
  return {
    raw_transcript: raw,
    is_garbage: false,
    // Both nullable fields stay null: that is the NORMAL case for a chunked
    // MediaRecorder blob and nothing downstream may coerce them.
    stt_confidence: null,
    audio_duration_ms: null,
    stt_vendor: 'test',
    request_id: 'stt-1',
    ...patch,
  };
}

function candidate(patch: Partial<Candidate> = {}): Candidate {
  return {
    nr_articulo: '100221',
    articulo: 'LECHUGA BATAVIA',
    unidad: 'Kilogram',
    unidad_display: 'kilos',
    score: 0.95,
    ...patch,
  };
}

function matched(patch: Partial<Candidate> = {}): MatchResponse {
  return {
    status: 'matched',
    candidates: [candidate(patch)],
    top_score: 0.95,
    margin: 0.4,
    request_id: 'match-1',
  };
}

function noMatch(candidates: Candidate[] = []): MatchResponse {
  return { status: 'no_match', candidates, top_score: 0.2, margin: 0, request_id: 'match-2' };
}

/** `@testing-library/jest-dom` is not installed; read the property directly. */
const disabled = (element: HTMLElement): boolean => (element as HTMLButtonElement).disabled;

const capture: CapturedAudio = {
  blob: new Blob(['audio'], { type: 'audio/webm' }),
  mimeType: 'audio/webm',
  durationMs: 3400,
};

/* -------------------------------------------------------------------------- */
/* Harness                                                                    */
/* -------------------------------------------------------------------------- */

const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';

/** The one plan the stub fetcher hands back — named after the demo catalogue. */
const DEMO_PLAN: PlanSummary = {
  id: '44444444-4444-4444-8444-444444444444',
  name: FIRST.label,
  warehouseId: '28f1c715-4c42-4920-bf4b-6127e40ce11f',
  catalogueId: FIRST.catalogueId,
};

interface Stubs {
  transcript?: string;
  transcribe?: (audio: CapturedAudio) => Promise<TranscribeResponse>;
  match?: (req: MatchRequest) => Promise<MatchResponse>;
  requestMic?: () => Promise<MicrophoneResult>;
  audio?: CapturedAudio;
  persistRecord?: (input: CreateRecordInput) => Promise<CreatedRecord>;
  removeRecord?: (id: string, input: { operatorId: string }) => Promise<{ id: string; deleted: boolean }>;
  /** Omit to exercise the REAL composition-root engine (the HTTP one). */
  anomalies?: AnomalyEngine;
  /**
   * Answers `POST /api/extract`. Omit and the extractor is unreachable, which
   * is what routes every other test in this file through the mock fallback —
   * the exact behaviour the demo host degrades to when Vertex is down.
   */
  extractFetch?: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;
  /**
   * `null` disables session resume. Tests that end mid-count need it: the real
   * `sessionStorage` is shared across the file, so a left-over resume context
   * would make the NEXT mount re-acquire the microphone.
   */
  resumeStorage?: Storage | null;
}

function mount(stubs: Stubs = {}) {
  let persistSeq = 0;
  const audio = stubs.audio ?? capture;
  const stop = vi.fn(async () => audio);
  const start = vi.fn<() => void>();
  const handle: RecorderHandle = { start, stop, onTick: vi.fn() };

  const transcribe = vi.fn(
    stubs.transcribe ?? (async (_audio: CapturedAudio) => transcribeResponse(stubs.transcript ?? SCRIPT_1)),
  );
  const match = vi.fn(stubs.match ?? (async (_req: MatchRequest) => matched()));
  const requestMic = vi.fn(
    stubs.requestMic ?? (async (): Promise<MicrophoneResult> => ({ ok: true, stream: fakeMediaStream() })),
  );
  const openRecorder = vi.fn((_stream: MediaStream) => handle);
  const loadPlans = vi.fn(async () => [DEMO_PLAN]);
  const persistConsent = vi.fn(async () => ({ id: 'consent-1' }));
  const persistRecord = vi.fn(
    stubs.persistRecord ??
      (async (_input: CreateRecordInput): Promise<CreatedRecord> => {
        persistSeq += 1;
        return { id: `server-${persistSeq}`, verdict: 'ok', anomaly: null };
      }),
  );
  const removeRecord = vi.fn(
    stubs.removeRecord ?? (async (id: string) => ({ id, deleted: true })),
  );

  // `extraction` is NOT injected: the point is to exercise whatever the
  // composition root wires by default. `fetch` is the only seam left.
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    // Only `/api/extract` is scriptable. Every other URL keeps the harness's
    // standing rule that the suite never reaches the network, so a stray call
    // fails loudly instead of being answered by the extractor's stub body.
    if (String(input) === '/api/extract' && stubs.extractFetch) return stubs.extractFetch(input, init);
    throw new TypeError('fetch failed');
  });
  vi.stubGlobal('fetch', fetchMock);

  const view = render(
    <CountSession
      transcribe={transcribe}
      match={match}
      requestMic={requestMic}
      openRecorder={openRecorder}
      searchDebounceMs={0}
      now={() => Date.UTC(2026, 6, 25, 14, 41, 0)}
      operatorId={OPERATOR_ID}
      loadPlans={loadPlans}
      persistConsent={persistConsent}
      persistRecord={persistRecord}
      removeRecord={removeRecord}
      {...(stubs.anomalies ? { anomalies: stubs.anomalies } : {})}
      {...(stubs.resumeStorage !== undefined ? { resumeStorage: stubs.resumeStorage } : {})}
    />,
  );

  return {
    ...view,
    transcribe,
    match,
    requestMic,
    openRecorder,
    handle,
    start,
    stop,
    loadPlans,
    persistConsent,
    persistRecord,
    removeRecord,
    fetchMock,
  };
}

/** Consent -> plans -> count, through the real screens and the real reducer. */
async function reachCountScreen(view: ReturnType<typeof mount>): Promise<void> {
  fireEvent.click(view.getByLabelText(/He leído y autorizo/));
  await act(async () => {
    fireEvent.click(view.getByRole('button', { name: 'Permitir el micrófono' }));
  });
  const start = await view.findByRole('button', { name: `Iniciar conteo · ${FIRST.label}` });
  await act(async () => {
    fireEvent.click(start);
  });
  await view.findByRole('button', { name: /Mantén presionado para dictar/ });
}

/** Confirms the sheet currently open and lets the persistence effect settle. */
async function confirmSheet(view: ReturnType<typeof mount>): Promise<void> {
  const sheet = await view.findByTestId('confirm-sheet');
  await act(async () => {
    fireEvent.click(within(sheet).getByRole('button', { name: 'Confirmar' }));
  });
}

/** One complete press-and-hold take. */
async function dictate(view: ReturnType<typeof mount>): Promise<void> {
  const mic = view.getByRole('button', { name: /Mantén presionado para dictar/ });
  fireEvent.pointerDown(mic);
  await act(async () => {
    fireEvent.pointerUp(mic);
  });
}

/* -------------------------------------------------------------------------- */
/* The demo narrative                                                         */
/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */
/* The default extraction wiring (REQ-EXT-5, REQ-EXT-7)                       */
/* -------------------------------------------------------------------------- */

/** The extractor's wire body for a one-item consensus. */
function consensus(producto: string, unidad: string, cantidad: number): Response {
  return new Response(
    JSON.stringify({
      validated_inventory: [{ producto, unidad, cantidad }],
      consensus_status: 'FULL_CONSENSUS',
      confidence_score: 0.96,
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

describe('CountSession — the production default is the real extraction service', () => {
  it('calls POST /api/extract with the transcript when no adapter is injected', async () => {
    const view = mount({
      resumeStorage: null,
      extractFetch: async () => consensus('LECHUGA BATAVIA', 'KILOGRAMO', 3),
    });

    await reachCountScreen(view);
    await dictate(view);
    await view.findByTestId('confirm-sheet');

    const extractCalls = view.fetchMock.mock.calls.filter(([url]) => String(url) === '/api/extract');
    expect(extractCalls).toHaveLength(1);
    const [, init] = extractCalls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ transcription: SCRIPT_1 });
  });

  it("drives the confirm sheet from the SERVICE's answer, not the mock's", async () => {
    // The service canonicalises: `KILOGRAMO`, not the spoken "kilos". Seeing
    // that reach the matcher request is what proves the mock is out of the path.
    const view = mount({
      resumeStorage: null,
      extractFetch: async () => consensus('LECHUGA BATAVIA', 'KILOGRAMO', 7),
    });

    await reachCountScreen(view);
    await dictate(view);

    const sheet = await view.findByTestId('confirm-sheet');
    expect(within(sheet).getByTestId('confirm-item').textContent).toContain('7');
    expect(view.match).toHaveBeenCalledWith(
      expect.objectContaining({ spoken_name: 'LECHUGA BATAVIA', unit: 'kilogramo' }),
    );
  });

  it('falls back to the mock silently when the extractor is unreachable', async () => {
    // No `extractFetch`: `fetch` throws, so the whole utterance is replayed
    // through the deterministic mock — with no error copy and no degraded badge
    // anywhere on screen (REQ-EXT-7).
    const view = mount({ resumeStorage: null });

    await reachCountScreen(view);
    await dictate(view);

    const sheet = await view.findByTestId('confirm-sheet');
    expect(within(sheet).getAllByTestId('confirm-item')).toHaveLength(1);
    // The mock's spoken units, which the service would have canonicalised.
    expect(view.match).toHaveBeenCalledWith(
      expect.objectContaining({ spoken_name: 'lechuga batavia', unit: 'kilos' }),
    );
    expect(view.queryByText(/modo degradado/i)).toBeNull();
    expect(view.queryByText(/sin conexión/i)).toBeNull();
  });
});

describe('CountSession — the operator walk-through, end to end', () => {
  it('runs consent -> plans -> dictation -> confirm -> record -> done', async () => {
    const view = mount();

    // S1: the CTA is dead until consent is ticked (REQ-VC-7 / Ley 1581).
    expect(disabled(view.getByRole('button', { name: 'Permitir el micrófono' }))).toBe(true);

    await reachCountScreen(view);
    expect(view.requestMic).toHaveBeenCalledTimes(1);
    expect(view.getByRole('heading', { name: FIRST.label })).toBeTruthy();

    await dictate(view);

    // S5 combined confirm sheet, built by the REAL pipeline over the real
    // extraction adapter.
    const sheet = await view.findByTestId('confirm-sheet');
    expect(within(sheet).getByTestId('confirm-transcript').textContent).toContain(SCRIPT_1);
    expect(within(sheet).getAllByTestId('confirm-item')).toHaveLength(1);

    // The matcher was asked for the catalogue the operator actually chose.
    expect(view.match).toHaveBeenCalledWith(
      expect.objectContaining({ catalogue_id: FIRST.catalogueId, unit: 'kilos' }),
    );

    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Confirmar' }));
    });

    expect(view.getByText('LECHUGA BATAVIA')).toBeTruthy();
    expect(view.getByText('1 registro')).toBeTruthy();

    // S9 through the AUTHORED «Terminar conteo» control.
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Terminar conteo' }));
    });

    expect(view.getByText('contada y enviada')).toBeTruthy();
  });

  it('reveals the transcript inside the processing sheet before the match resolves', async () => {
    let releaseMatch = (): void => {};
    const gate = new Promise<void>((resolve) => {
      releaseMatch = resolve;
    });
    const view = mount({
      match: async (_req: MatchRequest) => {
        await gate;
        return matched();
      },
    });

    await reachCountScreen(view);
    await dictate(view);

    // S4 is on screen, the pipeline is still in flight, and «Escuché "…"» is
    // already populated — the whole reason `onTranscript` exists.
    const processing = await view.findByTestId('processing-sheet');
    await waitFor(() => {
      expect(within(processing).getByTestId('processing-transcript').textContent).toContain(SCRIPT_1);
    });
    expect(view.queryByTestId('confirm-sheet')).toBeNull();

    await act(async () => {
      releaseMatch();
    });
    await view.findByTestId('confirm-sheet');
  });

  it('accumulates one record per confirmed dictation', async () => {
    const view = mount();
    await reachCountScreen(view);

    for (const _take of [0, 1, 2]) {
      await dictate(view);
      const sheet = await view.findByTestId('confirm-sheet');
      await act(async () => {
        fireEvent.click(within(sheet).getByRole('button', { name: 'Confirmar' }));
      });
    }

    expect(view.getByText('3 registros')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Anomaly — the preventive block (REQ-OCF-5, RF-28)                          */
/* -------------------------------------------------------------------------- */

describe('CountSession — anomaly blocks the microphone', () => {
  async function reachAnomaly() {
    // 900 gramos (mass) against a catalogue article counted in litros (volume):
    // the real FixtureAnomalyEngine rule (a). It is injected explicitly because
    // the composition root now defaults to the HTTP engine once a plan is
    // active — these cases are about the fixture RULES, not the transport.
    const view = mount({
      anomalies: fixtureAnomalyEngine,
      transcript: SCRIPT_2,
      match: async (_req: MatchRequest) =>
        matched({
          articulo: 'ACEITE DE OLIVA EXTRA VIRGEN 500ML',
          unidad: 'Liter',
          unidad_display: 'litros',
          nr_articulo: null,
        }),
    });
    await reachCountScreen(view);
    await dictate(view);
    await view.findByTestId('anomaly-sheet');
    return view;
  }

  it('opens the anomaly sheet and disables the mic while it is open', async () => {
    const view = await reachAnomaly();

    expect(view.getByTestId('anomaly-title').textContent).toContain('Revisa la unidad');
    expect(disabled(view.getByRole('button', { name: /Mantén presionado para dictar/ }))).toBe(true);
    expect(view.getByText('Micrófono en pausa hasta resolver el registro señalado.')).toBeTruthy();
  });

  it('«Eliminar y volver a dictar» drops the item and unblocks the mic', async () => {
    const view = await reachAnomaly();

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Eliminar y volver a dictar' }));
    });

    expect(view.queryByTestId('anomaly-sheet')).toBeNull();
    expect(disabled(view.getByRole('button', { name: /Mantén presionado para dictar/ }))).toBe(false);
    expect(view.getByText('0 registros')).toBeTruthy();
  });

  it('«Es correcto · dejar nota al auditor» keeps the record with its note', async () => {
    const view = await reachAnomaly();

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Es correcto · dejar nota al auditor' }));
    });

    expect(view.getByText('1 registro')).toBeTruthy();
    expect(view.getByText('ACEITE DE OLIVA EXTRA VIRGEN 500ML')).toBeTruthy();
    // A null nr_articulo is rendered as absence, never as "null" or "0".
    expect(view.getByTestId('record-meta').textContent).toContain('Sin código');
  });
});

/* -------------------------------------------------------------------------- */
/* Persistence — tasks 3.8/3.9 (REQ-SDA-4, REQ-OCF-4/13, D5, D6, RF-20/21)    */
/* -------------------------------------------------------------------------- */

/** The `RecordList` state icon is the only place the record state is visible. */
const recordState = (view: ReturnType<typeof mount>): string[] =>
  view.getAllByRole('img').map((icon) => icon.getAttribute('aria-label') ?? '');

describe('CountSession — confirmed records are persisted optimistically (D5)', () => {
  it('shows the record immediately, then settles it once the write resolves', async () => {
    let settle = (created: CreatedRecord): void => void created;
    const view = mount({
      persistRecord: () =>
        new Promise<CreatedRecord>((resolve) => {
          settle = resolve;
        }),
    });
    await reachCountScreen(view);
    await dictate(view);
    await confirmSheet(view);

    // Optimistic: the count is on screen before the server has heard of it.
    expect(view.getByText('LECHUGA BATAVIA')).toBeTruthy();
    expect(recordState(view)).toContain('Pendiente de subir');

    await act(async () => {
      settle({ id: 'count-record-1', verdict: 'ok', anomaly: null });
    });

    expect(recordState(view)).toContain('Registro confirmado');
    expect(recordState(view)).not.toContain('Pendiente de subir');
  });

  it('sends the plan scope, the article code and the canonical unit', async () => {
    const view = mount();
    await reachCountScreen(view);
    await dictate(view);
    await confirmSheet(view);

    expect(view.persistRecord).toHaveBeenCalledTimes(1);
    expect(view.persistRecord.mock.calls[0]![0]).toMatchObject({
      planId: DEMO_PLAN.id,
      operatorId: OPERATOR_ID,
      nrArticulo: '100221',
      quantity: 3,
      // `unidad_display` is 'kilos'; the SERVER gets the canonical code.
      unitCode: 'Kilogram',
      spokenName: 'lechuga batavia',
    });
    // The idempotency key is the client-minted record id, so a retry of this
    // very body resolves to the same row instead of counting the shelf twice.
    expect(view.persistRecord.mock.calls[0]![0].clientRecordId).toBeTruthy();
  });

  it('keeps the record and raises the banner when the write fails (never drops a count)', async () => {
    const view = mount({
      persistRecord: async () => {
        throw new UiError('proxy_unreachable');
      },
    });
    await reachCountScreen(view);
    await dictate(view);
    await confirmSheet(view);

    const banner = await view.findByTestId('count-error');
    expect(banner.textContent).toContain('No hay conexión con el servidor.');
    // The physical count the operator performed is still on screen.
    expect(view.getByText('LECHUGA BATAVIA')).toBeTruthy();
    expect(recordState(view)).toContain('Pendiente de subir');
  });

  it('writes one row per confirmed record, each with its own idempotency key', async () => {
    const view = mount();
    await reachCountScreen(view);

    for (const _take of [0, 1]) {
      await dictate(view);
      await confirmSheet(view);
    }

    expect(view.persistRecord).toHaveBeenCalledTimes(2);
    const keys = view.persistRecord.mock.calls.map((call) => call[0].clientRecordId);
    expect(new Set(keys).size).toBe(2);
  });
});

describe('CountSession — delete-and-redo is soft-delete plus a NEW row (RF-20/21, D6)', () => {
  it('soft-deletes the persisted row and never updates it', async () => {
    const view = mount();
    await reachCountScreen(view);
    await dictate(view);
    await confirmSheet(view);

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /Eliminar registro · LECHUGA BATAVIA/ }));
    });

    expect(view.removeRecord).toHaveBeenCalledTimes(1);
    // Addressed by the SERVER id: `count_records.id`, not the client key.
    expect(view.removeRecord.mock.calls[0]![0]).toBe('server-1');
    expect(view.removeRecord.mock.calls[0]![1]).toMatchObject({ operatorId: OPERATOR_ID });
    expect(view.getByText('0 registros')).toBeTruthy();
  });

  it('re-dictating after a delete creates a SECOND row, never a correction of the first', async () => {
    const view = mount();
    await reachCountScreen(view);
    await dictate(view);
    await confirmSheet(view);
    const firstKey = view.persistRecord.mock.calls[0]![0].clientRecordId;

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /Eliminar registro · LECHUGA BATAVIA/ }));
    });
    await dictate(view);
    await confirmSheet(view);

    expect(view.persistRecord).toHaveBeenCalledTimes(2);
    const secondKey = view.persistRecord.mock.calls[1]![0].clientRecordId;
    // A NEW key means a NEW row. Reusing the first one would resolve to the
    // soft-deleted record instead of creating the redictation.
    expect(secondKey).not.toBe(firstKey);
    // And the delete happened exactly once: nothing "moved" the old value.
    expect(view.removeRecord).toHaveBeenCalledTimes(1);
  });

  it('does not call the server for a record that was never persisted', async () => {
    let settle = (created: CreatedRecord): void => void created;
    const view = mount({
      persistRecord: () =>
        new Promise<CreatedRecord>((resolve) => {
          settle = resolve;
        }),
    });
    await reachCountScreen(view);
    await dictate(view);
    await confirmSheet(view);

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /Eliminar registro · LECHUGA BATAVIA/ }));
    });

    // There is no `count_records.id` to soft-delete yet; deleting nothing is the
    // only honest option, and the pending write is abandoned rather than undone.
    expect(view.removeRecord).not.toHaveBeenCalled();
    await act(async () => {
      settle({ id: 'server-late', verdict: 'ok', anomaly: null });
    });
  });
});

/* -------------------------------------------------------------------------- */
/* Manual search (REQ-OCF-6, D8)                                              */
/* -------------------------------------------------------------------------- */

describe('CountSession — manual search re-queries the live matcher', () => {
  it('opens the search sheet on no_match, re-queries as the operator types, and confirms the pick', async () => {
    const calls: MatchRequest[] = [];
    const view = mount({
      transcript: SCRIPT_3,
      match: async (req: MatchRequest) => {
        calls.push(req);
        // The dictated name finds nothing; the corrected query does.
        return req.spoken_name.includes('acrilica')
          ? noMatch([
              candidate({
                articulo: 'TABLA ACRILICA PICAR BLANCO 50X38CM FB',
                nr_articulo: '300112',
                unidad: 'Unidad',
                unidad_display: 'unidades',
              }),
            ])
          : noMatch();
      },
    });

    await reachCountScreen(view);
    await dictate(view);

    const sheet = await view.findByTestId('search-sheet');
    expect(within(sheet).getByTestId('search-prompt').textContent).toContain('No encontré');

    // 'tablas' resolves to NO unit (REQ-EXT-4), so the request must OMIT it
    // rather than narrow the matcher's search with a guess.
    expect(calls[0]).not.toHaveProperty('unit');

    const input = within(sheet).getByLabelText('Buscar el artículo en esta bodega');
    await act(async () => {
      fireEvent.input(input, { target: { value: 'tabla acrilica picar blanco' } });
    });

    const option = await view.findByText('TABLA ACRILICA PICAR BLANCO 50X38CM FB');
    await act(async () => {
      fireEvent.click(option);
    });

    const confirm = await view.findByTestId('confirm-sheet');
    await act(async () => {
      fireEvent.click(within(confirm).getByRole('button', { name: 'Confirmar' }));
    });

    expect(view.getByText('1 registro')).toBeTruthy();
    expect(calls.length).toBeGreaterThan(1);
  });

  it('«Ninguno · volver a dictar» drops the item without creating a record', async () => {
    const view = mount({ transcript: SCRIPT_3, match: async () => noMatch() });
    await reachCountScreen(view);
    await dictate(view);

    const sheet = await view.findByTestId('search-sheet');
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Ninguno · volver a dictar' }));
    });

    expect(view.queryByTestId('search-sheet')).toBeNull();
    expect(view.getByText('0 registros')).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* Failure surfaces — never a blank screen                                    */
/* -------------------------------------------------------------------------- */

describe('CountSession — every UiError reaches the operator in Spanish', () => {
  it.each([
    ['vendor_timeout', 'El servicio de voz tardó demasiado. Intenta otra vez.'],
    ['vendor_error', 'El servicio de voz falló. Intenta otra vez.'],
    ['proxy_unreachable', 'No hay conexión con el servidor. Intenta otra vez.'],
    ['garbage', 'No se entendió lo que dictaste. Acércate al micrófono y vuelve a dictar.'],
  ] as const)('renders the authored copy for %s', async (code, copy) => {
    const view = mount({
      transcribe: async (): Promise<TranscribeResponse> => {
        throw new UiError(code, 'req-err');
      },
    });
    await reachCountScreen(view);
    await dictate(view);

    const banner = await view.findByTestId('count-error');
    expect(banner.textContent).toContain(copy);
    // The English code must never surface.
    expect(banner.textContent).not.toContain(code);
    // And the count screen is still there — no blank screen, no dead end.
    expect(view.getByRole('button', { name: 'Terminar conteo' })).toBeTruthy();
  });

  it('refuses an oversized capture locally and never uploads it (D10)', async () => {
    const view = mount({
      audio: { blob: blobOfSize(1_048_577), mimeType: 'audio/webm', durationMs: 21_000 },
    });
    await reachCountScreen(view);
    await dictate(view);

    const banner = await view.findByTestId('count-error');
    expect(banner.textContent).toContain('La grabación quedó muy larga.');
    expect(view.transcribe).not.toHaveBeenCalled();
  });

  it('lets the operator dismiss the banner and dictate again', async () => {
    const view = mount({
      transcribe: async (): Promise<TranscribeResponse> => {
        throw new UiError('vendor_timeout');
      },
    });
    await reachCountScreen(view);
    await dictate(view);
    await view.findByTestId('count-error');

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Entendido' }));
    });

    expect(view.queryByTestId('count-error')).toBeNull();
    expect(disabled(view.getByRole('button', { name: /Mantén presionado para dictar/ }))).toBe(false);
  });

  it('a microphone denial keeps the operator on consent with the manual fallback', async () => {
    const view = mount({ requestMic: async () => ({ ok: false, reason: 'denied' }) });

    fireEvent.click(view.getByLabelText(/He leído y autorizo/));
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Permitir el micrófono' }));
    });

    expect(view.getByText(/Sin autorización el conteo se hace escribiendo/)).toBeTruthy();
    expect(view.queryByRole('button', { name: /Mantén presionado para dictar/ })).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */
/* Product invariants                                                         */
/* -------------------------------------------------------------------------- */

describe('CountSession — product invariants survive the wiring', () => {
  it('REQ-OCF-2: no system stock value exists anywhere in /conteo', async () => {
    const view = mount();
    await reachCountScreen(view);
    await dictate(view);
    const sheet = await view.findByTestId('confirm-sheet');
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Confirmar' }));
    });

    // The blind-counting footer legitimately names the system; nothing else may.
    const text = (view.container.textContent ?? '').replace(
      'Conteo ciego: nunca verás el stock del sistema.',
      '',
    );
    expect(text).not.toMatch(/teórico|saldo|existencias|diferencia|Sistema/i);
  });

  it('REQ-OCF-4: voice only ever creates — deletion is a touch control', async () => {
    const view = mount();
    await reachCountScreen(view);
    await dictate(view);
    const sheet = await view.findByTestId('confirm-sheet');
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Confirmar' }));
    });

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: /Eliminar registro · LECHUGA BATAVIA/ }));
    });
    expect(view.getByText('0 registros')).toBeTruthy();
  });

  it('REQ-VC-8: a take already in flight is never cut short by an anomaly', async () => {
    const view = mount();
    await reachCountScreen(view);

    const mic = view.getByRole('button', { name: /Mantén presionado para dictar/ });
    fireEvent.pointerDown(mic);
    expect(view.start).toHaveBeenCalledTimes(1);
    // Nothing on the recorder handle can cancel it: only the release stops it.
    expect(view.stop).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.pointerUp(mic);
    });
    expect(view.stop).toHaveBeenCalledTimes(1);
  });

  it('REQ-OCF-7: only unidad_display is rendered, never the English unidad', async () => {
    const view = mount();
    await reachCountScreen(view);
    await dictate(view);
    const sheet = await view.findByTestId('confirm-sheet');

    expect(within(sheet).getByTestId('confirm-unit').textContent).toBe('kilos');
    expect(view.container.textContent).not.toContain('Kilogram');
  });

  it('opens exactly ONE recorder per take, from the granted stream', async () => {
    const view = mount();
    await reachCountScreen(view);
    await dictate(view);

    expect(view.openRecorder).toHaveBeenCalledTimes(1);
    expect(view.openRecorder.mock.calls[0]?.[0]).toBeTruthy();
  });
});

/* -------------------------------------------------------------------------- */
/* S9 — the done screen (design contract §2 S9)                               */
/* -------------------------------------------------------------------------- */

describe('DoneScreen — S9 verbatim copy over real session state', () => {
  async function reachDone() {
    const view = mount();
    await reachCountScreen(view);
    await dictate(view);
    const sheet = await view.findByTestId('confirm-sheet');
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Confirmar' }));
    });
    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Terminar conteo' }));
    });
    return view;
  }

  it('names the bodega actually counted and states it is sent', async () => {
    const view = await reachDone();

    expect(view.getByRole('heading', { name: FIRST.label })).toBeTruthy();
    expect(view.getByText('contada y enviada')).toBeTruthy();
    expect(
      view.getByText('El auditor ya puede revisarla. No hay nada que transcribir después.'),
    ).toBeTruthy();
  });

  it('shows the four summary rows, derived from the session, not hardcoded', async () => {
    const view = await reachDone();
    const summary = view.getByTestId('done-summary');

    expect(within(summary).getByText('Artículos contados')).toBeTruthy();
    expect(within(summary).getByText('Registros por voz')).toBeTruthy();
    expect(within(summary).getByText('Alertas resueltas')).toBeTruthy();
    expect(within(summary).getByText('Tiempo total')).toBeTruthy();

    // One confirmed record over the seeded 45/107 progress.
    expect(within(summary).getByTestId('done-counted').textContent).toBe('46 / 107');
    expect(within(summary).getByTestId('done-records').textContent).toBe('1');
    expect(within(summary).getByTestId('done-alerts').textContent).toBe('0');
  });

  it('«Volver a mis conteos» returns to the plans screen', async () => {
    const view = await reachDone();

    await act(async () => {
      fireEvent.click(view.getByRole('button', { name: 'Volver a mis conteos' }));
    });

    // The plan list is fetched again on the way back, so the card arrives async.
    expect(await view.findByRole('button', { name: `Iniciar conteo · ${FIRST.label}` })).toBeTruthy();
  });

  it('C2 — the done screen never claims offline capability', async () => {
    const view = await reachDone();
    expect(view.container.textContent).not.toMatch(/sin señal|offline|se sincroniza/i);
  });
});

/* -------------------------------------------------------------------------- */
/* The /conteo route                                                          */
/* -------------------------------------------------------------------------- */

describe('/conteo — the route that closes the root redirect', () => {
  const page = readFileSync(resolve(process.cwd(), 'src/pages/conteo/index.astro'), 'utf8');

  it('renders inside OperatorLayout', () => {
    expect(page).toMatch(/import\s+OperatorLayout\s+from\s+['"]\.\.\/\.\.\/layouts\/OperatorLayout\.astro['"]/);
    expect(page).toMatch(/<OperatorLayout/);
  });

  it('mounts CountSession as a client:load island (D3)', () => {
    expect(page).toMatch(/<CountSession\s+client:load\s*\/>/);
  });

  it('is prerendered: the island owns all the interactivity (D2)', () => {
    expect(page).toMatch(/export\s+const\s+prerender\s*=\s*true\s*;/);
  });

  it('loads the operator stylesheet the components need', () => {
    expect(page).toMatch(/styles\/operator\.css/);
  });
});
