/**
 * Left pane, 286px — "Bodegas · 5 de 8 cerradas" (design contract §3, V1).
 *
 * Selection is local state only. The record list is seeded per the design and
 * does not change with the warehouse: the live operator->auditor handoff is
 * explicitly stretch (S4), and faking eight record sets would be inventing
 * data the design never specified.
 */
import type { Warehouse } from '../../lib/auditor/types';

export interface WarehouseListProps {
  warehouses: readonly Warehouse[];
  selectedId: string;
  onSelect: (id: string) => void;
  closedCount: number;
}

/** Material Symbols ligature per state. */
const ICONS: Readonly<Record<Warehouse['state'], string>> = {
  cerrada: 'check_circle',
  'en-curso': 'graphic_eq',
  programada: 'schedule',
};

export function WarehouseList({
  warehouses,
  selectedId,
  onSelect,
  closedCount,
}: WarehouseListProps) {
  return (
    <>
      <p class="pane__title">{`Bodegas · ${closedCount} de ${warehouses.length} cerradas`}</p>

      <ul class="wlist" aria-label="Bodegas">
        {warehouses.map((warehouse) => {
          const selected = warehouse.id === selectedId;
          return (
            <li key={warehouse.id}>
              <button
                type="button"
                class={`wrow${selected ? ' wrow--selected' : ''}`}
                aria-current={selected ? 'true' : undefined}
                onClick={() => onSelect(warehouse.id)}
              >
                <span class="wrow__head">
                  <span class="wrow__name">{warehouse.name}</span>
                  <span class="wrow__icon" aria-hidden="true">
                    {ICONS[warehouse.state]}
                  </span>
                </span>

                {/* Native progress semantics; the design draws two bare divs. */}
                <span
                  class={`bar bar--${warehouse.state}`}
                  role="progressbar"
                  aria-valuenow={warehouse.percentage}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`Avance de ${warehouse.name}`}
                >
                  <span class="bar__fill" style={{ width: `${warehouse.percentage}%` }} />
                </span>

                <span class="wrow__meta">
                  {`${warehouse.counted} / ${warehouse.total}`}
                  <span class="wrow__state">{warehouse.stateLabel}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </>
  );
}
