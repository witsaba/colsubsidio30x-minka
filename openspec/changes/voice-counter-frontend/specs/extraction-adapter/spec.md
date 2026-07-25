# Extraction Adapter Specification

## Purpose

The seam where the non-existent Module 2 (extraction/ITN/consensus) will plug in. Tonight it is a deterministic MOCK that turns a verbatim STT transcript into structured items for the matcher. New capability — no prior spec.

## Requirements

### Requirement: REQ-EXT-1 — Adapter interface

The capability MUST expose `extract(transcript: string): ExtractedItem[]` where `ExtractedItem = { quantity: number, unit: string | null, spokenName: string }`. `spokenName`/`unit` map directly onto the matcher's `MatchRequest.spoken_name`/`unit`. (RF-14, RF-17; mocks RF-23/RF-24)

#### Scenario: Shape of an extracted item

- WHEN `extract('cinco tablas para picar blancas')` is called
- THEN it returns an array whose items each have numeric `quantity`, `unit` of type string-or-null, and non-empty `spokenName`

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

### Requirement: REQ-EXT-4 — Unit vocabulary bound to the matcher

Emitted `unit` values MUST be drawn from spoken words the matcher already resolves (`services/matcher/src/matcher/units.py` `UNIT_SYNONYMS`: litro(s)/lt/lts/l, kilo(s)/kilogramo(s)/kg/kgs, unidad(es)/und/un, paquete(s), sobre(s), caja(s), porcion(es), racion(es)). Words outside that vocabulary (e.g. `gramos`, `botellas`) MAY pass through as spoken — the matcher treats unresolved units as `None`, never an error — but the adapter MUST NOT invent new unit words of its own.

#### Scenario: Resolvable unit passes through

- WHEN `extract('dos cajas de tomate chonto')` is called
- THEN the item's `unit === 'cajas'`, a word present in `UNIT_SYNONYMS`

#### Scenario: Utterance without a unit

- WHEN `extract('cinco tablas para picar blancas')` is called
- THEN the item's `unit === null` AND `quantity === 5`

### Requirement: REQ-EXT-5 — Deterministic mock behind a swap point

The shipped implementation is a MOCK: deterministic (same transcript → same output, no randomness, no network) and keyword-tolerant for the 4 demo scripts. The flow MUST depend only on the `extract` interface, injected at ONE swap point (the module that wires extraction into the count flow), so a real Module 2 replaces the mock without touching callers.

#### Scenario: Determinism

- WHEN `extract` is called twice with the same transcript
- THEN both results are deeply equal

#### Scenario: Swappability

- GIVEN a stub adapter substituted at the swap point
- WHEN the count flow processes a transcript
- THEN the stub's output reaches the matcher request unchanged AND no code path references the mock directly
