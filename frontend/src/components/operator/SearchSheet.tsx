/**
 * S7 — the manual-search sheet (REQ-OCF-6, RF-15, RF-16, D8).
 *
 * D8: ONE surface serves BOTH matcher outcomes.
 *   - `no_match`  keeps the design's original copy.
 *   - `ambiguous` reuses the same sheet with adjusted copy. The designers never
 *     drew this state, and the rationale for asking rather than guessing is
 *     that a confident wrong match is worse than a question.
 *
 * Two authored departures from the design:
 *   1. The design's "search field" is a `<span>`. A real, labelled `<input
 *      type="search">` is authored here and wired to a DEBOUNCED re-query, so
 *      the operator can correct what STT heard instead of re-dictating.
 *   2. The design draws 3 result rows; the matcher returns up to
 *      `MATCH_MAX_CANDIDATES = 5`, so the list is sized to the service.
 */
import { useEffect, useRef, useState } from 'preact/hooks';

import type { Candidate } from '../../lib/api/types';
import type { ExtractedItem } from '../../lib/extraction/adapter';
import { displayUnit } from '../../lib/units';
import { Sheet } from './Sheet';

/** Mirrors the matcher's own cap; the design's 3 rows were a mock. */
export const MATCH_MAX_CANDIDATES = 5;

const DEFAULT_DEBOUNCE_MS = 250;

const COPY = {
  no_match: {
    eyebrow: 'Sin coincidencia exacta',
    prompt: (query: string) => `No encontré “${query}” en esta bodega. ¿Cuál es?`,
  },
  ambiguous: {
    eyebrow: 'Encontré varias opciones',
    prompt: (_query: string) => '¿Cuál de estos es?',
  },
} as const;

export interface SearchSheetProps {
  mode: 'no_match' | 'ambiguous';
  item: ExtractedItem;
  /** The current search string; seeds the input. */
  query: string;
  candidates: Candidate[];
  /** Debounced; the caller dispatches `SEARCH_QUERY_CHANGED` and re-queries. */
  onQueryChange: (query: string) => void;
  onPick: (candidate: Candidate) => void;
  /** "Ninguno · volver a dictar" and Escape. */
  onDismiss: () => void;
  debounceMs?: number;
}

export function SearchSheet({
  mode,
  item,
  query,
  candidates,
  onQueryChange,
  onPick,
  onDismiss,
  debounceMs = DEFAULT_DEBOUNCE_MS,
}: SearchSheetProps) {
  const copy = COPY[mode];
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [draft, setDraft] = useState(query);
  // The seed value must never be echoed back as a re-query.
  const seeded = useRef(query);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (draft === seeded.current) return;
    const timer = setTimeout(() => onQueryChange(draft), debounceMs);
    return () => clearTimeout(timer);
  }, [draft, debounceMs, onQueryChange]);

  const visible = candidates.slice(0, MATCH_MAX_CANDIDATES);

  return (
    <Sheet labelledBy="search-title" describedBy="search-prompt" testId="search-sheet" onEscape={onDismiss}>
      <p id="search-title" class="eyebrow" style={{ marginBottom: 'var(--sp-2)' }}>
        {copy.eyebrow}
      </p>
      <p
        id="search-prompt"
        data-testid="search-prompt"
        style={{ fontSize: '19px', fontWeight: 800, marginBottom: 'var(--sp-4)' }}
      >
        {copy.prompt(query)}
      </p>

      <label
        for="search-input"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          padding: '0 var(--sp-4)',
          height: 'var(--h-secondary)',
          borderRadius: 'var(--r-input)',
          border: '1px solid var(--border-3)',
          background: 'var(--surface-input)',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <span class="icon" aria-hidden="true" style={{ color: 'var(--text-faint-3)' }}>
          search
        </span>
        {/* The accessible name comes from `aria-label` alone; a visually hidden
            twin here would double-announce it. */}
        <input
          id="search-input"
          ref={inputRef}
          type="search"
          value={draft}
          aria-label="Buscar el artículo en esta bodega"
          placeholder={item.spokenName}
          onInput={(event) => setDraft((event.currentTarget as HTMLInputElement).value)}
          style={{ flex: 1, border: 0, outline: 'none', background: 'transparent', fontSize: '14px' }}
        />
      </label>

      <ul style={{ display: 'grid', gap: 'var(--sp-2)', marginBottom: 'var(--sp-4)' }}>
        {visible.map((option, index) => {
          const unit = displayUnit(option.unidad_display);
          const parts: string[] = [];
          if (option.nr_articulo !== null) parts.push(option.nr_articulo);
          if (unit !== null) parts.push(`se cuenta en ${unit}`);
          const meta = parts.length === 0 ? 'Sin código' : parts.join(' · ');

          return (
            <li key={`${option.nr_articulo ?? 'sin-codigo'}-${index}`}>
              <button
                type="button"
                data-testid="search-candidate"
                onClick={() => onPick(option)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--sp-3)',
                  width: '100%',
                  textAlign: 'left',
                  padding: 'var(--sp-3) var(--sp-4)',
                  borderRadius: 'var(--r-card)',
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                }}
              >
                <span style={{ flex: 1 }}>
                  <span style={{ display: 'block', fontSize: '14px', fontWeight: 600 }}>
                    {option.articulo}
                  </span>
                  <span
                    class="mono-meta"
                    data-testid="search-candidate-meta"
                    style={{ display: 'block' }}
                  >
                    {meta}
                  </span>
                </span>
                <span class="icon" aria-hidden="true" style={{ color: 'var(--text-faint-3)' }}>
                  chevron_right
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <button
        type="button"
        onClick={onDismiss}
        style={{
          display: 'block',
          width: '100%',
          fontSize: '13px',
          fontWeight: 600,
          color: 'var(--text-soft-2)',
          padding: 'var(--sp-3)',
        }}
      >
        Ninguno · volver a dictar
      </button>
    </Sheet>
  );
}
