# Extraction Adapter Specification

## Purpose

The seam where the non-existent Module 2 (extraction/ITN/consensus) will plug in. Tonight it is a deterministic MOCK that turns a verbatim STT transcript into structured items for the matcher. New capability — no prior spec.

## Requirements

### Requirement: REQ-EXT-1 — Adapter interface

The capability MUST expose `extract(rawTranscript: string): Promise<ExtractedItem[]>` where `ExtractedItem = { quantity: number, unit: string | null, spokenName: string }`. Callers MUST await the promise before building the matcher request. `spokenName`/`unit` map directly onto the matcher's `MatchRequest.spoken_name`/`unit`. (RF-14, RF-17)
(Previously: synchronous `extract(transcript: string): ExtractedItem[]`)

#### Scenario: Shape of an extracted item

- WHEN `await extract('cinco tablas para picar blancas')` resolves
- THEN it yields an array whose items each have numeric `quantity`, `unit` of type string-or-null, and non-empty `spokenName`

#### Scenario: Result is a promise

- WHEN `extract` is called with any transcript
- THEN the return value is a Promise resolving to the item array

### Requirement: REQ-EXT-2 — Spanish ITN, 90 vs 900

Spanish cardinal words MUST be converted to digits (RF-17). The 90-vs-900 distinction MUST hold: `"novecientos"` → `900` and `"noventa"` → `90`. This is the demo's anomaly trigger and MUST be asserted explicitly.

#### Scenario: novecientos is 900, not 90

- WHEN `extract('novecientos gramos de aceite de oliva extra virgen')` is called
- THEN it returns exactly 1 item with `quantity === 900` AND `unit === 'gramos'`

#### Scenario: noventa stays 90

- WHEN `extract('noventa gramos de aceite de oliva extra virgen')` is called
- THEN the item's `quantity === 90`

### Requirement: REQ-EXT-3 — Multi-item split

One utterance containing conjunctions/commas MUST split into N independent items, each with its own quantity/unit/name (RF-14). The design script MUST yield exactly 3 items.

#### Scenario: Demo script 1 yields three items

- WHEN `extract('tres kilos de lechuga batavia, doce botellas de aceite vegetal y dos cajas de tomate chonto')` is called
- THEN it returns exactly 3 items with quantities `[3, 12, 2]` AND spoken names covering lechuga batavia, aceite vegetal, and tomate chonto respectively

### Requirement: REQ-EXT-4 — Unit vocabulary bound to the extraction result

Emitted `unit` values MUST originate from the extraction result — the adapter MUST only emit units the extraction returned (spoken words for the mock; consensus `unidad` values for the HTTP adapter), resolved through the emission vocabulary anchored on the matcher's `UNIT_SYNONYMS`. Words outside that vocabulary MAY pass through as spoken — the matcher treats unresolved units as `None`, never an error — but the adapter MUST NOT invent a unit the extraction did not return.
(Previously: "never invent a unit word of its own" over verbatim spoken passthrough; the LLM now canonicalizes `producto`/`unidad` — accepted behavior change vs verbatim passthrough)

#### Scenario: Resolvable unit passes through

- GIVEN the mock adapter
- WHEN `await extract('dos cajas de tomate chonto')` resolves
- THEN the item's `unit === 'cajas'`, a word present in `UNIT_SYNONYMS`

#### Scenario: Utterance without a unit

- GIVEN the mock adapter
- WHEN `await extract('cinco tablas para picar blancas')` resolves
- THEN the item's `unit === null` AND `quantity === 5`

### Requirement: REQ-EXT-5 — Real adapter default, deterministic mock behind the swap point

The production default MUST be the real HTTP adapter. The deterministic mock (same transcript → same output, no randomness, no network) MUST remain injectable at the ONE existing swap point as the explicit test double and runtime fallback. The flow MUST depend only on the `extract` interface.
(Previously: the mock WAS the shipped implementation; the swap point awaited a future Module 2)

#### Scenario: Production default is the HTTP adapter

- GIVEN no adapter is explicitly injected
- WHEN the count flow wires extraction
- THEN the HTTP adapter is used

#### Scenario: Determinism of the mock

- WHEN the mock's `extract` is awaited twice with the same transcript
- THEN both results are deeply equal

#### Scenario: Swappability

- GIVEN a stub adapter substituted at the swap point
- WHEN the count flow processes a transcript
- THEN the stub's output reaches the matcher request unchanged AND no code path references the mock directly

### Requirement: REQ-EXT-6 — HTTP adapter response mapping

The HTTP adapter MUST POST `{ transcription: rawTranscript }` to `/api/extract` and map each `validated_inventory` item as: `producto` → `spokenName`, `unidad` (enum `KILOGRAMO|UNIDAD|PORCION|LITRO`, lowercased then resolved through the emission vocabulary) → `unit`, `cantidad` → `quantity`. Items with non-positive or NaN `cantidad`, or empty/blank `producto`, MUST be dropped — never guessed or repaired. `consensus_status` and `confidence_score` MAY be ignored for the MVP; only `validated_inventory` is consumed.

#### Scenario: Successful mapping

- GIVEN `/api/extract` responds 200 with `validated_inventory: [{producto: "Lechuga Batavia", unidad: "KILOGRAMO", cantidad: 3}]`
- WHEN `await extract(...)` resolves
- THEN it yields exactly `[{quantity: 3, unit: 'kilogramo', spokenName: 'Lechuga Batavia'}]`

#### Scenario: Invalid items are dropped

- GIVEN a response mixing valid items with items having `cantidad` of `0`, `-1`, or `NaN`, or blank `producto`
- WHEN the adapter maps the response
- THEN only the valid items are returned AND no dropped item is repaired or guessed

#### Scenario: Empty inventory is not a failure

- GIVEN a successful consensus response with empty `validated_inventory`
- WHEN `await extract(...)` resolves
- THEN it yields `[]` AND the flow follows the normal `nothing_extracted` path, NOT the fallback

### Requirement: REQ-EXT-7 — Fallback-on-error to the mock

Any transport failure, timeout, non-2xx status, or unparsable body from the extract call MUST make the adapter fall back to the deterministic mock for that utterance. The failure MUST NOT surface an error to the operator and MUST NOT render a degraded-mode indicator (recorded orchestrator decision).

#### Scenario: Timeout falls back

- GIVEN the extract call exceeds its timeout
- WHEN the utterance is processed
- THEN the mock's output for that transcript is used AND the utterance completes normally

#### Scenario: Upstream 5xx falls back silently

- GIVEN `/api/extract` responds 502
- WHEN the utterance is processed
- THEN the mock's output is used AND no error state or visual indicator reaches the operator
