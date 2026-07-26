/**
 * T20 ADDITION B RED — `PipelineDeps.onTranscript`, the progressive-reveal
 * producer (design contract §2 S4, REQ-OCF-12).
 *
 * `PIPELINE_TRANSCRIPT` exists in the frozen event union and the reducer feeds
 * it into the processing overlay, but nothing ever produced it: `runPipeline`
 * resolved the whole chain before returning, so the S4 overlay showed «Escuché»
 * with no text at all until resolution. Against the real STT worst case
 * (`STT_TOTAL_DEADLINE_S = 45`) that is up to 45 s of blank sheet where the
 * design shows what the operator just said.
 *
 * The callback is OPTIONAL by construction: 31 existing pipeline tests and 60
 * reducer tests build `PipelineDeps` without it and must stay untouched.
 */
import { describe, expect, it, vi } from 'vitest';

import { UiError } from '../../src/lib/api/types';
import type { MatchRequest, MatchResponse, TranscribeResponse } from '../../src/lib/api/types';
import type { CapturedAudio } from '../../src/lib/audio/types';
import { runPipeline, type PipelineDeps } from '../../src/lib/pipeline';
import type { ExtractedItem, ExtractionAdapter } from '../../src/lib/extraction/adapter';
import type { AnomalyEngine } from '../../src/lib/anomaly/engine';

const CATALOGUE = 'STOCK_RESTAURANTE_FUENTES_AYB';

const audio: CapturedAudio = {
  blob: new Blob(['x'], { type: 'audio/webm' }),
  mimeType: 'audio/webm',
  durationMs: 4200,
};

function transcribeResponse(patch: Partial<TranscribeResponse> = {}): TranscribeResponse {
  return {
    raw_transcript: 'tres kilos de lechuga batavia',
    is_garbage: false,
    stt_confidence: null,
    audio_duration_ms: null,
    stt_vendor: 'test',
    request_id: 'req-1',
    ...patch,
  };
}

function matchResponse(): MatchResponse {
  return {
    status: 'matched',
    candidates: [
      {
        nr_articulo: '100221',
        articulo: 'LECHUGA BATAVIA',
        unidad: 'Kilogram',
        unidad_display: 'kilos',
        score: 0.94,
      },
    ],
    top_score: 0.94,
    margin: 0.3,
    request_id: 'req-2',
  };
}

const extraction: ExtractionAdapter = {
  extract: async (raw: string): Promise<ExtractedItem[]> => [
    { quantity: 3, unit: 'kilos', spokenName: raw },
  ],
};

const noAnomalies: AnomalyEngine = { check: async () => null };

function deps(patch: Partial<PipelineDeps> = {}): PipelineDeps {
  return {
    transcribe: vi.fn(async (_audio: CapturedAudio) => transcribeResponse()),
    extraction,
    match: vi.fn(async (_req: MatchRequest) => matchResponse()),
    anomalies: noAnomalies,
    ...patch,
  };
}

describe('runPipeline — onTranscript progressive reveal', () => {
  it('calls onTranscript with the verbatim transcript', async () => {
    const onTranscript = vi.fn<(raw: string) => void>();

    await runPipeline(audio, CATALOGUE, deps({ onTranscript }));

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith('tres kilos de lechuga batavia');
  });

  it('fires BEFORE extraction and before any match call — that is the whole point', async () => {
    const order: string[] = [];
    const onTranscript = vi.fn((_raw: string) => {
      order.push('onTranscript');
    });
    const tracingExtraction: ExtractionAdapter = {
      extract: async (raw: string) => {
        order.push('extract');
        return extraction.extract(raw);
      },
    };
    const match = vi.fn(async (_req: MatchRequest) => {
      order.push('match');
      return matchResponse();
    });

    await runPipeline(
      audio,
      CATALOGUE,
      deps({ onTranscript, extraction: tracingExtraction, match }),
    );

    expect(order).toEqual(['onTranscript', 'extract', 'match']);
  });

  it('never fires when STT itself failed', async () => {
    const onTranscript = vi.fn<(raw: string) => void>();
    const transcribe = vi.fn(async (_audio: CapturedAudio): Promise<TranscribeResponse> => {
      throw new UiError('vendor_timeout', 'req-9');
    });

    await expect(runPipeline(audio, CATALOGUE, deps({ onTranscript, transcribe }))).rejects.toBeInstanceOf(
      UiError,
    );
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('never fires for garbage audio: there is nothing honest to reveal', async () => {
    const onTranscript = vi.fn<(raw: string) => void>();
    const transcribe = vi.fn(async (_audio: CapturedAudio) =>
      transcribeResponse({ is_garbage: true, raw_transcript: 'mmmhh' }),
    );

    await expect(
      runPipeline(audio, CATALOGUE, deps({ onTranscript, transcribe })),
    ).rejects.toMatchObject({ code: 'garbage' });
    expect(onTranscript).not.toHaveBeenCalled();
  });

  it('still reveals the transcript when extraction then yields nothing', async () => {
    // The operator dictated something real; the adapter simply found no
    // quantity. They should still see what was heard before the error copy.
    const onTranscript = vi.fn<(raw: string) => void>();
    const empty: ExtractionAdapter = { extract: async () => [] };

    await expect(
      runPipeline(audio, CATALOGUE, deps({ onTranscript, extraction: empty })),
    ).rejects.toMatchObject({ code: 'nothing_extracted' });
    expect(onTranscript).toHaveBeenCalledWith('tres kilos de lechuga batavia');
  });

  it('is OPTIONAL: omitting it changes the outcome not at all', async () => {
    const withCallback = await runPipeline(audio, CATALOGUE, deps({ onTranscript: vi.fn() }));
    const without = await runPipeline(audio, CATALOGUE, deps());

    expect(without).toEqual(withCallback);
    expect(without.transcript).toBe('tres kilos de lechuga batavia');
    expect(without.queue).toHaveLength(1);
  });
});
