# Exploration: Module 1 — Speech-to-text backend service (implement-stt-service)

## Current State

No Module 1 code exists yet in the worktree — no `src/`, no `services/stt/`, no
FastAPI/httpx/pydantic-settings/pytest-asyncio/respx in `pyproject.toml`
(current deps: `pandas`, `openpyxl`, dev `rapidfuzz`/`unidecode`, leftovers from
the Module 3 matching spike and the SQLite build tooling). The vendor research
and build spec live in committed spikes (`spikes/01-speech-to-text.md`,
`spikes/05-stack-module-1-stt.md`, `spikes/03-integration-risks.md`,
`spikes/04-next-steps.md`, commit `51c9fa1`) and are complete and decided.
`openspec/config.yaml` already reflects the post-spike stack (strict TDD on,
FastAPI/httpx/pydantic-settings, Module 1 on :8001) and is authoritative;
`openspec/project.md` is stale ("Runtime/language: Not selected") and should get
a follow-up doc-fix but is not a blocker. PRD (`docs/prd.md`) confirms RNF-04
(voice not stored, legal caveat open for future storage, lines 346–349), RF-17
(ITN, line 293), RNF-14 (native es-CO, WER 4–6% target, line 344).

## Affected Areas (for the follow-up proposal)

- `pyproject.toml` / `uv.lock` — add FastAPI, uvicorn, httpx, pydantic-settings,
  pytest-asyncio, respx.
- New `services/stt/` — FastAPI app, `POST /transcribe`, `GET /health`,
  Deepgram/Groq vendor adapters behind `STT_VENDOR`.
- New `services/stt/docker-compose.yml`, `services/stt/Dockerfile` per
  `spikes/05-stack-module-1-stt.md`.
- New `benchmarks/` — corpus, `run.py`, `report.py` (first-class deliverable,
  not deferred).
- `openspec/project.md` — stale stack description, candidate for a small
  doc-fix task.
- `spikes/01-speech-to-text.md:137` and `spikes/README.md:29` — stale
  `language=multi`/"multilingual" phrasing left over from before the es-CO
  scoping decision; the decision section and `05-stack-module-1-stt.md`
  (`STT_LANGUAGE=es`) are authoritative and win.

## Approaches

1. **Deepgram Nova-3 Spanish-only, primary; Groq whisper-large-v3-turbo,
   runtime-switchable fallback** (the decided approach)
   - Pros: both offer genuine self-serve zero-retention (RNF-04 compliant);
     es-CO scoping (`language=es`) is both a scope requirement and a plausible
     accuracy win on short push-to-talk utterances; httpx-only (no vendor SDK)
     makes the fallback a function swap, not a dependency change; stateless
     service, cheap to test with `respx`.
   - Cons: `mip_opt_out=true` billing impact unverified; no independent Spanish
     benchmark exists for either vendor — only vendor-self-reported WER;
     garbage-clip hallucination behavior unmeasured for the chosen config.
   - Effort: Medium (stack is fully specified; main work is adapters + tests +
     benchmark harness).

2. **ElevenLabs Scribe v2** — rejected: zero-retention is Enterprise-only and
   "may be restricted at ElevenLabs' sole discretion," failing RNF-04 on a
   self-serve account, despite best self-reported Spanish accuracy (3.1% WER
   FLEURS-es).

3. **OpenAI gpt-4o-transcribe** — rejected: 30-day default retention, ZDR needs
   an Enterprise account team; also documented to "smooth"/paraphrase
   transcripts (digit-accuracy risk) and to leak prompt-based glossary terms
   into near-silent-audio output — exactly the garbage-clip population.

4. **Self-hosted faster-whisper** — rejected: zero-retention by construction
   but requires ffmpeg, a hand-built VAD gate, no built-in Spanish numeral
   handling — too much day-1 engineering under time pressure.

5. **Audio-native LLM (collapse STT + extraction into one call)** — rejected:
   chat-tuned audio models are documented to be weakest at digit accuracy;
   OpenAI's audio-native path cannot combine audio input with guaranteed
   structured JSON; it destroys the Module 1/Module 2 diagnostic boundary.
   Gemini's audio-native path is untested for Spanish numeric accuracy —
   timeboxed as a future data point, not this change.

## Recommendation

Proceed with the decided approach (Deepgram Nova-3 `language=es` primary, Groq
fallback via `STT_VENDOR`), per `spikes/01-speech-to-text.md` and
`spikes/05-stack-module-1-stt.md`. It is already well-evidenced and the
retention-posture criterion (RNF-04) makes it the only self-serve-compliant
option among the commercial candidates evaluated. The proposal should scope the
service plus the benchmark harness together, and carry the open/unverified
items forward as explicit verification tasks with pass/fail criteria — not
resolve them silently.

## Risks

- `mip_opt_out=true` may change Deepgram's billed rate — unverified against a
  live key.
- Chunked webm (MediaRecorder timeslice mode) often lacks a duration header and
  can trip server-side decoders — untested against the actual vendors.
- Garbage-clip hallucination rate is unmeasured for the chosen vendor/config;
  kill criterion in the spike says add a browser-side VAD/energy gate
  (frontend, out of this service's scope) if both vendors fail.
- No independent Spanish benchmark exists for Deepgram/Groq/ElevenLabs/OpenAI —
  only vendor-self-reported WER; the benchmark harness itself has a known
  corpus-validity risk (family-recorded scripts, same-person record+label)
  flagged in `spikes/03-integration-risks.md` #2, unresolved and cross-module.
- Ley 1581 legal gap: "we don't store audio" alone does not discharge Ley 1581
  obligations for the transcript/operator-identity data — flagged in
  `spikes/03-integration-risks.md` #8, needs a one-line authorisation-basis fix
  (not a build blocker for this service, but worth carrying into the
  proposal/design).
- Doc drift in the spike itself: `language=multi` phrasing at
  `spikes/01-speech-to-text.md:137` and `spikes/README.md:29` predates the
  es-CO scoping decision and should be corrected in a small follow-up, not
  treated as current guidance.

## Ready for Proposal

Yes. The vendor decision, service contract, and stack are stable and evidenced;
sdd-propose can proceed, carrying the open risks forward as explicit
verification/benchmark tasks.
