/**
 * T20 ADDITION A RED — `src/styles/operator.css`, the operator component
 * stylesheet (design contract §1, §2).
 *
 * T14 froze `tokens.css` (values) and `global.css` (reset, type roles, a11y
 * floor). Neither implements a single component class, and T16/T17 shipped
 * screens that emit class names nothing styles — the demo would render as an
 * unstyled document. This file is the missing layer.
 *
 * The headline test is DRIFT-PROOF by construction: instead of listing the
 * classes by hand, it scans the operator components for the class names they
 * actually emit and asserts each one is implemented in `operator.css` or in the
 * frozen `global.css`. A component author adding `class="plan-card__badge"`
 * fails this suite until the stylesheet grows a rule, which is exactly the
 * silent drift the T16/T17 handover warned about.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const stylesDir = resolve(process.cwd(), 'src/styles');
const componentsDir = resolve(process.cwd(), 'src/components/operator');

const operatorCss = readFileSync(resolve(stylesDir, 'operator.css'), 'utf8');
const globalCss = readFileSync(resolve(stylesDir, 'global.css'), 'utf8');

const componentSources = readdirSync(componentsDir)
  .filter((file) => file.endsWith('.tsx'))
  .map((file) => ({ file, source: readFileSync(resolve(componentsDir, file), 'utf8') }));

/**
 * Every static class token emitted by the operator components.
 *
 * Both authoring forms are scanned: `class="a b"` and the template form
 * ``class={`a a--${x}`}``. Interpolated fragments cannot be resolved from the
 * source text, so tokens containing `${` are dropped here and their concrete
 * variants are asserted explicitly below.
 */
function emittedClasses(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  const pattern = /class=(?:"([^"]*)"|\{`([^`]*)`\})/g;

  for (const { file, source } of componentSources) {
    for (const match of source.matchAll(pattern)) {
      const literal = match[1] ?? match[2] ?? '';
      for (const token of literal.split(/\s+/)) {
        if (token === '' || token.includes('${')) continue;
        const owners = found.get(token) ?? [];
        if (!owners.includes(file)) owners.push(file);
        found.set(token, owners);
      }
    }
  }
  return found;
}

/** A class is implemented when some selector in either sheet mentions it. */
const isStyled = (token: string): boolean => {
  const selector = new RegExp(`\\.${token.replace(/[-]/g, '\\-')}(?![\\w-])`);
  return selector.test(operatorCss) || selector.test(globalCss);
};

describe('operator.css — implements what the components actually emit', () => {
  it('finds class names to check at all (guards the scanner itself)', () => {
    const emitted = emittedClasses();
    expect(emitted.size).toBeGreaterThan(20);
    expect(emitted.has('mic-dock__button')).toBe(true);
  });

  it('styles every static class the operator components emit', () => {
    const missing = [...emittedClasses().entries()]
      .filter(([token]) => !isStyled(token))
      .map(([token, files]) => `${token} (${files.join(', ')})`);

    expect(missing).toEqual([]);
  });

  it.each([
    // `class={`record record--${record.state}`}` — the four RecordState values.
    'record--ok',
    'record--anom_open',
    'record--anom_noted',
    'record--sync',
  ])('styles the interpolated modifier %s', (token) => {
    expect(isStyled(token)).toBe(true);
  });

  it('styles the Material Symbols ligature class the screens use', () => {
    // The screens emit `msr`, the sheets emit `icon`. Both must resolve to the
    // icon font or every icon renders as the literal word "mic".
    expect(operatorCss).toMatch(/\.msr[^{]*\{[^}]*font-family:\s*var\(--font-icon\)/s);
  });
});

describe('operator.css — the design contract §1/§2 shapes', () => {
  it('paints the blue plan header and the yellow progress fill', () => {
    expect(operatorCss).toMatch(/\.count__header[^{]*\{[^}]*background:\s*var\(--brand-blue\)/s);
    expect(operatorCss).toMatch(/\.count__progress-fill[^{]*\{[^}]*background:\s*var\(--accent\)/s);
  });

  it('sizes the mic button at 88x88 and gives the dock its gradient fade', () => {
    expect(operatorCss).toMatch(/\.mic-dock__button[^{]*\{[^}]*width:\s*88px/s);
    expect(operatorCss).toMatch(/\.mic-dock__button[^{]*\{[^}]*height:\s*88px/s);
    expect(operatorCss).toMatch(/\.mic-dock[^{]*\{[^}]*linear-gradient/s);
  });

  it('animates the pulse ring and the 13-bar waveform with the design keyframes', () => {
    expect(operatorCss).toMatch(/\.mic-dock__pulse[^{]*\{[^}]*animation:[^;]*vpulse/s);
    expect(operatorCss).toMatch(/\.mic-dock__bar[^{]*\{[^}]*animation:[^;]*vbar/s);
  });

  it('renders quantities with tabular figures in the record row', () => {
    expect(operatorCss).toMatch(/\.record__qty[^{]*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
  });

  it('paints the done screen full-bleed blue with the yellow CTA', () => {
    expect(operatorCss).toMatch(/\.done[^{]*\{[^}]*background:\s*var\(--brand-blue\)/s);
    expect(operatorCss).toMatch(/\.done__cta[^{]*\{[^}]*background:\s*var\(--accent\)/s);
  });
});

describe('operator.css — token discipline and motion', () => {
  it('contains NO raw hex colour: every value resolves through tokens.css', () => {
    expect(operatorCss.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
  });

  it('names no raw rgb()/hsl() colour either', () => {
    expect(operatorCss).not.toMatch(/\b(?:rgb|hsl)a?\(/);
  });

  it('honours prefers-reduced-motion for its own animations', () => {
    expect(operatorCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    const block = operatorCss.slice(operatorCss.indexOf('prefers-reduced-motion'));
    expect(block).toMatch(/animation[^:]*:\s*none/);
  });

  it('C1/C2 — no compliance copy is smuggled into the style layer', () => {
    expect(operatorCss).not.toContain('12 meses');
    expect(operatorCss).not.toMatch(/sin señal|offline|se sincroniza/i);
  });
});
