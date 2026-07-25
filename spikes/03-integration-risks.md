# Spike 03 — Cross-module risks

What neither module owner is looking at. Ranked by what sinks the demo, not by
interest. Sized in hours, with an owner.

## Demo-killers

### 1. RF-11 cannot be built with the data we have
`RF-11` (Must) says the audit plan determines the warehouse **and its
catalogue**. The real dataset is 8 category-level stock tables (56–345 rows)
plus a flat list of 48 warehouse *names* with **no join key** between them.
"Select a warehouse → its catalogue loads" is not implementable — it is a
missing column in the source Excel, not a bug.

**Mitigation (~3 h, Braejan)**: pick one stock table as *the* demo catalogue,
relabel the UI step "select audit category" rather than "select warehouse", and
say it out loud in the pitch: today's catalogue is scoped to one stock
category; per-warehouse mapping needs a join key Colsubsidio has not provided.
Anything else invites "which warehouse is this?" on stage.

### 2. The benchmark corpus is unowned, and its method invalidates the headline claim
Family members reading prepared scripts is not an operator dictating while
holding a product — different pacing, prosody and disfluency. And if whoever
recorded a clip also labels it, that is not measurement, it is self-grading.

**Minimum defensible fix (~4–6 h, unowned — assign it)**:
- whoever transcribes a clip must not be whoever recorded it;
- get 30–50 clips of genuinely spontaneous speech: hand someone an object and a
  number on a card, let them say it however they want;
- record garbage clips with real ambient noise, not clean silence — silence and
  noisy nothing fail differently in Whisper-family models;
- phrase the claim as "N clips, team and families, preliminary validation", not
  as a population-level accuracy.

### 3. The Module 1 → Module 2 seam is undefined
Braejan produces text; Daniel consumes it. Undefined: the JSON shape, garbage
signalling, who owns ITN, what an empty/low-confidence transcript means,
whether multi-item audio arrives as one blob or pre-split.

**Freeze at the 06:00 sync (~2 h, Braejan + Daniel)**:
```json
{ "raw_transcript": "string", "is_garbage": false, "stt_confidence": 0.0,
  "audio_duration_ms": 0, "stt_vendor": "string" }
```
ITN (RF-17) belongs to Module 2 — its prompt already emits structured output.

### 4. The latency budget breaks on exactly the hard inputs
Target ≤ 20–30 s. Real path: webm upload over venue wifi + STT + three parallel
LLM calls + **a full extra round trip whenever the three disagree** + match +
render. Disagreement is likeliest on multi-item, accented or ambiguous-SKU
input — i.e. whatever a juror improvises.

**Mitigation (~3–4 h, both)**: measure on venue-like wifi, not office
broadband. Hard client-side timeout with a calm "still processing" state
instead of a silent hang. Script the live demo around inputs already proven
fast.

### 5. The likeliest on-stage failure is a hang, not a crash
Wifi drop, cold-start spike, or a false anomaly firing and preventively
blocking the next recording right when momentum matters.

**Insurance (~2 h)**: rehearse the exact live phrases 10+ times on the venue
network; pre-warm connections before walking on; keep a one-click pre-recorded
run of *the same phrase* as a semi-live fallback — cutting to the full canned
video mid-demo reads as a tell.

## Credibility risks

### 6. The consensus math does not hold as stated
"A single model ran ≈82 % … consensus raises precision to ≈99.92 %, borrowed
from aerospace redundancy" has two problems: the 82 % comes from a different
task, and aerospace redundancy assumes **independent** failure modes. Three LLMs
fed the same transcript, the same prompt, and overlapping training data are
correlated — they agree-and-are-wrong precisely on the hard cases. "Did all
three ever fail on the same clip?" is an easy question to lose.

**Honest phrasing that still sells**: "Three-model majority voting catches
one-off glitches and flags disagreement for automatic reprocessing instead of
silently guessing. On our benchmark the models agreed on X % of clips;
disagreement triggered reprocessing on Y %." Report the measured agreement
rate. (~2 h Daniel to compute, ~1 h Edith/Adriana to reword the slide.)

### 7. "< 1 % error" will be heard as a claim about real operators
Same root cause as #2. Fix the protocol, then scope the claim explicitly in the
deck.

### 8. "We don't store audio" does not discharge Ley 1581 de 2012
Not persisting audio is a good decision that reduces exposure, but the law
attaches to processing personal data generally — the transcript, the operator's
identity and the timestamp of what they counted are still personal data tied to
an identifiable employee. Authorisation and clear notice of purpose are what the
law asks for; voice becomes *sensitive* data specifically when used for
biometric identification, which we do not do.

**Fix (~1 h, Adriana)**: one corrected line — "operator identity and count
transcripts are processed under the existing employment-relationship
authorisation; we further minimise exposure by never persisting raw audio."
Not a blocker for Sunday; a real gap for production.

### 9. Matching accuracy must be reported split by has-code vs no-code
18.4 % of rows have no article code, and the known ambiguity clusters sit inside
that population. A single blended number hides it. (~1 h, Braejan — reporting
only, no new engineering.)

## Nice to have

- Duplicate/misspelled warehouse names in the source sheet (`cafeteria acuario
  suministros` twice; `parqueadero`/`paqueadero`) — cosmetic unless the UI lists
  them verbatim.
- The PRD still carries offline-first (RNF-08) as unratified while the team has
  dropped it. One-line doc fix.
- Two operators counting the same warehouse concurrently is unaddressed
  anywhere. One sentence of Q&A prep, not an engineering fix.
- Verify the mockups distinguish "record accepted" from "still processing" —
  that distinction is what makes the async-validation flow legible.
