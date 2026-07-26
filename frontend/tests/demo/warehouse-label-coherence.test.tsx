/**
 * The demo narrative must name ONE bodega (WARNING-2 of the verify report).
 *
 * The operator half derives its label from the 8 REAL matcher catalogues
 * (`lib/catalogues.ts`); the auditor half runs on seeded fixtures because the
 * live handoff is stretch S4 and was not built. Nothing forced the two halves
 * to agree, and they had already drifted: the operator counted "Restaurante
 * Fuentes · AyB" while the auditor reviewed "Cocina Principal".
 *
 * These tests pin the invariant end to end — plan card, count header, done
 * screen and auditor review header must all resolve to the SAME label, and
 * `lib/catalogues.ts` must remain its only source.
 */
import { render, screen, within } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';

import { AuditorReview } from '../../src/components/auditor/AuditorReview';
import { CountScreen } from '../../src/components/operator/CountScreen';
import { DoneScreen } from '../../src/components/operator/DoneScreen';
import { PlansScreen } from '../../src/components/operator/PlansScreen';
import { AUDITOR_RECORDS, AUDITOR_WAREHOUSES } from '../../src/fixtures/auditorSeed';
import * as operatorSeed from '../../src/fixtures/operatorSeed';
import { DEMO_CATALOGUE_ID, labelFor } from '../../src/lib/catalogues';
import { initialSessionState } from '../../src/lib/session/reducer';
import type { SessionState } from '../../src/lib/session/types';

const LABEL = labelFor(DEMO_CATALOGUE_ID);

const counting = (): SessionState => ({
  ...initialSessionState,
  screen: 'count',
  consentChecked: true,
  micPermission: 'granted',
  catalogueId: DEMO_CATALOGUE_ID,
});

describe('one bodega name across the whole demo', () => {
  it('names the same bodega on the plan card, the count header, the done screen and the auditor review header', async () => {
    const noop = () => undefined;

    // The plan card no longer reads `lib/catalogues.ts`: the name comes from
    // `audit_plans` now (REQ-OCF-8 as modified). The coherence requirement is
    // unchanged and is now a requirement on the SEEDED PLAN — the demo plan must
    // be named after the catalogue it is bound to, or the operator and the
    // auditor are again looking at two different bodegas.
    const plans = render(
      <PlansScreen
        dispatch={noop}
        operatorId="op-demo"
        loadPlans={async () => [
          { id: 'plan-demo', name: LABEL, warehouseId: 'wh-demo', catalogueId: DEMO_CATALOGUE_ID },
        ]}
      />,
    );
    const card = await plans.findByRole('heading', { level: 2 });
    const planLabel = card.textContent;
    plans.unmount();

    const count = render(<CountScreen state={counting()} dispatch={noop} />);
    const countLabel = count.container.querySelector('#count-title')?.textContent;
    count.unmount();

    const done = render(
      <DoneScreen state={{ ...counting(), screen: 'done' }} dispatch={noop} durationMs={0} />,
    );
    const doneLabel = done.container.querySelector('#done-title')?.textContent;
    done.unmount();

    // The auditor island no longer imports the seed itself (task 5.6): the
    // bodega pane is passed in, and the records arrive through the fetch seam.
    const auditor = render(
      <AuditorReview
        planId="plan-demo"
        auditorId="aud-demo"
        warehouses={AUDITOR_WAREHOUSES}
        clock={() => '9:05 a.m.'}
        loadRecords={async () => AUDITOR_RECORDS}
      />,
    );
    const auditorTitle = auditor.container.querySelector('.review__title')?.textContent;

    // Non-trivial by construction: the label is a real catalogue label, and an
    // empty or missing heading fails the equality below.
    expect(LABEL).toBe('Restaurante Fuentes · AyB');
    expect(planLabel).toBe(LABEL);
    expect(countLabel).toBe(LABEL);
    expect(doneLabel).toBe(LABEL);
    expect(auditorTitle).toBe(`${LABEL} · revisión`);
  });

  it('opens the auditor on the very bodega the operator counted', async () => {
    const selected = AUDITOR_WAREHOUSES.filter((w) => w.selected);
    expect(selected).toHaveLength(1);
    expect(selected[0]?.name).toBe(LABEL);

    render(
      <AuditorReview
        planId="plan-demo"
        auditorId="aud-demo"
        warehouses={AUDITOR_WAREHOUSES}
        clock={() => '9:05 a.m.'}
        loadRecords={async () => AUDITOR_RECORDS}
      />,
    );
    const warehouses = await screen.findByRole('list', { name: 'Bodegas' });
    const current = within(warehouses).getAllByRole('button', { current: true });
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain(LABEL);
  });

  it('stamps the same bodega on the auditor trace plan line', () => {
    expect(AUDITOR_RECORDS.length).toBeGreaterThan(0);
    for (const record of AUDITOR_RECORDS) {
      expect(record.plan.startsWith(`${LABEL} · `)).toBe(true);
    }
  });

  it('keeps `lib/catalogues.ts` the only source of bodega names', () => {
    // `OPERATOR_PLANS` was a second, contradictory table of warehouse labels
    // imported by tests only. It is deleted; this pins it deleted.
    expect(Object.keys(operatorSeed)).not.toContain('OPERATOR_PLANS');
    expect(Object.keys(operatorSeed)).toContain('OPERATOR_SEED_PROGRESS');
  });
});
