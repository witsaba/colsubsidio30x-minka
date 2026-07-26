/**
 * S6 — "Alerta de anomalía" (REQ-OCF-5, RF-28, RF-29).
 *
 * The sheet is DELIBERATELY non-dismissible. While it is open the reducer's
 * derived `blocked()` guard is true and the microphone is inert, so offering an
 * Escape key or a close button would silently unblock the count. The only two
 * ways out are the two designed resolutions.
 *
 * `title`, `reason` and `hint` are rendered verbatim from the `Anomaly` the
 * engine produced — no copy is authored here, so the fixture wording and any
 * future real engine wording reach the operator unaltered.
 */
import type { Anomaly } from '../../lib/anomaly/engine';
import type { ConfirmableItem } from '../../lib/pipeline';
import { displayUnit } from '../../lib/units';
import { Sheet } from './Sheet';

export interface AnomalySheetProps {
  item: ConfirmableItem;
  anomaly: Anomaly;
  /** "Eliminar y volver a dictar" — drops the item and pops the queue. */
  onRedictate: () => void;
  /** "Es correcto · dejar nota al auditor" — keeps it as `anom_noted`. */
  onKeepNoted: () => void;
}

export function AnomalySheet({ item, anomaly, onRedictate, onKeepNoted }: AnomalySheetProps) {
  const unit = displayUnit(item.picked.unidad_display);
  const sku = item.picked.nr_articulo;

  return (
    <Sheet labelledBy="anomaly-title" describedBy="anomaly-reason" testId="anomaly-sheet">
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--sp-2)',
          padding: 'var(--sp-2) var(--sp-3)',
          borderRadius: 'var(--r-pill)',
          background: 'var(--warn-bg)',
          color: 'var(--warn-text)',
          width: 'fit-content',
          marginBottom: 'var(--sp-3)',
        }}
      >
        <span class="icon" data-testid="anomaly-icon" aria-hidden="true" style={{ fontSize: '18px' }}>
          error
        </span>
        <span style={{ fontSize: '11px', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
          Alerta de anomalía
        </span>
      </div>

      <h2
        id="anomaly-title"
        data-testid="anomaly-title"
        class="h2"
        style={{ fontSize: '23px', marginBottom: 'var(--sp-4)' }}
      >
        {anomaly.title}
      </h2>

      <div
        data-testid="anomaly-card"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 'var(--sp-3)',
          padding: 'var(--sp-4)',
          borderRadius: 'var(--r-card)',
          border: '1.5px solid var(--warn-border-2)',
          background: 'var(--warn-bg-2)',
          marginBottom: 'var(--sp-4)',
        }}
      >
        <span
          class="qty"
          data-testid="anomaly-qty"
          style={{ fontSize: '28px', color: 'var(--warn)' }}
        >
          {item.extracted.quantity}
        </span>
        {unit !== null ? (
          <span
            data-testid="anomaly-unit"
            style={{
              fontSize: '11px',
              fontWeight: 800,
              textTransform: 'uppercase',
              color: 'var(--warn-text-2)',
            }}
          >
            {unit}
          </span>
        ) : null}
        <span style={{ flex: 1 }}>
          <span style={{ display: 'block', fontSize: '14px', fontWeight: 600 }}>
            {item.picked.articulo}
          </span>
          <span class="mono-meta" data-testid="anomaly-sku" style={{ display: 'block' }}>
            {sku === null ? 'Sin código' : sku}
          </span>
        </span>
      </div>

      <p
        id="anomaly-reason"
        data-testid="anomaly-reason"
        style={{ fontSize: '14px', lineHeight: 1.5, color: 'var(--text-secondary)' }}
      >
        {anomaly.reason}
      </p>
      <p
        data-testid="anomaly-hint"
        class="mono-meta"
        style={{ marginTop: 'var(--sp-2)', marginBottom: 'var(--sp-5)' }}
      >
        {anomaly.hint}
      </p>

      <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
        <button
          type="button"
          onClick={onRedictate}
          style={{
            height: 'var(--h-primary)',
            borderRadius: 'var(--r-btn)',
            background: 'var(--warn)',
            color: 'var(--surface)',
            fontWeight: 700,
          }}
        >
          Eliminar y volver a dictar
        </button>
        <button
          type="button"
          onClick={onKeepNoted}
          style={{
            height: 'var(--h-secondary)',
            borderRadius: 'var(--r-btn)',
            border: '1.5px solid var(--border-4)',
            color: 'var(--text-muted)',
            fontWeight: 700,
          }}
        >
          Es correcto · dejar nota al auditor
        </button>
      </div>
    </Sheet>
  );
}
