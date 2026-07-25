/**
 * Wire contracts for the two upstream services (design §8).
 *
 * FROZEN by T3 — seven parallel tasks build against this file. Do not edit it;
 * request a change from the T3 owner instead.
 *
 * Nullability here is load-bearing and mirrors the services exactly. A field
 * typed `T | null` MUST survive as `null` all the way to the render tree; it is
 * never coerced to `0`, `''` or `"failed"` (REQ-OCF-7, QA-05, QA-10).
 */
import type { CapturedAudio } from '../audio/types';

/* -------------------------------------------------------------------------- */
/* STT — mirrors services/stt/src/transcribe.py:327-337                       */
/* -------------------------------------------------------------------------- */

export interface TranscribeResponse {
  /** Verbatim transcript. The extraction adapter's only input. */
  raw_transcript: string;
  /** True when the vendor returned unusable audio; the pipeline aborts. */
  is_garbage: boolean;
  /** Null when the vendor reported no confidence. NEVER render as 0. */
  stt_confidence: number | null;
  /** Null when the vendor reported no duration. Elapsed time in the UI always
   *  comes from the local recording timer, never from this field. */
  audio_duration_ms: number | null;
  stt_vendor: string;
  request_id: string;
}

/** The error envelope both services emit (and the proxy reproduces). */
export interface ServiceError {
  error: {
    code: string;
    message: string;
    request_id?: string;
  };
}

/* -------------------------------------------------------------------------- */
/* Matcher — mirrors services/matcher/src/matcher/schemas.py                  */
/* -------------------------------------------------------------------------- */

export interface MatchRequest {
  spoken_name: string;
  catalogue_id: string;
  /** Omitted when extraction resolved no unit. The matcher treats an
   *  unresolved unit as `None`, never as an error (REQ-EXT-4). */
  unit?: string;
}

export interface Candidate {
  /** Null when the catalogue row carries no SKU: render the SKU line without
   *  a code, never a placeholder (REQ-OCF-7). */
  nr_articulo: string | null;
  articulo: string;
  /** Canonical English unit ('Kilogram', 'Liter', ...). NEVER rendered. */
  unidad: string | null;
  /** The only unit string allowed in the UI ('kg', 'litros', ...). Null means
   *  the unit is absent from the render, not blank or defaulted. */
  unidad_display: string | null;
  score: number;
}

export interface MatchResponse {
  status: 'matched' | 'ambiguous' | 'no_match';
  candidates: Candidate[];
  top_score: number;
  margin: number;
  request_id: string;
}

export interface CatalogueInfo {
  catalogue_id: string;
  rows: number;
}

/* -------------------------------------------------------------------------- */
/* Client error taxonomy                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every failure the UI can distinguish. The mapping from transport to code is
 * T9's client (413 -> payload_too_large, 400 -> invalid_audio, 502 ->
 * vendor_timeout/vendor_error, 422 -> validation, match 404 ->
 * unknown_catalogue, thrown fetch -> proxy_unreachable, AbortError ->
 * aborted); `garbage` and `nothing_extracted` are raised by the pipeline.
 */
export type UiErrorCode =
  | 'payload_too_large'
  | 'invalid_audio'
  | 'vendor_timeout'
  | 'vendor_error'
  | 'validation'
  | 'unknown_catalogue'
  | 'proxy_unreachable'
  | 'aborted'
  | 'garbage'
  | 'nothing_extracted';

/**
 * The single error type crossing the client/pipeline boundary.
 *
 * `message` is deliberately the code itself: user-facing Spanish copy is
 * authored in the components, so no English string can leak into the UI.
 */
export class UiError extends Error {
  constructor(
    readonly code: UiErrorCode,
    readonly requestId?: string,
  ) {
    super(code);
    this.name = 'UiError';
  }
}

/* -------------------------------------------------------------------------- */
/* Client function shapes                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Structural types for the client functions T9 implements.
 *
 * Design §7 wrote `PipelineDeps` in terms of `typeof transcribe`. These named
 * shapes say the same thing without forcing this frozen file to import T9's
 * not-yet-written `client.ts`, which keeps every consumer compiling from T3
 * onward. T9's implementations must remain assignable to them.
 */
export type TranscribeFn = (
  audio: CapturedAudio,
  opts?: { signal?: AbortSignal },
) => Promise<TranscribeResponse>;

export type MatchFn = (
  req: MatchRequest,
  opts?: { signal?: AbortSignal },
) => Promise<MatchResponse>;

export type GetCataloguesFn = () => Promise<CatalogueInfo[]>;
