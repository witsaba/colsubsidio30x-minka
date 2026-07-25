/**
 * T15 — layout shells, breakpoints and root route (design §4, §5, D12).
 *
 * `.astro` files are compiled by Astro, not by Vite's Preact preset, so the
 * suite asserts against their source text. That is the right granularity here:
 * the failure modes this task must prevent are structural — a missing landmark,
 * a missing breakpoint, a missing font link, a forbidden compliance string —
 * not a computed style.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (relative: string): string =>
  readFileSync(resolve(process.cwd(), 'src', relative), 'utf8');

const operator = read('layouts/OperatorLayout.astro');
const auditor = read('layouts/AuditorLayout.astro');
const index = read('pages/index.astro');

const GOOGLE_FONTS_URL =
  'https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500&family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,300,0,0&display=swap';

describe.each([
  ['OperatorLayout', operator],
  ['AuditorLayout', auditor],
])('%s — shared shell contract', (_name, source) => {
  it('declares Colombian Spanish as the document language', () => {
    expect(source).toMatch(/<html[^>]*lang="es-CO"/);
  });

  it('sets charset and a viewport meta', () => {
    expect(source).toMatch(/<meta charset="utf-8"/);
    expect(source).toMatch(/<meta name="viewport"/);
  });

  it('loads the token layer through global.css', () => {
    expect(source).toMatch(/import\s+['"]\.\.\/styles\/global\.css['"]\s*;/);
  });

  it('loads the three font families with a single Google Fonts link (D12)', () => {
    expect(source).toContain(GOOGLE_FONTS_URL);
    expect(source).toMatch(/rel="preconnect"[^>]*fonts\.googleapis\.com/);
    expect(source).toMatch(/rel="preconnect"[^>]*fonts\.gstatic\.com/);
    // Exactly one stylesheet call for all three families.
    expect(source.match(/fonts\.googleapis\.com\/css2/g)).toHaveLength(1);
  });

  it('documents the CDN tradeoff in a comment', () => {
    expect(source).toMatch(/CDN/);
  });

  it('renders a main landmark and a skip link — the design has zero aria', () => {
    expect(source).toMatch(/<main[^>]*id="contenido"/);
    expect(source).toMatch(/class="skip-link"[^>]*href="#contenido"|href="#contenido"[^>]*class="skip-link"/);
  });

  it('takes a page title', () => {
    expect(source).toMatch(/<title>/);
  });
});

describe('OperatorLayout — phone-first, designed at 390x844', () => {
  it('is a fluid single column capped at the operator max width', () => {
    expect(operator).toMatch(/max-width:\s*var\(--operator-max-width\)/);
    expect(operator).toMatch(/margin-inline:\s*auto/);
  });

  it('uses the operator app background and fills the dynamic viewport', () => {
    expect(operator).toMatch(/background:\s*var\(--app-bg\)/);
    expect(operator).toMatch(/min-height:\s*100dvh/);
  });

  it('needs no media query — it simply centers on larger screens', () => {
    expect(operator).not.toMatch(/@media\s*\((?:min|max)-width/);
  });
});

describe('AuditorLayout — designed at 1194x834, must scale up to desktop', () => {
  it('lays out the rigid four-track grid at 1024px and above', () => {
    expect(auditor).toMatch(/@media\s*\(min-width:\s*1024px\)/);
    expect(auditor).toMatch(
      /grid-template-columns:\s*var\(--auditor-rail\)\s+var\(--auditor-warehouses\)\s+1fr\s+var\(--auditor-detail\)/,
    );
    expect(auditor).toMatch(/height:\s*100dvh/);
  });

  it('shows the static notice instead of a broken layout below 1024px', () => {
    expect(auditor).toContain('Usa una tablet o un computador para la revisión');
    expect(auditor).toMatch(/@media\s*\(max-width:\s*1023\.98px\)/);
  });

  it('exposes rail, warehouses, records and detail slots', () => {
    for (const slot of ['rail', 'bodegas', 'registros', 'detalle']) {
      expect(auditor).toContain(`name="${slot}"`);
    }
  });

  it('uses the auditor content background', () => {
    expect(auditor).toMatch(/background:\s*var\(--app-bg-auditor\)/);
  });
});

describe('/ — root route', () => {
  it('redirects to /conteo with a 302 and is not prerendered', () => {
    expect(index).toMatch(/export\s+const\s+prerender\s*=\s*false\s*;/);
    expect(index).toMatch(/Astro\.redirect\(\s*'\/conteo'\s*,\s*302\s*\)/);
  });
});

describe('compliance', () => {
  const all = [operator, auditor, index];

  it('C2 — "Funciona sin señal" appears nowhere (RNF-08 was removed)', () => {
    for (const source of all) {
      expect(source).not.toContain('Funciona sin señal');
    }
  });

  it('C2 — no layout copy implies offline or background sync', () => {
    for (const source of all) {
      expect(source).not.toMatch(/sin conexión|sin señal|offline|se sincroniza/i);
    }
  });

  it('C1 — no shared layout copy claims audio retention', () => {
    for (const source of all) {
      expect(source).not.toContain('12 meses');
      expect(source).not.toMatch(/el audio se guarda/i);
    }
  });
});
