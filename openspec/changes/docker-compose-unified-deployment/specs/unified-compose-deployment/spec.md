# unified-compose-deployment Specification

## Purpose

Defines the repository-root Docker Compose surface as the sole canonical deployment definition for the project: a single `docker-compose.yml` at the repository root that exposes the existing STT service on host port `8001` and the matcher service on host port `8002`, individually or together, while preserving every existing application-level contract (build context, image, environment defaults, healthcheck, restart policy, read-only catalogue volume).

## Requirements

### Requirement: Root Compose is the sole canonical deployment surface (REQ-UCD-1)

The repository root SHALL contain exactly one Compose file named `docker-compose.yml` that defines both `stt` and `matcher` services as the project's canonical deployment surface. No other Compose file SHALL exist inside the repository tree. Every documented operator command (root quick path, single-service start, both-service start, validation, build) SHALL resolve through this root file.

#### Scenario: Exactly one Compose file is committed

- GIVEN a clean checkout
- WHEN the repository tree is searched for any `docker-compose*.yml` or `compose.y*ml` file
- THEN exactly one match exists: `docker-compose.yml` at the repository root

#### Scenario: Root file defines both services

- GIVEN the root `docker-compose.yml`
- WHEN it is parsed
- THEN it declares exactly the `services` keys `stt` and `matcher`

### Requirement: Service selection exposes each service independently (REQ-UCD-2)

`docker compose up stt` SHALL start only the `stt` container, publish only host port `8001`, and SHALL NOT start `matcher` or publish host port `8002`. `docker compose up matcher` SHALL start only the `matcher` container, publish only host port `8002`, and SHALL NOT start `stt` or publish host port `8001`. `docker compose up` (no service argument) SHALL start both `stt` and `matcher` and SHALL publish both host ports `8001` and `8002`.

#### Scenario: `docker compose up stt` starts only STT

- GIVEN a clean Docker daemon
- WHEN `docker compose up stt` runs at the repository root
- THEN only the `stt` container is created, host port `8001` is bound, `matcher` is absent, and host port `8002` is unbound by this invocation

#### Scenario: `docker compose up matcher` starts only matcher

- GIVEN a clean Docker daemon
- WHEN `docker compose up matcher` runs at the repository root
- THEN only the `matcher` container is created, host port `8002` is bound, `stt` is absent, and host port `8001` is unbound by this invocation

#### Scenario: `docker compose up` starts both services

- GIVEN a clean Docker daemon
- WHEN `docker compose up` runs at the repository root with no service argument
- THEN both `stt` and `matcher` containers are created and host ports `8001` and `8002` are both bound

### Requirement: Preserved per-service deployment contracts (REQ-UCD-3)

The root Compose SHALL preserve, unchanged, the contracts that each service already depends on: STT's build context `./services/stt` with its own `Dockerfile`; matcher's build context `.` (repository root) with `dockerfile: services/matcher/Dockerfile`; matcher's bind mount of `./data:/data:ro`; every existing environment-variable name and documented default already present in `services/stt/docker-compose.yml` (vendor keys with empty defaults, `STT_VENDOR`, `STT_ELEVENLABS_MODEL`, `STT_LANGUAGE`, `STT_MODEL`, `STT_NUMERALS`, `STT_MIP_OPT_OUT`, `STT_CONFIDENCE_FLOOR`, `STT_MIN_SPEECH_MS`, `STT_MAX_UPLOAD_BYTES`, `STT_VENDOR_TIMEOUT_S`, `STT_RETRY_ATTEMPTS`, `STT_RETRY_BACKOFF_S`, `STT_FALLBACK_ENABLED`, `STT_FALLBACK_VENDOR`, `STT_TOTAL_DEADLINE_S`, `LOG_LEVEL`) and in `services/matcher/docker-compose.yml` (`CATALOGUE_DB=/data/bodegas-y-stock.sqlite`, `MATCH_ACCEPT_SCORE=0.50`, `MATCH_AMBIGUITY_MARGIN=0.08`, `MATCH_TSR_MARGIN=0.08`, `MATCH_MAX_CANDIDATES=5`, `MATCH_UNIT_RERANK=true`, `STARTUP_RETRIES=3`, `STARTUP_RETRY_DELAY_SECONDS=2.0`); each service's healthcheck against its `GET /health` endpoint (`http://localhost:<port>/health`); each service's `restart: unless-stopped`.

#### Scenario: STT service preserves its build context

- GIVEN the root Compose
- WHEN the `stt` service definition is inspected
- THEN `build` resolves to `./services/stt` (its own Dockerfile) and the env-var set, ports, healthcheck, and restart match the existing STT contract

#### Scenario: Matcher preserves its root-context build and read-only catalogue mount

- GIVEN the root Compose
- WHEN the `matcher` service definition is inspected
- THEN `build.context` is `.` and `build.dockerfile` is `services/matcher/Dockerfile`, the volume `./data:/data:ro` is declared with read-only mode, and the env-var set, port, healthcheck, and restart match the existing matcher contract

#### Scenario: Defaults are non-secret placeholders

- GIVEN the root Compose
- WHEN its `environment` block is inspected for every variable
- THEN vendor secret values resolve to empty strings (`${VAR:-}`) or documented defaults — no committed credential string is present

### Requirement: Independent services with no startup ordering (REQ-UCD-4)

Neither service SHALL declare `depends_on` on the other; the root Compose SHALL NOT introduce any cross-service start ordering, health-gated wait, or shared lifecycle dependency. Each service SHALL be able to reach a healthy state independently of the other, and either service SHALL be startable and stoppable in isolation without affecting the other.

#### Scenario: No `depends_on` references the sibling service

- GIVEN the root Compose
- WHEN the `stt` definition is inspected for `depends_on`
- THEN no entry references `matcher`; the same holds symmetrically for `matcher`

#### Scenario: One service unhealthy does not block the other

- GIVEN the root Compose is running both services
- WHEN matcher is unhealthy (e.g. catalogue read failure) while STT is healthy
- THEN STT's container is independently marked healthy and remains reachable on port `8001`

### Requirement: Secret-safe root environment workflow (REQ-UCD-5)

The repository root SHALL carry a non-secret `.env.example` template that mirrors every documented variable in the root Compose with blank values or non-sensitive defaults; the root `.env` file SHALL be listed in `.gitignore` and MUST NOT be committed. Operators SHALL be able to start the stack using either (a) a locally-created `.env` at the repository root or (b) `docker compose --env-file <path>`. Credentials SHALL be supplied by the operator through one of these mechanisms; no committed file SHALL contain a real vendor key, token, or password.

#### Scenario: Root env template is non-secret

- GIVEN the root `.env.example`
- WHEN its contents are inspected
- THEN every line is either a blank value, a documented non-sensitive default, or an inline comment naming the variable — no real credential value is present

#### Scenario: Local `.env` is git-ignored

- GIVEN the repository `.gitignore`
- WHEN root-level environment files are inspected
- THEN `.env` is listed there and a `.env` placed at the root is not tracked by git

#### Scenario: `--env-file` startup works

- GIVEN the root Compose and an operator-provided env file `<path>`
- WHEN `docker compose --env-file <path> up <service>` runs
- THEN that invocation resolves interpolation values from `<path>` and starts the named service

### Requirement: Daemon-free configuration and contract validation (REQ-UCD-6)

The project SHALL ship daemon-free validation that proves the root Compose file parses, validates, and preserves the deployment contracts of REQ-UCD-3: the Compose `services` keys, each service's port mapping, each service's healthcheck endpoint, the matcher's `./data:/data:ro` mount, the matcher's root build context, the absence of `depends_on` between services, and the absence of a secret credential in the committed file. Validation SHALL NOT require a running Docker daemon.

#### Scenario: `docker compose config` resolves every contract term

- GIVEN the root Compose and no daemon access required
- WHEN `docker compose -f docker-compose.yml config` renders the file
- THEN it exits `0`, the rendered `services.stt.ports[0]` resolves to `published: 8001` and `target: 8001`, the rendered `services.matcher.ports[0]` resolves to `published: 8002` and `target: 8002`, `services.matcher.volumes` contains a single read-only entry whose source is the repository's `data` directory and whose mode is `ro`, `services.matcher.build.context` is the repository root with `dockerfile: services/matcher/Dockerfile`, and neither `services.stt.depends_on` nor `services.matcher.depends_on` references the sibling service

#### Scenario: Secret-leak guard rejects committed credentials

- GIVEN a hypothetical committed file under the proposed root Compose tree containing `DEEPGRAM_API_KEY=<real-looking-key>`
- WHEN the secret-leak validation runs against the working tree
- THEN it fails with a message naming the offending variable

### Requirement: Conditional runtime smoke evidence (REQ-UCD-7)

When Docker daemon access is available, a deployed stack SHALL produce evidence that each service can reach its healthy state (`GET /health` returns its documented success body): STT healthy when `stt` runs alone, matcher healthy when `matcher` runs alone, and both healthy when the stack runs together. A missing active-vendor credential SHALL skip only STT-dependent smoke evidence (matcher smoke still runs when Docker access and the catalogue are present). Docker unavailability SHALL skip all runtime smoke; the daemon-free validation of REQ-UCD-6 is the contract guarantee in that case. Skipped stages MUST be reported with a named reason rather than silently dropped.

#### Scenario: STT reaches `/health` when started alone

- GIVEN Docker access and a non-empty value for the active STT vendor key (Deepgram or Groq, per `STT_VENDOR`)
- WHEN `docker compose up stt` runs and the command polls `http://localhost:8001/health`
- THEN the response is `200` with a JSON body reporting `status: "ok"` and a `vendor` field equal to the active vendor name

#### Scenario: Matcher reaches `/health` when started alone

- GIVEN Docker access and `data/bodegas-y-stock.sqlite` present in the repository
- WHEN `docker compose up matcher` runs and the command polls `http://localhost:8002/health`
- THEN the response is `200`

#### Scenario: Both services healthy when started together

- GIVEN Docker access, active STT vendor credentials, and the catalogue present
- WHEN `docker compose up` runs
- THEN both `http://localhost:8001/health` and `http://localhost:8002/health` return their `200` healthy bodies

#### Scenario: Runtime checks are skipped without Docker access

- GIVEN a host with no reachable Docker daemon
- WHEN the validation pipeline runs
- THEN the daemon-free checks of REQ-UCD-6 still execute and the runtime smoke stage is reported as skipped with a reason

#### Scenario: Runtime checks are skipped without STT credentials

- GIVEN Docker access but a blank value for the active STT vendor key
- WHEN the validation pipeline runs
- THEN the matcher runtime smoke still executes and the STT runtime smoke is skipped with a reason naming the missing credential

### Requirement: Service-local Compose files are removed; commands are migrated (REQ-UCD-8)

`services/stt/docker-compose.yml` and `services/matcher/docker-compose.yml` SHALL NOT exist in the repository at the end of this change. All operator-facing documentation (root deployment guide, per-service `README.md`, `services/stt/docs/dod-live-checks.md`) and the project-level verification artifacts SHALL reference the root Compose commands (`docker compose up stt`, `docker compose up matcher`, `docker compose up`, `docker compose config`, `docker compose down`) and SHALL NOT instruct operators to use `docker compose -f services/<svc>/docker-compose.yml ...`.

#### Scenario: No service-local Compose file remains

- GIVEN the change is complete
- WHEN the tree is searched
- THEN no `docker-compose*.yml` or `compose.y*ml` file exists under `services/`

#### Scenario: Operator docs reference root commands only

- GIVEN the deployment-related docs and readmes touched by this change
- WHEN each is searched for the substring `-f services/`
- THEN no instruction telling an operator to use a service-local Compose file remains

### Requirement: Future-service extension contract (REQ-UCD-9)

Any new service added to the root Compose SHALL satisfy a documented checklist — a unique service key, a unique host port that does not collide with `8001` or `8002`, an explicit `build.context` and `Dockerfile` path, environment variables with non-secret defaults, a healthcheck against an in-container `GET /health` style endpoint, a `restart: unless-stopped` policy, and least-privilege mounts — and the root Compose SHALL continue to validate and to expose each service via `docker compose up <key>`. A non-compliant addition SHALL be rejected by validation.

#### Scenario: New service with a unique key and port is accepted

- GIVEN a hypothetical service `foo` added to the root Compose with port `8003:8003`, its own build context, env defaults, healthcheck, and `restart: unless-stopped`
- WHEN `docker compose -f docker-compose.yml config` runs
- THEN it exits `0` and `docker compose up foo` starts only that service

#### Scenario: Adding `depends_on` on an existing service is rejected

- GIVEN a hypothetical addition that adds `depends_on: [matcher]` to `stt`
- WHEN the structural validation of REQ-UCD-6 runs
- THEN it fails with a message naming the forbidden dependency

#### Scenario: Host port collision with `8001`/`8002` is rejected

- GIVEN a hypothetical new service whose host port mapping duplicates `8001` or `8002`
- WHEN the structural validation runs
- THEN it fails with a message naming the colliding port

### Requirement: Guided creation of the single root env file (REQ-UCD-10)

The repository SHALL ship an executable shell script that produces the root
`.env` from `.env.example` without the operator editing either file by hand.
The script SHALL derive both the set of variables and the help text it shows
from `.env.example` alone, so that adding a service requires no change to the
script. It SHALL ask one question per documented variable, offering as the
default the value already in `.env`, else the value exported in the
environment, else the template default. Values whose names end in `_API_KEY`,
`_SECRET`, `_TOKEN`, `_PASSWORD` or `_KEY` SHALL be read without terminal echo
and SHALL never be printed back in clear text. The script SHALL support a
non-interactive mode, SHALL write the file with owner-only permissions, SHALL
preserve the previous file, and SHALL report before exit whether the active STT
vendor's key is missing.

#### Scenario: Every documented variable is asked about, once

- GIVEN `.env.example` documenting N variables
- WHEN the script runs interactively
- THEN it prints each variable's name and its template comment, and writes a
  `.env` containing exactly those N variables

#### Scenario: A secret is never echoed

- GIVEN an operator typing an API key at the prompt
- WHEN the script acknowledges the answer
- THEN neither stdout nor stderr contains the value, and the acknowledgement is
  masked

#### Scenario: Re-running keeps the answers already given

- GIVEN a `.env` that already holds a vendor key
- WHEN the script runs again and the operator presses Enter at that prompt
- THEN the existing value is preserved and the previous file is kept as a
  backup

#### Scenario: A new service's variables are picked up with no script change

- GIVEN a variable added to `.env.example` under an explanatory comment
- WHEN the script runs against an existing `.env`
- THEN the new variable is written with its template default, and a variable
  the template no longer documents is dropped

#### Scenario: A missing active-vendor key is reported before startup

- GIVEN `STT_VENDOR=deepgram` and a blank `DEEPGRAM_API_KEY`
- WHEN the script finishes
- THEN it warns, naming `DEEPGRAM_API_KEY`, that `stt` will not boot

### Requirement: Stable Compose project identity (REQ-UCD-11)

The root Compose file SHALL pin an explicit project `name`. Without it Compose
derives the project from the working directory, so the same stack started from
a git worktree becomes a second set of containers competing for the same host
ports while appearing unrelated to `docker compose ps` at the root.

#### Scenario: The project name does not follow the directory

- GIVEN the root Compose file
- WHEN it is parsed
- THEN a top-level `name:` key is present

## Out of scope (reaffirmed)

Application code, internal ports, Dockerfiles, secrets management, reverse proxies, custom networks, orchestration platforms, registries, and CI/CD deployment are out of scope for this capability. The root Compose is the single deployment surface introduced here; runtime claims that depend on missing credentials or missing Docker access are conditional and surface as documented skips, not as failures.
