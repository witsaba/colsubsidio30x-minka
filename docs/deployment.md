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
| `product_identification` | 8003 | `.` (repository root) | Product identification and voice inventory extraction using Vertex AI & Gemini dual-model consensus. |
| `matcher` | 8002 | `.` (repository root) | Product matching. Reads the catalogue from Supabase at boot and caches it in `redis`. Needs `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, and will not boot without them. |
| `redis` | — | `redis:7.4-alpine` (image) | Snapshot cache for the matcher's catalogue. Publishes no host port. |

The services are deliberately independent: no `depends_on`, no custom network,
no shared lifecycle. Any of them can be started, stopped, or fail on its own
without touching the others. `docker compose up matcher` never starts `stt`,
which is what makes the matcher usable while STT credentials are still missing.

**The one nuance: `redis` is a *soft* dependency of the matcher.** There is
still no `depends_on` in either direction, and that is deliberate rather than an
oversight. The matcher boots without Redis by reading Supabase directly, and if
Redis dies afterwards the matcher keeps serving matches from the catalogue it
already holds in memory — a match performs no Redis and no Supabase call. What
Redis buys is a warm start: with a fresh snapshot cached, a restart loads the
catalogue with zero Supabase reads. Losing it costs one Supabase read per boot
and nothing else.

### The matcher's catalogue variables

Four variables drive the catalogue path. All four are documented in
`.env.example`, so `setup-env.sh` asks about each one.

| Variable | Compose default | What it does |
|---|---|---|
| `SUPABASE_URL` | blank | PostgREST base URL of the catalogue project. Blank aborts boot with a named error rather than silently starting against the wrong project. |
| `SUPABASE_SECRET_KEY` | blank | The secret (`service_role`-equivalent) key. The container reads it as `SUPABASE_KEY`; this is the host-side name. See below. |
| `REDIS_URL` | `redis://redis:6379/0` | The snapshot cache. Reached by Compose service name, so it differs from the local-dev default (`redis://localhost:6379/0`) on purpose. |
| `CATALOGUE_CACHE_TTL_SECONDS` | `10800` | Snapshot freshness window (3 h). The background refresh fires on this interval with ±10% jitter; the Redis key itself is set to twice this, so a stale snapshot survives to be served if Supabase is down. |

There is no `CATALOGUE_DB` and no `./data:/data:ro` mount any more. The matcher
reads no SQLite file at runtime; the catalogue comes from Supabase and lives in
memory behind the Redis snapshot.

### The matcher's Supabase credential

`SUPABASE_SECRET_KEY` must be the project's **secret** key (the
`service_role` equivalent in the new Supabase API-key scheme) — its value
starts with `sb_secret_`. A **publishable** key (`sb_publishable_...`) will
**NOT** work: it maps to the `anon` Postgres role, which holds zero table
privileges in this project by design.

That is not the original intent and it is not least privilege. A
least-privilege key was tried and is not available today: the `anon` role holds
no `GRANT` on any catalogue table, so PostgREST answers `401` with code
`42501`; every read policy on those tables targets the `authenticated` role;
and `warehouse_products_read` additionally requires `private.is_staff()`. The
server routes rely on the secret key's service-role RLS bypass. Until
a dedicated role with `GRANT`s on the four catalogue tables is provisioned,
the secret key is the only credential that can read the catalogue.

Treat it accordingly: it carries **full database access and bypasses RLS**.

- It ships blank in `.env.example` and is masked by `setup-env.sh` (its name
  ends in `_KEY`). Never commit a value, and never paste one into an issue, a
  log, or a PR.
- The matcher never logs it: it is excluded from the startup line and from
  every exception message the Supabase client raises.
- The matcher only ever reads the four catalogue tables. It never constructs a
  query against `warehouse_stock_balances`, and no stock field can reach Redis —
  both are enforced by tests, not by convention.

Rotating it is a `.env` edit plus `docker compose up -d --force-recreate
matcher`; nothing is baked into the image.

### Debugging the cache

```bash
docker compose exec redis redis-cli                       # a shell on the cache
docker compose exec redis redis-cli GET matcher:catalogue:snapshot:v1 | head -c 200
docker compose exec redis redis-cli TTL matcher:catalogue:snapshot:v1
docker compose exec redis redis-cli DEL matcher:catalogue:snapshot:v1   # force a cold start
```

Redis persists nothing (`--save "" --appendonly no`): it is a pure cache, and a
cold start rebuilds the snapshot from Supabase.

## Adding a service

The next service (the frontend, for instance) is added by editing two files.

1. **`docker-compose.yml`** — a new key under `services:` with:
   - a unique service name;
   - a unique host port (8001, 8002 and 8003 are taken);
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

**Backing services you run rather than build** (Redis is the first) take a
narrow exemption from the first and fifth items: instead of a build context
they pin an upstream `image:` with an explicit tag — never `latest` — and
instead of an HTTP `/health` probe they use the image's own CLI, as `redis`
does with `redis-cli ping`. Everything else on the checklist still applies, and
the exemption only holds while the service declares no `build:` at all, so it
cannot be used to slip an unpinned or half-built service through.

## Verifying without Docker

`uv run pytest tests/deployment` proves the contracts with no daemon running:

- `test_root_compose.py` — the committed text: one Compose file, the checklist
  above, no committed credential, `.env` ignored by git.
- `test_compose_config.py` — what Compose itself renders the file to (ports,
  environment, build contexts, healthchecks), plus proof that no rendering path
  can turn a real key into output.
- `test_setup_env.py` — the setup script: what it asks, what it writes, what it
  refuses to print.

Tests that need the `docker` binary skip with a named reason rather than
failing when it is absent.

## Troubleshooting

**`stt` restarts in a loop.** It has no key for the vendor in `STT_VENDOR`.
`docker compose logs stt` names the missing variable; `./scripts/setup-env.sh`
warns about it before you ever run `up`.

**`matcher` is unhealthy.** It could not load the catalogue. `docker compose
logs matcher` names the cause: a blank or wrong `SUPABASE_URL`/`SUPABASE_SECRET_KEY`
aborts boot immediately (exit 3 after the configured retries), while an
unreachable Redis only logs a warning and is never the reason. Fix the
credential, then `docker compose up -d --force-recreate matcher`.

**A port is already in use.** Something else holds 8001 or 8002 — most likely a
container from an older, per-service Compose file. `docker ps` will show it;
`docker rm -f <name>` clears it.
