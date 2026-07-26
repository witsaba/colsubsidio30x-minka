# Delta for Auditor Dashboard

## MODIFIED Requirements

### Requirement: REQ-AUD-3 — Filters and badges

Filter chips MUST be "Requieren mirada · {n}", "Todos los registros", "Verificados", and MUST filter live records read from `count_records` and `record_anomalies` — the 8 hardcoded fixtures are retired. Soft-deleted records (`is_deleted = true`) MUST NOT count as pending nor render as active records. Each record MUST show its state badge: `Unidad` / `Cantidad atípica` / `Saldo negativo` (warn), `Verificado`, `Búsqueda manual` / `Sin novedad`.
(Previously: chips filtered a seeded set of 8 fixture records)

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
(Previously: trace entries were appended to in-memory record state only)

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
(Previously: the export modal was visual-only; confirming generated nothing)

#### Scenario: Blocked modal buttons act as labelled

- GIVEN 3 open alerts
- WHEN the blocked modal is shown and "Ver los pendientes" is activated
- THEN the modal closes and the record list filters to "Requieren mirada" AND no "Exportar de todos modos" control exists

#### Scenario: Gate lifts and export is real

- GIVEN all alerts resolved
- WHEN "Exportar a Oracle" then "Generar y descargar" are activated
- THEN an `export_batches` row with its `export_lines` exists AND a file download is offered
