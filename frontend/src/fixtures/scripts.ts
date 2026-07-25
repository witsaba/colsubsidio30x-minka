/**
 * The four demo dictation scripts, verbatim from the design contract §2.
 *
 * Shared by the app and the tests on purpose: the demo IS the test data. If a
 * script's expected extraction changes here, the suite fails immediately rather
 * than the live demo failing in front of the client.
 */
import type { ExtractedItem } from '../lib/extraction/adapter';

/** Where each script is meant to land in the operator flow (design contract). */
export type ScriptOutcome = 'confirm' | 'anomaly:unidad' | 'search' | 'anomaly:cantidad';

export interface DictationScript {
  /** 1-based position in the demo walk-through. */
  step: number;
  /** Verbatim transcript, exactly as the operator dictates it. */
  transcript: string;
  /** What `MockExtractionAdapter.extract` must return for it. */
  expected: ExtractedItem[];
  /** The surface the flow must reach. */
  outcome: ScriptOutcome;
}

export const DICTATION_SCRIPTS: readonly DictationScript[] = [
  {
    step: 1,
    transcript:
      'tres kilos de lechuga batavia, doce botellas de aceite vegetal y dos cajas de tomate chonto',
    expected: [
      { quantity: 3, unit: 'kilos', spokenName: 'lechuga batavia' },
      { quantity: 12, unit: 'botellas', spokenName: 'aceite vegetal' },
      { quantity: 2, unit: 'cajas', spokenName: 'tomate chonto' },
    ],
    outcome: 'confirm',
  },
  {
    step: 2,
    transcript: 'novecientos gramos de aceite de oliva extra virgen',
    expected: [
      { quantity: 900, unit: 'gramos', spokenName: 'aceite de oliva extra virgen' },
    ],
    outcome: 'anomaly:unidad',
  },
  {
    step: 3,
    // `tablas` is a container noun, not a unit (REQ-EXT-4): it stays in
    // spokenName so the matcher can fuzzy-match "TABLA ACRILICA PICAR BLANCO".
    transcript: 'cinco tablas para picar blancas',
    expected: [{ quantity: 5, unit: null, spokenName: 'tablas para picar blancas' }],
    outcome: 'search',
  },
  {
    step: 4,
    transcript: 'trescientas cinco unidades de gaseosa personal',
    expected: [{ quantity: 305, unit: 'unidades', spokenName: 'gaseosa personal' }],
    outcome: 'anomaly:cantidad',
  },
] as const;
