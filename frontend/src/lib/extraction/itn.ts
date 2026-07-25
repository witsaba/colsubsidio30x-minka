/**
 * Spanish inverse text normalisation: spoken cardinals -> digits (REQ-EXT-2).
 *
 * Scope is deliberately small and deterministic — no network, no model. It
 * covers 0..999_999, which is far beyond any plausible inventory count, and it
 * carries the gender variants Colombian speakers actually use
 * (`doscientos`/`doscientas`, `trescientos`/`trescientas`, `una`, `veintiuna`).
 *
 * The load-bearing case is 90 vs 900: `noventa` -> 90 and `novecientos` -> 900.
 * The demo's unit anomaly depends on `novecientos gramos` becoming 900.
 */

/** Lowercase, strip accents, collapse whitespace. */
export function normalizeSpokenNumber(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** 0-29 read as a single word (accent-stripped keys). */
const SMALL: Readonly<Record<string, number>> = {
  cero: 0,
  un: 1,
  uno: 1,
  una: 1,
  dos: 2,
  tres: 3,
  cuatro: 4,
  cinco: 5,
  seis: 6,
  siete: 7,
  ocho: 8,
  nueve: 9,
  diez: 10,
  once: 11,
  doce: 12,
  trece: 13,
  catorce: 14,
  quince: 15,
  dieciseis: 16,
  diecisiete: 17,
  dieciocho: 18,
  diecinueve: 19,
  veinte: 20,
  veintiun: 21,
  veintiuno: 21,
  veintiuna: 21,
  veintidos: 22,
  veintitres: 23,
  veinticuatro: 24,
  veinticinco: 25,
  veintiseis: 26,
  veintisiete: 27,
  veintiocho: 28,
  veintinueve: 29,
};

const TENS: Readonly<Record<string, number>> = {
  treinta: 30,
  cuarenta: 40,
  cincuenta: 50,
  sesenta: 60,
  setenta: 70,
  ochenta: 80,
  // 90 lives here; 900 lives in HUNDREDS. Keeping the two tables separate is
  // what makes the noventa/novecientos confusion structurally impossible.
  noventa: 90,
};

const HUNDREDS: Readonly<Record<string, number>> = {
  cien: 100,
  ciento: 100,
  doscientos: 200,
  doscientas: 200,
  trescientos: 300,
  trescientas: 300,
  cuatrocientos: 400,
  cuatrocientas: 400,
  quinientos: 500,
  quinientas: 500,
  seiscientos: 600,
  seiscientas: 600,
  setecientos: 700,
  setecientas: 700,
  ochocientos: 800,
  ochocientas: 800,
  novecientos: 900,
  novecientas: 900,
};

/** Every word this module recognises as part of a cardinal. */
const CARDINAL_WORDS: ReadonlySet<string> = new Set([
  ...Object.keys(SMALL),
  ...Object.keys(TENS),
  ...Object.keys(HUNDREDS),
  'mil',
  'y',
]);

/**
 * True when `word` is a tens word (20-90), i.e. a word that legitimately takes
 * a joining "y" ("treinta y dos"). The adapter needs this to tell that "y"
 * apart from the conjunction that separates two dictated items.
 */
export function isTensWord(word: string): boolean {
  const key = normalizeSpokenNumber(word);
  return key === 'veinte' || TENS[key] !== undefined;
}

/** True when `word` may take part in a spoken cardinal (already normalized). */
export function isCardinalWord(word: string): boolean {
  return CARDINAL_WORDS.has(word) || /^\d+$/.test(word);
}

const SMALL_WORDS = [
  'cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho',
  'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis',
  'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós',
  'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete',
  'veintiocho', 'veintinueve',
] as const;

const TENS_WORDS = [
  '', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta',
  'ochenta', 'noventa',
] as const;

const HUNDREDS_WORDS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
] as const;

function belowThousandToCardinal(value: number): string {
  if (value < 30) return SMALL_WORDS[value]!;
  if (value < 100) {
    const tens = TENS_WORDS[Math.floor(value / 10)]!;
    const rest = value % 10;
    return rest === 0 ? tens : `${tens} y ${SMALL_WORDS[rest]!}`;
  }
  if (value === 100) return 'cien';
  const hundreds = HUNDREDS_WORDS[Math.floor(value / 100)]!;
  const rest = value % 100;
  return rest === 0 ? hundreds : `${hundreds} ${belowThousandToCardinal(rest)}`;
}

/**
 * The inverse of `cardinalToNumber`, in masculine form: 900 -> "novecientos".
 *
 * Used by the UI copy that quotes what the operator said ("Escuché
 * «novecientos» y lo escribí 900"). Returns `null` outside 0..999_999 or for a
 * non-integer, so callers never render a half-built phrase.
 */
export function numberToCardinal(value: number): string | null {
  if (!Number.isInteger(value) || value < 0 || value > 999_999) return null;
  if (value < 1000) return belowThousandToCardinal(value);

  const thousands = Math.floor(value / 1000);
  const rest = value % 1000;
  const prefix = thousands === 1 ? 'mil' : `${belowThousandToCardinal(thousands)} mil`;
  return rest === 0 ? prefix : `${prefix} ${belowThousandToCardinal(rest)}`;
}

/**
 * Convert a spoken Spanish cardinal to a number.
 *
 * Returns `null` when the input is empty or contains any word that is not part
 * of a cardinal — callers treat `null` as "this is not a quantity", never as 0.
 * A string of digits passes straight through, because STT sometimes emits
 * digits already.
 */
export function cardinalToNumber(spoken: string): number | null {
  const normalized = normalizeSpokenNumber(spoken);
  if (normalized === '') return null;
  if (/^\d+$/.test(normalized)) return Number(normalized);

  const words = normalized.split(' ').filter((w) => w !== '' && w !== 'y');
  if (words.length === 0) return null;

  let total = 0;
  let current = 0;
  let sawAnyWord = false;

  for (const word of words) {
    if (word === 'mil') {
      // "mil" alone means 1000; "dos mil" means 2000.
      total += (current === 0 ? 1 : current) * 1000;
      current = 0;
      sawAnyWord = true;
      continue;
    }

    const hundreds = HUNDREDS[word];
    if (hundreds !== undefined) {
      current += hundreds;
      sawAnyWord = true;
      continue;
    }

    const tens = TENS[word];
    if (tens !== undefined) {
      current += tens;
      sawAnyWord = true;
      continue;
    }

    const small = SMALL[word];
    if (small !== undefined) {
      current += small;
      sawAnyWord = true;
      continue;
    }

    return null;
  }

  return sawAnyWord ? total + current : null;
}
