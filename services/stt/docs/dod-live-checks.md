# Definition of Done — live-key checks

These four checks need real vendor credentials, so they cannot run in CI and
they were not run during implementation. They gate the Definition of Done of the
`implement-stt-service` change; they do **not** gate the mocked test suite,
which is green.

Whoever has the keys runs these and records the outcome here — with the
transcript redacted, because a real clip is personal data (Ley 1581).

Setup for all four:

```bash
cd services/stt
cp .env.example .env      # fill in DEEPGRAM_API_KEY and GROQ_API_KEY
docker compose up -d --build
curl -s localhost:8001/health
```

---

## [ ] T21 — `mip_opt_out=true` accepted, and what it costs

Deepgram's zero-retention flag is sent on every request. Confirm the vendor
accepts it and check whether it changes the billed rate — this is design open
question 3, unresolvable without a live account.

- POST a clip with a live Deepgram key (the service always sends
  `mip_opt_out=true`).
- Record: HTTP status, and the rate shown for that request in the Deepgram
  console.

**Result**: _(pending — record status and observed billed rate)_

---

## [ ] T22 — Real clip transcribes end to end

- `docker compose up -d` with a real `.env`; `curl :8001/health` returns
  `{"status":"ok","vendor":"deepgram"}`.
- POST a real es-CO push-to-talk clip.
- Expect `200`, a verbatim transcript, and `is_garbage: false`.

**Result**: _(pending — record the response body with `raw_transcript` redacted)_

---

## [ ] T23 — Vendor swap with both keys

The kill criteria in spike 01 require swapping vendors mid-build. Prove one env
var is enough.

- Same clip with `STT_VENDOR=deepgram`, then with `STT_VENDOR=groq`.
- `/health` must report each vendor; both responses must carry the six frozen
  fields.
- Note that Groq's confidence is a derived proxy, so the two numbers are not
  comparable — record both, compare neither.

**Result**: _(pending — record both `stt_vendor` values and both confidences)_

---

## [ ] T24 — Chunked MediaRecorder timeslice blob

Chunked webm usually carries no duration header. This is the path where a
forced `0` would falsely flag garbage, which is why the field is nullable.

- POST a real `MediaRecorder` timeslice blob.
- Expect a correct transcript with `audio_duration_ms: null` and
  `is_garbage: false`.

**Result**: _(pending — record the null duration and the garbage flag)_

---

## Also outstanding, outside this file

**T25 — ratify the frozen shape with Daniel** (06:00 contract sync). Confirm
`audio_duration_ms: int | null` and the six-field shape. If the sync changes
anything, amend `openspec/changes/implement-stt-service/specs/stt-transcription/spec.md`
and re-run the Phase 3 tests.
