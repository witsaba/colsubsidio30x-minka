# Design: Unified Docker Compose Deployment

## Technical Approach

Replace the two service-local Compose files with a single root `docker-compose.yml` (Compose v2, no `version:` key) defining both `stt` and `matcher`. Service-local files and references are removed. Build contexts are rewritten relative to the repository root; defaults move to one root `.env.example`; `.env` is git-ignored. Daemon-free validation uses `docker compose -f docker-compose.yml config --no-interpolate --format json` (Compose v2.0+) so `${VAR:-}` placeholders reach the validator verbatim and resolved credentials never enter stdout. Pytest text-matcher fallback ensures RED before any green. Runtime smoke is conditional on `docker info` and active STT vendor key.



## Architecture Decisions

| # | Choice | Rationale |
|---|---|---|
| D1 | Single root `docker-compose.yml` | REQ-UCD-1/8 mandate one canonical surface |
| D2-D4 | Compose v2 (no `version:`); no `depends_on`; default network (no `networks:`) | Existing files omit `version:`; services independent (REQ-UCD-4/9); no inter-service traffic |
| D5-D7 | STT `build: ./services/stt`; matcher `build: { context: ., dockerfile: services/matcher/Dockerfile }`; matcher volume `./data:/data:ro` | Reuse existing Dockerfile; preserve root-context contract and `:ro` mount |
| D8 | STT keys `${VAR:-}`, matcher pinned literally | JD-4: empty keys tolerated for Groq-only / fallback |
| D9 | Single root `.env.example` | REQ-UCD-5; variables do not collide |
| D10 | `docker compose config --no-interpolate --format json` primary; pytest fallback | REQ-UCD-6; `--no-interpolate` keeps `${VAR:-}` placeholders, so credentials cannot leak. Min Compose: v2.0+ |
| D11 | Runtime smoke gated on `docker info` + active-vendor key | REQ-UCD-7: conditional skip with named reason, never silent drop |

| D12 | Migrate `test_container.py`; delete service-local compose + STT env + gitignore | Shims re-introduce drift REQ-UCD-1 forbids |
| D13 | **Supersedes D8**: matcher tunables become `${VAR:-<same default>}` rather than literals | REQ-UCD-10 makes `.env` the single control surface; the reviewed default still applies with no `.env` present, and `test_container.py` keeps cross-checking it against `matcher.config.Settings`. `STT_LANGUAGE`, `STT_MODEL`, `STT_NUMERALS`, `STT_MIP_OPT_OUT` and `STT_CONFIDENCE_FLOOR` stay literal: REQ-VND-1 freezes the request shape and RNF-04 forbids making the training opt-out operator-tunable |
| D14 | `scripts/setup-env.sh` is driven by `.env.example` alone — variable set, order, help text, and secret detection by name suffix | REQ-UCD-10 / REQ-UCD-9: adding a service must touch two files (`docker-compose.yml`, `.env.example`) and nothing else. A registry inside the script would be a third |
| D15 | Pinned `name: colsubsidio30x-minka` | REQ-UCD-11; this repository is developed across many git worktrees, where a directory-derived project name silently forks the stack |
| D16 | `smoke-compose.sh` leaves the stack up by default; `--ephemeral` opts into `docker compose down` via `trap` | The operator's goal is a running stack; unconditional teardown would make the script useless for the very command it exists to prove. CI passes `--ephemeral` |



## File Changes

| Action | Files |
|---|---|
| Create | `docker-compose.yml` (root — canonical surface, no `depends_on` / `networks:` / `secrets:`); `.env.example` (root — vendor keys blank, others non-secret); `docs/deployment.md`; `scripts/smoke-compose.sh` (named skip reason, `trap`-based cleanup); `tests/deployment/test_root_compose.py`; `tests/deployment/test_compose_config.py` |

| Modify | `.gitignore` (add `.env`); `pyproject.toml` (`testpaths` → `["services/matcher/tests", "tests/deployment"]`); `services/stt/README.md` + `services/stt/docs/dod-live-checks.md` (root commands); `services/matcher/tests/unit/test_container.py` (repoint `compose` to root, preserve `Settings` cross-check); `openspec/project.md` (root commands); `openspec/config.yaml` (`verify.build_command: docker compose build`; `testing.layers` gains `deployment`) | |

| Delete | `services/stt/docker-compose.yml`, `services/matcher/docker-compose.yml`, `services/stt/.env.example`, `services/stt/.gitignore` — subsumed by root |

## Interfaces / Contracts

STT `:8001`; matcher `:8002` + `./data:/data:ro`. Env from root `.env` or `--env-file <path>`. Root `docker-compose.yml` keeps the env-block, healthcheck, restart, port, and volume contracts. No `version:`, `networks:`, `depends_on`, or `secrets:`. Validator output is parsed only for non-interpolated placeholder keys, never values.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Repository | Compose count = 1; non-secret env; port uniqueness; no `depends_on` sibling; no secret-shaped strings; no compose files under `services/`; no `-f services/` in operator docs | `tests/deployment/test_root_compose.py` (string/regex) |
| Daemon-free + sentinel-leak (RED) | JSON matches REQ-UCD-3/4; sentinels for the three STT vendor API keys absent from validator output, pytest failure messages, or persisted output | `tests/deployment/test_compose_config.py` shells `docker compose config --no-interpolate --format json`; captures to temp file; asserts sentinels absent; failure prints placeholder name only; skipped if binary absent |



| Container contract (re-aimed) | Dockerfile + compose env/default cross-check, port, healthcheck, restart, read-only mount, build context | Migrate `services/matcher/tests/unit/test_container.py` to root-relative assertions; preserve all existing matcher container-contract cases |
| Runtime smoke (conditional) | `/health` 200 for `stt` alone, `matcher` alone, both | `scripts/smoke-compose.sh` via marker-gated pytest: skip STT on blank active-vendor key, skip all on `docker info` fail |


## Threat Matrix

Git/VCS rows from `references/threat-matrix.md` are N/A (no docs-like exec paths, VCS/PR automation, or commit/push/PR commands). Process-integration rows:


| Boundary | Adversarial cases | Safe / failure behavior | Planned RED tests |
|---|---|---|---|
| `docker compose ... config --no-interpolate` | binary absent / daemon absent / sentinel env exported / malformed compose | Exit 0 + JSON stdout when valid. `--no-interpolate` mandatory: stdout contains `${VAR:-}` placeholders only. Skipped (named reason) when binary absent | Run with sentinels; capture to temp file; assert sentinels absent; assert exit 0 |
| `docker info` | reachable / unreachable | Exit 0 → smoke runs; non-zero → skip with named reason | Marker-gated test asserts `subprocess.run(["docker","info"], check=False).returncode == 0` gates smoke; else skip |

| `scripts/smoke-compose.sh` | `up` succeeds / fails healthcheck / `/health` never 200 / cleanup failure | `docker compose down -v --remove-orphans` on exit via `trap`; logs skip reason; never prints/persists credentials | pytest subprocess invokes script; asserts cleanup ran; asserts `/health` body shape without echoing credentials |
## Migration / Rollout

Single PR. Order: (1) add root `docker-compose.yml` + `.env.example`; (2) migrate matcher container tests to root compose; (3) delete service-local compose + STT env artefacts; (4) update operator docs; (5) add `docs/deployment.md`; (6) add daemon-free + sentinel-leak + smoke tests. Rollback: `git revert`. **Review Workload Forecast (informational only — sdd-tasks MUST recompute and emit before apply):** `Decision needed before apply: <budget / single-vs-chained>`, `Chained PRs recommended: <yes/no>`, `<risks / budget headroom>`.






