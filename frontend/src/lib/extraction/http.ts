/**
 * `HttpExtractionAdapter` — the production extraction adapter (REQ-EXT-6).
 *
 * Calls the `product_identification` service through the same-origin proxy
 * (`/api/extract` -> `:8003/api/v1/extract`) and maps its consensus result onto
 * the frozen `ExtractedItem` shape. It reuses `request()` from `lib/api/client`
 * so the error taxonomy and the abort-signal composition are the SAME ones
 * every other call already goes through — a second, subtly different fetch path
 * is how error handling drifts.
 *
 * The mapping is deliberately TOLERANT on a 2xx body and STRICT on transport:
 *
 *   - a 2xx never throws. The service canonicalises `producto`/`unidad` through
 *     an LLM consensus, so its shape can drift; drift degrades to fewer items,
 *     never to an error thrown at the operator mid-count. `[]` on envelope
 *     drift is indistinguishable from an honest empty consensus, and both
 *     surface as the normal `nothing_extracted` («repite») path.
 *   - transport failures (non-2xx, timeout, abort, dead proxy) DO throw, and
 *     that is the whole point: the throw is what arms `withFallback` to replay
 *     the utterance through the deterministic mock (REQ-EXT-7).
 *
 * `consensus_status` and `confidence_score` are read by nobody in the MVP. They
 * are typed here so the next consumer does not have to rediscover the wire.
 */
import { request } from '../api/client';
import { resolveSpokenUnit } from '../units';
import type { ExtractedItem, ExtractionAdapter } from './adapter';

const EXTRACT_URL = '/api/extract';

/**
 * Client-side abort budget, equal to the proxy's (`_upstream.ts`).
 *
 * The equal-budget race is benign and intentional: whichever side aborts first,
 * the client sees a `UiError` — `aborted` from its own signal, `vendor_error`
 * from the proxy's 502 — and both arm the mock fallback identically.
 */
export const EXTRACT_TIMEOUT_MS = 60_000;

/** The extractor's response envelope. Only `validated_inventory` is consumed. */
export interface ExtractionResponse {
  validated_inventory?: unknown;
  consensus_status?: string;
  confidence_score?: number;
}

/**
 * Map one wire item, or `null` when it cannot be trusted.
 *
 * A dropped item is never repaired or guessed at: a `cantidad` of 0 or a blank
 * `producto` means the consensus failed for that line, and inventing a value
 * would put a number the operator never said into the count.
 */
function toExtractedItem(raw: unknown): ExtractedItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const { producto, unidad, cantidad } = raw as Record<string, unknown>;

  if (typeof producto !== 'string') return null;
  const spokenName = producto.trim();
  if (spokenName === '') return null;

  if (typeof cantidad !== 'number' || !Number.isFinite(cantidad) || cantidad <= 0) return null;

  // Decimals are kept verbatim. Rounding "kilo y medio" to 2 would silently
  // change the counted amount, which is worse than an unusual-looking quantity.
  return {
    quantity: cantidad,
    // `resolveSpokenUnit` already lowercases and strips accents, and returns
    // null for anything outside the emission vocabulary — so an unexpected enum
    // value costs the unit, not the item (REQ-EXT-4).
    unit: typeof unidad === 'string' ? resolveSpokenUnit(unidad) : null,
    spokenName,
  };
}

export class HttpExtractionAdapter implements ExtractionAdapter {
  async extract(rawTranscript: string): Promise<ExtractedItem[]> {
    const response = await request<ExtractionResponse>(
      EXTRACT_URL,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // Verbatim: the service does its own normalisation, and pre-trimming
        // here would hide what STT actually produced.
        body: JSON.stringify({ transcription: rawTranscript }),
      },
      EXTRACT_TIMEOUT_MS,
    );

    const inventory = (response as ExtractionResponse | null)?.validated_inventory;
    if (!Array.isArray(inventory)) return [];

    return inventory
      .map(toExtractedItem)
      .filter((item): item is ExtractedItem => item !== null);
  }
}

/** The single shared instance the app composes into `PipelineDeps`. */
export const httpExtractionAdapter: ExtractionAdapter = new HttpExtractionAdapter();
