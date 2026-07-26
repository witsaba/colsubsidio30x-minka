# Delta for Operator Count Flow

## ADDED Requirements

### Requirement: REQ-OCF-13 — Session state persists across reload

Consent, records, and anomaly flags MUST be backed by the operational tables (via `supabase-data-access` / `anomaly-validation`), not reducer-only state; reloading `/conteo` mid-count MUST restore the persisted records of the active plan session.

#### Scenario: Records survive reload

- GIVEN 3 confirmed records in a count session
- WHEN the page reloads and the session resumes
- THEN the same 3 records render from `count_records`

## MODIFIED Requirements

### Requirement: REQ-OCF-4 — Voice creates only

Voice MUST only CREATE records — never edit, never delete. Correction is delete-then-redictate via touch on the record row. Each confirmed record MUST persist as a `count_records` row; delete-then-redictate MUST mark the old row `is_deleted = true` and persist the redictation as a NEW row — never an in-place UPDATE of counted values. (RF-20, RF-21, QA-13, QA-14)
(Previously: same voice-create-only rule, but records were in-memory only with no persistence semantics)

#### Scenario: No voice mutation path

- GIVEN an existing record
- WHEN any dictation is processed
- THEN existing records are unchanged AND deletion is available only through the touch UI

#### Scenario: Redo persists as soft-delete plus new row

- GIVEN a persisted record
- WHEN the operator deletes it and redictates
- THEN the old `count_records` row has `is_deleted = true` AND the redictation is a new row

### Requirement: REQ-OCF-8 — Plan-based selection

Plan selection MUST list the operator's assigned plans read from `audit_plans`/`plan_operators` (per REQ-SDA-3), not a raw warehouse/catalogue listing. Each plan MUST carry the real `catalogue_id` used to build match requests. Selecting or counting against a plan not assigned to the operator MUST be rejected at the route level. (RF-11, RF-07)
(Previously: selection listed the 8 real matcher catalogues directly, with the RF-11 limitation stated)

#### Scenario: Selected plan carries a real catalogue_id

- WHEN a plan is selected and a match request is built
- THEN `catalogue_id` is the real catalogue id bound to that plan

#### Scenario: Only assigned plans are offered

- GIVEN plans assigned to other operators exist
- WHEN the plan screen renders
- THEN only the identified operator's plans are listed

### Requirement: REQ-OCF-10 — C1 corrected consent copy

The consent screen's "Cuánto se conserva" row MUST state audio is NOT stored. The design's "El audio se guarda 12 meses como soporte de auditoría y luego se elimina." MUST be replaced by exactly: "El audio no se guarda: se transmite para transcribirlo y se descarta al instante. Solo se conserva la transcripción de lo que dictas." Accepting consent MUST persist a `voice_consents` row (per REQ-SDA-2) before the flow advances. (RNF-04, Ley 1581, RF-22, S1)
(Previously: same corrected copy, but acceptance only advanced local state without persistence)

#### Scenario: No retention claim survives

- WHEN the consent screen renders
- THEN the corrected copy above is present verbatim AND the string "12 meses" appears nowhere

#### Scenario: Acceptance writes consent

- GIVEN the operator taps accept
- WHEN the flow advances to `plans`
- THEN a `voice_consents` row exists for that acceptance
