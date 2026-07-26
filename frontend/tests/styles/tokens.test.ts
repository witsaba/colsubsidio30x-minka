/**
 * T14 — token layer contract (design §4, design contract §1).
 *
 * The prototypes carry zero CSS variables, zero Tailwind and zero media
 * queries: every value is a literal inline style. This suite is therefore the
 * only place where the token layer is pinned to the design contract. It reads
 * the authored stylesheets as text — a structural assertion, because the
 * meaningful failure mode is "a token is missing or drifted from the palette",
 * not "the browser computed the wrong pixel".
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// Vitest's root is `frontend/`, so cwd-relative resolution is stable here and
// avoids `import.meta.url` rewriting under the Vite transform.
const read = (relative: string): string =>
  readFileSync(resolve(process.cwd(), 'src/styles', relative), 'utf8');

const tokens = read('tokens.css');
const global = read('global.css');

/**
 * Declaration lookup that tolerates whitespace but not a different value.
 * `value` is a regex source: plain hex literals contain no special characters,
 * and the few non-hex tokens (scrim, aliases) pass their own escaped pattern.
 */
const declares = (css: string, name: string, value: string): boolean =>
  new RegExp(`${name}\\s*:\\s*${value}\\s*;`).test(css);

describe('tokens.css — brand palette', () => {
  it.each([
    ['--brand-blue', '#0067b1'],
    ['--brand-blue-hover', '#00588f'],
    ['--brand-blue-link-hover', '#00507f'],
    ['--brand-blue-deep', '#00517f'],
    ['--brand-yellow', '#ffd000'],
    ['--brand-yellow-hover', '#f0c500'],
    ['--yellow-live', '#ffb800'],
  ])('declares %s as %s', (name, value) => {
    expect(declares(tokens, name, value)).toBe(true);
  });

  it('exposes the short aliases the tasks artifact names', () => {
    expect(declares(tokens, '--primary', 'var\\(--brand-blue\\)')).toBe(true);
    expect(declares(tokens, '--accent', 'var\\(--brand-yellow\\)')).toBe(true);
    expect(declares(tokens, '--page', 'var\\(--page-bg\\)')).toBe(true);
  });
});

describe('tokens.css — surfaces, text ramp and borders', () => {
  it.each([
    ['--page-bg', '#f2f2ef'],
    ['--app-bg', '#fbfbf9'],
    ['--app-bg-auditor', '#f7f7f4'],
    ['--surface', '#ffffff'],
    ['--surface-alt', '#f4f4f0'],
    ['--surface-pale-blue', '#f4f8fc'],
    ['--surface-pale-blue-2', '#f0f6fb'],
    ['--surface-pale-blue-3', '#f6fafd'],
    ['--surface-pale-blue-4', '#f7f9fb'],
    ['--surface-input', '#fafaf7'],
  ])('declares surface %s as %s', (name, value) => {
    expect(declares(tokens, name, value)).toBe(true);
  });

  it.each([
    ['--text', '#2f2f2e'],
    ['--text-secondary', '#4a4a46'],
    ['--text-muted', '#575756'],
    ['--text-soft', '#66665f'],
    ['--text-soft-2', '#77776f'],
    ['--text-soft-3', '#88887f'],
    ['--text-faint', '#8a8a86'],
    ['--text-faint-2', '#9a9a94'],
    ['--text-faint-3', '#a2a29b'],
    ['--text-on-blue', '#dceaf6'],
    ['--text-on-blue-2', '#a8d2ee'],
    ['--text-on-blue-3', '#bcdcf2'],
  ])('declares text token %s as %s', (name, value) => {
    expect(declares(tokens, name, value)).toBe(true);
  });

  it.each([
    ['--border', '#e6e6e0'],
    ['--border-2', '#ebebe4'],
    ['--border-3', '#e0e0d8'],
    ['--border-4', '#dcdcd4'],
    ['--border-5', '#e9e9e2'],
    ['--border-6', '#ecece5'],
    ['--border-7', '#f2f2ec'],
    ['--divider-on-blue', '#ececE5'],
  ])('declares border token %s as %s', (name, value) => {
    expect(declares(tokens, name, value)).toBe(true);
  });
});

describe('tokens.css — warn / ok / neutral scales', () => {
  it.each([
    ['--warn', '#d9631a'],
    ['--warn-hover', '#bf5413'],
    ['--warn-bg', '#fdf1e7'],
    ['--warn-bg-2', '#fffaf5'],
    ['--warn-border', '#f2d3b4'],
    ['--warn-border-2', '#e8b98d'],
    ['--warn-border-3', '#f0d5bb'],
    ['--warn-text', '#8a4a12'],
    ['--warn-text-2', '#c07a3c'],
    ['--ok', '#2f6b3a'],
    ['--ok-bg', '#eef6ef'],
    ['--info-bg', '#e9f2f9'],
    ['--neutral-badge-bg', '#f4f4ef'],
    ['--dark', '#575756'],
    ['--dark-hover', '#3f3f3e'],
    ['--device-frame', '#1b1b1a'],
  ])('declares %s as %s', (name, value) => {
    expect(declares(tokens, name, value)).toBe(true);
  });

  it('declares the scrim and the disabled ramp', () => {
    expect(declares(tokens, '--scrim', 'rgba\\(24,\\s*24,\\s*22,\\s*\\.44\\)')).toBe(true);
    expect(declares(tokens, '--disabled-bg', '#d5d5cd')).toBe(true);
    expect(declares(tokens, '--disabled-bg-2', '#c9c9c1')).toBe(true);
    expect(declares(tokens, '--disabled-bg-3', '#ecece5')).toBe(true);
    expect(declares(tokens, '--disabled-fg', '#8f8f89')).toBe(true);
    expect(declares(tokens, '--disabled-fg-2', '#a2a29b')).toBe(true);
  });

  it('introduces no red — destructive actions reuse the anomaly orange', () => {
    const reds = tokens.match(/#(f{2}0{4}|e[0-9a-f]{5}|d[0-9a-f]{5}|c[0-9a-f]{5}|b[0-9a-f]{5})\b/gi) ?? [];
    const forbidden = reds.filter((hex) => {
      const r = parseInt(hex.slice(1, 3), 16);
      const g = parseInt(hex.slice(3, 5), 16);
      const b = parseInt(hex.slice(5, 7), 16);
      // A true red has almost no green. The anomaly ramp (#d9631a, #bf5413)
      // sits well above this floor and must stay allowed.
      return r > 150 && g < 70 && b < 70;
    });
    expect(forbidden).toEqual([]);
  });
});

describe('tokens.css — typography, shape and control tokens', () => {
  it('declares the three font families from the design contract', () => {
    expect(tokens).toMatch(/--font-ui\s*:\s*Manrope,\s*system-ui,\s*sans-serif\s*;/);
    expect(tokens).toMatch(/--font-mono\s*:\s*'JetBrains Mono',\s*ui-monospace,\s*monospace\s*;/);
    expect(tokens).toMatch(/--font-icon\s*:\s*'Material Symbols Rounded'/);
  });

  it.each(['--r-pill', '--r-btn', '--r-card', '--r-modal', '--r-sheet', '--r-screen', '--r-screen-tablet'])(
    'declares radius %s',
    (name) => {
      expect(new RegExp(`${name}\\s*:`).test(tokens)).toBe(true);
    },
  );

  it.each(['--shadow-row', '--shadow-mic', '--shadow-device'])('declares shadow %s', (name) => {
    expect(new RegExp(`${name}\\s*:`).test(tokens)).toBe(true);
  });

  it.each(['--h-primary', '--h-secondary', '--h-auditor-primary', '--h-auditor-secondary', '--h-header-btn'])(
    'declares control height %s',
    (name) => {
      expect(new RegExp(`${name}\\s*:`).test(tokens)).toBe(true);
    },
  );

  it('declares the spacing ramp', () => {
    for (const name of ['--sp-1', '--sp-2', '--sp-3', '--sp-4', '--sp-5', '--sp-6']) {
      expect(new RegExp(`${name}\\s*:`).test(tokens)).toBe(true);
    }
  });
});

describe('tokens.css — animation', () => {
  it.each(['vpulse', 'vbar', 'vdot', 'vrise', 'trise'])('defines the %s keyframes', (name) => {
    expect(new RegExp(`@keyframes\\s+${name}\\s*\\{`).test(tokens)).toBe(true);
  });

  it('reproduces the keyframe bodies verbatim', () => {
    const stripped = tokens.replace(/\s+/g, '');
    expect(stripped).toContain(
      '@keyframesvpulse{0%{transform:scale(1);opacity:.55;}70%{transform:scale(1.55);opacity:0;}100%{transform:scale(1.55);opacity:0;}}',
    );
    expect(stripped).toContain('@keyframesvbar{0%,100%{transform:scaleY(.22);}50%{transform:scaleY(1);}}');
    expect(stripped).toContain('@keyframesvdot{0%,100%{opacity:.25;}50%{opacity:1;}}');
    expect(stripped).toContain(
      '@keyframesvrise{from{transform:translateY(14px);opacity:0;}to{transform:translateY(0);opacity:1;}}',
    );
    expect(stripped).toContain(
      '@keyframestrise{from{transform:translateY(10px);opacity:0;}to{transform:translateY(0);opacity:1;}}',
    );
  });

  it('honours prefers-reduced-motion — the design has no such block', () => {
    expect(tokens).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    const block = tokens.slice(tokens.indexOf('prefers-reduced-motion'));
    expect(block).toMatch(/animation[^:]*:\s*none\s*!important/);
    expect(block).toMatch(/transition[^:]*:\s*none\s*!important/);
  });
});

describe('global.css — reset, numerics and accessibility floor', () => {
  it('imports the token layer', () => {
    expect(global).toMatch(/@import\s+['"]\.\/tokens\.css['"]\s*;/);
  });

  it('applies the UI font stack to the document', () => {
    expect(global).toMatch(/font-family:\s*var\(--font-ui\)/);
    expect(global).toMatch(/background:\s*var\(--page\)/);
  });

  it('puts quantities on tabular figures — a requirement, not a flourish', () => {
    expect(global).toMatch(/\.qty[^{]*\{[^}]*font-variant-numeric:\s*tabular-nums/s);
  });

  it('exposes the mono meta and eyebrow roles', () => {
    expect(global).toMatch(/\.mono-meta[^{]*\{[^}]*font-family:\s*var\(--font-mono\)/s);
    expect(global).toMatch(/\.eyebrow[^{]*\{[^}]*text-transform:\s*uppercase/s);
  });

  it('ships a visible keyboard focus ring the design lacks entirely', () => {
    expect(global).toMatch(/:focus-visible/);
    expect(global).toMatch(/outline:\s*[^;]*var\(--brand-blue\)/);
  });

  it('ships a base for role="dialog" overlays', () => {
    expect(global).toMatch(/\[role='dialog'\]|\[role="dialog"\]/);
    expect(global).toMatch(/background:\s*var\(--scrim\)/);
  });

  it('ships a screen-reader-only utility so landmarks can be labelled', () => {
    expect(global).toMatch(/\.sr-only/);
  });
});

describe('compliance', () => {
  it('C2 — never claims offline behaviour (RNF-08 was removed)', () => {
    expect(tokens).not.toContain('Funciona sin señal');
    expect(global).not.toContain('Funciona sin señal');
  });

  it('C1 — no retention copy leaks into the style layer', () => {
    expect(tokens).not.toContain('12 meses');
    expect(global).not.toContain('12 meses');
  });
});
