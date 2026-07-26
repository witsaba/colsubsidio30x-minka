# Diagrams — status and match against the 23 Jul meeting

**Status:** vendored as received, **not corrected**. Two of the three findings marked `BLOCKER`
below reproduce step labels that were explicitly corrected during the meeting.

| File | Subject |
| --- | --- |
| [`01-end-to-end-flow.png`](01-end-to-end-flow.png) · [source](01-end-to-end-flow.html) | End-to-end capture flow, 10 steps |
| [`02-two-apps-architecture.png`](02-two-apps-architecture.png) · [source](02-two-apps-architecture.html) | Two-app split, operator / auditor, shared backend |
| [`03-implementation-flow.md`](03-implementation-flow.md) | Implementation flow as the code actually runs — Mermaid (flowchart + sequence + state + failure map + port map). Source-of-truth for what would happen if you pushed the mic right now. |

Originals: `01_detailed_flow.{html,png}`, `02_two_apps_architecture.{html,png}`. The `.html` files are
the editable sources (inline SVG); each carries a "Download PNG" button that regenerates its `.png`.

Matched against [`../sources/meet-define-project.md`](../sources/meet-define-project.md) (raw
transcript), [`../prd-seed.md`](../prd-seed.md) (traceable extraction) and [`../prd.md`](../prd.md) §6.1.
Timestamps below are transcript anchors; `L###` are line numbers in the raw transcript.

---

## 0. Verdict

**Diagram 02 (two apps) is substantially faithful.** Its problems are naming and status, not flow.

**Diagram 01 (end-to-end flow) encodes the *pre-meeting* Discovery flow, not the agreed one.** Two of
its step labels are the exact wording Daniel corrected out loud while the team reviewed the Discovery
document:

| Diagram 01 label | Transcript | What was said |
| --- | --- | --- |
| ① "Select warehouse (bodega) / App loads that warehouse's product catalog" | L976 (00:54:48) | *"esta seleccionar bodega como tal no no sería un seleccionar bodega porque él no va a seleccionar una bodega, sino que va a seleccionar un plan de auditoría"* |
| ⑤ "REAL-TIME VALIDATION vs CATALOG" | L1440 (01:27:49) | *"este que llamaron ustedes aquí valida en tiempo real, yo no lo yo no lo dejaría en tiempo real"* |

Both phrases survive verbatim in the diagram. The diagram therefore shows the flow as it stood at
00:17:29, before the corrections at 00:54:48 and 01:27:49.

---

## 1. Blockers — diagram contradicts a `[DECIDED]` item

### B-01 · Operator selects a warehouse ❌ selects an **audit plan**
Diagram 01 ①; Diagram 02 "Warehouse selection".
The audit plan is the unit of work and is bound to exactly one warehouse; the operator only sees
plans they are assigned to. Selecting a warehouse directly is the option surface the design
deliberately removes — *"entre menos opciones tenga la persona, es muchísimo mejor"* (L1008).
→ 00:48:36, 00:54:48, 00:57:16 · seed §4.2 · PRD §6.1 step 3

### B-02 · Validation shown as real-time ❌ it is **asynchronous**
Diagram 01 ⑤.
Explicitly rejected. The process is split into two parallel stages so the operator is never
interrupted: extraction creates the record, and a separate background stage checks it against
history and the statistical models (L1440, L1444).
→ 01:27:49, 01:29:26 · seed §4.6 · PRD §6.1 step 5

### B-03 · Anomaly gate placed *before* saving ❌ the record is created **first**
Diagram 01: ⑤ → anomaly? → ⑥ confirm → ⑦ save, with the alert card reading "Ask before saving".
The agreed order is the reverse: *"Y luego una vez creado el registro se dispara el trigger de
validación"* (L1464). There is no rule blocking record creation — creation is already protected by
the three-model consensus.
The alert card also contradicts itself: "Ask before saving" against "Flow keeps moving; alert
resolved async."
→ 01:27:49, 01:29:26 · seed §4.6 · PRD §6.1 step 5

---

## 2. Gaps — `[DECIDED]` in the meeting, missing from the diagrams

| # | Missing | Reference |
| --- | --- | --- |
| G-01 | **Preventive block.** After the in-flight audio is submitted, a warning notice *and a preventive block* appear before the operator may record again — *"antes de dejarlo volver a disparar otro audio se le genere un letrero de advertencia y un bloqueo preventivo"* (L1464). Diagram 01 shows the flow continuing ungated | 01:30:46 · seed §4.6 |
| G-02 | **Flow starts with the auditor**, not the operator — Excel upload, warehouse characterisation, user management, audit plan. Diagram 01 opens at the operator; setup appears only as a parenthetical in ⑧ | 00:46:06 · seed §4.1 |
| G-03 | **Audit plan** as an object — absent from both diagrams | 00:48:36 · seed §4.2 |
| G-04 | **Three-model disagreement → reprocess the audio.** Diagram 01 ④ shows the three models but no reprocess edge; the consensus mechanism is only half-drawn | 00:30:37 · seed §4.5 |
| G-05 | **Multi-item splitting** — one audio containing several SKUs must split into independent records | 01:21:59, 01:23:39 · seed §4.3 |
| G-06 | **Manual product search fallback** when the AI fails to match the SKU | 01:04:16, 01:05:18 · seed §4.3 |
| G-07 | **Voice notes are duration-capped** — "shorts", short audios (L1344) | 01:20:47, 01:21:59 · seed §4.3 |
| G-08 | **Discrepancy ownership.** Quantity-vs-history discrepancies are resolved by the **auditor**, not the operator; the operator only fixes their own transcription mistakes. Diagram 01's green "NO / RESOLVED → confirm" edge implies the operator clears the anomaly inline | 00:24:10 · seed §4.7 |

---

## 3. Status overstatements — shown as settled, actually open

| # | Diagram claims | Actual status |
| --- | --- | --- |
| S-01 | ③ "Audio processed, not stored → no voice-privacy risk" | **`[OPEN]`.** Braejan set storage as conditional on a legal basis (L620); Daniel proposed anonymisation or encrypted storage (L630) and separately argued for keeping audio as audit evidence (00:27:48). Not resolved · seed §6.2 · PRD §13 |
| S-02 | ⑧ "Supabase" as the central database | **Technical signal, not a locked decision.** seed §8 states none of the technical signals is an architectural decision · 00:40:36, 00:48:36 |
| S-03 | ⑩ Export as the terminal deliverable | **`[PROPOSED]` with an unreconciled conflict** — presented as the final deliverable at 00:09:42, referred to as a nice-to-have at 01:35:20 · seed §4.8 · PRD §13 |
| S-04 | Role named "Supervisor" (01 ⑨; 02 "Supervisor / Auditor") | The decided role is **Auditor**. Whether a separate supervisor exists is itself the `[OPEN]` third-role question — the label pre-answers it · 00:50:58, 00:52:06 · seed §2 |
| S-05 | ⚠ card: *"Are you sure it's 90 and not 9 boxes?"* | Invented example. The meeting's examples were "19 kg of rice" recorded as 9 (00:23:03) and the unit-dissonance wording at 01:30:46 |
| S-06 | ⑥ read-back confirmation drawn as a hard step | `[PROPOSED]`, not `[DECIDED]` · 00:17:29 · seed §4.3 |

---

## 4. Rendering defect

`01-end-to-end-flow.html:153-154` — the green "NO / RESOLVED → confirm" edge

```
<path d="M835 575 C 560 575, 525 575, 525 480" class="edgeG" .../>
<text x="560" y="600" class="tag" fill="#12b981">NO / RESOLVED → confirm</text>
```

runs horizontally at `y=575` straight through the ⚠ ASYNC ALERT card (`x 600–800`, `y 520–630`), and
its label at `(560,600)` overprints that card's body text. Visible in the exported PNG: the strings
"…VE LATER" and "and not 9 boxes?" collide. Cosmetic, but the busiest junction of the diagram is
unreadable.

---

## 5. What the diagrams get right

Recorded so the next revision does not regress it.

| Element | Reference |
| --- | --- |
| Push-to-talk; live streaming rejected | 01:02:02, 01:07:57 |
| Three AI models in parallel, consensus required | 00:30:37 |
| Correction = delete & re-record; no manual edits; voice never edits or deletes | 01:25:06, 01:26:33, 01:27:49 |
| Two apps — operator mobile, auditor web — same data, different interaction | 00:19:07, 00:21:20, 00:26:33 |
| Excel import as the loading path for catalogue and stock | 00:37:57, 00:39:21 |
| User management module (create operators, assign) | 00:44:57 |
| ERP is fed, not replaced — dashed boundary, *"This project feeds it — does not replace it"* | 00:37:57, 00:43:56 |
| Anomalies flagged in **orange** | 01:30:46 |
| Auditor reviews counted vs system and resolves flags | 00:24:10 |
| Discrepancy reports → clean export file | 00:09:42 |

---

## 6. Corrected flow, for reference

The order agreed in the meeting, as already written in [`../prd.md`](../prd.md) §6.1:

```
AUDITOR (web) ──────────────────────────────────────────────────────────
  Excel upload → characterise warehouses/SKUs/units + statistical params
  → approve → create audit plan (ONE warehouse, period, assigned operators)

OPERATOR (app) ─────────────────────────────────────────────────────────
  Select AUDIT PLAN (not warehouse) → catalogue for that warehouse loads
  → push-to-talk, short audio → release

AI ENGINE ──────────────────────────────────────────────────────────────
  transcribe → ITN → multi-item split → 3 models in parallel → JSON
    ├─ agree ──────→ SKU match (fuzzy; fallback manual search)
    └─ disagree ───→ REPROCESS AUDIO ↺
  → read-back on screen → operator confirms → RECORD CREATED

ASYNC VALIDATION (trigger, fires after creation) ───────────────────────
  product in this warehouse? unit correct? quantity vs history?
  negative balance?
    └─ anomaly → orange flag → operator finishes current audio
                → warning + PREVENTIVE BLOCK before next recording
                → resolution = delete & re-dictate
                → quantity-vs-history discrepancies escalate to AUDITOR

AUDITOR (web) ──────────────────────────────────────────────────────────
  review counted vs system → resolve alerts → export → client ERP
```

---

## 7. Where each status overstatement is tracked in the PRD

Checked against [`../prd.md`](../prd.md). Two are **not** tracked, which is a PRD gap the diagrams exposed.

| # | Tracked in the PRD? |
| --- | --- |
| S-01 audio storage | **Yes**, but not in §13 — §8 RNF-04 plus the RNF-04 caveat, and §15 |
| S-02 Supabase | **No — and the PRD overstates it too.** §6.2 lists "Supabase as the MVP database" under the heading *"All of the following are `[MEETING]` decisions from 23 Jul"*. The meeting recorded it as a technical signal, explicitly not an architectural decision (seed §8) |
| S-03 export priority | **No.** The seed flags an unreconciled conflict — final deliverable (00:09:42) vs nice-to-have (01:35:20), seed §4.8 — and the PRD carries neither side as open. §4 lists OCR as the only nice-to-have |
| S-04 supervisor / third role | **Yes** — §13 Q1 |

## 8. Actions

1. Decide whether to reissue Diagram 01 against §6, or present it with these caveats stated.
2. **PRD fix — S-02:** move Supabase out of the `[MEETING]` decisions table in §6.2, or restate the
   table heading. As written it attributes a decision to the meeting that the meeting did not make.
3. **PRD fix — S-03:** add the export priority conflict to §13. It is an open question in the seed
   that did not survive into the PRD.
4. Fix the §4 rendering defect in whichever revision ships.
