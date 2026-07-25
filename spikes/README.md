# Spikes — Braejan's two core modules

Research + measurement spike for the two critical modules Braejan owns, per the
24 Jul meeting (`00:45:08`–`01:11:26`):

- **Module 1 — Speech-to-text**: audio in → faithful Spanish text out.
- **Module 3 — Product match**: `{product_name_spoken}` → SKU in that catalogue,
  or the new/unmapped-article flow.

Both must demonstrate **< 1 % error** through automated benchmarking.

| Document | Content |
| :--- | :--- |
| [01-speech-to-text.md](01-speech-to-text.md) | 5 STT options, adversarial review, decision, kill criteria |
| [02-product-matching.md](02-product-matching.md) | 5 matching options, **measured** benchmark on the real catalogue, decision |
| [03-integration-risks.md](03-integration-risks.md) | Cross-module gaps that threaten Saturday and the pitch |
| [04-next-steps.md](04-next-steps.md) | Handoff: build order, contracts, what to re-measure |
| [05-stack-module-1-stt.md](05-stack-module-1-stt.md) | **Build spec** — STT service stack, contract, docker-compose |
| [06-stack-module-3-matching.md](06-stack-module-3-matching.md) | **Build spec** — matching service stack, contract, docker-compose |
| `matching/` | Runnable experiment: 624-case eval set, 7 matchers, results |

Documents 05 and 06 are the entry point for the implementing agents. Each
module is an independent backend service with its own stack and its own
`docker-compose` — they share no process, no datastore and no deployment unit.
Frontend is out of scope for both.

## Decisions in one line each

1. **STT — build against Deepgram Nova-3 with es-CO (`language=es`).** ElevenLabs, the team's
   initial pick, is disqualified for the MVP: zero-retention is Enterprise-gated
   and we require that audio is never persisted. Fallback: Groq
   `whisper-large-v3-turbo`.
2. **Match — build an in-process trigram matcher, not a database search.**
   Measured 98.6 % top-1 / 100 % recall@3 / p95 1.8 ms on the real catalogue.
   No Postgres search, no FTS5, no embeddings, no second datastore.

Both decisions carry explicit kill criteria — read them before writing code.

## Reproducing the matching benchmark

```bash
uv run python spikes/matching/gen_eval_set.py   # regenerates eval_set.json
uv run python spikes/matching/run_eval.py       # headline table
uv run python spikes/matching/threshold_experiment.py
uv run python spikes/matching/extra_experiments.py
```

## Method

Three research agents (STT, matching, Engram source audit), then three
adversarial agents tasked with refuting them. The matching adversary was
required to **measure rather than argue** — it built a 624-case labelled set
from the real catalogue and benchmarked 7 matchers. That measurement overturned
the first recommendation. Where a claim could not be verified, it is marked
as unverified rather than smoothed over.
