/**
 * T13 — `runPipeline` fan-out and recombine (design §7, REQ-OCF-6, REQ-OCF-12,
 * REQ-EXT-1).
 *
 * Every dependency is injected, so this suite is DOM-free, network-free and
 * clock-free: `PipelineDeps` is satisfied entirely by stubs. The two real
 * collaborators (`MockExtractionAdapter`, `FixtureAnomalyEngine`) are exercised
 * in the last block to prove the demo scripts survive the whole chain.
 */
import { describe, expect, test, vi } from 'vitest';

import { UiError } from '../../src/lib/api/types';
import type { Candidate, MatchRequest, MatchResponse, TranscribeResponse } from '../../src/lib/api/types';
import type { Anomaly, AnomalyEngine } from '../../src/lib/anomaly/engine';
import type { CapturedAudio } from '../../src/lib/audio/types';
import type { ExtractedItem, ExtractionAdapter } from '../../src/lib/extraction/adapter';
import type { PipelineDeps } from '../../src/lib/pipeline';
import { runPipeline } from '../../src/lib/pipeline';
import { mockExtractionAdapter } from '../../src/lib/extraction/mock';
import { fixtureAnomalyEngine } from '../../src/lib/anomaly/fixtureEngine';

/* -------------------------------------------------------------------------- */
/* Builders                                                                   */
/* -------------------------------------------------------------------------- */

const CATALOGUE = 'STOCK_RESTAURANTE_FUENTES_AYB';

function audio(): CapturedAudio {
  return { blob: new Blob(['x'], { type: 'audio/webm' }), mimeType: 'audio/webm', durationMs: 3200 };
}

/** `audio_duration_ms` and `stt_confidence` default to NULL on purpose: chunked
 *  MediaRecorder blobs carry no duration header, and that is NORMAL. */
function transcribeResponse(over: Partial<TranscribeResponse> = {}): TranscribeResponse {
  return {
    raw_transcript: 'tres kilos de lechuga batavia',
    is_garbage: false,
    stt_confidence: null,
    audio_duration_ms: null,
    stt_vendor: 'deepgram',
    request_id: 'req-stt-1',
    ...over,
  };
}

function candidate(over: Partial<Candidate> = {}): Candidate {
  return {
    nr_articulo: '10045',
    articulo: 'LECHUGA BATAVIA',
    unidad: 'Kilogram',
    unidad_display: 'kg',
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
  return { quantity: 3, unit: 'kilos', spokenName: 'lechuga batavia', ...over };
}

const anomaly: Anomaly = {
  kind: 'unidad',
  title: 'Revisa la unidad',
  reason: 'Dictaste gramos y el artículo se cuenta en litros.',
  hint: 'Confirma si son 900 gramos o 900 mililitros.',
};

function staticExtraction(items: ExtractedItem[]): ExtractionAdapter {
  return { extract: () => items };
}

const noAnomalies: AnomalyEngine = { check: () => null };

function deps(over: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    transcribe: async () => transcribeResponse(),
    extraction: staticExtraction([extracted()]),
    match: async () => matchResponse(),
    anomalies: noAnomalies,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Transcription hop                                                          */
/* -------------------------------------------------------------------------- */

describe('runPipeline — transcription hop', () => {
  test('the verbatim STT transcript reaches the outcome and the extractor', async () => {
    const extract = vi.fn(() => [extracted()]);
    const outcome = await runPipeline(audio(), CATALOGUE, deps({
      transcribe: async () => transcribeResponse({ raw_transcript: 'tres kilos de lechuga batavia' }),
      extraction: { extract },
    }));

    expect(outcome.transcript).toBe('tres kilos de lechuga batavia');
    expect(extract).toHaveBeenCalledWith('tres kilos de lechuga batavia');
  });

  test('the captured audio is handed to transcribe untouched', async () => {
    const captured = audio();
    const transcribe = vi.fn(async (_audio: CapturedAudio) => transcribeResponse());
    await runPipeline(captured, CATALOGUE, deps({ transcribe }));

    expect(transcribe).toHaveBeenCalledTimes(1);
    expect(transcribe.mock.calls[0]![0]).toBe(captured);
  });

  test('null audio_duration_ms and null stt_confidence are normal, never an error', async () => {
    const outcome = await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        transcribe: async () =>
          transcribeResponse({ audio_duration_ms: null, stt_confidence: null }),
      }),
    );

    expect(outcome.queue).toHaveLength(1);
    expect(outcome.queue[0]!.kind).toBe('confirmable');
  });

  test('a 0 confidence is a real value and is not read as garbage', async () => {
    const outcome = await runPipeline(
      audio(),
      CATALOGUE,
      deps({ transcribe: async () => transcribeResponse({ stt_confidence: 0 }) }),
    );

    expect(outcome.queue).toHaveLength(1);
  });

  test('is_garbage on a 200 response surfaces as UiError("garbage") carrying the request id', async () => {
    const extract = vi.fn(() => [extracted()]);
    const match = vi.fn(async () => matchResponse());

    await expect(
      runPipeline(
        audio(),
        CATALOGUE,
        deps({
          transcribe: async () =>
            transcribeResponse({ is_garbage: true, raw_transcript: '', request_id: 'req-stt-9' }),
          extraction: { extract },
          match,
        }),
      ),
    ).rejects.toMatchObject({ name: 'UiError', code: 'garbage', requestId: 'req-stt-9' });

    // A garbage signal stops the chain: nothing downstream is attempted.
    expect(extract).not.toHaveBeenCalled();
    expect(match).not.toHaveBeenCalled();
  });
});

/* -------------------------------------------------------------------------- */
/* Extraction hop                                                             */
/* -------------------------------------------------------------------------- */

describe('runPipeline — extraction hop', () => {
  test('zero extracted items raise UiError("nothing_extracted") and issue no match call', async () => {
    const match = vi.fn(async () => matchResponse());

    const error = await runPipeline(
      audio(),
      CATALOGUE,
      deps({ extraction: staticExtraction([]), match }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UiError);
    expect((error as UiError).code).toBe('nothing_extracted');
    expect(match).not.toHaveBeenCalled();
  });

  test('the real MockExtractionAdapter dropping every segment still yields nothing_extracted', async () => {
    // 'tres kilos' has no article name, so the adapter silently returns [].
    const error = await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        transcribe: async () => transcribeResponse({ raw_transcript: 'tres kilos' }),
        extraction: mockExtractionAdapter,
      }),
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UiError);
    expect((error as UiError).code).toBe('nothing_extracted');
  });
});

/* -------------------------------------------------------------------------- */
/* Fan out                                                                    */
/* -------------------------------------------------------------------------- */

describe('runPipeline — fan out', () => {
  test('3 extracted items issue 3 match calls carrying the catalogue id and the unit', async () => {
    const match = vi.fn(async (_req: MatchRequest) => matchResponse());
    await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        extraction: staticExtraction([
          extracted({ quantity: 3, unit: 'kilos', spokenName: 'lechuga batavia' }),
          extracted({ quantity: 12, unit: 'botellas', spokenName: 'aceite vegetal' }),
          extracted({ quantity: 2, unit: 'cajas', spokenName: 'tomate chonto' }),
        ]),
        match,
      }),
    );

    expect(match).toHaveBeenCalledTimes(3);
    const requests = match.mock.calls.map((c) => c[0]);
    expect(requests.map((r) => r.spoken_name)).toEqual([
      'lechuga batavia',
      'aceite vegetal',
      'tomate chonto',
    ]);
    expect(requests.every((r) => r.catalogue_id === CATALOGUE)).toBe(true);
    expect(requests.map((r) => r.unit)).toEqual(['kilos', 'botellas', 'cajas']);
  });

  test('the 3 match calls are CONCURRENT, not sequential', async () => {
    const started: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const match = vi.fn(async (req: MatchRequest) => {
      started.push(req.spoken_name);
      await gate;
      return matchResponse();
    });

    const pending = runPipeline(
      audio(),
      CATALOGUE,
      deps({
        extraction: staticExtraction([
          extracted({ spokenName: 'a' }),
          extracted({ spokenName: 'b' }),
          extracted({ spokenName: 'c' }),
        ]),
        match,
      }),
    );

    // All three are in flight while none has resolved: sequential awaits would
    // have recorded only the first.
    await Promise.resolve();
    await Promise.resolve();
    expect(started).toEqual(['a', 'b', 'c']);

    release();
    await expect(pending).resolves.toMatchObject({ queue: expect.any(Array) });
  });

  test('an unresolved unit is OMITTED from the request, never sent as null', async () => {
    const match = vi.fn(async (_req: MatchRequest) => matchResponse());
    await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        extraction: staticExtraction([extracted({ unit: null, spokenName: 'tablas para picar blancas' })]),
        match,
      }),
    );

    expect('unit' in match.mock.calls[0]![0]).toBe(false);
  });

  test('N items recombine into ONE outcome for ONE confirm sheet (RF-14)', async () => {
    const outcome = await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        extraction: staticExtraction([
          extracted({ spokenName: 'lechuga batavia' }),
          extracted({ spokenName: 'aceite vegetal' }),
          extracted({ spokenName: 'tomate chonto' }),
        ]),
      }),
    );

    expect(outcome.queue).toHaveLength(3);
    expect(outcome.queue.every((e) => e.kind === 'confirmable')).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */
/* Routing                                                                    */
/* -------------------------------------------------------------------------- */

describe('runPipeline — status routing (REQ-OCF-6, D8)', () => {
  test('matched with a clean anomaly check becomes a confirmable picking candidates[0]', async () => {
    const top = candidate({ articulo: 'LECHUGA BATAVIA', score: 0.97 });
    const response = matchResponse({ candidates: [top, candidate({ articulo: 'LECHUGA CRESPA' })] });

    const outcome = await runPipeline(audio(), CATALOGUE, deps({ match: async () => response }));

    const entry = outcome.queue[0]!;
    expect(entry.kind).toBe('confirmable');
    if (entry.kind !== 'confirmable') throw new Error('unreachable');
    expect(entry.item.picked).toBe(top);
    expect(entry.item.match).toBe(response);
    expect(entry.item.extracted.spokenName).toBe('lechuga batavia');
  });

  test('the anomaly engine runs ONLY on matched items, and its verdict routes the entry', async () => {
    const check = vi.fn((): Anomaly | null => anomaly);
    const outcome = await runPipeline(
      audio(),
      CATALOGUE,
      deps({ anomalies: { check }, match: async () => matchResponse() }),
    );

    expect(check).toHaveBeenCalledTimes(1);
    const entry = outcome.queue[0]!;
    expect(entry.kind).toBe('anomaly');
    if (entry.kind !== 'anomaly') throw new Error('unreachable');
    expect(entry.anomaly).toBe(anomaly);
  });

  test('the anomaly engine is NOT consulted for ambiguous or no_match items', async () => {
    const check = vi.fn((): Anomaly | null => anomaly);
    await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        anomalies: { check },
        match: async () => matchResponse({ status: 'ambiguous', candidates: [candidate()] }),
      }),
    );

    expect(check).not.toHaveBeenCalled();
  });

  test('ambiguous routes to needs_search carrying the returned candidates (D8)', async () => {
    const three = [candidate({ articulo: 'A' }), candidate({ articulo: 'B' }), candidate({ articulo: 'C' })];
    const outcome = await runPipeline(
      audio(),
      CATALOGUE,
      deps({ match: async () => matchResponse({ status: 'ambiguous', candidates: three }) }),
    );

    const entry = outcome.queue[0]!;
    expect(entry.kind).toBe('needs_search');
    if (entry.kind !== 'needs_search') throw new Error('unreachable');
    expect(entry.candidates).toEqual(three);
    expect(entry.item.spokenName).toBe('lechuga batavia');
    expect(outcome.queue.some((e) => e.kind === 'confirmable')).toBe(false);
  });

  test('no_match routes to needs_search with an empty candidate list', async () => {
    const outcome = await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        match: async () => matchResponse({ status: 'no_match', candidates: [], top_score: 0, margin: 0 }),
      }),
    );

    const entry = outcome.queue[0]!;
    expect(entry.kind).toBe('needs_search');
    if (entry.kind !== 'needs_search') throw new Error('unreachable');
    expect(entry.candidates).toEqual([]);
  });

  test('a matched status with no candidates degrades to needs_search instead of crashing', async () => {
    const outcome = await runPipeline(
      audio(),
      CATALOGUE,
      deps({ match: async () => matchResponse({ status: 'matched', candidates: [] }) }),
    );

    expect(outcome.queue[0]!.kind).toBe('needs_search');
  });
});

/* -------------------------------------------------------------------------- */
/* Recombine ordering                                                         */
/* -------------------------------------------------------------------------- */

describe('runPipeline — queue ordering', () => {
  test('the queue is ordered anomalies -> searches -> confirmables (design §7)', async () => {
    const items = [
      extracted({ spokenName: 'confirmable one' }),
      extracted({ spokenName: 'needs search' }),
      extracted({ spokenName: 'anomalous' }),
      extracted({ spokenName: 'confirmable two' }),
    ];
    const byName: Record<string, MatchResponse> = {
      'confirmable one': matchResponse(),
      'needs search': matchResponse({ status: 'no_match', candidates: [] }),
      anomalous: matchResponse(),
      'confirmable two': matchResponse(),
    };

    const outcome = await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        extraction: staticExtraction(items),
        match: async (req: MatchRequest) => byName[req.spoken_name]!,
        anomalies: { check: (item) => (item.extracted.spokenName === 'anomalous' ? anomaly : null) },
      }),
    );

    expect(outcome.queue.map((e) => e.kind)).toEqual([
      'anomaly',
      'needs_search',
      'confirmable',
      'confirmable',
    ]);
  });

  test('the extraction order is preserved WITHIN each ordering bucket', async () => {
    const items = [
      extracted({ spokenName: 'c1' }),
      extracted({ spokenName: 'c2' }),
      extracted({ spokenName: 'c3' }),
    ];
    const outcome = await runPipeline(
      audio(),
      CATALOGUE,
      deps({ extraction: staticExtraction(items), match: async () => matchResponse() }),
    );

    const names = outcome.queue.flatMap((e) =>
      e.kind === 'confirmable' ? [e.item.extracted.spokenName] : [],
    );
    expect(names).toEqual(['c1', 'c2', 'c3']);
  });
});

/* -------------------------------------------------------------------------- */
/* Error propagation                                                          */
/* -------------------------------------------------------------------------- */

describe('runPipeline — UiError propagation (never swallowed)', () => {
  const codes = [
    'payload_too_large',
    'invalid_audio',
    'vendor_timeout',
    'vendor_error',
    'validation',
    'aborted',
    'proxy_unreachable',
  ] as const;

  test.each(codes)('a transcribe failure with code %s reaches the caller verbatim', async (code) => {
    const thrown = new UiError(code, 'req-stt-err');
    const error = await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        transcribe: async () => {
          throw thrown;
        },
      }),
    ).catch((e: unknown) => e);

    expect(error).toBe(thrown);
    expect((error as UiError).code).toBe(code);
    expect((error as UiError).requestId).toBe('req-stt-err');
  });

  test('a match 404 unknown_catalogue reaches the caller verbatim', async () => {
    const thrown = new UiError('unknown_catalogue', 'req-match-err');
    const error = await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        match: async () => {
          throw thrown;
        },
      }),
    ).catch((e: unknown) => e);

    expect(error).toBe(thrown);
  });

  test('one failing match in a fan-out of 3 rejects the whole pipeline with THAT error', async () => {
    const thrown = new UiError('vendor_timeout');
    const error = await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        extraction: staticExtraction([
          extracted({ spokenName: 'a' }),
          extracted({ spokenName: 'b' }),
          extracted({ spokenName: 'c' }),
        ]),
        match: async (req: MatchRequest) => {
          if (req.spoken_name === 'b') throw thrown;
          return matchResponse();
        },
      }),
    ).catch((e: unknown) => e);

    expect(error).toBe(thrown);
  });

  test('a non-UiError rejection is not rewrapped into a generic failure either', async () => {
    const thrown = new TypeError('boom');
    const error = await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        transcribe: async () => {
          throw thrown;
        },
      }),
    ).catch((e: unknown) => e);

    expect(error).toBe(thrown);
  });
});

/* -------------------------------------------------------------------------- */
/* The demo scripts, end to end through the real mocks                        */
/* -------------------------------------------------------------------------- */

describe('runPipeline — demo scripts with the real extraction and anomaly mocks', () => {
  test('script 1 (3 items) becomes ONE outcome of 3 confirmables', async () => {
    const outcome = await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        transcribe: async () =>
          transcribeResponse({
            raw_transcript:
              'tres kilos de lechuga batavia, doce botellas de aceite vegetal y dos cajas de tomate chonto',
          }),
        extraction: mockExtractionAdapter,
        anomalies: fixtureAnomalyEngine,
        match: async () => matchResponse(),
      }),
    );

    expect(outcome.queue).toHaveLength(3);
    expect(outcome.queue.every((e) => e.kind === 'confirmable')).toBe(true);
  });

  test('script 2 (900 gramos of a Liter article) surfaces a unit anomaly', async () => {
    const outcome = await runPipeline(
      audio(),
      CATALOGUE,
      deps({
        transcribe: async () =>
          transcribeResponse({ raw_transcript: 'novecientos gramos de aceite de oliva extra virgen' }),
        extraction: mockExtractionAdapter,
        anomalies: fixtureAnomalyEngine,
        match: async () =>
          matchResponse({
            candidates: [
              candidate({
                articulo: 'ACEITE DE OLIVA EXTRA VIRGEN',
                unidad: 'Liter',
                unidad_display: 'litros',
              }),
            ],
          }),
      }),
    );

    const entry = outcome.queue[0]!;
    expect(entry.kind).toBe('anomaly');
    if (entry.kind !== 'anomaly') throw new Error('unreachable');
    expect(entry.anomaly.kind).toBe('unidad');
  });
});
