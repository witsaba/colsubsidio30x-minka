/**
 * T21 RED — the two zero-JS auditor shells (REQ-AUD-1).
 *
 * `close` and `base` MAY ship tonight as static shells. They contain no
 * behaviour, so — exactly as the T15 layout suite does — the assertions are
 * against the `.astro` source text: the failure modes worth preventing are a
 * missing verbatim copy line, a missing Oracle column, or a shell that
 * accidentally becomes an island.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The shells are `.astro`, and `vitest.config.ts` (owned by T2, frozen) carries
 * no Astro Vite plugin — so `astro/container` cannot render them here and the
 * assertions run against source text, exactly as the T15 layout suite does.
 * Source text is line-wrapped by the formatter, so copy is matched against a
 * whitespace-collapsed view; data rendered from `auditorSeed.ts` is asserted
 * through its import and mapping, with the values themselves pinned by
 * `auditor-seed.test.ts`.
 */
const read = (relative: string): string =>
  readFileSync(resolve(process.cwd(), 'src', relative), 'utf8').replace(/\s+/g, ' ');

const cierre = read('pages/auditor/cierre.astro');
const base = read('pages/auditor/base.astro');
const rail = read('components/auditor/AuditorRail.astro');

describe('AuditorRail — the shared nav rail', () => {
  it('offers the three views', () => {
    for (const item of ['Revisión', 'Cierre', 'Base']) {
      expect(rail).toContain(item);
    }
  });

  it('marks the active item for assistive tech — the design has zero aria', () => {
    expect(rail).toMatch(/aria-current="page"/);
  });

  it('renders the auditor avatar from the seeded initials', () => {
    expect(rail).toContain('AUDITOR_INITIALS');
    expect(rail).toContain('Auditor');
  });

  it('hardcodes no hex colour', () => {
    expect(rail).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});

describe.each([
  ['cierre', cierre],
  ['base', base],
])('/auditor/%s — static shell contract', (_name, source) => {
  it('is prerendered and ships zero client JS', () => {
    expect(source).toMatch(/export\s+const\s+prerender\s*=\s*true\s*;/);
    expect(source).not.toMatch(/client:(load|idle|visible|only)/);
  });

  it('renders inside the shared auditor shell', () => {
    expect(source).toMatch(/AuditorLayout/);
  });

  it('mounts the shared nav rail', () => {
    expect(source).toMatch(/<AuditorRail\b/);
  });

  it('hardcodes no hex colour — every value comes from the token layer', () => {
    expect(source).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});

describe('/auditor/cierre — Cierre y exportación', () => {
  it('uses the designed header title', () => {
    expect(cierre).toContain('Cierre y exportación');
  });

  it('renders the 4 KPI cards from the shared seed', () => {
    expect(cierre).toMatch(/CLOSE_KPIS/);
    expect(cierre).toMatch(/CLOSE_KPIS\.map/);
  });

  it('renders the Oracle rows and the conciliación list from the shared seed', () => {
    expect(cierre).toMatch(/ORACLE_EXPORT_ROWS\.map/);
    expect(cierre).toMatch(/CONCILIATION_ROWS\.map/);
  });

  it('renders the Oracle file card with the Import Count Sequences columns', () => {
    expect(cierre).toContain('Archivo para Oracle My Inventory');
    expect(cierre).toContain('Import Count Sequences');
    for (const column of ['SUBINVENTORY', 'ITEM', 'COUNT_QTY', 'UOM', 'COUNTER']) {
      expect(cierre).toContain(column);
    }
  });

  it('uses real table semantics — the design ships divs only', () => {
    expect(cierre).toMatch(/<table/);
    expect(cierre).toMatch(/<thead/);
    expect(cierre).toMatch(/scope="col"/);
  });

  it('renders the conciliación list and the promo card verbatim', () => {
    expect(cierre).toContain('Conciliación');
    expect(cierre).toContain('De 2 días a 41 minutos');
    expect(cierre).toContain(
      'El conteo ya está digitado en el momento de contar. Nadie vuelve a transcribir las 48 bodegas.',
    );
  });

  it('documents the deliberate decimal-separator split in a comment', () => {
    expect(cierre).toMatch(/machine-targeted/i);
  });
});

describe('/auditor/base — Base de datos y equipo', () => {
  it('uses the designed header title', () => {
    expect(base).toContain('Base de datos y equipo');
  });

  it('renders the workbook card verbatim', () => {
    expect(base).toContain('BODEGAS Y STOCK.xlsx');
    expect(base).toContain('Cargado 30 jul · 14:02 · 1.482 SKU');
    expect(base).toContain('Aprobada');
    expect(base).toMatch(/WORKBOOK_STATS\.map/);
  });

  it('renders the learned ranges section from the shared seed', () => {
    expect(base).toContain('Rangos aprendidos por artículo');
    expect(base).toMatch(/LEARNED_RANGES\.map/);
  });

  it('renders the team from the shared seed', () => {
    expect(base).toContain('Equipo del conteo');
    expect(base).toMatch(/COUNT_TEAM\.map/);
  });

  it('states the "Sin integración al ERP" note verbatim', () => {
    expect(base).toContain('Sin integración al ERP');
    expect(base).toContain(
      'La herramienta es autónoma: se alimenta del Excel y devuelve el archivo de carga. El ERP sigue siendo el dueño de traslados, ventas y bajas.',
    );
  });

  it('states the RF-11 bodega→catálogo limitation verbatim (design §11)', () => {
    expect(base).toContain(
      'El libro de origen no trae una llave que una las 48 bodegas con las 8 tablas de stock: las categorías de auditoría son las 8 tablas reales.',
    );
  });
});

describe('compliance — the shells never contradict the shipped product', () => {
  const all = [cierre, base];

  it('C2 — no offline claim survives', () => {
    for (const source of all) {
      expect(source).not.toMatch(/sin conexión|sin señal|offline|se sincroniza/i);
    }
  });

  it('C1 — no shell claims the audio is stored', () => {
    for (const source of all) {
      expect(source).not.toContain('12 meses');
      expect(source).not.toMatch(/el audio se guarda/i);
    }
  });

  it('keeps the auditor legend statement that the voice is not stored', () => {
    expect(cierre).toContain('La voz no se almacena.');
  });
});
