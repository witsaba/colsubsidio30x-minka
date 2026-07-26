# Auditor Dashboard Specification

## Purpose

The `/auditor` tablet-first dashboard: live review pane, close/base shells, modals, export gating, and trace. New capability — no prior spec. UI copy is verbatim Colombian Spanish from the design contract.

## Requirements

### Requirement: REQ-AUD-1 — Three views

The dashboard MUST provide `review` (live, three-pane: warehouses 286px / records / detail 352px), `close`, and `base`. `close` and `base` MAY ship tonight as static shells matching the design. (RF-08, RF-09 partial)

#### Scenario: Navigation between views

- GIVEN the nav rail with Revisión / Cierre / Base
- WHEN each item is activated
- THEN the corresponding view renders with its header title ("{bodega} · revisión", where {bodega} is `labelFor(DEMO_CATALOGUE_ID)` — the same label the operator counted under, "Restaurante Fuentes · AyB" / "Cierre y exportación" / "Base de datos y equipo")

### Requirement: REQ-AUD-2 — Auditor may see theoretical stock

The detail pane MUST show "Contado" vs "Sistema" side-by-side with the diff line ("Sin diferencia" / "Unidad distinta" / "Diferencia"). Blind counting binds the OPERATOR only — this view is correct as designed. (RF-18 scope, C6)

#### Scenario: Contado vs Sistema renders

- GIVEN the seeded record `900 g ACEITE DE OLIVA EXTRA VIRGEN 500ML` with system `4 L`
- WHEN it is selected
- THEN both counted and system values are visible in the detail pane

### Requirement: REQ-AUD-3 — Filters and badges

Filter chips MUST be "Requieren mirada · {n}", "Todos los registros", "Verificados", and MUST filter live records read from `count_records` and `record_anomalies` — the 8 hardcoded fixtures are retired. Soft-deleted records (`is_deleted = true`) MUST NOT count as pending nor render as active records. Each record MUST show its state badge: `Unidad` / `Cantidad atípica` / `Saldo negativo` (warn), `Verificado`, `Búsqueda manual` / `Sin novedad`.

#### Scenario: Requieren mirada shows only open alerts

- GIVEN persisted records with 3 open `record_anomalies`
- WHEN "Requieren mirada · 3" is selected
- THEN exactly those 3 alert records render

#### Scenario: Operator write appears to auditor

- GIVEN an operator persists a new count record
- WHEN the auditor view loads
- THEN that record renders without any fixture data source

### Requirement: REQ-AUD-4 — Actions leave a persisted trace

Actions "Aprobar registro", "Corregir", "Pedir reconteo" MUST each write an `auditor_actions` row (user, time, action, record) and render it in the record's trace, per "Toda acción queda firmada con usuario, hora y motivo." Approving an alerted record MUST mark it "Verificado" and decrement the open-alert count. The trace MUST survive reload. (RF-08/09/32)

#### Scenario: Approve decrements the alert pill

- GIVEN 3 alertas abiertas
- WHEN "Aprobar registro" is confirmed on an alerted record
- THEN the record's badge becomes "Verificado" AND the header pill shows "2 alertas abiertas" AND an `auditor_actions` row exists

#### Scenario: Trace survives reload

- GIVEN an approved record
- WHEN the dashboard reloads
- THEN the approval trace entry still renders from `auditor_actions`

### Requirement: REQ-AUD-5 — Export gate and real export

Export MUST be gated while alerts are open (`strictExport`, default true): "Exportar a Oracle" renders disabled, and activating export with open alerts shows the `blocked` modal "Faltan {n} registros por resolver". Primary "Ver los pendientes" navigates to the filtered pending list; secondary "Cancelar" dismisses; "Exportar de todos modos" remains REMOVED. With zero open alerts, "Generar y descargar" MUST trigger the real export (per `oracle-export`): persisted `export_batches`/`export_lines` and a downloaded file — not a no-op modal. (RF-30, RF-31)

#### Scenario: Blocked modal buttons act as labelled

- GIVEN 3 open alerts
- WHEN the blocked modal is shown and "Ver los pendientes" is activated
- THEN the modal closes and the record list filters to "Requieren mirada" AND no "Exportar de todos modos" control exists

#### Scenario: Gate lifts and export is real

- GIVEN all alerts resolved
- WHEN "Exportar a Oracle" then "Generar y descargar" are activated
- THEN an `export_batches` row with its `export_lines` exists AND a file download is offered
