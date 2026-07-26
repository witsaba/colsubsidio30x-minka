# Delta for unified-compose-deployment

Base: `openspec/changes/docker-compose-unified-deployment/specs/unified-compose-deployment/spec.md` (capability not yet archived into `openspec/specs/`; this delta applies on top of it). The live compose has since gained `product_identification` (port 8003); the modified blocks below reflect the real post-change service set.

## ADDED Requirements

### Requirement: Redis service as a soft dependency (REQ-UCD-12)

The root Compose SHALL declare a `redis` service. No service SHALL declare `depends_on` on `redis`, and `redis` SHALL declare `depends_on` on no service — the independence promise of REQ-UCD-4 extends to it, with the documented nuance that Redis is a soft cache dependency of the matcher. `SUPABASE_URL`, `SUPABASE_KEY`, `REDIS_URL`, and `CATALOGUE_CACHE_TTL_SECONDS` SHALL flow through `.env.example` → `scripts/setup-env.sh` → `docker-compose.yml` interpolation; `SUPABASE_KEY` SHALL be treated as a secret by the setup script (no echo, blank committed default).

#### Scenario: Redis service present without coupling

- GIVEN the root `docker-compose.yml`
- WHEN it is parsed
- THEN a `redis` service exists and no `depends_on` edge references it in either direction

#### Scenario: Supabase and Redis env vars flow end to end

- GIVEN `.env.example`, `scripts/setup-env.sh`, and the root Compose
- WHEN each is inspected
- THEN `SUPABASE_URL`, `SUPABASE_KEY`, `REDIS_URL`, and `CATALOGUE_CACHE_TTL_SECONDS` are documented in `.env.example`, picked up by the script per REQ-UCD-10, and interpolated into the matcher's environment — with no committed credential value

#### Scenario: Matcher healthy with Redis stopped

- GIVEN Docker access, valid Supabase credentials, and the `redis` service not running
- WHEN `docker compose up matcher` runs
- THEN the matcher reaches its healthy state via Supabase

## MODIFIED Requirements

### Requirement: Root Compose is the sole canonical deployment surface (REQ-UCD-1)

The repository root SHALL contain exactly one Compose file named `docker-compose.yml` that defines the `stt`, `matcher`, `product_identification`, `frontend`, and `redis` services as the project's canonical deployment surface. No other Compose file SHALL exist inside the repository tree. Every documented operator command (root quick path, single-service start, both-service start, validation, build) SHALL resolve through this root file.
(Previously: declared exactly the `services` keys `stt` and `matcher`; the compose has since gained `product_identification` and `frontend`, and this change adds `redis`.)

#### Scenario: Exactly one Compose file is committed

- GIVEN a clean checkout
- WHEN the repository tree is searched for any `docker-compose*.yml` or `compose.y*ml` file
- THEN exactly one match exists: `docker-compose.yml` at the repository root

#### Scenario: Root file defines the full service set

- GIVEN the root `docker-compose.yml`
- WHEN it is parsed
- THEN it declares exactly the `services` keys `stt`, `matcher`, `product_identification`, `frontend`, and `redis`

### Requirement: Preserved per-service deployment contracts (REQ-UCD-3)

The root Compose SHALL preserve, unchanged, the contracts that each service already depends on: STT's build context `./services/stt` with its own `Dockerfile`; matcher's build context `.` (repository root) with `dockerfile: services/matcher/Dockerfile`; every existing environment-variable name and documented default already present for STT (vendor keys with empty defaults, `STT_VENDOR`, `STT_ELEVENLABS_MODEL`, `STT_LANGUAGE`, `STT_MODEL`, `STT_NUMERALS`, `STT_MIP_OPT_OUT`, `STT_CONFIDENCE_FLOOR`, `STT_MIN_SPEECH_MS`, `STT_MAX_UPLOAD_BYTES`, `STT_VENDOR_TIMEOUT_S`, `STT_RETRY_ATTEMPTS`, `STT_RETRY_BACKOFF_S`, `STT_FALLBACK_ENABLED`, `STT_FALLBACK_VENDOR`, `STT_TOTAL_DEADLINE_S`, `LOG_LEVEL`) and for the matcher (`SUPABASE_URL`, `SUPABASE_KEY`, `REDIS_URL`, `CATALOGUE_CACHE_TTL_SECONDS=10800`, `MATCH_ACCEPT_SCORE=0.50`, `MATCH_AMBIGUITY_MARGIN=0.08`, `MATCH_TSR_MARGIN=0.08`, `MATCH_MAX_CANDIDATES=5`, `MATCH_UNIT_RERANK=true`, `STARTUP_RETRIES=3`, `STARTUP_RETRY_DELAY_SECONDS=2.0`); each service's healthcheck against its `GET /health` endpoint (`http://localhost:<port>/health`); each service's `restart: unless-stopped`. The matcher SHALL declare no `./data` volume and no `CATALOGUE_DB` variable.
(Previously: the matcher contract included the `./data:/data:ro` bind mount and `CATALOGUE_DB=/data/bodegas-y-stock.sqlite`.)

#### Scenario: STT service preserves its build context

- GIVEN the root Compose
- WHEN the `stt` service definition is inspected
- THEN `build` resolves to `./services/stt` (its own Dockerfile) and the env-var set, ports, healthcheck, and restart match the existing STT contract

#### Scenario: Matcher preserves its root-context build with no catalogue mount

- GIVEN the root Compose
- WHEN the `matcher` service definition is inspected
- THEN `build.context` is `.` and `build.dockerfile` is `services/matcher/Dockerfile`, no `./data` volume and no `CATALOGUE_DB` variable is declared, and the env-var set, port, healthcheck, and restart match the matcher contract above

#### Scenario: Defaults are non-secret placeholders

- GIVEN the root Compose
- WHEN its `environment` block is inspected for every variable
- THEN vendor secret values and `SUPABASE_KEY` resolve to empty strings (`${VAR:-}`) or documented defaults — no committed credential string is present

### Requirement: Daemon-free configuration and contract validation (REQ-UCD-6)

The project SHALL ship daemon-free validation that proves the root Compose file parses, validates, and preserves the deployment contracts of REQ-UCD-3: the Compose `services` keys (including `redis`), each application service's port mapping, each application service's healthcheck endpoint, the absence of any matcher `./data` mount and of `CATALOGUE_DB`, the matcher's root build context, the absence of `depends_on` between services (including to/from `redis`), and the absence of a secret credential in the committed file. Validation SHALL NOT require a running Docker daemon.
(Previously: validated the presence of the matcher's `./data:/data:ro` mount.)

#### Scenario: `docker compose config` resolves every contract term

- GIVEN the root Compose and no daemon access required
- WHEN `docker compose -f docker-compose.yml config` renders the file
- THEN it exits `0`, `services.stt.ports[0]` resolves to `published: 8001`/`target: 8001`, `services.matcher.ports[0]` to `published: 8002`/`target: 8002`, `services.matcher` declares no `./data` volume and no `CATALOGUE_DB` variable, `services.matcher.build.context` is the repository root with `dockerfile: services/matcher/Dockerfile`, a `services.redis` block exists, and no service's `depends_on` references another

#### Scenario: Secret-leak guard rejects committed credentials

- GIVEN a hypothetical committed file under the root Compose tree containing `SUPABASE_KEY=<real-looking-key>` (or `DEEPGRAM_API_KEY=<real-looking-key>`)
- WHEN the secret-leak validation runs against the working tree
- THEN it fails with a message naming the offending variable

### Requirement: Conditional runtime smoke evidence (REQ-UCD-7)

When Docker daemon access is available, a deployed stack SHALL produce evidence that each service can reach its healthy state (`GET /health` returns its documented success body): STT healthy when `stt` runs alone, matcher healthy when `matcher` runs alone, and both healthy when the stack runs together. A missing active-vendor credential SHALL skip only STT-dependent smoke evidence; missing Supabase credentials SHALL skip only matcher-dependent smoke evidence. Docker unavailability SHALL skip all runtime smoke; the daemon-free validation of REQ-UCD-6 is the contract guarantee in that case. Skipped stages MUST be reported with a named reason rather than silently dropped.
(Previously: matcher smoke was gated on `data/bodegas-y-stock.sqlite` being present.)

#### Scenario: STT reaches `/health` when started alone

- GIVEN Docker access and a non-empty value for the active STT vendor key (Deepgram or Groq, per `STT_VENDOR`)
- WHEN `docker compose up stt` runs and the command polls `http://localhost:8001/health`
- THEN the response is `200` with a JSON body reporting `status: "ok"` and a `vendor` field equal to the active vendor name

#### Scenario: Matcher reaches `/health` when started alone

- GIVEN Docker access and valid Supabase credentials configured
- WHEN `docker compose up matcher` runs and the command polls `http://localhost:8002/health`
- THEN the response is `200`

#### Scenario: Both services healthy when started together

- GIVEN Docker access, active STT vendor credentials, and valid Supabase credentials
- WHEN `docker compose up` runs
- THEN both `http://localhost:8001/health` and `http://localhost:8002/health` return their `200` healthy bodies

#### Scenario: Runtime checks are skipped without Docker access

- GIVEN a host with no reachable Docker daemon
- WHEN the validation pipeline runs
- THEN the daemon-free checks of REQ-UCD-6 still execute and the runtime smoke stage is reported as skipped with a reason

#### Scenario: Runtime checks are skipped without credentials

- GIVEN Docker access but a blank active STT vendor key or blank Supabase credentials
- WHEN the validation pipeline runs
- THEN only the smoke stages depending on the missing credential are skipped, each with a reason naming it
