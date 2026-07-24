# PRD Seed — Voice-Driven Inventory Capture (Colsubsidio Hospitality Challenge)

**Status:** Seed document. Not a PRD. Input for the PRD approval meeting on 2026-07-24, 14:00.
**Derived from:** [`docs/sources/meet-define-project.md`](sources/meet-define-project.md) — "Let's define the flow and tech", 2026-07-23, 01:43:15 duration (Gemini notes + full verbatim transcript).
**Consumed by:** [`docs/prd.md`](prd.md) — the approval-ready PRD built from this seed plus the Spanish draft.
**Participants:** Adriana Durand Calle, Daniel Enrique Rosas Esteban, Braejan David Arias Heregua. Invited: Edith Lavado.

---

## 0. How to read this document

Every statement below traces to the meeting. Nothing here is inferred, extrapolated, or imported
from other sources. Where the meeting did not settle something, it is marked `[OPEN]` rather than
filled in with a plausible answer — those gaps are the agenda for the PRD meeting.

| Marker | Meaning |
|---|---|
| `[DECIDED]` | Explicitly agreed by the participants in the meeting |
| `[PROPOSED]` | Raised and not contradicted, but never confirmed as a decision |
| `[OPEN]` | Explicitly identified as unresolved, or assigned as a question to the client |
| `[OUT]` | Explicitly excluded from current scope |

Timestamps in parentheses refer to transcript anchors, e.g. `(00:21:20)`.

---

## 1. Problem and goal

**Today:** physical inventory counts in warehouses are recorded on paper. Operators write down
what they count; the paper is handed to an auditor who has to review everything that was written
(00:21:20). Paper "tolerates anything", which is precisely why so many problems occur (00:58:36).
Corrections are made by crossing out and rewriting (01:13:01). Discrepancies surface hours or days
later (01:29:26).

**Goal `[DECIDED]`:** eliminate paper, or at minimum render it obsolete (00:43:56).

**Explicit non-goal `[DECIDED]`:** ERP integration. The client repeatedly stated not to focus on the
ERP. Connecting to it is a bonus, not the objective (00:43:56).

---

## 2. Users and roles

Two roles are confirmed as presented by the client (00:52:06):

| Role | Surface | Responsibility |
|---|---|---|
| **Operator** (`operario`) | Mobile app | Data ingestion. Needs speed, lightness, mobility (00:21:20) |
| **Auditor** | Web platform | Setup, configuration, review, approve/reject records (00:21:20) |

**Key premise `[DECIDED]`:** both roles access the *same* information but interact with it in
different ways (00:26:33). This is a separation of interaction, not of data.

**Operational reality `[DECIDED]`:** the auditor does *not* have the operational capacity to review
an entire warehouse inventory. The auditor reviews inconsistencies and specific incidents where
there is doubt (00:21:20). Example of auditor reasoning given: operator 5 raised warnings on 17
products while operator 2 raised 2 — a statistical anomaly worth investigating in person (00:23:03).

**`[OPEN]` — Is there a third role?** Unknown whether the auditor assigns operators to warehouses,
or whether a warehouse supervisor does. If a supervisor exists, a third actor enters the model
(00:50:58). **Working assumption for now `[PROPOSED]`:** the auditor assigns operators (00:52:06).

---

## 3. Product shape

**`[DECIDED]`** Two applications (00:19:07, 00:21:20):

1. **Mobile app** — operator. Voice ingestion of inventory counts.
2. **Web platform** — auditor. Configuration, administration, review, resolution of discrepancies.

**`[DECIDED]`** The tool is **fully autonomous and independent** from the client's ERP (Oracle). It
cannot assume a live connection, and cannot depend on the team manipulating the database directly —
"that isn't seen anywhere" (00:37:57).

> **Rule number one, verbatim:** *"si usted crea una herramienta que no permita cargar Excel, nadie
> la va a usar"* — if you build a tool that doesn't allow Excel upload, nobody will use it
> (00:37:57).

The realistic data path today: the client extracts inventory information from the ERP into Excel,
and that Excel is loaded into the tool as its source of truth (00:37:57, 00:39:21).

---

## 4. Core flows

### 4.1 Auditor — initial configuration

`[DECIDED]` The flow does **not** start with the operator. It starts with the auditor preparing the
environment (00:46:06).

The auditor:

1. Uploads the Excel with existing inventory data — this becomes the tool's database of warehouses,
   SKUs, products, units and history (00:39:21, 00:47:26).
2. Creates or approves warehouses, and verifies the loaded data is correct: N points of sale /
   hotels, N warehouses, N SKUs (00:47:26).
3. Manages users — creation, enablement, role assignment, email dispatch (00:36:38, 00:37:57,
   00:50:58).

`[DECIDED]` A **user management module is mandatory**, and it is acknowledged as added complexity
that the team accepts, because it gives the AI tight boundaries it cannot escape, which
substantially reduces hallucinations, workload and token consumption (00:44:57).

> Rationale given: if the user says "I'm in the north warehouse", the model can hallucinate in ten
> thousand ways — another north warehouse may exist elsewhere. The more variables the model must
> resolve, the higher the hallucination probability (00:44:57).

`[PROPOSED]` During the hackathon, this initial configuration will be performed by the team with the
data already received; eventually the client performs it themselves (00:46:06).

`[OPEN]` **Can the auditor create products that were not in the initial load?** Example given: 15 kg
of chocolate balls found in warehouse 1 that did not exist at the start of the month. Daniel's
position: the auditor must have that authority, because the AI will not be able to resolve it
(00:42:55). Braejan's position: keep the initial load as the source of truth for now, suggest adding
the product, and don't complicate it until management answers (00:43:56). Likely current practice:
the product is created directly in Oracle (00:42:55). **Assigned to Braejan to ask management.**

### 4.2 Auditor — audit plan (`plan de auditoría`)

`[DECIDED]` The audit plan is the unit of work (00:48:36).

An audit plan contains:

- **What is being audited** — `[DECIDED]` exactly **one warehouse per plan**. Daniel's explicit
  clarification: audit plan → warehouse 1, audit plan → warehouse 2, and so on (00:57:16).
- **Time period** in which the audit is performed (00:53:34).
- **Which operators** are authorized to fill in that plan (00:48:36, 00:53:34).

Consequences `[DECIDED]`:

- An operator may be included in several audit plans (00:53:34).
- Ingestion is segmented by location, to avoid unmanageable mass ingestion and to keep it tractable
  for the AI (00:53:34).
- The operator selects **an audit plan**, not a warehouse (00:54:48).
- The operator can only see and interact with audit plans they are assigned to. This removes the
  possibility of entering data for an unassigned warehouse entirely (00:57:16).
- Stated benefit: strict operational control over who ingests what, fewer human errors, and "the
  fewer options the person has, the much better" (00:57:16).

### 4.3 Operator — capture

**`[DECIDED]` Push-to-talk. Real-time streaming audio is rejected.**

Reasons given (01:02:02, 01:07:57):

- Real-time is technically painful — silence detection, interruption handling, knowing whether the
  human or the assistant is speaking. Both participants had prior first-hand experience and called
  it "horrible".
- Human factor: two people doing an inventory talk to each other, tell stories, digress. The model
  has no way to know what to ignore.
- Cost: per-token billing means every extra token is both money and an additional error variable.

> Verbatim: *"tiene que ser un botón de push. Ya presiono, hablo, suelto, termina, va, analiza y
> crea"* (01:07:57).

**`[DECIDED]` Short, time-limited voice notes.** The audio the user can send must be bounded in
duration. The longer the audio, the more errors, complexity and tokens (01:20:47, 01:21:59).
`[OPEN]` The concrete limit is not defined.

**`[DECIDED]` Multi-item splitting.** The base model is one voice note per SKU, but the tool must be
able to split a single audio containing several items — "2 kg of tomato, 4 kg of potato and 3 kg of
lettuce" — into independent records (01:21:59, 01:23:39).

**`[DECIDED]` Product identification.** The AI attempts to identify the product/SKU automatically
from the audio. The interface must provide a manual search/selection option for when the system
fails to match (01:04:16, 01:05:18). The user dictates "3 kg of lettuce" — not the SKU; the AI
resolves the SKU (01:20:47).

**`[PROPOSED]` Visual confirmation before saving.** The extracted data is shown to the user before
being sent, so the user can confirm, retry or correct. It remains a confirmation step but avoids
typing. This also cleans the data before persisting (00:17:29).

**`[PROPOSED]` Bias-free confirmation.** Confirmation questions must not reveal the prior stock
value, so as not to steer the count. Confirmation restricted to yes/no (00:08:00).

### 4.4 Correction model — the central constraint

**`[DECIDED]` Voice/AI is restricted to creating records only.**

No edit, no delete, no replace via voice (01:25:06, 01:26:33, 01:27:49).

Correction flow `[DECIDED]`: if the user made a mistake, they go to that specific record, **delete
it with a UI control, and record it again** (01:26:33, 01:27:49). "Borrón y cuenta nueva."

Rationale (01:25:06):

- Granting the model `create`, `replace`, `edit` and `delete` creates ambiguity the model can get
  tangled in.
- The team's error tolerance target is **below 1%**, so that the product represents a meaningful
  paradigm shift for the client.
- Modern models are good enough that it might work — the point is the risk margin is not acceptable
  at MVP stage, especially live during the pitch (01:32:13).
- Braejan: not allowing deletion via AI is essential — "eso sí sale mal todavía" (01:26:33).

`[DECIDED]` The user retains the right to be wrong and to correct — that is preserved today with
crossed-out paper, and removing it would be missed (01:23:39).

**`[OPEN]` Recount mechanics (`reconteo`).** A real and normal operational mechanic: an operator
doubts a count, walks back, recounts, and the previous figure changes (10 → 9), then later adds 3
more of the same product. On paper this is resolved by crossing out and writing the total. It is not
resolved how the tool handles this — whether the AI sums/subtracts, whether the user deletes and
re-records, or something else (01:14:08, 01:15:18). Daniel's position: this must be evaluated
directly through testing, because reliably interpreting "edit this for me" is very hard (01:18:03).

**`[PROPOSED]` Correction keyword.** Adriana's suggestion: when the AI hears "correction",
"modification", "add" or similar words, it pauses and asks — an explicit entry point for correction
incidents (01:19:20). Not adopted as a decision.

**`[PROPOSED]` Correction listing.** Braejan's complement: show what the user has registered so far
in the current audit plan and ask which record needs correcting (01:19:20).

### 4.5 Multi-model validation (anti-hallucination)

`[DECIDED]` The same information is processed by **three different AI models** simultaneously, each
asked to return the result in JSON (quantity, type, warehouse, and so on) (00:30:37).

- If all three return the same JSON → the processing is correct, the record is created.
- If any model disagrees → at least one hallucinated → reprocess the audio.

Figures cited from Daniel's own automation work (00:30:37, 00:31:50):

- Single model: ~82% effectiveness → 18% error, described as too large a cap to be viable.
- Three-model consensus: **~99.92% precision**.
- Technique analogy: the redundancy approach used for aerospace calculations.

> These numbers come from the participant's prior experience, not from a measurement on this
> project. They are recorded here as the stated design target, not as validated results.

### 4.6 Asynchronous validation and warnings

`[DECIDED]` Validation is **split from creation** and runs asynchronously, to avoid interrupting the
user (01:27:49, 01:29:26).

Flow:

1. There is **no strict rule blocking record creation**. The record is created — backed by the
   three-model consensus described above (01:29:26).
2. Once created, a **validation trigger** fires. It checks the record against history and the
   relevant statistical/mathematical models to determine whether it is an anomaly (01:27:49,
   01:30:46).
3. The user keeps recording while validation runs in the background at its own pace (01:29:26).
4. Estimated processing time: the participant doubts it exceeds **20–30 seconds** (01:27:49).

`[DECIDED]` Warning behaviour (01:30:46, 01:32:13):

- The distinction is deliberate: **an error is something that is wrong; a warning is something that
  requires the user's attention.** These are warnings.
- The record is flagged in **orange**.
- The alert is *not* raised mid-recording. The user finishes the audio they are recording, the audio
  is submitted, and only then — **before allowing another recording** — a warning notice and a
  **preventive block** appear.
- The notice is shown front and center, links directly to the offending record, and explains the
  dissonance in plain language. Example given: *"usually this is handled in units / boxes / grams /
  kilos and you just dictated it in grams. Please resolve this inconsistency before continuing."*
- Resolution path is the same as §4.4: delete and re-dictate.

`[PROPOSED]` The trigger logic is extensible — webhooks and other actions could hang off it later
(01:33:06).

Validation checks named in the reviewed Discovery flow (00:17:29): correct unit; quantity reasonable
versus historical; per-item range validation; alert on atypical value. Braejan flagged that per-item
range validation was not fully understood at the time.

### 4.7 Discrepancy ownership and the auditor's two workflows

`[DECIDED]` **Quantity discrepancies versus historical are resolved by the auditor, not by the
operator** — this preserves quality control (00:24:10).

The operator resolves only their own transcription mistakes — e.g. said "19 kg of rice", the system
recorded 9 (00:23:03, 00:24:10).

`[DECIDED]` All inconsistencies occurring during the process must be documented / flagged as a
warning and stored, because those are exactly what the auditor wants to zoom into (00:23:03).

**`[OPEN]` — the workflow forks on a fact the team does not have** (00:25:16, 00:26:33):

| If the auditor is… | Then… |
|---|---|
| **On site** | The auditor approves, declines or corrects the record directly |
| **In the office** | The operator approves or declines, **and** an anomaly report is generated for the auditor to audit afterwards, with complete traceability |

Both paths must exist and be connected, because two entirely different users interact with the same
solution. **Assigned to Braejan to clarify with the project manager.**

### 4.8 Output

`[PROPOSED]` The end result is a **downloadable file compatible with the client's main system**,
which they upload to complete the stock in their system (00:09:42).

`[OPEN]` **Priority conflict to resolve in the PRD meeting.** Adriana presented the downloadable
export as the final deliverable of the flow (00:09:42), while Braejan later referred to export
capability as a "nice to have" in the context of reports and anomaly listings (01:35:20). These two
statements were never reconciled.

---

## 5. Explicitly out of scope

| Item | Status | Reference |
|---|---|---|
| **OCR / image recognition** | `[OUT]` of MVP — treated as optional "nice to have", added only if time permits. Validating an OCR model and an audio model in the same window could work against the team. Gemini API proposed as a low-complexity route if credits are activated | 00:12:33, 00:13:50 |
| **Real-time streaming audio** | `[OUT]` — replaced by push-to-talk | 01:02:02, 01:07:57 |
| **Direct ERP / Oracle connection** | `[OUT]` — the tool is standalone; bridges and SQL connections are a later invention | 00:37:57, 00:43:56 |
| **Warehouse section/zone mapping** | `[OUT]` — viable and feasible, but adds sublevels and unnecessary complexity; warehouse layout is also volatile (horizontal today, different tomorrow). Can be mentioned in the pitch as a scaling path | 00:59:42, 01:00:42 |
| **Disposal / expiry records** (`actas de eliminación`) | `[OUT]` — the tool as designed does not contemplate them. `[OPEN]` whether the client wants them in this first stage | 01:15:18, 01:16:20 |
| **Edit / delete / replace via voice** | `[OUT]` — see §4.4 | 01:25:06, 01:27:49 |

---

## 6. Non-functional signals

These were discussed as requirements but not specified formally. They belong in the PRD's NFR
section.

### 6.1 Accuracy

- Target error tolerance: **below 1%** (01:25:06).
- Multi-model consensus design target: **99.92%** (00:31:50).
- Stated stake: if the team presents 99.92% precision and the 0.08% happens live during the pitch,
  it is a serious problem — hence the conservative create-only scope (01:33:06).
- The current process already has this problem; it just takes longer. A solution that introduces a
  ~20% gap would not be a real improvement (00:31:50).

### 6.2 Privacy and legal — audio handling

`[PROPOSED]` **Position taken in the meeting: voice is not stored.** Adriana's research: there is no
significant legal risk because the voice will not be used or retained — everything condenses into a
table/the system. Consent is required since it is a worker and the purpose is work-related
(00:09:42, 00:11:31).

`[OPEN]` **Contradicting consideration.** Daniel raised that storing audio could serve as audit
evidence for the auditor to listen to, and that whether to store it can be decided later (00:27:48).
This is unresolved.

If audio is stored, the risks and mitigations named (00:27:48, 00:29:10):

- Voice can be cloned from as little as 5 seconds → personally identifiable, traceable to the person.
- A legal basis and explicit acceptance would be required.
- Mitigation options mentioned: anonymize the voice through prior modelling (lower frequencies,
  neutralize it), or store the audio encrypted.
- The scope must be delimited — "we can't extend infinitely".

**Action item:** Adriana — analyze legal implications and privacy risks of storing audio files.

### 6.3 Information security — ISO 27001

`[DECIDED]` Define security protocols under **ISO 27001** for the final presentation (00:29:10).

- Explain secure channels, what encryption data travels under, and the information-security
  technical layer.
- Rationale: the client visibly cares about information security; arriving with this is a
  significant added value and a differentiator for the final pitch.

**Action item:** the whole group.

### 6.4 Performance

- Async validation processing estimated at **under 20–30 seconds** (01:27:49).
- Voice note duration must be capped — value `[OPEN]` (01:21:59).

---

## 7. Testing and QA

`[DECIDED]` A robust test plan is required (01:21:59, 01:23:39).

- **Stress testing to the point of failure**, deliberately.
- Produce a **complete test matrix** to present: reliability percentage per capability, where it
  fails, and what it is not capable of doing.
- Testing with **real voices**, across the full flow — can be done in parts (00:11:31).
- QA for AI has a different approach from conventional QA (01:41:26).

`[DECIDED]` **Strong onboarding is required** — teaching the user how to dictate correctly, and
stating the maximum tested capacity. This must be explained in the pitch (01:18:03, 01:21:59).

> Acknowledged risk: even with onboarding, humans differ enormously. Non-technical users will keep
> using natural language and some believe they are talking to a conscious entity, which breaks
> things (01:16:20).

`[PROPOSED]` Record a demo video as a fallback, in case the live demo misbehaves (01:32:13).

---

## 8. Technical signals

Mentioned in the meeting. **None of these is a locked architectural decision** — they are inputs for
the design phase.

| Signal | Note | Reference |
|---|---|---|
| **Supabase / PostgreSQL** | Migrate the Excel inventory structure to Supabase to verify visualization and functionality. The intent is to turn the Excel into a relational, transactional database | 00:40:36, 00:48:36 |
| **Gemini API** | Proposed for OCR if that optional feature is included; already used in internal tests with JSON output, considered stable enough | 00:13:50 |
| **Three distinct AI models** | Required by §4.5. Which three is not specified | 00:30:37 |
| **Figma** | Adriana produced the flow and screen mockups | 00:07:00, 00:09:42 |
| **Event-driven processing** | Braejan raised the need for an event/queue mechanism, since three parallel model calls plus retries introduce a wait. Converges with the async validation trigger in §4.6 | 00:32:59, 01:29:26 |
| **Mermaid** | Braejan intends to diagram the whole flow for review | 01:38:50 |
| **OpenSpec** | Braejan has experience working with it, starting from a PRD | 01:39:47 |

`[DECIDED]` Process order: **approve the PRD first, then specify.** The PRD is the initial horizon —
"not written in marble", but agreed before specification begins (01:39:47).

`[DECIDED]` Do not adopt tooling the team does not currently master during the hackathon — learning
it would be counterproductive. "Get it out however you can, we'll polish after Sunday" (01:40:35).

---

## 9. Open questions — PRD blockers

### 9.1 For the client (hospitality project manager)

Owner: **Braejan**, to raise directly with management as early as possible.

1. **How many people are involved in the inventory process?** The operator role (data ingestion) and
   the auditor role (review) are mapped. What is the relationship between them? Is the auditor the
   person who assigns operators to the inventory activity, or is there an additional supervisor who
   decides which operators register which warehouse? (00:52:06)
2. **Is the auditor on site in the warehouse, or in an office waiting for the papers?** This
   determines which of the two workflows in §4.7 is built. (00:25:16)
3. **Can new products be created during the inventory?** How is it handled today when a product is
   found that was not in the initial data — is it created directly in Oracle? (00:42:55, 00:43:56)
4. **How are reductions handled** — expired items, items that must be pulled from inventory? Is a
   separate act signed, or is it written on the same paper? **Should it be included in this first
   stage of the challenge?** (01:16:20)
5. **How are products currently identified?** Whether the paper carries the SKU or only a
   description like "3 pounds of lettuce", and how the match is made today — apparently by a second
   person corroborating. Owner: **Daniel**, to post in the hospitality challenge Q&A channel. (01:04:16,
   01:05:18)

### 9.2 Internal — to resolve in the PRD meeting

1. **Product name.** The current working label was called into question — "we'll probably change the
   name later" (00:08:00). Not resolved.
2. **Export priority** — deliverable or nice-to-have (§4.8).
3. **Audio storage** — store or not store (§6.2).
4. **Voice note duration limit** — concrete value (§4.3).
5. **Recount handling** — the `reconteo` mechanic (§4.4).
6. **Which three AI models** for the consensus mechanism (§4.5).
7. **Per-item range validation** — semantics were not clear to the team when reviewed (§4.6).

---

## 10. Team, responsibilities and timeline

`[DECIDED]` Work split (01:38:50, 01:41:26):

| Who | Responsibility |
|---|---|
| **Braejan + Daniel** | Technical implementation and programming |
| **Adriana + Edith** | Initial product documents, functional and non-functional requirements, use cases, QA. Act as full auditors of everything Braejan and Daniel build |

Rationale for the split: while the two developers are programming they will have dead time and will
not be communicating constantly, so the documentation and QA track runs in parallel (01:41:26).

Schedule as agreed in the meeting:

- **2026-07-24, 14:00** — meeting to review and approve the PRD.
- **2026-07-24, from 17:00** — Daniel free; programming starts with Braejan that evening.
- **Saturday** — continued build; pitch structure can be reviewed Saturday afternoon.

### Action items from the meeting

| Owner | Action |
|---|---|
| Braejan | Clarify flows: meet the manager to resolve doubts about audit flows and user roles |
| Adriana | Investigate voice legality: legal implications and privacy risks of storing audio files |
| Group | Plan security: define protocols under ISO 27001 for the final presentation |
| Group | Build data manager: user administration and Excel upload modules for the database |
| Braejan | Locate and share the consolidated Discovery document with the team |
| Daniel | Post the product-identification question in the hospitality challenge Q&A channel |
| Braejan | Ask the manager about the auditor/operator hierarchy and handling of expired or removed products |
| Braejan | Migrate inventory data structure to Supabase to verify visualization and functionality |
| Braejan | Summarize the agreements reached and share them with the team |
| Braejan | Post the meeting summary in the team channel |
| Daniel | Upload the documents and resources discussed to the shared folder |
| Adriana, Edith | Produce the initial product documents: technical functional and non-functional requirements, use cases |
| Group | PRD meeting on 2026-07-24 at 14:00 to review and approve |

---

## 11. Design principles that emerged

Recurring reasoning worth carrying into the PRD as explicit principles:

1. **Constrain the AI's action surface.** Fewer verbs, fewer variables, fewer hallucinations. Create
   only; correction is delete-and-redo (§4.4).
2. **Constrain the user's option surface.** Pre-assigned audit plans instead of free warehouse
   selection — "the fewer options the person has, the much better" (00:57:16).
3. **Never block the operator's flow.** Validation is asynchronous; warnings queue up and interrupt
   at a safe boundary, never mid-recording (§4.6).
4. **Redundancy over trust.** Three models must agree before a record is considered correct (§4.5).
5. **Adapt to the user's natural behaviour.** Inventory follows an order, but anomalies are common —
   the same product scattered across locations. The tool must accommodate how people actually count
   (00:59:42, 01:00:42).
6. **Deliberately narrow scope, expand if time allows.** Explicitly adopted from the hackathon
   guidance: define a tightly bounded scope and add extras only if there is room (00:12:33).
7. **Understand the operation before writing code.** Stated as the reason so much of this flow was
   uncovered — go into the kitchen and see how things are done first (01:34:30).

---

## 12. Traceability

Source file: [`docs/sources/meet-define-project.md`](sources/meet-define-project.md) (1,800 lines:
Gemini summary §1–53, verbatim transcript §106–1800).

The transcript is machine-generated and contains transcription errors — participant names, product
names and technical terms appear distorted in places (e.g. "Cloud" for Claude, "RP"/"LP" for ERP,
"Jason" for JSON, "supace" for Supabase). Interpretations of distorted terms in this document were
made only where the surrounding context makes them unambiguous; where it did not, the point is
marked `[OPEN]` instead.
