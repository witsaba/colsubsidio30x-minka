# Proposal: Unified Docker Compose Deployment

## Intent
Create one canonical root Compose surface to start STT on `8001`, matcher on `8002`, or both, without changing either application.

## Scope

### In Scope
- Add root commands: `docker compose up stt`, `docker compose up matcher`, and `docker compose up`.
- Preserve names, build contexts, environment defaults, healthchecks, restart policies, ports, and matcher `./data:/data:ro` mount.
- Add a secret-safe root environment template, deployment docs, daemon-free checks, and conditional smoke checks.
- Remove service-local Compose files and migrate their docs/tests to the root contract.

### Out of Scope
- Application/API, internal-port, or Dockerfile changes.
- Dependencies, startup ordering, custom networks, databases, proxies, TLS/auth, registries, CI/CD, or production secret managers.
- Runtime claims without Docker access or STT vendor credentials.

## Capabilities

### New Capabilities
- `unified-compose-deployment`: Root orchestration, independent/all-service startup, environment setup, extensibility rules, and contract verification.

### Modified Capabilities
- None. Application behavior remains unchanged.

## Approach
Define `stt` with build context `./services/stt`; define `matcher` with repository-root context and `services/matcher/Dockerfile`. Use the default network and no `depends_on` because the services are independent. Provide root `.env.example` copied to ignored `.env`, with blank credentials and current defaults; also document `--env-file`. Future services require a unique key/port, explicit build context, non-secret defaults, healthcheck, restart policy, least-privilege mounts, validation, and single-service command.

## Compatibility and Migration
Retire service-local commands in this slice. Root service selection preserves independent startup, while deleting duplicate YAML prevents drift. Document exact replacements; no application or data migration occurs.

## Affected Areas

| Area | Impact |
|---|---|
| `docker-compose.yml`, root env template | New |
| `services/*/docker-compose.yml` | Removed |
| Deployment docs, matcher container tests | Modified |
| `openspec/config.yaml` | Modified |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| STT lacks active-vendor key | High | Document credentials; keep config validation secret-free. |
| Local commands break | Med | Publish root replacements. |
| Contract drift | Med | Test ports, paths, defaults, mounts, health, and restart. |
| Port conflict | Low | Keep defaults and document the error. |

## Rollback Plan
Restore local Compose files and previous docs/config from version control; remove root artifacts. No data rollback is needed.

## Dependencies
Docker Compose v2, `data/bodegas-y-stock.sqlite`, and STT credentials for live checks.

## Success Criteria
- [ ] Root `docker compose config` validates without secrets and preserves `stt:8001` and `matcher:8002` contracts.
- [ ] Root commands select either service or both; matcher keeps its root context and read-only mount.
- [ ] Checks reject drift and dependency ordering; runtime checks are conditional on Docker/credentials.
- [ ] No local Compose files remain; forecast stays within the cached 800-line single-PR budget.
