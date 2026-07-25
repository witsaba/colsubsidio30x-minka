# Spike 01 — Speech-to-text (Module 1)

Owner: Braejan. Decision date: 2026-07-24. Status: **decided, pending a
one-hour empirical check before the build commits.**

## Decision

**Build against Deepgram Nova-3, Spanish-only** (`model=nova-3`,
**`language=es`**, `numerals=true`, `mip_opt_out=true`).

> **Scoping decision, 2026-07-24**: the MVP is **es-CO only**. No multilingual
> mode, no code-switching, no language detection, no i18n layer. The audience is
> Colombian. This is a software scope constraint, and it changes the build
> parameter: use the dedicated Spanish model, not `language=multi`.

**Fallback, promoted to co-favourite: Groq `whisper-large-v3-turbo`.**

**ElevenLabs Scribe v2 is disqualified for the MVP**, reversing the preference
stated in the meeting (`00:54:21`). Reason below — it is a hard-requirement
failure, not a quality judgement.

## Why ElevenLabs is out

Our requirement is that **audio is never persisted** (PRD RNF-04, the position
Adriana's legal research produced). ElevenLabs' Zero Retention Mode is
**Enterprise-only**, and its own documentation adds that it "may be restricted
at ElevenLabs' sole discretion". The `enable_logging=false` parameter exists in
the API but is gated behind the same Enterprise plan. A hackathon team on a
self-serve account cannot satisfy the requirement.
<https://elevenlabs.io/docs/eleven-api/resources/zero-retention-mode>

This is worth stating plainly to the team, because ElevenLabs had the best
Spanish accuracy numbers of any candidate (3.1 % WER on FLEURS-es, 5.5 % on
Common Voice-es) and the largest keyterm budget. It loses on a compliance
constraint we chose ourselves, not on merit. If someone gets an Enterprise
conversation confirmed before Saturday morning, this decision reopens.

## Retention posture — the criterion that decided it

| Vendor | Default | Zero-retention on a self-serve account |
| :--- | :--- | :--- |
| **Deepgram** | Auto-enrolled in the Model Improvement Partnership — audio **is** retained for training | **Yes** — `mip_opt_out=true`, a request parameter, no plan upgrade. Forfeits an MIP discount |
| **Groq** | Not retained for inference; abuse logs ≤ 30 days | **Yes** — ZDR toggle on the Data Controls page, all tiers, explicitly covers `/openai/v1/audio/transcriptions` |
| **ElevenLabs** | Retained per privacy policy | **No** — Enterprise only |
| OpenAI `gpt-4o-transcribe` | 30-day retention | No — ZDR requires an Enterprise account team |

**Action before writing integration code**: confirm with a live API key that
`mip_opt_out=true` is accepted and does not change the billed rate. Deepgram's
published ~$0.26/hr may assume MIP participation; that is unverified.

## The five options

| | Deepgram Nova-3 multi | Groq whisper-large-v3-turbo | ElevenLabs Scribe v2 | OpenAI gpt-4o-transcribe | Self-hosted faster-whisper |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Spanish numerals → digits | `numerals=true`, documented for es | Whisper default, inconsistent | `apply_text_normalization` | inconsistent, documented | none built in |
| Vocabulary biasing | keyterms ~100 words | prompt, 224 tokens, weak | keyterms (large) | prompt — **leaks into output on near-silent audio** | `initial_prompt`, 224 tokens |
| Garbage-audio robustness | VAD suppression documented | Whisper hallucination risk | undocumented | prompt-leak hallucination documented | you build the VAD gate |
| webm/opus direct | yes | yes | yes | yes | needs ffmpeg |
| Go SDK | official | OpenAI-compatible | none official | community | n/a |
| Zero retention self-serve | yes | yes | **no** | no | by construction |
| Price | ~$0.26/hr | $0.04/hr | $0.22/hr | $0.36/hr | GPU rental |

## Findings that changed the shape of the decision

**Cost is not a criterion at our volume.** 300 clips × 5 providers × 3 runs ≈
25 hours of audio ≈ **under $10 total** at the most expensive option. Ranking
$0.22 against $0.26 per hour is noise dressed as signal. Removed from the
criteria.

**The Go SDK tiebreaker is nearly worthless.** STT for every candidate is a
single multipart POST with a bearer token — an hour of `net/http` +
`mime/multipart`. Real, but it should not move a ranking.

**Keyterm biasing is oversold and possibly harmful.** A catalogue is hundreds of
SKUs; Deepgram allows ~100 words. Curating a subset is real day-1 work with
uncertain payoff, and Module 3 exists precisely to resolve product names
against the catalogue. Worse, prompt-based biasing is documented to leak
glossary words into transcripts of near-silent audio on `gpt-4o-transcribe` —
which is exactly our ~70 garbage clips. **Do not build keyterm curation on
Saturday.**

**No independent Spanish benchmark exists for the commercial options.** The
HuggingFace Open ASR Leaderboard's multilingual track covers open-weight models
only — Deepgram, ElevenLabs and OpenAI do not appear. Every WER figure quoted
for the paid APIs is vendor-self-reported on the vendor's own benchmark. We are
choosing between marketing claims until our own corpus runs. Say this honestly
rather than quoting vendor WER in the pitch.

**`smart_format` is asymmetric in multilingual mode.** English segments get full
NER-based formatting; Spanish segments get punctuation only. The standalone
`numerals` feature is separately documented as working for Spanish, but the two
are not equivalent and vendor copy blurs them. **This is the single claim the
first-hour test must settle.** Scoping to `language=es` removes the multilingual
detection layer entirely, which should reduce — but not automatically
eliminate — this risk; still verify empirically.

**Spanish-only is an accuracy win, not just a scope cut.** Deepgram documents
that `language=es` "may yield a measurable improvement for short utterances,
as multilingual detection adds complexity that can impact short utterance
accuracy". Our utterances are short by design (push-to-talk, one to a few items
per note), so this lands squarely on our worst case. Monolingual is also billed
at a different — lower — rate than multilingual.
<https://developers.deepgram.com/docs/models-languages-overview>,
<https://deepgram.com/learn/deepgram-expands-nova-3-with-spanish-french-and-portuguese-support>

**"Voxtral is too new" was a bad reason.** Mistral Voxtral Transcribe 2 shipped
2026-02-04 — five months of production mileage, ~4 % WER on FLEURS top-10,
$0.003/min. The team's caution about a genuinely bleeding-edge Microsoft model
got applied to something else. Conclusion (deprioritise) stands only because
its retention terms and Spanish numeral handling were never researched — not
because it is new.

## Audio-native LLM (STT + extraction in one call) — evaluated, rejected

Would collapse Modules 1 and 2 into a single call returning
`{product, quantity, unit}` JSON directly from audio. Rejected for this
weekend, for three reasons:

1. **Digit accuracy is where chat-tuned audio models are weakest.**
   `gpt-4o-transcribe` is documented to "smooth" transcripts — paraphrasing
   rather than transcribing verbatim. A model that smooths is a model that may
   silently reinterpret *novecientos*.
2. OpenAI's audio-native path **cannot combine audio input with guaranteed
   structured JSON output** (function calling only) — an engineering gap, not a
   hypothetical.
3. It destroys the module boundary between Braejan's and Daniel's work. With
   under 30 hours left, being able to answer "was that a transcription error or
   an extraction error?" is worth more than the saved hop.

Gemini's audio-native path is more promising on paper but no vendor-neutral
evaluation of its Spanish numeric accuracy was found. **Timebox: one hour, 20–30
clips, as a data point for a later iteration. It must not block the build.**

## First-hour empirical check (before committing build time)

1. 20 clips: clean speech, warehouse-noise speech, and 5 garbage clips.
   Through Deepgram (`numerals=true, language=multi`) and Groq in parallel.
2. Score exactly two things:
   - **digit accuracy** — hand-count every "said 90, transcribed 900" error;
   - **hallucination rate on the garbage clips** — did either invent
     inventory-shaped text from silence or noise?
3. Confirm `mip_opt_out=true` and Groq's ZDR toggle work against real keys.
4. Push 3–5 raw MediaRecorder blobs recorded **in timeslice chunks** through
   both. Chunked webm often lacks a duration header and trips server-side
   decoders — a build risk independent of vendor choice.

## Kill criteria — switch to Groq mid-build if

- Deepgram's `numerals` silently no-ops or degrades on Spanish segments (the
  `smart_format` asymmetry bleeding into `numerals` itself). Groq's raw Whisper
  transcript can then be post-processed with a Spanish number parser **we
  control**, which is strictly more debuggable than trusting vendor-side ITN.
- `mip_opt_out=true` turns out to need a plan we do not have today.
- Garbage-clip hallucination exceeds a low single-digit percentage. **If both
  vendors fail this, do not shop for a third under time pressure** — add a
  browser-side VAD/energy gate so silent clips never reach the API at all.

## Open, unverified

- Whether `mip_opt_out=true` changes Deepgram's billed rate.
- ElevenLabs Scribe v1 deprecation status (found neither way).
- Voxtral Transcribe 2 retention terms and Spanish numeral handling.
- Gemini audio-native numeric accuracy in Spanish.
- Real behaviour of any vendor on Spanish filler speech ("eh", "este") and on
  pure silence — only our own corpus will answer this.

## Interface this module must expose (freeze at the 06:00 sync)

```json
{ "raw_transcript": "string", "is_garbage": false, "stt_confidence": 0.0,
  "audio_duration_ms": 0, "stt_vendor": "string" }
```

**Inverse Text Normalisation (RF-17, "novecientos" → 900) is assigned to
Module 2**, not here: the extraction prompt already produces structured output
and can normalise numbers as part of it. Module 1 returns what was said.
