# Operator Count Flow Specification

## Purpose

The `/conteo` operator experience: S1–S9 state machine, overlays, blind counting, anomaly block, record list, and finish-count. New capability — no prior spec. UI copy is verbatim Colombian Spanish from the design contract.

## Requirements

### Requirement: REQ-OCF-1 — State machine

The flow MUST be modeled as `screen ∈ {permiso, plans, count, done}` × `overlay ∈ {null, processing, confirm, anomaly, search, exclude}`. Overlays open only over `count`. (CU-03)

#### Scenario: Legal transitions only

- GIVEN `screen === 'plans'`
- WHEN "Iniciar conteo" is tapped
- THEN state becomes `{screen:'count', overlay:null}` AND no overlay can be opened from `permiso` or `done`

### Requirement: REQ-OCF-2 — Blind counting invariant

No operator screen or overlay — INCLUDING the confirmation sheet — may ever display theoretical/system stock. This is an invariant over the whole `/conteo` render tree. (RF-18, QA-12)

#### Scenario: System stock never renders

- GIVEN records whose auditor-side data includes system quantities
- WHEN any operator screen/overlay renders
- THEN the rendered output contains no system/theoretical stock value AND the footer reads "Conteo ciego: nunca verás el stock del sistema."

### Requirement: REQ-OCF-3 — Confirmation before persist

Every extracted result MUST pass a yes/no confirmation sheet before a record is created: buttons "Repetir" and "Confirmar" only. The sheet reveals no prior stock. (RF-33, QA-22)

#### Scenario: Confirmar creates, Repetir discards

- GIVEN the confirm overlay shows 3 item cards
- WHEN "Confirmar" is tapped THEN 3 records are appended
- WHEN instead "Repetir" is tapped THEN no record is created and the mic returns to idle

### Requirement: REQ-OCF-4 — Voice creates only

Voice MUST only CREATE records — never edit, never delete. Correction is delete-then-redictate via touch on the record row. Each confirmed record MUST persist as a `count_records` row; delete-then-redictate MUST mark the old row `is_deleted = true` and persist the redictation as a NEW row — never an in-place UPDATE of counted values. (RF-20, RF-21, QA-13, QA-14)

#### Scenario: No voice mutation path

- GIVEN an existing record
- WHEN any dictation is processed
- THEN existing records are unchanged AND deletion is available only through the touch UI

#### Scenario: Redo persists as soft-delete plus new row

- GIVEN a persisted record
- WHEN the operator deletes it and redictates
- THEN the old `count_records` row has `is_deleted = true` AND the redictation is a new row

### Requirement: REQ-OCF-5 — Anomaly flag and preventive block

An anomaly MUST render the orange flag state (`flag` `#d9631a`) and block the mic (banner "Micrófono en pausa hasta resolver el registro señalado.", hint "Resuelve el registro señalado para seguir contando.") until resolved via "Eliminar y volver a dictar" or "Es correcto · dejar nota al auditor". The block MUST NOT cut an in-flight recording. (RF-28, RF-29)

#### Scenario: Mic disabled until resolved

- GIVEN a record flagged `anom`
- WHEN the operator tries `pointerdown` on the mic
- THEN no recording starts AND after resolving the anomaly the mic is enabled again

### Requirement: REQ-OCF-6 — Match status routing

`matched` MUST open the confirm sheet. `ambiguous` AND `no_match` MUST open the manual-search sheet (S7) listing the matcher's candidates, with adjusted copy for `ambiguous`; `no_match` copy: "No encontré "{query}" en esta bodega. ¿Cuál es?". Footer "Ninguno · volver a dictar" returns to idle. (RF-15, RF-16)

#### Scenario: Ambiguous goes to search, not confirm

- GIVEN a matcher response with `status:'ambiguous'` and 3 candidates
- WHEN the flow routes the result
- THEN the search sheet opens showing those candidates AND the confirm sheet does not

### Requirement: REQ-OCF-7 — Unit and SKU rendering

Live units MUST render ONLY via `unidad_display` (`kg`, `litros`, `unidades`, `porciones`). English canonical units (`Kilogram`, `Liter`, `Unidad`, `Portion`) MUST NEVER appear. A null unit renders as absent — never coerced. A null `nr_articulo` renders the SKU line without a code. `stt_confidence: null` and `audio_duration_ms: null` MUST never render as 0 or "failed". (QA-05, QA-10)

#### Scenario: Null fields render honestly

- GIVEN a candidate `{nr_articulo:null, unidad:null, unidad_display:null}`
- WHEN its card renders
- THEN no unit text and no code appear AND the string "Kilogram"/"Liter" appears nowhere in the DOM

### Requirement: REQ-OCF-8 — Plan-based selection

Plan selection MUST list the operator's assigned plans read from `audit_plans`/`plan_operators` (per REQ-SDA-3), not a raw warehouse/catalogue listing. Each plan MUST carry the real `catalogue_id` used to build match requests. Selecting or counting against a plan not assigned to the operator MUST be rejected at the route level. (RF-11, RF-07)

#### Scenario: Selected plan carries a real catalogue_id

- WHEN a plan is selected and a match request is built
- THEN `catalogue_id` is the real catalogue id bound to that plan

#### Scenario: Only assigned plans are offered

- GIVEN plans assigned to other operators exist
- WHEN the plan screen renders
- THEN only the identified operator's plans are listed

### Requirement: REQ-OCF-9 — Finish-count control (design gap, authored)

A "Terminar conteo" control MUST exist on `count` — the design has none, yet `done` (S9) is unreachable without it. Tapping it MUST transition to `{screen:'done'}`.

#### Scenario: Reaching S9

- GIVEN `screen === 'count'` with ≥1 record and no open anomaly
- WHEN "Terminar conteo" is activated
- THEN `screen === 'done'` and the summary screen renders

### Requirement: REQ-OCF-10 — C1 corrected consent copy

The consent screen's "Cuánto se conserva" row MUST state audio is NOT stored. The design's "El audio se guarda 12 meses como soporte de auditoría y luego se elimina." MUST be replaced by exactly: "El audio no se guarda: se transmite para transcribirlo y se descarta al instante. Solo se conserva la transcripción de lo que dictas." Accepting consent MUST persist a `voice_consents` row (per REQ-SDA-2) before the flow advances. (RNF-04, Ley 1581, RF-22, S1)

#### Scenario: No retention claim survives

- WHEN the consent screen renders
- THEN the corrected copy above is present verbatim AND the string "12 meses" appears nowhere

#### Scenario: Acceptance writes consent

- GIVEN the operator taps accept
- WHEN the flow advances to `plans`
- THEN a `voice_consents` row exists for that acceptance

### Requirement: REQ-OCF-11 — C2 no offline claim or behaviour

The UI MUST NOT claim offline capability ("Funciona sin señal" is dropped; RNF-08 removed) and MUST NOT implement offline sync. The `sync` record state MAY appear only as in-session "pending upload".

#### Scenario: No offline copy

- WHEN all operator screens render
- THEN the string "Funciona sin señal" appears nowhere

### Requirement: REQ-OCF-12 — Promise-driven processing state

The processing overlay MUST be driven by the real request promise and remain credible for up to 45 s (STT worst case). It MUST NOT use the prototype's fixed 1700 ms timer in the real path. STT/proxy errors MUST resolve to an authored error state offering retry, not a hang. (RNF-02, RNF-11)

#### Scenario: 45 s wait stays coherent

- GIVEN a transcribe request that resolves after 45 s
- WHEN the processing overlay is shown
- THEN it remains visible with its indicator until resolution AND then routes to confirm/anomaly/search/error accordingly

### Requirement: REQ-OCF-13 — Session state persists across reload

Consent, records, and anomaly flags MUST be backed by the operational tables (via `supabase-data-access` / `anomaly-validation`), not reducer-only state; reloading `/conteo` mid-count MUST restore the persisted records of the active plan session.

#### Scenario: Records survive reload

- GIVEN 3 confirmed records in a count session
- WHEN the page reloads and the session resumes
- THEN the same 3 records render from `count_records`
