/**
 * Center pane — filter chips plus the record rows (design contract §3, V1).
 *
 * The chips are toggle buttons, so they carry `aria-pressed`; the design has no
 * aria at all and communicates the active chip with colour alone.
 */
import type { AuditorRecord } from '../../fixtures/auditorSeed';
import { badgeOf, isOpenAlert } from '../../fixtures/auditorSeed';

export type RecordFilter = 'mirada' | 'todos' | 'verificados';

export interface RecordListProps {
  records: readonly AuditorRecord[];
  visible: readonly AuditorRecord[];
  filter: RecordFilter;
  onFilter: (filter: RecordFilter) => void;
  selectedId: string | null;
  onSelect: (id: string) => void;
}

export function RecordList({
  records,
  visible,
  filter,
  onFilter,
  selectedId,
  onSelect,
}: RecordListProps) {
  const pending = records.filter(isOpenAlert).length;

  const chips: readonly { key: RecordFilter; label: string }[] = [
    { key: 'mirada', label: `Requieren mirada · ${pending}` },
    { key: 'todos', label: 'Todos los registros' },
    { key: 'verificados', label: 'Verificados' },
  ];

  return (
    <>
      <div class="chips">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            class={`chip${chip.key === filter ? ' chip--on' : ''}`}
            aria-pressed={chip.key === filter ? 'true' : 'false'}
            onClick={() => onFilter(chip.key)}
          >
            {chip.label}
          </button>
        ))}

        <p class="chips__count">
          {`${visible.length} de ${records.length} registros · 84 contados hoy`}
        </p>
      </div>

      {visible.length === 0 ? (
        <p class="empty">Ningún registro en este filtro.</p>
      ) : (
        <ul class="rlist" aria-label="Registros">
          {visible.map((record) => {
            const badge = badgeOf(record);
            const selected = record.id === selectedId;
            return (
              <li key={record.id}>
                <button
                  type="button"
                  class={`rrow${selected ? ' rrow--selected' : ''}${
                    isOpenAlert(record) ? ' rrow--alert' : ''
                  }`}
                  aria-current={selected ? 'true' : undefined}
                  onClick={() => onSelect(record.id)}
                >
                  <span class="rrow__qty">
                    <b class="qty">{record.counted.quantity}</b>
                    <span class="rrow__unit">{record.counted.unit}</span>
                  </span>

                  <span class="rrow__main">
                    <span class="rrow__name">{record.articulo}</span>
                    <span class="rrow__meta">
                      {`${record.sku} · ${record.operator} · ${record.time}`}
                    </span>
                  </span>

                  <span class={`badge badge--${badge.tone}`}>{badge.label}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
