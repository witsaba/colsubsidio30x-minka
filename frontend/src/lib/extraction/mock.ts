/**
 * `MockExtractionAdapter` — the Module 2 seam (REQ-EXT-1, REQ-EXT-3,
 * REQ-EXT-4, REQ-EXT-5).
 *
 * Module 2 (extraction / ITN / 3-model consensus) does NOT exist. This is a
 * deterministic, offline, keyword-tolerant stand-in that implements the frozen
 * `ExtractionAdapter` interface and nothing else. A real Module 2 later ships
 * as another `ExtractionAdapter` and no caller changes, because extraction is
 * injected at exactly one swap point (`PipelineDeps.extraction`).
 *
 * The algorithm, in one pass over the normalized tokens:
 *   1. split the utterance into segments at commas and at a CONJUNCTION "y"
 *      (a "y" preceded by a tens word joins a number — "treinta y dos" — and
 *      never splits);
 *   2. per segment, consume the longest leading run of cardinal words as the
 *      quantity (`cardinalToNumber`);
 *   3. consume the next word as the unit ONLY if `resolveSpokenUnit` knows it —
 *      the adapter never invents a unit word (REQ-EXT-4);
 *   4. drop a single linking "de"/"del"/"de la";
 *   5. the rest is `spokenName`, handed to the matcher verbatim.
 *
 * A segment with no leading quantity, or with no words left for a name, is
 * dropped rather than guessed at.
 */
import { cardinalToNumber, isCardinalWord, isTensWord, normalizeSpokenNumber } from './itn';
import { resolveSpokenUnit } from '../units';
import type { ExtractedItem, ExtractionAdapter } from './adapter';

/** Words that link a quantity+unit to the article name and carry no meaning. */
const LINKING_WORDS: ReadonlySet<string> = new Set(['de', 'del', 'de la', 'd']);

/** Articles that may follow the linking "de" ("de la casa"). */
const LEADING_ARTICLES: ReadonlySet<string> = new Set(['la', 'el', 'los', 'las']);

function tokenize(transcript: string): string[] {
  return normalizeSpokenNumber(transcript)
    // keep the comma as its own token: it is a segment boundary
    .replace(/[,;]+/g, ' , ')
    .replace(/[.!?¡¿"'()]/g, ' ')
    .split(' ')
    .filter((token) => token !== '');
}

/** Split tokens at commas and at conjunction "y" / "e". */
function splitSegments(tokens: string[]): string[][] {
  const segments: string[][] = [];
  let current: string[] = [];

  tokens.forEach((token, index) => {
    if (token === ',') {
      segments.push(current);
      current = [];
      return;
    }
    if (token === 'y' || token === 'e') {
      const previous = tokens[index - 1];
      // "treinta y dos": the "y" belongs to the number, not to the sentence.
      if (previous !== undefined && isTensWord(previous)) {
        current.push(token);
        return;
      }
      segments.push(current);
      current = [];
      return;
    }
    current.push(token);
  });

  segments.push(current);
  return segments.filter((segment) => segment.length > 0);
}

function extractSegment(tokens: string[]): ExtractedItem | null {
  let cursor = 0;

  // 1. longest leading run of cardinal words -> quantity
  while (cursor < tokens.length && isCardinalWord(tokens[cursor]!)) cursor += 1;
  if (cursor === 0) return null;
  const quantity = cardinalToNumber(tokens.slice(0, cursor).join(' '));
  if (quantity === null) return null;

  // 2. the next word is a unit only if the vocabulary knows it
  let unit: string | null = null;
  const unitCandidate = tokens[cursor];
  if (unitCandidate !== undefined) {
    const resolved = resolveSpokenUnit(unitCandidate);
    if (resolved !== null) {
      unit = resolved;
      cursor += 1;
    }
  }

  // 3. drop one linking "de" (+ a following article)
  const linking = tokens[cursor];
  if (linking !== undefined && LINKING_WORDS.has(linking)) {
    cursor += 1;
    const article = tokens[cursor];
    if (article !== undefined && LEADING_ARTICLES.has(article)) cursor += 1;
  }

  // 4. whatever remains is the article name, verbatim for the matcher
  const spokenName = tokens.slice(cursor).join(' ').trim();
  if (spokenName === '') return null;

  return { quantity, unit, spokenName };
}

export class MockExtractionAdapter implements ExtractionAdapter {
  extract(rawTranscript: string): ExtractedItem[] {
    return splitSegments(tokenize(rawTranscript))
      .map(extractSegment)
      .filter((item): item is ExtractedItem => item !== null);
  }
}

/** The single shared instance the app wires into `PipelineDeps`. */
export const mockExtractionAdapter: ExtractionAdapter = new MockExtractionAdapter();
