/**
 * Right pane, 352px — the selected record (design contract §3, V1).
 *
 * "Contado" and "Sistema" sit side by side and the AUDITOR MAY see theoretical
 * stock (REQ-AUD-2, C6). RF-18 blind counting binds the OPERATOR only: the
 * `/conteo` surface must never render a system value, this one must.
 *
 * The RF-32 trace is a real `<table>` with row headers; the design draws it as
 * label/value divs, which announces as an undifferentiated run of text.
 */
import type { AuditorRecord } from '../../fixtures/auditorSeed';
import { badgeOf, diffOf } from '../../fixtures/auditorSeed';

export interface DetailPaneProps {
  record: AuditorRecord | null;
  onApprove: () => void;
  onCorrect: () => void;
  onRecount: () => void;
}

export function DetailPane({ record, onApprove, onCorrect, onRecount }: DetailPaneProps) {
  if (record === null) {
    return <p class="empty">Selecciona un registro para revisarlo.</p>;
  }

  const badge = badgeOf(record);
  const diff = diffOf(record);

  return (
    <div class="detail">
      <p class="pane__title">Registro seleccionado</p>
      <h2 class="detail__name">{record.articulo}</h2>
      <p class="detail__sku">{record.sku}</p>

      <div class="compare">
        <div class="compare__cell">
          <p class="compare__label">Contado</p>
          <p class="compare__value qty">{record.counted.quantity}</p>
          <p class="compare__unit">{record.counted.unit}</p>
        </div>
        <div class="compare__cell compare__cell--system">
          <p class="compare__label">Sistema</p>
          <p class="compare__value qty">{record.system.quantity}</p>
          <p class="compare__unit">{record.system.unit}</p>
        </div>
      </div>

      <p class={`diff diff--${diff.tone}`}>{diff.label}</p>

      {record.alert !== null && !record.verified ? (
        <div class="alert">
          <p class="alert__title">{record.alert.title}</p>
          <p class="alert__detail">{record.alert.detail}</p>
        </div>
      ) : null}

      <table class="trace" aria-label="Traza del registro">
        <tbody>
          <tr>
            <th scope="row">Contado por</th>
            <td>{record.operator}</td>
          </tr>
          <tr>
            <th scope="row">Hora del registro</th>
            <td>{record.time}</td>
          </tr>
          <tr>
            <th scope="row">Plan</th>
            <td>{record.plan}</td>
          </tr>
          <tr>
            <th scope="row">Lo que se dictó</th>
            <td>{record.dictated}</td>
          </tr>
          <tr>
            <th scope="row">Consenso de modelos</th>
            <td>{record.consensus}</td>
          </tr>
          <tr>
            <th scope="row">Estado</th>
            <td>{badge.label}</td>
          </tr>
        </tbody>
      </table>

      {record.trace.length > 0 ? (
        <ul class="signed" aria-label="Decisiones del auditor">
          {record.trace.map((entry, index) => (
            <li key={`${entry.time}-${index}`}>
              {`${entry.time} · ${entry.user} · ${entry.action}${
                entry.reason === undefined ? '' : ` · ${entry.reason}`
              }`}
            </li>
          ))}
        </ul>
      ) : null}

      <div class="detail__actions">
        <button type="button" class="btn btn--primary" onClick={onApprove}>
          Aprobar registro
        </button>
        <div class="detail__secondary">
          <button type="button" class="btn btn--secondary" onClick={onCorrect}>
            Corregir
          </button>
          <button type="button" class="btn btn--secondary btn--recount" onClick={onRecount}>
            Pedir reconteo
          </button>
        </div>
      </div>

      <p class="detail__note">Toda acción queda firmada con usuario, hora y motivo.</p>
    </div>
  );
}
