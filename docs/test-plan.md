# Test Plan — Voice Inventory Counter (to-failure matrix)

This plan operationalizes the Data Engineer's (Daniel Rosas) testing recommendation from the
project-definition meeting: do not stop at functional tests — **take the tool to failure, record the
maximum proven capacity, and present a complete reliability matrix in the pitch**. It expands PRD
§10 (QA-01…QA-22) into executable campaigns, maps what the implemented services already prove, and
defines the matrix that becomes the pitch deliverable.

## Quick path

1. Keep the strict-TDD unit layer green on every change (`uv run pytest` — Layer 1).
2. Execute the acceptance table QA-01…QA-22 from PRD §10 as modules land (Layer 2).
3. Run each to-failure campaign C1…C9 below; each one ends with a measured breaking point (Layer 3).
4. Copy every campaign result into the reliability matrix (§Matrix) — that table, plus the recorded
   demo video, is what goes to the pitch (Layer 4).

## Source of truth — what Daniel actually asked for

Verbatim evidence from the meeting transcript (`meet_define_project.md`; the auto-summary paraphrases
it as "stress testing" — the transcript is authoritative):

| Recommendation | Verbatim anchor | Timestamp |
| --- | --- | --- |
| Test to failure, deliver a complete matrix | "llevar la herramienta hasta el fallo y tener una matriz completa de pruebas para poder presentar esa matriz de pruebas" | ~01:20:47 |
| Document max proven capacity for onboarding/pitch | "cuál es la capacidad máxima probada" | ~01:20:47 |
| Error tolerance under 1% | "la tolerancia al error de nosotros debería estar por debajo del 1% para que esto sea un cambio de paradigma" | ~01:23:39 |
| Tri-model consensus for voice extraction | three models agree on JSON → accept; disagree → reprocess; "precisión del 99,92%" | 00:30:37 |
| Unknowable edge cases resolved empirically | "esos casos tendríamos que evaluarlos directamente con testing" | ~01:14 |
| Test with real voices | recalled by Braejan: "debemos en lo posible hacer … pruebas con voces reales" | morning session |
| Demo failure risk is real | "ese 0.08 pasa en el pitch" → recorded video as safety net | 01:33:06 |

## Targets

| Metric | Target | Source |
| --- | --- | --- |
| End-to-end error tolerance | < 1% | Daniel, ~01:23:39 |
| Voice-extraction consensus agreement | ≥ 99.9% (claim to verify, not assume) | Daniel, 00:30:37; QA-02 |
| STT word error rate (es-CO, noise) | 4–6% WER | QA-01 / RNF-14 |
| Matcher top-1 / recall@3 | ≥ 0.986 / 1.000 (already measured, must not regress) | eval gate, n=430 |
| Record-creation latency | ≤ 20–30 s per voice note | QA-18 / RNF-02 |
| Matcher availability | auto-recovery: bounded startup retry → exit 3 → Docker restart | Judgment Day JD-U |

## Layered model

| Layer | What | Status |
| --- | --- | --- |
| L1 — Unit/TDD | Failing test first on every RF (working agreement, PRD §10 note) | **Active**: matcher 298 tests, STT 98 tests, all green |
| L2 — Acceptance | QA-01…QA-22 tables in PRD §10 | Partially executable today (see Evidence) |
| L3 — To-failure campaigns | C1…C9 below — escalate until it breaks, record the limit | **This plan's core; mostly pending** |
| L4 — Reliability matrix | `[scenario] → [reliability %] → [where it fails] → [what it cannot do]` | Template below; populated from L2+L3 |

## To-failure campaigns (Layer 3)

Each campaign escalates one axis until failure, then records: last passing level (= **max proven
capacity**), first failing level, failure mode, and the matrix row. Never stop at the first pass.

| ID | Axis under stress | Procedure (escalation) | Failure signal | Feeds |
| --- | --- | --- | --- | --- |
| C1 | Items per voice note (multi-item split) | Dictate 1, 2, 3, 5, 8, 12, 20… items per note with real voices until the split drops/merges/invents an item | Wrong item count or wrong field assignment | QA-04, matrix "capacidad máxima" row |
| C2 | Note duration | 5 s → 15 s → 30 s → 60 s → 120 s notes; same content density | STT truncation, timeout, latency > 30 s | QA-18, voice-note duration limit decision (01:20:47) |
| C3 | Vocabulary distance | Catalogue name → colloquial nickname → diminutive → wrong-but-close product | Confident wrong match (worse than no_match) | QA-05; matcher garbage gate (false-confidence 0.0054 measured) |
| C4 | Acoustic conditions, real voices | Quiet room → warehouse ambience → forklift/talking over → multiple regional es-CO accents; ≥ 2 real speakers per condition | WER > 6% or hallucinated numbers | QA-01, QA-03 |
| C5 | Consensus disagreement | Feed ambiguous/noisy audios; measure 3-model agreement rate and reprocess loop behaviour; escalate noise until agreement < 99.9% | Silent acceptance of a disagreement, or reprocess loop that never converges | QA-02 |
| C6 | Matcher input hostility | Garbage phrases, 300-char inputs, empty-ish strings, unit mismatches, `MATCH_MAX_CANDIDATES` edge configs | 200 with `matched` on garbage; 5xx; ambiguity signals silently disabled | QA-05; JD-9 follow-up |
| C7 | Concurrency / sustained load | 1 → 5 → 20 → 50 concurrent operators dictating; sustained 30-min run; watch RSS (bounded trigram cache) and latency | OOM, RSS growth, latency > 30 s, container restart | QA-21 / RNF-01; JD-1 regression guard |
| C8 | Availability drills | Kill container mid-request; missing/corrupt catalogue at boot; verify bounded retry (`STARTUP_RETRIES`) → exit 3 → `restart: unless-stopped` recovery; healthcheck flips | No auto-recovery, or serving from a broken catalogue | QA-21; **already executed for matcher** (see Evidence) |
| C9 | Offline capture and sync | Record N items offline → reconnect → sync; escalate N and disconnection duration | Lost/duplicated records | QA-19 / RNF-08 |

Rules inherited from the meeting for all campaigns:

- Voice commands **create records only** — every campaign must include a spoken edit/delete attempt
  and assert it executes no change (QA-13, decision at 01:09–01:17).
- No audio is persisted after processing, and no transcript/spoken text may appear in logs
  (QA-16 / Ley 1581 — already test-enforced in the matcher logger).
- Blind counting: no test fixture may show theoretical stock to the operator path (QA-12).

## Reliability matrix (Layer 4 — pitch deliverable)

One row per scenario, populated only from executed L2/L3 runs. This exact table (plus the recorded
demo video) is the pitch artifact Daniel asked for.

| Scenario | Reliability % | Max proven capacity | Where it fails | What it cannot do |
| --- | --- | --- | --- | --- |
| Product match, exact dictation | 98.37% top-1, 100% recall@3 (n=430) | 1,405-row catalogue, 8 warehouse codes | 7/430 top-1 misses (all recovered within top 3: 6 at rank 2, 1 at rank 3) | Cannot distinguish SKUs whose names differ only by data absent from dictation |
| Product match, garbage input | 99.46% correct rejection (1/184 false-confidence) | 300-char input cap | Confident match on 1 adversarial phrase | Cannot flag ambiguity when `MATCH_MAX_CANDIDATES=1` (documented footgun) |
| Matcher availability | Verified: healthy ≤ 12 s; retry drill 3 warned attempts → exit 3 → restart layer | — | Wedged-but-alive process is not auto-restarted (healthcheck has no consumer) | No auth/rate-limit (demo scope) |
| STT es-CO, quiet / noisy | *pending C4* | *pending* | *pending* | *pending* |
| Multi-item split | *pending C1* | *pending — this is the "capacidad máxima probada"* | *pending* | *pending* |
| Tri-model consensus | *pending C5* | *pending* | *pending* | *pending* |
| End-to-end record creation | *pending C2/C7* (≤ 20–30 s target) | *pending* | *pending* | *pending* |
| Offline sync | *pending C9* | *pending* | *pending* | *pending* |

## Evidence already banked

| Asset | What it proves | Where |
| --- | --- | --- |
| Matcher suite: 298 tests green, strict TDD | L1 for Module 3, incl. cache bound, input caps, log privacy, startup retry | `services/matcher/tests/` (PR #3) |
| Matcher eval gate | 0.9860 / 1.0000 over 430 labelled cases; garbage false-confidence 0.0054 | `tests/eval/test_eval_accuracy.py` |
| Judgment Day adversarial review | Dual blind judges, terminal APPROVED; availability drill passed live in Docker | `openspec/changes/add-matching-service/judgment-day-ledger.md` |
| STT suite: 98 tests + benchmark harness | L1 for Module 1; vendor fallback (Deepgram→Groq) | `services/stt/` (PR #2) |

## Ownership and sequencing

| Who | What |
| --- | --- |
| Daniel + Braejan (technical) | C5 consensus rig, C7 load rig, C8 drills, matrix automation |
| Adriana + team (QA, per 01:38:50 role split) | Real-voice datasets (C1/C2/C4), use-case scripts, executing L2 tables, matrix curation |
| Everyone before the demo | Record the demo video (safety net vs. "el 0.08 pasa en el pitch"), rehearse with the matrix |

Priority order for the remaining work: **C1 → C4 → C5** (they gate the pitch's precision claim),
then C2/C7 (latency + capacity numbers), then C9.

## Checklist — definition of done for this plan

- [ ] Every campaign C1…C9 has a recorded breaking point (no "passed at level 1 and stopped").
- [ ] Reliability matrix has zero *pending* rows before the pitch.
- [ ] Max proven capacity (items per note) appears in the onboarding script and the pitch.
- [ ] Demo video recorded on the same build the matrix was measured on.
- [ ] End-to-end error rate demonstrated < 1%, or the gap is explicitly listed in "what it cannot do".
