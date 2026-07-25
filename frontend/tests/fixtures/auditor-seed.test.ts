/**
 * T21 RED — auditor seed fixtures (REQ-AUD-1, REQ-AUD-3).
 *
 * The auditor runs on seeded fixtures tonight (the live operator->auditor
 * handoff is stretch S4), so these fixtures ARE the product data. Every value
 * is transcribed verbatim from design contract §3; the suite exists to stop a
 * later refactor from quietly inventing a record, a warehouse or a copy string.
 */
import { describe, expect, it } from 'vitest';

import {
  AUDITOR_RECORDS,
  AUDITOR_WAREHOUSES,
  CLOSE_KPIS,
  CONCILIATION_ROWS,
  COUNT_TEAM,
  LEARNED_RANGES,
  ORACLE_EXPORT_ROWS,
  badgeOf,
  diffOf,
  openAlertCount,
  REVIEWED_WAREHOUSE_NAME,
} from '../../src/fixtures/auditorSeed';

describe('AUDITOR_RECORDS — the 8 verbatim seed records', () => {
  it('seeds exactly 8 records', () => {
    expect(AUDITOR_RECORDS).toHaveLength(8);
  });

  it('opens with exactly 3 alerts, one per alert kind', () => {
    const alerted = AUDITOR_RECORDS.filter((r) => r.alert !== null);
    expect(alerted).toHaveLength(3);
    expect(alerted.map((r) => r.alert?.kind)).toEqual(['unidad', 'cantidad', 'negativo']);
    expect(openAlertCount(AUDITOR_RECORDS)).toBe(3);
  });

  it('gives every record a counted value, a system value and an EMPTY trace', () => {
    for (const record of AUDITOR_RECORDS) {
      expect(record.counted.quantity).toBeTypeOf('string');
      expect(record.counted.unit).toBeTypeOf('string');
      expect(record.system.quantity).toBeTypeOf('string');
      expect(record.system.unit).toBeTypeOf('string');
      // Trace starts empty: every entry must be produced by an auditor action.
      expect(record.trace).toEqual([]);
      expect(record.verified).toBe(false);
      expect(badgeOf(record).label).toBeTypeOf('string');
    }
  });

  it('transcribes the three alerted records exactly as designed', () => {
    const [unidad, cantidad, negativo] = AUDITOR_RECORDS;

    expect(unidad).toMatchObject({
      counted: { quantity: '900', unit: 'g' },
      system: { quantity: '4', unit: 'L' },
      articulo: 'ACEITE DE OLIVA EXTRA VIRGEN 500ML',
      sku: 'MP-10077',
      operator: 'Pablo R.',
      time: '8:23',
    });
    expect(unidad?.alert).toMatchObject({
      kind: 'unidad',
      title: 'Unidad fuera del catálogo',
      detail:
        'Este artículo se cuenta en litros. El contador dictó gramos: 900 g no es convertible sin la equivalencia del producto.',
    });

    expect(cantidad).toMatchObject({
      counted: { quantity: '305', unit: 'und' },
      system: { quantity: '32', unit: 'und' },
      articulo: 'GASEOSA PERSONAL 400ML',
      sku: 'MP-10505',
      operator: 'Pablo R.',
      time: '8:31',
    });
    expect(cantidad?.alert).toMatchObject({
      kind: 'cantidad',
      title: 'Cantidad 10× sobre el rango',
      detail:
        'El rango histórico de esta bodega es 20 a 40 unidades. Vale la pena un reconteo antes de cerrar.',
    });

    expect(negativo).toMatchObject({
      counted: { quantity: '0', unit: 'und' },
      system: { quantity: '−2', unit: 'und' },
      articulo: 'SALSA DE SOYA 1L',
      sku: 'MP-10333',
      operator: 'Marta G.',
      time: '8:36',
    });
    expect(negativo?.alert).toMatchObject({
      kind: 'negativo',
      title: 'El sistema arrastra saldo negativo',
      detail:
        'El teórico está en −2. El conteo en 0 confirma el error previo: hay que ajustar el saldo, no el conteo.',
    });
  });

  it('transcribes the five clean records, including the manual-search one', () => {
    expect(AUDITOR_RECORDS.slice(3).map((r) => [r.counted.quantity, r.counted.unit, r.articulo, r.sku, r.operator, r.time])).toEqual([
      ['3', 'kg', 'LECHUGA BATAVIA', 'MP-10221', 'Pablo R.', '8:21'],
      ['12', 'und', 'ACEITE VEGETAL GIRASOL 3L', 'MP-10038', 'Pablo R.', '8:21'],
      ['6,5', 'kg', 'ARROZ BLANCO PREPARADO', 'PT-20877', 'Marta G.', '8:14'],
      ['24', 'und', 'PECHUGA POLLO FILETE X 180G', 'MP-10412', 'Marta G.', '8:12'],
      ['5', 'und', 'TABLA ACRILICA PICAR BLANCO 50X38CM FB', 'DT-30112', 'Pablo R.', '8:33'],
    ]);

    const manual = AUDITOR_RECORDS.filter((r) => r.manualSearch);
    expect(manual).toHaveLength(1);
    expect(manual[0]?.sku).toBe('DT-30112');
  });

  it('carries the RF-32 trace columns on every record', () => {
    for (const record of AUDITOR_RECORDS) {
      expect(record.plan).toBe(`${REVIEWED_WAREHOUSE_NAME} · 31 jul`);
      expect(record.dictated.length).toBeGreaterThan(0);
      expect(record.consensus).toBe('3 de 3');
    }
  });
});

describe('badgeOf — REQ-AUD-3 badge vocabulary', () => {
  it('labels each seeded record with its designed badge', () => {
    expect(AUDITOR_RECORDS.map((r) => badgeOf(r).label)).toEqual([
      'Unidad',
      'Cantidad atípica',
      'Saldo negativo',
      'Sin novedad',
      'Sin novedad',
      'Sin novedad',
      'Sin novedad',
      'Búsqueda manual',
    ]);
  });

  it('overrides every other state once the record is verified', () => {
    const record = AUDITOR_RECORDS[0];
    expect(record).toBeDefined();
    expect(badgeOf({ ...record!, verified: true }).label).toBe('Verificado');
  });
});

describe('diffOf — REQ-AUD-2 counted vs system', () => {
  it('reads "Unidad distinta" when the dimensions disagree', () => {
    expect(diffOf(AUDITOR_RECORDS[0]!).label).toBe('Unidad distinta');
  });

  it('reads "Diferencia" when the numbers disagree', () => {
    expect(diffOf(AUDITOR_RECORDS[1]!).label).toBe('Diferencia');
    expect(diffOf(AUDITOR_RECORDS[2]!).label).toBe('Diferencia');
    expect(diffOf(AUDITOR_RECORDS[3]!).label).toBe('Diferencia');
  });

  it('reads "Sin diferencia" when counted and system agree', () => {
    for (const record of AUDITOR_RECORDS.slice(4)) {
      expect(diffOf(record).label).toBe('Sin diferencia');
    }
  });
});

describe('AUDITOR_WAREHOUSES — the left pane', () => {
  it('seeds the 8 designed warehouses, 5 of them closed', () => {
    expect(AUDITOR_WAREHOUSES).toHaveLength(8);
    expect(AUDITOR_WAREHOUSES.filter((w) => w.state === 'cerrada')).toHaveLength(5);
    expect(AUDITOR_WAREHOUSES.filter((w) => w.state === 'en-curso')).toHaveLength(1);
    expect(AUDITOR_WAREHOUSES.filter((w) => w.state === 'programada')).toHaveLength(2);
  });

  it('transcribes name, percentage, counts, operator line and state verbatim', () => {
    expect(
      AUDITOR_WAREHOUSES.map((w) => [w.name, w.percentage, w.counted, w.total, w.stateLabel]),
    ).toEqual([
      ['Almacén General', 100, 412, 412, 'Cerrada · Jorge M.'],
      [REVIEWED_WAREHOUSE_NAME, 78, 84, 107, 'En curso · Pablo R.'],
      ['Restaurante Principal', 100, 96, 96, 'Cerrada · Marta G.'],
      ['Cafetería Primer Piso', 0, 0, 62, 'Programada 11:00'],
      ['Bar Piscina', 100, 48, 48, 'Cerrada · Luis P.'],
      ['Panadería', 100, 71, 71, 'Cerrada · Ana T.'],
      ['Bodega Aseo', 100, 58, 58, 'Cerrada · Jorge M.'],
      ['Bodega Zoológico', 0, 0, 39, 'Programada 14:00'],
    ]);
  });

  it('selects the bodega the operator counted — the one the review view opens on', () => {
    expect(AUDITOR_WAREHOUSES.filter((w) => w.selected)).toHaveLength(1);
    expect(AUDITOR_WAREHOUSES.find((w) => w.selected)?.name).toBe(REVIEWED_WAREHOUSE_NAME);
  });
});

describe('ORACLE_EXPORT_ROWS — Import Count Sequences', () => {
  it('seeds the 9 designed rows in order', () => {
    expect(ORACLE_EXPORT_ROWS.map((r) => [r.subinventory, r.item, r.countQty, r.uom, r.counter])).toEqual([
      ['COCINA_PPAL', 'MP-10221', '3', 'KG', 'PABLO.R'],
      ['COCINA_PPAL', 'MP-10038', '12', 'UND', 'PABLO.R'],
      ['COCINA_PPAL', 'PT-20877', '6.5', 'KG', 'MARTA.G'],
      ['COCINA_PPAL', 'MP-10412', '24', 'UND', 'MARTA.G'],
      ['COCINA_PPAL', 'DT-30112', '5', 'UND', 'PABLO.R'],
      ['ALM_GENERAL', 'MP-10505', '32', 'UND', 'JORGE.M'],
      ['ALM_GENERAL', 'MP-10077', '4', 'LT', 'JORGE.M'],
      ['BAR_PISCINA', 'BB-40021', '18', 'UND', 'LUIS.P'],
      ['PANADERIA', 'PT-20455', '46', 'UND', 'ANA.T'],
    ]);
  });

  it('keeps the deliberate decimal-separator split: UI "6,5" vs export "6.5"', () => {
    // Spanish UI uses a comma; the Oracle file is machine-targeted and uses a
    // period. Both are intentional and must not be "normalised" to one form.
    expect(AUDITOR_RECORDS.find((r) => r.sku === 'PT-20877')?.counted.quantity).toBe('6,5');
    expect(ORACLE_EXPORT_ROWS.find((r) => r.item === 'PT-20877')?.countQty).toBe('6.5');
  });
});

describe('close and base view data', () => {
  it('seeds the 4 KPI cards verbatim', () => {
    expect(CLOSE_KPIS.map((k) => [k.label, k.value, k.detail])).toEqual([
      ['Bodegas cerradas', '5 / 8', '2 en curso · 1 programada'],
      ['Registros verificados', '1.482', 'de 1.489 capturados'],
      ['Alertas abiertas', '3', 'requieren decisión del auditor'],
      ['Diferencia vs. sistema', '1,8%', 'histórico del mes: 4,1%'],
    ]);
  });

  it('seeds the conciliación list verbatim', () => {
    expect(CONCILIATION_ROWS.map((r) => [r.label, r.value])).toEqual([
      ['Artículos contados', '1.489'],
      ['Coinciden con el sistema', '1.402'],
      ['Con diferencia', '87'],
      ['Ajustes por reconteo', '9'],
      ['Tiempo de la toma', '3 h 12 min'],
    ]);
  });

  it('seeds the 5 learned ranges verbatim', () => {
    expect(LEARNED_RANGES.map((r) => [r.articulo, r.unit, r.range])).toEqual([
      ['ACEITE DE OLIVA EXTRA VIRGEN 500ML', 'L', '2 – 8'],
      ['GASEOSA PERSONAL 400ML', 'UND', '20 – 40'],
      ['LECHUGA BATAVIA', 'KG', '1,5 – 6'],
      ['ARROZ BLANCO PREPARADO', 'KG', '3 – 12'],
      ['PECHUGA POLLO FILETE X 180G', 'UND', '12 – 40'],
    ]);
  });

  it('seeds the 4 team members with their initials', () => {
    expect(COUNT_TEAM.map((m) => [m.initials, m.name, m.role])).toEqual([
      ['VR', 'Viviana Ríos', 'Auditora · cierra la toma'],
      ['PR', 'Pablo Ruiz', `Chef · ${REVIEWED_WAREHOUSE_NAME}`],
      ['MG', 'Marta Gómez', 'Auxiliar · verifica cocina'],
      ['JM', 'Jorge Mesa', 'Líder de costos · asigna'],
    ]);
  });
});
