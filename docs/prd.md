# PRD — Voice Inventory Counter

**Hospitality Challenge · Hackathon Colsubsidio x 30X · July 2026**

| Field | Value |
| --- | --- |
| Version | 1.0 — for approval at the team meeting |
| Date | 2026-07-24 |
| Status | Draft for approval |
| Team | Braejan Arias, Daniel Rosas (technical implementation) · Adriana Durand, Edith Lavado (documentation, use cases, QA) |
| Anchor | Agreements reached in "Let's define the flow and tech", 2026-07-23 |

**Sources — all present in this repository under `docs/sources/`:**

| Source | Repo path |
| --- | --- |
| Meeting "Let's define the flow and tech" (23 Jul 2026) | [`docs/sources/meet-define-project.md`](sources/meet-define-project.md) |
| PRD draft, Spanish (basis for this document) | [`docs/sources/prd-draft-es.md`](sources/prd-draft-es.md) |
| Anexo PRD — requirements, use cases, QA plan | [`docs/sources/anexo-prd-draft.docx`](sources/anexo-prd-draft.docx) |
| Double Diamond — Problem and Solution | [`docs/sources/doble-diamante-problema-solucion.docx`](sources/doble-diamante-problema-solucion.docx) |
| Discovery — Consolidated (Hospitality Challenge) | [`docs/sources/discovery-consolidado.xlsx`](sources/discovery-consolidado.xlsx) |
| Dataset BODEGAS Y STOCK | [`docs/sources/bodegas-y-stock.xlsx`](sources/bodegas-y-stock.xlsx) |

Client statements marked `[CLIENT]` come from Colsubsidio's answers in the challenge Q&A channel,
22–24 Jul. The channel transcript is deliberately not vendored here: it is a shared group with many
third-party participants, and republishing it would expose their personal data. Only the answers
Colsubsidio gave about the process are carried forward, in §11.

Companion document: [`docs/prd-seed.md`](prd-seed.md) — the traceable extraction of the 23 Jul meeting,
with transcript timestamps. Use it to settle any dispute about what was actually agreed.

---

## 0. Provenance conventions

This PRD merges three inputs of different evidential weight. Where they diverge, the marker says so.

| Marker | Meaning |
| --- | --- |
| `[MEETING]` | Agreed in the 23 Jul meeting. Traceable to a transcript timestamp in `prd-seed.md` |
| `[CLIENT]` | Stated by Colsubsidio in the challenge Q&A channel, 22–24 Jul. Verified against the original answers at the time of writing |
| `[DATASET]` | Derived from analysis of `bodegas-y-stock.xlsx` in the source draft. **Not re-verified in this repo** — no spreadsheet tooling was available. Treat the percentages as the draft's figures, pending recomputation |
| `[TEAM]` | Introduced by the team in the PRD draft, beyond what the meeting or the client stated. Legitimate, but not yet ratified |

Anything the sources left unresolved appears in §13 as an open question rather than being filled in
with a plausible answer.

---

## 1. Executive summary

At every month end, the costing team at Colsubsidio's hotels and parks performs the physical
inventory count on paper: one person counts and writes, another types it into Oracle, and a third
verifies. That manual step is where errors are born — 90 vs 900, grams vs kilos, illegible
handwriting — along with roughly two days of latency before the figure reaches the system.

**Voice Inventory Counter** replaces "paper + retyping" with push-to-talk voice capture on a
corporate tablet. The operator dictates what they count; the AI extracts
`{product, quantity, unit}`, validates it by three-model consensus, cross-checks it asynchronously
against the warehouse catalogue and history, and accumulates clean records. The auditor administers
everything from a web platform: uploads the base Excel, creates audit plans, resolves anomalies, and
exports a file compatible with Oracle My Inventory.

The tool does not replace the ERP. It feeds it correct data the first time.

---

## 2. Context and problem

### 2.1 Current situation

- `[CLIENT]` The process is fully analogue. The system generates the product listing **without
  quantities**, so the count can be filled in; staff count and write by hand, and another person
  types it into Oracle My Inventory.
- `[CLIENT]` A "counter + typist" duality duplicates effort, and **the auditor recounts the entire
  inventory** as a second verification — "the count is done twice, the same procedure of counting
  in person and reporting".
- `[CLIENT]` Both the first counter and the auditor walk the same zones in the same order, because
  products are always in the same place and order.
- `[TEAM]` Roughly two days of latency between the physical count and the figure landing in the
  system → no real-time inventory.
- `[TEAM]` Scale: 48 warehouses at Piscilago, 107+ items per warehouse; Food & Beverage handles more
  references still. Heterogeneous categories: sealed, open (fractional weighing), recipe-transformed,
  chemicals, zoo supplies.
- `[DATASET]` Evidence in the real dataset: ~5.6% negative balances (imbalances), ~18% of items
  without a unique code, ~23% with decimals (weighing), and mixed units (Unit / Kg / L / Portion).
- `[CLIENT]` Constraints: personal mobile phones are prohibited; corporate tablets are available and
  confirmed; blind counting; output must be compatible with Oracle; logic must be explainable, not a
  black box.

### 2.2 Problem statement

Colsubsidio's warehouse staff capture the physical count on paper and type it into Oracle afterwards.
This two-step process is slow (up to two days of latency), prone to human error (with critical cases
such as 90 vs 900 kg), and requires double validation — which makes reliable real-time inventory
impossible.

### 2.3 Guiding question

How might we capture the physical count at the point of work — without paper and without subsequent
retyping — producing a reliable, validated and traceable figure, ready to load into Oracle?

---

## 3. Objectives and success metrics

| Objective | Metric | Target |
| --- | --- | --- |
| Eliminate capture error | Pipeline error rate | < 1% (three-model consensus ≈ 99.9%) |
| Reduce data latency | Count → data available | Minutes, not days |
| Fast capture | Latency per voice note | ≤ 20–30 s |
| Frictionless adoption | Self-service onboarding | ≤ 5 min |
| Feed the ERP | Export importable into Oracle My Inventory | No manual adjustment |

> `[TEAM]` These targets originate with the team, except the < 1% error tolerance and the three-model
> consensus figure, which are `[MEETING]` decisions. **The economic cost of the current errors was
> asked of Colsubsidio and never answered** (§13.9) — so no baseline exists to measure improvement
> against.

---

## 4. MVP scope

**In scope (Saturday demo):** Excel upload as the database; data characterisation and approval; audit
plan per warehouse; user management; push-to-talk voice capture in the operator app; extraction of
`{product, quantity, unit}`; three-model consensus; asynchronous validation with anomaly alerting;
correction by delete-and-redo; manual product search; export in Oracle format.

**Nice to have (if time allows):** OCR via the Gemini API; polished reconciliation report; interactive
onboarding; statistical comparison signals across operators.

**Explicitly out of scope:**

| Item | Basis |
| --- | --- |
| Direct Oracle ERP integration | `[MEETING]` + `[CLIENT]` — Colsubsidio explicitly recommends focusing on speeding up capture; integration would be built with them if the project wins |
| Internal warehouse section/zone mapping | `[MEETING]` — feasible but adds unnecessary complexity at this stage; layout is volatile |
| Editing or deleting records by voice | `[MEETING]` — see §6.2 |
| Expiry / disposal records (`actas`) | `[MEETING]` — not contemplated; pending confirmation with the manager |
| Kitchen orders, recipes, menus | `[TEAM]` |
| Supplier purchasing | `[TEAM]` — the client confirmed purchasing questions raised in the group are out of the challenge's scope |

---

## 5. Users and roles

**Operator** (app on tablet). Counts the warehouse by dictating with push-to-talk. Works standing,
hands occupied, in an environment with operational activity — `[CLIENT]` noise is not expected to be
significant beyond typical daily operation. Needs a self-service tool that does not force them to put
down the product to write. Only accesses the audit plans they were assigned to. Never sees theoretical
stock (blind counting).

**Auditor** (web platform). Configures the tool (uploads the Excel, approves the characterisation),
creates audit plans, manages users, creates new products, reviews records and anomalies,
approves/declines/corrects, and generates the export and reports.

`[MEETING]` The auditor does **not** have the operational capacity to review an entire warehouse
inventory; the role reviews inconsistencies and specific incidents. `[CLIENT]` Today the auditor
recounts everything the first person reported. The tool's contribution is to let the auditor
prioritise by anomaly instead of recounting 100%.

`[MEETING]` Both roles access the **same** information and interact with it differently. This is a
separation of interaction, not of data.

> **`[MEETING]` Open — is there a third role?** It is unknown whether the auditor assigns operators to
> warehouses or whether a warehouse supervisor does. Working assumption: the auditor assigns. The
> audit-plan design is agnostic to who assigns, so this does not block the MVP. See §13.1.

---

## 6. Solution and architecture decisions

### 6.1 End-to-end flow

1. **Setup** (auditor, web) — upload `BODEGAS Y STOCK.xlsx` → the system characterises warehouses,
   SKUs and units, and computes per-product statistical parameters (expected range, canonical unit) →
   the auditor reviews and approves.
2. **Audit plan** (auditor, web) — select **one** warehouse, define the period, assign authorised
   operators.
3. **Count** (operator, tablet) — choose the plan → the catalogue for that warehouse loads → hold
   push-to-talk and dictate ("3 kilos of lettuce… 12 bottles of oil") → release, and the audio is
   processed.
4. **Extraction** (AI engine) — transcription → ITN ("novecientos" → 900) → multi-item split → three
   models in parallel return `{product, quantity, unit, warehouse}` as JSON → if they agree it is
   validated, otherwise reprocessed → SKU match against the catalogue (fuzzy matching; fallback to
   manual search).
5. **Asynchronous validation** (trigger) — does the product exist in this warehouse? Does the unit
   correspond? Is the quantity reasonable versus history? Does it produce a negative balance? →
   anomaly = orange warning + preventive block, raised after the in-flight audio finishes.
6. **Correction** (operator) — delete and redo. Remove the record with a touch action and dictate it
   again. Voice never edits and never deletes.
7. **Review** (auditor) — on site: approve/decline/correct. In office: the operator resolves and the
   auditor receives a report with full traceability.
8. **Close** — export in Oracle format (Import Count Sequences style) + reconciliation report + audit
   trail.

### 6.2 Agreed technical decisions

All of the following are `[MEETING]` decisions from 23 Jul.

| Decision | Rationale |
| --- | --- |
| Two interfaces: operator app + auditor web | Two users with opposing needs — ingestion speed vs. review and approval |
| **Push-to-talk, not real-time audio** | Real-time carries a high error rate, technical difficulty, and human interference — side conversations the model cannot filter. Also token cost |
| **Three-model consensus returning JSON** | A single model ran ≈82% effective in the participant's prior work; consensus raises precision to ≈99.92%. Technique borrowed from aerospace calculation redundancy |
| **Asynchronous validation via trigger** | Does not interrupt the operator's recording flow |
| **Voice creates records only; correction = delete + re-record** | Granting the model create/replace/edit/delete multiplies the error surface, and arithmetic is where hallucinations bite |
| **Excel as source of truth; no ERP integration** | The tool must be autonomous — "a tool that doesn't allow Excel upload, nobody will use" |
| Supabase as the MVP database | Migrate the inventory structure to validate visualisation and functionality |
| **Voice is not stored** | Cloning risk from a few seconds of audio; with no persistence there is no significant legal exposure. See the caveat in §8, RNF-04 |
| Voice notes of limited duration | Controls processing cost and error rate |
| ISO 27001 as the documented security framework | Added value for the final presentation; the client visibly cares about information security |
| OCR via Gemini API as nice-to-have only | Validating a voice model and an OCR model in the same window works against the schedule |

### 6.3 Design principles

Carried from the meeting reasoning; they explain most of the constraints above.

1. **Constrain the AI's action surface.** Fewer verbs, fewer variables, fewer hallucinations.
2. **Constrain the user's option surface.** Pre-assigned audit plans instead of free warehouse
   selection — "the fewer options the person has, the much better".
3. **Never block the operator's flow.** Validation is asynchronous; warnings interrupt at a safe
   boundary, never mid-recording.
4. **Redundancy over trust.** Three models must agree before a record counts as correct.
5. **Adapt to natural behaviour.** Counting follows an order, but anomalies are common — the tool
   accommodates how people actually count.
6. **Deliberately narrow scope, expand if time allows.**

---

## 7. Functional requirements

IDs are identical to the Spanish draft in `docs/sources/prd-draft-es.md`, so the two remain
cross-referenceable.

### 7.1 Administration module — Auditor (web)

| ID | Requirement | Priority |
| --- | --- | --- |
| RF-01 | Upload an inventory Excel that acts as the database (warehouses, SKUs, products, canonical unit, history). Without this the tool is not viable | Must |
| RF-02 | On upload, characterise the data: warehouses, points of sale / hotels, and SKU counts, for auditor validation and approval | Must |
| RF-03 | On initial load, compute per-product statistical parameters (expected range, canonical unit) as input to anomaly detection | Must |
| RF-04 | The auditor can create products absent from the initial base (description, unit, warehouse). **The AI never creates products** | Must |
| RF-05 | User management: create, enable and disable operators under the auditor | Must |
| RF-06 | Create an audit plan bound to **exactly one warehouse**, with a period and authorised operators | Must |
| RF-07 | Restrict operator access strictly to the plans they were assigned | Must |
| RF-08 | Display all records per operator, with anomalies flagged | Must |
| RF-09 | Two anomaly-resolution flows: auditor on site (approve/decline/correct) and auditor in office (operator resolves, auditor receives a traceable report) | Should |
| RF-10 | Statistical comparison signals across operators (e.g. warnings per operator) to prioritise auditing | Should |

### 7.2 Voice ingestion module — Operator (tablet app)

| ID | Requirement | Priority |
| --- | --- | --- |
| RF-11 | The operator selects an **audit plan**, not a loose warehouse; the plan determines the warehouse and its catalogue | Must |
| RF-12 | Push-to-talk capture (record–release–process), not real-time audio | Must |
| RF-13 | Cap the duration of each voice note (cost and processing error) | Must |
| RF-14 | Split an audio containing multiple items into independent records ("2 kg of tomato, 4 of potato and 3 of lettuce" → 3 records) | Must |
| RF-15 | The AI identifies product, quantity and unit, and matches the SKU against the warehouse catalogue, tolerating colloquial names — `[CLIENT]` example: "tabla para picar blanca" → `TABLA ACRILICA PICAR BLANCO 50X38CM FB` | Must |
| RF-16 | On no match, offer manual search and selection | Must |
| RF-17 | Inverse Text Normalisation: "novecientos" → 900, neutralising the 90 vs 900 failure | Must |
| RF-18 | Blind counting: never show theoretical stock to the operator — `[CLIENT]` consistent with today's process, where the listing is generated without quantities | Must |
| RF-19 | Records accumulate in a clean list visible on screen | Must |
| RF-20 | Voice is used **only** to create records; it never edits and never deletes | Must |
| RF-21 | Correction by delete-and-redo: remove the record with a touch action and dictate it again | Must |
| RF-22 | Onboarding that teaches correct dictation (paced, clear pattern) and states the maximum tested capacity | Should |
| RF-33 | **`[MEETING]`** Before a record is persisted, show the extracted data for the operator to confirm, retry or correct. Confirmation must not reveal prior stock and is limited to yes/no, so the count is not steered | Must |

> RF-33 is added here. It was agreed in the meeting (visual confirmation before sending, and
> bias-free confirmation questions) but does not appear in the Spanish draft, where it is only
> partially implied by RF-19 and RNF-11.

### 7.3 AI engine, validation and anomalies

| ID | Requirement | Priority |
| --- | --- | --- |
| RF-23 | Process the audio with three AI models in parallel, each returning `{product, quantity, unit, warehouse}` as JSON | Must |
| RF-24 | If the three JSONs agree, the record is validated; on discrepancy, reprocess the audio | Must |
| RF-25 | Validate against the database and history asynchronously (event trigger), without blocking the next recording | Must |
| RF-26 | Validation checks: (a) does the product exist in this warehouse? (b) does the unit correspond to the product — block grams↔kilos? (c) is the quantity reasonable versus history? (d) does the count create or carry a negative balance? — `[CLIENT]` the negatives were explicitly flagged as a "mini challenge" worth validating | Must |
| RF-27 | Distinguish **warning** (requires attention) from **error** (invalid data). Anomalies are warnings | Must |
| RF-28 | On anomaly: flag in orange and apply a preventive block that takes the operator to the affected record before another audio is allowed | Must |
| RF-29 | The block never cuts the in-flight audio; it waits for the current recording to finish | Should |

### 7.4 Reports and export

| ID | Requirement | Priority |
| --- | --- | --- |
| RF-30 | Generate a downloadable file compatible with Oracle My Inventory (Excel/CSV, Import Count Sequences style) | Should |
| RF-31 | Reconciliation report: counted vs. system, differences, recurring imbalances | Should |
| RF-32 | Audit trail per record (who, when, which plan, which anomalies) | Should |

---

## 8. Non-functional requirements

| ID | Category | Requirement | Target |
| --- | --- | --- | --- |
| RNF-01 | Accuracy | Pipeline error rate below the paradigm-shift threshold | < 1%; three-model consensus ≈ 99.9% |
| RNF-02 | Performance | Record-creation latency after releasing the audio | ≤ 20–30 s per voice note |
| RNF-03 | Performance | Asynchronous validation must not degrade the recording experience | Operator keeps recording while the trigger runs |
| RNF-04 | Security | Voice is not stored. If it is stored in future: anonymise (lower frequencies) or encrypt, with worker consent | No audio persistence in the MVP |
| RNF-05 | Security | Secure channels and encryption aligned to ISO 27001, documented for the pitch | Documented |
| RNF-06 | Usability | Low, self-service learning curve; hands-free | Onboarding ≤ 5 min |
| RNF-07 | Compatibility | Runs on a corporate tablet — `[CLIENT]` personal phones prohibited, tablets confirmed and currently unused for this process | Tablet + microphone |
| RNF-08 | Availability | Offline-first / tolerant of intermittent connectivity; syncs on reconnect | Capture without network, deferred sync |
| RNF-09 | Autonomy | Operates independently of the ERP; the source of truth is the uploaded Excel | No direct Oracle integration |
| RNF-10 | Scalability | Scales from 1–2 sample warehouses to the whole network without redesign | Multi-warehouse architecture |
| RNF-11 | Explainability | The user always sees and validates the figure; not a black box | Visible confirmation |
| RNF-12 | Cost | Bounded audios and initial parameters that reduce hallucination | Compensation-fund budget |
| RNF-13 | Traceability | Every inconsistency is documented as a warning for later auditing | Persistent anomaly log |
| RNF-14 | Language | Native Colombian Spanish (es-CO); tolerant of nicknames and local terms | WER target 4–6% |

> **RNF-04 caveat.** "Voice is not stored" was the position taken in the meeting, based on Adriana's
> legal research. In the same meeting Daniel raised storing audio as evidence the auditor could listen
> to, and that was never resolved. The MVP position stands; if audio storage is later reconsidered, the
> legal analysis in §13.10 must be completed first.
>
> **RNF-08 and RNF-14 are `[TEAM]`.** Neither offline-first operation nor a WER target was discussed in
> the meeting or stated by the client. Offline-first in particular is a significant architectural
> commitment — flag it for explicit ratification at the approval meeting.

---

## 9. Use cases

**CU-01 · Configure the tool (Auditor)** — Precondition: has the inventory Excel. Upload → the system
characterises warehouses/SKUs and computes parameters → review and approve. Covers RF-01, RF-02, RF-03.

**CU-02 · Create the audit plan (Auditor)** — Select warehouse → define period → assign operators →
activate. Postcondition: the plan is visible only to assignees. Covers RF-05, RF-06, RF-07.

**CU-03 · Count by voice (Operator)** — Precondition: an active plan with the operator assigned. Choose
plan → catalogue loads → push-to-talk: "3 kg of lettuce" → the AI extracts `{product, quantity, unit}`,
applies ITN and matches the SKU → confirmation shown → the record enters the clean list. Extension: no
match → manual search (RF-16). Covers RF-11, RF-12, RF-15, RF-17, RF-18, RF-19, RF-23, RF-24, RF-33.

**CU-04 · Dictate several items in one audio (Operator)** — "2 kg of tomato, 4 of potato and 3 of
lettuce" → split into 3 records. Covers RF-13, RF-14.

**CU-05 · Correct a record (Operator)** — Identify the wrong record → delete it (touch) → dictate again.
Rule: never by voice. Covers RF-20, RF-21.

**CU-06 · Resolve an anomaly (Operator / system)** — The trigger detects an incorrect unit, atypical
quantity or negative balance → flags orange → once the in-flight audio ends, the preventive block leads
to the record → correction by delete-and-redo. Covers RF-25, RF-26, RF-27, RF-28, RF-29.

**CU-07 · Register an uncatalogued product (Auditor)** — A non-existent item appears → the auditor
creates it with description, unit and warehouse. Covers RF-04.

**CU-08 · Review and approve/reject (Auditor)** — On site: approve, decline or correct the flagged
record. In office: the operator resolves and the auditor receives a traceable report. Prioritisation by
per-operator statistical signals. Covers RF-08, RF-09, RF-10.

**CU-09 · Close and export (Auditor / system)** — Generate the Oracle-format file + reconciliation
report + trail. Covers RF-30, RF-31, RF-32.

---

## 10. QA plan

`[MEETING]` QA for AI requires, beyond functional testing, **stress testing to the point of failure**
and a **reliability matrix for the pitch**: precision percentage, where it fails, and what it cannot do.

### 10.1 Voice and AI pipeline

| ID | Test | Acceptance criterion | Req. |
| --- | --- | --- | --- |
| QA-01 | es-CO recognition with accents and warehouse noise | WER 4–6% | RNF-14 |
| QA-02 | Three-model consensus on controlled audios | Agreement ≥ 99.9%; discrepancy triggers reprocessing | RF-23, RF-24 |
| QA-03 | ITN "noventa vs novecientos" and spoken numbers | 100% of critical numbers normalised | RF-17 |
| QA-04 | Multi-item split with varying item counts | All items split correctly up to the maximum tested capacity | RF-14 |
| QA-05 | Matching against colloquial names and nicknames | Correct match or fallback to manual search — never an invented value | RF-15, RF-16 |

### 10.2 Validation and anomalies

| ID | Test | Acceptance criterion | Req. |
| --- | --- | --- | --- |
| QA-06 | Incorrect unit (grams↔kilos) | Orange warning and progress blocked | RF-26, RF-28 |
| QA-07 | Atypical quantity vs. history (10× jump) | Warning without blocking the in-flight recording | RF-26, RF-29 |
| QA-08 | Product absent from the warehouse | Warning and route to auditor creation or manual search | RF-04, RF-26 |
| QA-09 | Negative balance (imbalance) | Detected and flagged | RF-26 |
| QA-10 | Item without a unique code | Name-based match without breaking the flow | RF-15 |
| QA-11 | Asynchronous validation does not block recording | Operator keeps recording while the trigger runs | RF-25, RNF-03 |

### 10.3 Rules and security

| ID | Test | Acceptance criterion | Req. |
| --- | --- | --- | --- |
| QA-12 | Blind counting | No operator screen shows theoretical stock | RF-18 |
| QA-13 | Voice creates records only | Spoken edit/delete commands execute no change | RF-20 |
| QA-14 | Delete-and-redo | Delete + re-record produces the correct record | RF-21 |
| QA-15 | Per-plan access restriction | The operator cannot see unassigned warehouses | RF-07 |
| QA-16 | No voice persistence | No audio remains stored after processing | RNF-04 |
| QA-22 | Pre-save confirmation is bias-free | The confirmation screen never displays prior stock; confirmation is yes/no only | RF-33 |

### 10.4 System and load

| ID | Test | Acceptance criterion | Req. |
| --- | --- | --- | --- |
| QA-17 | Excel upload and characterisation | Warehouses, SKUs and units loaded and approvable without error | RF-01, RF-02 |
| QA-18 | Record-creation latency | ≤ 20–30 s per voice note | RNF-02 |
| QA-19 | Offline and synchronisation | Capture without network and complete sync on reconnect | RNF-08 |
| QA-20 | Export to Oracle format | File importable without manual adjustment; reconciliation correct | RF-30, RF-31 |
| QA-21 | Stress to failure | Maximum capacity and breaking points documented in the matrix | RNF-01 |

### 10.5 Reliability matrix (pitch deliverable)

Per scenario: `[scenario] → [reliability %] → [where it fails] → [what it cannot do]`. Populated from
QA-01…QA-22. It backs the precision claim, alongside a recorded demo video as a safety net against a
live failure.

> **`[MEETING]` — TDD note.** The team's working agreement for this repository is strict TDD: a failing
> test first, then implementation, then green. The QA table above is the acceptance layer, not the unit
> layer. Each RF needs its failing test written before its implementation.

---

## 11. Client findings incorporated

Answers given by Colsubsidio in the challenge Q&A channel, 22–24 Jul, verified against the original
messages at the time of writing. The channel transcript itself is not vendored — see §0.

| Finding | Impact on the PRD |
| --- | --- |
| The current system is Oracle My Inventory; they recommend focusing on speeding up capture — integration would be worked on with Colsubsidio if the project wins | RF-30 targets a compatible format; integration out of scope (RNF-09) |
| The auditor recounts what was reported; the count is done twice, and both walk the same zones in the same order | Grounds RF-09 / RF-10 — prioritise by anomaly instead of recounting everything |
| Tablets are confirmed in these environments and are **not** used for this process today | RNF-07; an integration opportunity worth highlighting in the pitch |
| Staff must register using the database names, but Colsubsidio suggests reconciling colloquial dictation with the record ("tabla para picar blanca" → `TABLA ACRILICA PICAR BLANCO 50X38CM FB`) | RF-15 includes fuzzy/semantic matching |
| Negative quantities are a "mini challenge"; they suggest including a validation | RF-26(d) and QA-09 |
| The stock listing is generated **without quantities** so the count can be filled in | Confirms blind counting (RF-18) |
| Ambient noise is not significant beyond typical daily operation | Lowers the risk behind QA-01; the test is retained |
| Products are always in the same order and place | Simplifies the counting flow; reinforces not mapping sections at this stage |
| Products without a code, and the nature of the codes: Colsubsidio undertook to validate internally; no answer yet | QA-10 retained (name-based match). Pending in §13 |
| Colsubsidio suggested a **web app usable from a tablet** as the faster route | See §13.11 — the PRD currently assumes a mobile app; a responsive web app may satisfy both surfaces with less build |

---

## 12. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| ASR/LLM hallucination on quantities | Three-model consensus + ITN + visual confirmation (RF-17, RF-23, RF-24, RF-33) |
| Colloquial names with no match | Fuzzy search + manual fallback; never an invented value (RF-15, RF-16) |
| Similar product names — "ACEITE" vs "ACEITE DE OLIVA" vs "ACEITE DE OLIVA 10ML/BOLSA" | Raised in the client group and unanswered. Fuzzy matching must prefer "no match → manual search" over a confident wrong match. See §13.12 |
| Live failure during the pitch | Recorded demo video as a safety net; reliability matrix with documented limits |
| Intermittent connectivity in the warehouse | Offline-first design with deferred sync (RNF-08) — note this NFR is unratified |
| Single AI vendor dependency | Three models from different providers; decoupled architecture |
| Processing cost | Bounded audio duration; token control (RF-13, RNF-12) |
| Pending client definitions (§13) | Questions already sent to the manager; the audit-plan design is agnostic to who assigns |

---

## 13. Open questions

None of these block the MVP build. Several block the *correctness* of detail logic, marked accordingly.

**From the 23 Jul meeting — pending with the hospitality manager:**

1. **Who assigns operators to warehouses — the auditor or a supervisor?** Working assumption: the
   auditor. Not answered in the meeting or the client Q&A channel.
2. **How are expired and removed products handled?**
3. **Do expiry/disposal records enter this stage?** Out of scope until confirmed.

**From the 23 Jul meeting — unresolved internally:**

4. **Recount mechanics (`reconteo`).** *Blocks detail logic.* An operator doubts a count, walks back,
   recounts, and the earlier figure changes (10 → 9), then later finds 3 more of the same product. On
   paper this is resolved by crossing out and writing the total. **The Spanish draft does not address
   this at all**, yet the meeting identified it as a normal operational mechanic and concluded it can
   only be settled through testing. RF-21's delete-and-redo assumes the operator can identify *which*
   record to delete — that assumption is untested for the recount case.
5. **Voice note duration limit.** RF-13 requires a cap; no value is defined.
6. **Which three AI models.** RF-23 requires three; none are named.
7. **Per-item range validation semantics.** Named in the reviewed Discovery flow, and explicitly not
   understood by the team at the time. RF-26(c) partially covers it.

**From the client channel — asked and never answered:**

8. **What is a normal difference between counted and system, and from what magnitude does it become a
   "significant novelty" requiring a recount?** *Blocks detail logic* — this threshold is precisely what
   RF-26(c) needs in order to fire. Asked by Adriana on 22 Jul, unanswered.
9. **What is the economic cost of the current errors, and what is the most important metric to improve?**
   Asked by Adriana on 23 Jul, unanswered. Without it, §3 has no baseline.
10. **Is the auditor's recount independent (without seeing the first count) or a verification against
    what was already entered?** Affects the on-site auditor view (RF-09).
11. **Are the product codes internal ERP codes or barcodes, and why do some items have no code?**
    Colsubsidio undertook to validate; affects RF-15.
12. **Unit conversion.** Are there spoken subunits (grams, millilitres, boxes, packs) that must convert
    to the system's base unit, and what is the conversion table per product? Are there products with
    more than one valid unit depending on context (counted in boxes, held in units)? *Blocks detail
    logic* — RF-26(b) blocks a grams↔kilos mismatch as an anomaly, which is only correct if no
    legitimate conversion exists. Asked in the group, unanswered.
13. **How critical is confusing similar product names, and are there known frequent-confusion cases?**
    Asked in the group, unanswered. Affects RF-15 matching thresholds.

**Internal decisions for the approval meeting:**

14. **Product name.** "Voice Inventory Counter" / "Contador de Inventario por Voz" is the draft's
    working name; the meeting flagged the name as provisional.
15. **Mobile app vs. responsive web on tablet.** `[CLIENT]` Colsubsidio suggested web-on-tablet as the
    faster route. The PRD assumes a native mobile app. Resolving this changes the build.
16. **Ratify the `[TEAM]` NFRs** — offline-first (RNF-08) and the es-CO WER target (RNF-14) were never
    discussed with the client or in the meeting.
17. **Re-verify the `[DATASET]` percentages** (~5.6% negatives, ~18% without code, ~23% decimals). They
    could not be recomputed in this repo — no spreadsheet tooling available.

---

## 14. Traceability (RF ↔ CU ↔ QA)

| Area | RF | CU | QA |
| --- | --- | --- | --- |
| Auditor configuration | RF-01…RF-06 | CU-01, CU-02, CU-07 | QA-17 |
| Voice ingestion | RF-11…RF-22, RF-33 | CU-03, CU-04, CU-05 | QA-01…QA-05, QA-13, QA-14, QA-22 |
| AI and validation | RF-23…RF-29 | CU-03, CU-06 | QA-02, QA-06…QA-11 |
| Rules and security | RF-07, RF-18, RF-20 | CU-05, CU-08 | QA-12, QA-15, QA-16 |
| Reports / export | RF-30…RF-32 | CU-09 | QA-20 |
| Non-functional | RNF-01…RNF-14 | cross-cutting | QA-18, QA-19, QA-21 |

---

## 15. Delta against the Spanish draft

Recorded so the approval meeting can see exactly what changed, rather than diffing two documents.

**Added:**

- RF-33 — pre-save confirmation, bias-free. Agreed in the meeting, absent from the draft.
- QA-22 — test for RF-33.
- §13.4 — recount mechanics, the largest gap between the meeting and the draft.
- §13.5–13.7 — three meeting items the draft dropped: voice-note duration value, which three models,
  per-item range validation.
- §13.8, 13.9, 13.12, 13.13 — four client questions asked in the Q&A channel and never answered,
  two of which (§13.8 recount threshold, §13.12 unit conversion) block requirement logic that the draft
  states as settled.
- §13.15 — the client's web-on-tablet suggestion, which the draft does not mention.
- §0 — provenance markers separating meeting agreements, client statements, dataset analysis, and
  team additions.

**Flagged, not changed:**

- RNF-04 "voice is not stored" is presented in the draft as settled. The meeting left a counter-proposal
  (audio as auditor evidence) unresolved. The MVP position is retained with the caveat noted.
- RNF-08 offline-first and RNF-14 WER target are `[TEAM]` additions with no source in the meeting or the
  client channel. Retained pending ratification.
- The `[DATASET]` percentages are carried unverified.

**Unchanged:** all RF/RNF/CU/QA identifiers, scope boundaries, and the eleven agreed technical decisions.
