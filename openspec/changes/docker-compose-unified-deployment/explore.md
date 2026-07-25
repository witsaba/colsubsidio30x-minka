## Exploration: The new feature to add is to implement one just deployment with docker compose that up the two services independently, in differents ports and that allows to up once with all services and the way for futures services

### Current State
The repository has two independent FastAPI deploy units and no root Compose file. STT lives in `services/stt`, builds from that service directory, starts `src.main:app` on container/host port `8001`, and exposes `GET /health`. Matcher lives in `services/matcher`, requires the repository root as its Docker build context because it is a root uv-workspace member, starts `matcher.main:app` on container/host port `8002`, and exposes `GET /health` only after loading the catalogue.

Each service currently starts independently with its local Compose file (`docker compose -f services/stt/docker-compose.yml up` and `docker compose -f services/matcher/docker-compose.yml up`). Both Compose configurations validate, and their host ports do not conflict, so operators can start both in separate Compose projects today. There is no repository-root command that starts both, and separate projects create separate implicit networks and lifecycles.

The STT container is stateless and has no volume. It requires the selected primary vendor credential at application startup; Compose passes Deepgram, Groq, and ElevenLabs credentials as optional environment values. Matcher has no secret input but bind-mounts committed `data/` to `/data:ro`, uses `/data/bodegas-y-stock.sqlite`, and retries catalogue loading before exiting. Both services define internal HTTP healthchecks and `restart: unless-stopped`. Neither application calls the other, so there is no evidence for `depends_on` or health-gated startup ordering.

### Affected Areas
- Root Compose file (new) — becomes the canonical multi-service deployment and must preserve `stt`/`matcher` names, ports `8001`/`8002`, build contexts, environment contracts, healthchecks, restart policies, and the matcher read-only catalogue mount.
- `services/stt/docker-compose.yml` — currently owns the STT deployment definition; retaining it beside a root definition creates drift risk, while replacing it affects documented independent-start commands.
- `services/matcher/docker-compose.yml` — currently owns matcher deployment behavior and is asserted directly by `services/matcher/tests/unit/test_container.py`.
- `services/stt/Dockerfile` — requires `services/stt` as the effective build context and its standalone `pyproject.toml`/`uv.lock`.
- `services/matcher/Dockerfile` and root `.dockerignore` — require the repository root build context and exclude the runtime catalogue from the image.
- `services/stt/.env.example` — documents secret and vendor configuration, but its current instruction to copy to `services/stt/.env` does not automatically serve a Compose invocation from the repository root.
- `services/stt/README.md`, `services/stt/docs/dod-live-checks.md`, `openspec/project.md`, and deployment-related docs — currently teach service-local Compose commands and need a root quick path plus explicit single-service commands.
- `services/matcher/tests/unit/test_container.py` and new deployment tests — existing textual assertions are coupled to the service-local matcher Compose file; the root contract needs daemon-free validation plus runtime checks when Docker is available.
- `openspec/config.yaml` — currently describes two separate deployment units and verifies only the matcher Compose build.

### Approaches
1. **Canonical root Compose with explicit service definitions** — add one root Compose file containing `stt` and `matcher`, using `./services/stt` for STT and repository root plus `services/matcher/Dockerfile` for matcher.
   - Pros: Directly supports `docker compose up stt`, `docker compose up matcher`, and `docker compose up`; paths are resolved consistently from the root file; one project/network/lifecycle; easiest convention to copy for future services; no advanced Compose feature dependency.
   - Cons: Duplicates existing service-local YAML unless those files are deprecated or removed; requires careful documentation and test migration; STT root environment loading must be made explicit.
   - Effort: Medium

2. **Root Compose assembled with Compose `include` or multiple-file composition** — reuse service-local Compose definitions and aggregate them at the root.
   - Pros: Reduces repeated service configuration and can preserve local service ownership.
   - Cons: Relative path and project-directory semantics are easy to misread, especially because the two services require different build contexts; `include` availability depends on Docker Compose versions; separate files are less obvious as the future-service template; still needs environment-path reconciliation.
   - Effort: Medium

3. **Generate the root Compose from per-service fragments** — introduce templates or a script that emits the aggregate deployment.
   - Pros: Single logical source per service and potentially strong drift control at larger scale.
   - Cons: Adds tooling and generated-artifact lifecycle before two services justify it; obscures the standard `docker compose` workflow; increases testing and contributor overhead.
   - Effort: High

### Recommendation
Use a canonical, explicit root Compose file as the first slice. Keep service names stable (`stt`, `matcher`), retain the proven host mappings `8001:8001` and `8002:8002`, preserve both healthchecks and restart policies, and do not add `depends_on`: the current services are operationally independent and no repository evidence shows a runtime call path between them. The default Compose network is sufficient for future internal DNS without defining a custom network now.

Treat root invocation as canonical and decide in proposal/design whether service-local Compose files are removed immediately or temporarily retained with explicit deprecation. Long-term duplicate deployment definitions should not remain. Establish a future-service checklist: unique service key and host port, explicit Dockerfile/build context, environment defaults with no committed secrets, healthcheck, restart policy, least-privilege mounts, daemon-free `docker compose config`/contract checks, and documented `docker compose up <service>` usage.

**First-slice scope:** root orchestration for the two existing services; independent and all-service commands; stable non-conflicting ports; exact preservation of environment, read-only volume, health, and restart semantics; root environment template/documentation; structural Compose validation and, where Docker access exists, healthy-state smoke checks for each service and both together.

**Non-goals:** changing application APIs or internal ports; introducing service-to-service calls or startup ordering; adding databases, queues, reverse proxies, TLS, auth, orchestration platforms, production secret managers, image registries, or CI/CD deployment; redesigning Dockerfiles; embedding the catalogue in an image; claiming live STT success without vendor credentials; or claiming runtime Compose proof where Docker daemon access is unavailable.

### Risks
- Root Compose reads interpolation defaults from the invocation project directory; the current `services/stt/.env` workflow can therefore fail unless credentials are exported, passed with `--env-file`, or represented by a root-level ignored env workflow.
- STT fails boot without the active vendor key. Consequently, bare `docker compose up` cannot make all services healthy without operator-supplied credentials, even though `docker compose config` succeeds with empty defaults.
- Duplicating root and service-local Compose definitions can silently drift in ports, thresholds, healthchecks, or retry behavior.
- Matcher must keep the repository-root build context and `./data:/data:ro`; changing either can break uv workspace installation or violate read-only catalogue handling.
- Existing matcher tests assert exact service-local YAML text. A migration must preserve deployment guarantees rather than merely adding an untested root file.
- A healthcheck reports container health but does not itself restart a wedged process; `restart: unless-stopped` reacts to process exit, not an unhealthy status.
- Fixed host ports are intentionally stable but can collide with unrelated local processes. Optional port overrides may be considered only if they retain `8001` and `8002` as documented defaults.
- Runtime verification may remain environment-dependent: STT needs live credentials, and prior work recorded Docker socket permission constraints.

### Ready for Proposal
Yes. The proposal should state that the root Compose file is the canonical deployment surface, confirm the environment-file convention for root invocation, and choose a migration policy for the two service-local Compose files. It should preserve independent application behavior while unifying only orchestration and establish the explicit future-service checklist above.
