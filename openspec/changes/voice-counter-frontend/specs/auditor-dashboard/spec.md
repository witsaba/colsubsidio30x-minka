# Auditor Dashboard Specification

## Purpose

The `/auditor` tablet-first dashboard: live review pane, close/base shells, modals, export gating, and trace. New capability — no prior spec. UI copy is verbatim Colombian Spanish from the design contract.

## Requirements

### Requirement: REQ-AUD-1 — Three views

The dashboard MUST provide `review` (live, three-pane: warehouses 286px / records / detail 352px), `close`, and `base`. `close` and `base` MAY ship tonight as static shells matching the design. (RF-08, RF-09 partial)

#### Scenario: Navigation between views

- GIVEN the nav rail with Revisión / Cierre / Base
- WHEN each item is activated
- THEN the corresponding view renders with its header title ("Cocina Principal · revisión" / "Cierre y exportación" / "Base de datos y equipo")

### Requirement: REQ-AUD-2 — Auditor may see theoretical stock

The detail pane MUST show "Contado" vs "Sistema" side-by-side with the diff line ("Sin diferencia" / "Unidad distinta" / "Diferencia"). Blind counting binds the OPERATOR only — this view is correct as designed. (RF-18 scope, C6)

#### Scenario: Contado vs Sistema renders

- GIVEN the seeded record `900 g ACEITE DE OLIVA EXTRA VIRGEN 500ML` with system `4 L`
- WHEN it is selected
- THEN both counted and system values are visible in the detail pane

### Requirement: REQ-AUD-3 — Filters and badges

Filter chips MUST be "Requieren mirada · {n}", "Todos los registros", "Verificados", and MUST filter the seeded 8 records. Each record MUST show its state badge: `Unidad` / `Cantidad atípica` / `Saldo negativo` (warn), `Verificado`, `Búsqueda manual` / `Sin novedad`.

#### Scenario: Requieren mirada shows only open alerts

- GIVEN the 8 seed records with 3 open alerts
- WHEN "Requieren mirada · 3" is selected
- THEN exactly the 3 alert records render

### Requirement: REQ-AUD-4 — Actions leave a trace

Actions "Aprobar registro", "Corregir", "Pedir reconteo" MUST each append a trace entry (user, time, action) to the record, per "Toda acción queda firmada con usuario, hora y motivo." Approving an alerted record MUST mark it "Verificado" and decrement the open-alert count. (RF-32)

#### Scenario: Approve decrements the alert pill

- GIVEN 3 alertas abiertas
- WHEN "Aprobar registro" is confirmed on an alerted record
- THEN the record's badge becomes "Verificado" AND the header pill shows "2 alertas abiertas" AND a trace entry exists

### Requirement: REQ-AUD-5 — Export gate and corrected blocked modal

Export MUST be gated while alerts are open (`strictExport`, default true): "Exportar a Oracle" renders disabled, and activating export with open alerts shows the `blocked` modal "Faltan {n} registros por resolver". The design's inverted wiring MUST be corrected: primary "Ver los pendientes" navigates to the filtered pending list; secondary "Cancelar" dismisses; "Exportar de todos modos" is REMOVED (the strict gate is the honest behaviour). With zero open alerts, export MUST show the `export` modal ("Generar archivo de carga"). (RF-30 visual, RF-31)

#### Scenario: Blocked modal buttons act as labelled

- GIVEN 3 open alerts
- WHEN the blocked modal is shown and "Ver los pendientes" is activated
- THEN the modal closes and the record list filters to "Requieren mirada" AND no "Exportar de todos modos" control exists

#### Scenario: Gate lifts when alerts reach zero

- GIVEN all alerts resolved
- WHEN "Exportar a Oracle" is activated
- THEN the export modal opens with "Generar y descargar" enabled
