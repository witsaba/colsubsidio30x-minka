# Deployment

Everything in this repository runs from **one** `docker-compose.yml` at the
root and **one** `.env` next to it. There is no per-service Compose file and no
per-service env file; a second one anywhere in the tree fails the deployment
tests on purpose.

## First run

```bash
./scripts/setup-env.sh        # asks one question per variable, writes .env
docker compose up --build     # everything
docker compose ps             # health per service
```

`setup-env.sh` reads `.env.example`, so the questions it asks and the help it
prints are whatever that file documents. Press Enter to accept the value in
brackets. Secrets are typed without echo and only ever acknowledged as
`********`, so a key never lands in the terminal scrollback.

Re-run it any time to change one answer: values already in `.env` are the
defaults on the next pass, the previous file is kept as `.env.bak.<timestamp>`,
and variables a service has since stopped using are dropped.

Non-interactive (CI, a scripted rebuild):

```bash
DEEPGRAM_API_KEY=... ./scripts/setup-env.sh --defaults
```

Precedence is: what is already in `.env` → the exported environment → the
template default.

## Day to day

| Task | Command |
|---|---|
| Start everything | `docker compose up -d` |
| Start one service | `docker compose up -d stt` (or `matcher`) |
| Health | `docker compose ps`, or `curl localhost:8001/health` |
| Logs | `docker compose logs -f stt` |
| Rebuild after a code change | `docker compose up -d --build <service>` |
| Stop | `docker compose down` |
| Validate the file, no daemon needed | `docker compose config` |
| Use a different env file | `docker compose --env-file /path/to/env up` |

## What runs

| Service | Port | Build context | Notes |
|---|---|---|---|
| `stt` | 8001 | `./services/stt` | Speech to text. Needs the API key of the vendor named by `STT_VENDOR`, and will not boot without it. |
| `matcher` | 8002 | `.` (repository root) | Product matching. Mounts `./data:/data:ro`, so `data/bodegas-y-stock.sqlite` must exist — build it with `make build-sqlite`. |

The services are deliberately independent: no `depends_on`, no custom network,
no shared lifecycle. Either can be started, stopped, or fail on its own without
touching the other. `docker compose up matcher` never starts `stt`, which is
what makes the matcher usable while STT credentials are still missing.

## Adding a service

The next service (the frontend, for instance) is added by editing two files.

1. **`docker-compose.yml`** — a new key under `services:` with:
   - a unique service name;
   - a unique host port (8001 and 8002 are taken);
   - an explicit `build.context` **and** `dockerfile`;
   - every environment value written as `${NAME:-default}`, never a literal
     credential;
   - a `healthcheck` probing its own `GET /health`, with a `start_period` long
     enough to cover its boot;
   - `restart: unless-stopped`;
   - least-privilege mounts (`:ro` unless it genuinely writes).
2. **`.env.example`** — its variables, each under a comment explaining it. That
   comment is the question `setup-env.sh` asks, so an undocumented variable is
   a prompt with nothing in it. Secrets go in blank, and their names end in
   `_API_KEY`, `_SECRET`, `_TOKEN`, `_PASSWORD` or `_KEY` so the script masks
   them.

Nothing else changes: the setup script and the tests are driven by those two
files. `uv run pytest tests/deployment` enforces every item above, including
the port collision and the missing help text, so a non-compliant service fails
before it reaches a review.

If a service must not start by default, give it a Compose profile rather than a
second Compose file.

## Verifying without Docker

`uv run pytest tests/deployment` proves the contracts with no daemon running:

- `test_root_compose.py` — the committed text: one Compose file, the checklist
  above, no committed credential, `.env` ignored by git.
- `test_compose_config.py` — what Compose itself renders the file to (ports,
  mounts, build contexts, healthchecks), plus proof that no rendering path can
  turn a real key into output.
- `test_setup_env.py` — the setup script: what it asks, what it writes, what it
  refuses to print.

Tests that need the `docker` binary skip with a named reason rather than
failing when it is absent.

## Troubleshooting

**`stt` restarts in a loop.** It has no key for the vendor in `STT_VENDOR`.
`docker compose logs stt` names the missing variable; `./scripts/setup-env.sh`
warns about it before you ever run `up`.

**`matcher` is unhealthy.** `data/bodegas-y-stock.sqlite` is missing or
unreadable. Run `make build-sqlite`, then `docker compose up -d --force-recreate
matcher`.

**A port is already in use.** Something else holds 8001 or 8002 — most likely a
container from an older, per-service Compose file. `docker ps` will show it;
`docker rm -f <name>` clears it.
