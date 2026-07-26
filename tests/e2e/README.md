# E2E smoke suite

Playwright (Python, sync API) smoke tests that prove the RUNNING app supports a
real audit plan. They hit a live server and real Supabase-seeded data — nothing
is mocked. They are opt-in: not in the default pytest `testpaths`.

## Prerequisites

The docker compose stack must be up:

```sh
docker compose up -d
```

Services involved: frontend (http://localhost:4321), stt (:8001),
extractor (:8003), matcher (:8002). The suite only talks to the frontend.

## Install

```sh
uv sync --group e2e
uv run playwright install chromium
```

(`uv run playwright install chromium --with-deps` also installs OS libraries,
but needs sudo.)

## Run

```sh
uv run pytest tests/e2e -v -m e2e
```

## Environment variables

| Variable       | Default                 | Meaning                       |
| -------------- | ----------------------- | ----------------------------- |
| `E2E_BASE_URL` | `http://localhost:4321` | Frontend origin under test    |

## What is covered

- `GET /health` liveness.
- `GET /api/plans` param validation, plan visibility for the seeded operator
  (PLAN-DEMO-002 with catalogue `STOCK_RESTAURANTE_FUENTES_AYB`), and the
  no-disclosure guarantee for unassigned operators.
- `GET /api/auditor/records` param validation and array shape.
- `/auditor` query-param contract (`?plan=` + `?auditor=`): the
  "Falta el plan a revisar" note appears without `plan` and disappears with it.
- `/conteo` boots without uncaught browser errors (errors from the known-down
  matcher service are the only tolerated ones).

Test fixtures (seeded UUIDs) live in `conftest.py`. DB-backed tests assert the
CORRECT behavior; if the frontend's Supabase credential is broken they fail
loudly by design — do not weaken them to get green.
