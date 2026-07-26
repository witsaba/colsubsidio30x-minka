/**
 * `CountSession` session resume (REQ-OCF-13, task 6.11).
 *
 * The gap this closes, in the words of the requirement: "reloading `/conteo`
 * mid-count MUST restore the persisted records of the active plan session".
 * Before this, a reload started from `initialSessionState` — consent screen,
 * empty list — while the rows sat in `count_records`. Because
 * `CountRecord.id` IS the `client_record_id` idempotency key, re-dictating the
 * same shelf then wrote a second row for one physical count.
 *
 * A reload is modelled the only way a component test honestly can: a FRESH
 * mount with the storage a previous session left behind. That is exactly what
 * the browser does.
 */
import { act, render, waitFor } from '@testing-library/preact';
import { describe, expect, it, vi } from 'vitest';

import { CountSession } from '../../../src/components/operator/CountSession';
import type { CreateRecordInput, RestoredRecordDto } from '../../../src/lib/api/operational';
import { RESUME_STORAGE_KEY } from '../../../src/lib/session/resume';
import { CATALOGUES } from '../../../src/lib/catalogues';
import { fakeMediaStream } from '../../setup';

const FIRST = CATALOGUES[0]!;
const OPERATOR_ID = '11111111-1111-4111-8111-111111111111';
const PLAN_ID = '44444444-4444-4444-8444-444444444444';
const WAREHOUSE_ID = '28f1c715-4c42-4920-bf4b-6127e40ce11f';

const SCOPE = {
  catalogueId: FIRST.catalogueId,
  planId: PLAN_ID,
  operatorId: OPERATOR_ID,
  warehouseId: WAREHOUSE_ID,
};

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  } as Storage;
}

/** Storage as a previous, un-finished session would have left it. */
function storageWithActivePlan(): Storage {
  return memoryStorage({ [RESUME_STORAGE_KEY]: JSON.stringify(SCOPE) });
}

function persisted(over: Partial<RestoredRecordDto> = {}): RestoredRecordDto {
  return {
    id: 'rec-1000-0',
    serverId: 'srv-1',
    quantity: 3,
    unitCode: 'KG',
    unitDisplay: 'kilos',
    articulo: 'LECHUGA BATAVIA',
    nrArticulo: '100221',
    spokenName: 'tres kilos de lechuga batavia',
    state: 'ok',
    anomaly: null,
    createdAt: '2026-07-25T13:00:00Z',
    ...over,
  };
}

interface Stubs {
  storage?: Storage;
  records?: RestoredRecordDto[];
  loadRecords?: (planId: string, operatorId: string) => Promise<RestoredRecordDto[]>;
  micOk?: boolean;
}

function mount(stubs: Stubs = {}) {
  const storage = stubs.storage ?? storageWithActivePlan();
  const loadRecords = vi.fn(
    stubs.loadRecords ?? (async () => stubs.records ?? [persisted()]),
  );
  const requestMic = vi.fn(async () =>
    stubs.micOk === false
      ? ({ ok: false, reason: 'denied' } as const)
      : ({ ok: true, stream: fakeMediaStream() } as const),
  );
  const persistRecord = vi.fn(async (_input: CreateRecordInput) => ({
    id: 'should-not-happen',
    verdict: 'ok' as const,
    anomaly: null,
  }));
  const loadPlans = vi.fn(async () => []);

  const view = render(
    <CountSession
      operatorId={OPERATOR_ID}
      resumeStorage={storage}
      loadRecords={loadRecords}
      requestMic={requestMic}
      loadPlans={loadPlans}
      persistRecord={persistRecord}
      persistConsent={vi.fn(async () => ({ id: 'consent-1' }))}
      now={() => Date.UTC(2026, 6, 25, 14, 41, 0)}
    />,
  );

  return { ...view, storage, loadRecords, requestMic, persistRecord };
}

describe('reloading mid-count restores the session', () => {
  it('opens on the count screen, not back on the consent screen', async () => {
    const view = mount();

    expect(await view.findByRole('button', { name: /Mantén presionado para dictar/ })).toBeTruthy();
  });

  it('renders the records the server had, not an empty list', async () => {
    const view = mount({
      records: [
        persisted(),
        persisted({
          id: 'rec-1000-1',
          serverId: 'srv-2',
          quantity: 12,
          articulo: 'GASEOSA POSTOBON 400 ML',
          nrArticulo: '100482',
          unitDisplay: 'unidades',
          unitCode: 'UND',
          spokenName: 'doce gaseosas',
        }),
      ],
    });

    await view.findByRole('button', { name: /Mantén presionado para dictar/ });
    expect(await view.findByText(/LECHUGA BATAVIA/)).toBeTruthy();
    expect(await view.findByText(/GASEOSA POSTOBON 400 ML/)).toBeTruthy();
  });

  it('asks the server for exactly the plan and operator that were being counted', async () => {
    const view = mount();

    await view.findByRole('button', { name: /Mantén presionado para dictar/ });
    expect(view.loadRecords).toHaveBeenCalledWith(PLAN_ID, OPERATOR_ID, expect.anything());
  });

  it('never re-writes a restored record — that is the whole double-count bug', async () => {
    const view = mount();

    await view.findByRole('button', { name: /Mantén presionado para dictar/ });
    // Give the persistence effect every chance to fire before asserting silence.
    await act(async () => {
      await Promise.resolve();
    });

    expect(view.persistRecord).not.toHaveBeenCalled();
  });

  it('restores a flagged record as SIGNALLED, not as a clean count', async () => {
    const view = mount({
      records: [
        persisted({
          state: 'anom_noted',
          anomaly: {
            type: 'atypical_quantity',
            severity: 'warning',
            title: 'Cantidad fuera de lo habitual',
          },
        }),
      ],
    });

    await view.findByRole('button', { name: /Mantén presionado para dictar/ });
    // The auditor-facing flag survives the reload: a restored anomaly must not
    // come back looking like an ordinary settled count.
    expect(await view.findByLabelText('Registro señalado con nota al auditor')).toBeTruthy();
  });

  it('restores a clean record WITHOUT the signalled flag', async () => {
    const view = mount();

    await view.findByRole('button', { name: /Mantén presionado para dictar/ });
    expect(view.queryByLabelText('Registro señalado con nota al auditor')).toBeNull();
  });
});

describe('resume refuses to guess', () => {
  it('starts a normal session when no plan was left in storage', async () => {
    const view = mount({ storage: memoryStorage() });

    expect(await view.findByLabelText(/He leído y autorizo/)).toBeTruthy();
    expect(view.loadRecords).not.toHaveBeenCalled();
  });

  it('stays on consent when the records cannot be fetched, rather than resuming empty', async () => {
    const view = mount({
      loadRecords: async () => {
        throw new Error('network down');
      },
    });

    expect(await view.findByLabelText(/He leído y autorizo/)).toBeTruthy();
  });

  it('stays on consent when the microphone is no longer granted', async () => {
    const view = mount({ micOk: false });

    expect(await view.findByLabelText(/He leído y autorizo/)).toBeTruthy();
  });

  it('resumes an empty plan onto the count screen — the plan was still open', async () => {
    const view = mount({ records: [] });

    expect(await view.findByRole('button', { name: /Mantén presionado para dictar/ })).toBeTruthy();
  });
});

describe('the resume context is written and cleared by the session itself', () => {
  it('clears the stored plan once the count is finished', async () => {
    const view = mount();

    const finish = await view.findByRole('button', { name: /Terminar conteo/ });
    await act(async () => {
      finish.click();
    });

    await waitFor(() => expect(view.storage.getItem(RESUME_STORAGE_KEY)).toBeNull());
  });
});
