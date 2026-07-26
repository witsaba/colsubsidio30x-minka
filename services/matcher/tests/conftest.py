"""Shared fixtures and test doubles for the matcher test suite.

The catalogue is no longer a file, so a fixture catalogue is now just data
(`FIXTURE_CATALOGUE`) fed through `FakeCatalogueSource`, and the cache is the
real `RedisSnapshotCache` over a throwaway `fakeredis` backend -- the repo's
real-but-throwaway convention (design D2/D7). **No fixture here touches the
network, a Supabase project, or a real Redis.**

`catalogue_id` is a `warehouses.code` throughout; the eight SQLite stock table
names are gone with the loader that read them (REQ-CSS-1, REQ-API-2).
"""
from __future__ import annotations

from pathlib import Path
from typing import Sequence

import fakeredis
import pytest

from matcher.catalogue import CatalogueUnavailableError
from matcher.ports import Row

REPO_ROOT = Path(__file__).resolve().parents[3]

SUPABASE_URL = "http://supabase.invalid"
"""A reserved-TLD URL: constructed into `Settings`, never dialed."""

SUPABASE_KEY = "test-key"
REDIS_URL = "redis://localhost:6379/0"

CACHE_TTL_SECONDS = 10_800
LOCK_TTL_SECONDS = 60

RowSpec = str | tuple[str, str | None, str | None]
"""Either an `articulo`, or `(articulo, unidad, nr_articulo)`."""

FIXTURE_CATALOGUE: dict[str, Sequence[RowSpec]] = {
    "AYB-01": [
        ("ACHIOTE MOLIDO", "KG", "7003"),
        ("ACEITE DE OLIVA", "LT", "8001"),
        ("ACEITE DE OLIVA EXTRA VIRGEN", "LT", "8002"),
        ("ARROZ BLANCO", "KG", "7004"),
        ("PANELA CUADRADA", None, None),
    ],
    "SUM-02": [
        ("JABON EN POLVO", "UND", "9001"),
        ("ESCOBA PLASTICA", "UND", "9002"),
    ],
    "ZOO-03": [
        ("CONCENTRADO PARA AVES", "KG", "9101"),
        ("HENO DE ALFALFA", "KG", "9102"),
    ],
}
"""Three warehouses reaching all three decision statuses.

`ACEITE DE OLIVA` and `ACEITE DE OLIVA EXTRA VIRGEN` are deliberate near
duplicates: they are what makes "aceite de oliva" `ambiguous` rather than
`matched`, exactly as the real catalogue's crowded olive-oil field did.
"""

FIXTURE_WAREHOUSES = list(FIXTURE_CATALOGUE)
FIXTURE_CATALOGUE_ID = FIXTURE_WAREHOUSES[0]
FIXTURE_ROW_COUNT = sum(len(rows) for rows in FIXTURE_CATALOGUE.values())


@pytest.fixture(autouse=True)
def instant_startup_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the bounded startup retry real but instant across the suite.

    Startup-failure tests still perform every configured attempt; only the
    wait between them is removed, so the suite does not pay the production
    `STARTUP_RETRY_DELAY_SECONDS` default. Tests that assert on the delay set
    the variable themselves and override this.

    The two required Supabase variables are supplied here too: `Settings()` is
    constructed inside the app's own lifespan, and they have no default by
    design (D6). Tests asserting the missing-credential path delete them.
    """
    monkeypatch.setenv("STARTUP_RETRY_DELAY_SECONDS", "0")
    monkeypatch.setenv("SUPABASE_URL", SUPABASE_URL)
    monkeypatch.setenv("SUPABASE_KEY", SUPABASE_KEY)
    monkeypatch.setenv("REDIS_URL", REDIS_URL)


def make_rows(
    catalogue: dict[str, Sequence[RowSpec]] | None = None,
) -> list[Row]:
    """Build flat catalogue rows from `{warehouse_code: [row spec, ...]}`.

    The replacement for `make_synthetic_db`: the catalogue is no longer a file,
    so a test fixture is now just data. `uid` is derived deterministically so a
    test can assert on it without restating it; a bare string spec gets a
    derived `unidad`/`nr_articulo` for tests that do not care about either.
    """
    catalogue = FIXTURE_CATALOGUE if catalogue is None else catalogue
    rows: list[Row] = []
    for warehouse_code, specs in catalogue.items():
        for position, spec in enumerate(specs, start=1):
            uid = f"{warehouse_code}-{position:04d}"
            if isinstance(spec, str):
                articulo, unidad, nr_articulo = spec, "KG", f"SKU-{uid}"
            else:
                articulo, unidad, nr_articulo = spec
            rows.append(
                Row(
                    warehouse_code=warehouse_code,
                    uid=uid,
                    articulo=articulo,
                    unidad=unidad,
                    nr_articulo=nr_articulo,
                )
            )
    return rows


class FakeCatalogueSource:
    """A `CatalogueSource` double that counts how often it was actually read.

    The call counter is the point: "a warm snapshot performs zero Supabase
    calls" (REQ-RCC-1) is only provable by an adapter that can report it. The
    real PostgREST adapter is covered separately over `httpx.MockTransport`.

    `fail_times` makes the first N loads raise `CatalogueUnavailableError`, so
    the degraded startup paths and the bounded startup retry can be driven
    without any network or timing dependency.
    """

    QUERIED_TABLES = frozenset({"warehouse_products", "warehouses", "products"})

    def __init__(
        self,
        rows: Sequence[Row] | dict[str, Sequence[Row]] | None = None,
        fail_times: int = 0,
    ) -> None:
        if rows is None:
            rows = make_rows()
        if isinstance(rows, dict):
            flat: list[Row] = [row for group in rows.values() for row in group]
        else:
            flat = list(rows)
        self._rows = flat
        self._fail_times = fail_times
        self.calls = 0
        self.queried_tables: set[str] = set()

    def load(self) -> dict[str, list[Row]]:
        self.calls += 1
        if self.calls <= self._fail_times:
            raise CatalogueUnavailableError(
                f"fake catalogue source failing call {self.calls}"
            )
        self.queried_tables |= set(self.QUERIED_TABLES)
        grouped: dict[str, list[Row]] = {}
        for row in self._rows:
            grouped.setdefault(row.warehouse_code, []).append(row)
        return grouped


def make_cache(ttl_seconds: int = CACHE_TTL_SECONDS):
    """A real `RedisSnapshotCache` over a private, empty fakeredis backend."""
    from matcher.cache import RedisSnapshotCache

    return RedisSnapshotCache(
        fakeredis.FakeRedis(),
        ttl_seconds=ttl_seconds,
        lock_ttl_seconds=LOCK_TTL_SECONDS,
    )


@pytest.fixture
def fixture_rows() -> list[Row]:
    return make_rows()


@pytest.fixture
def settings():
    """Default `Settings`, constructed with credentials that are never dialed."""
    from matcher.config import Settings

    return Settings(
        supabase_url=SUPABASE_URL,
        supabase_key=SUPABASE_KEY,
        redis_url=REDIS_URL,
    )


@pytest.fixture
def service(settings, fixture_rows: list[Row]):
    """A `MatcherService` over the fixture catalogue and an empty cache."""
    from matcher.service import MatcherService

    return MatcherService(settings, FakeCatalogueSource(fixture_rows), make_cache())


@pytest.fixture
def client(fixture_rows: list[Row], monkeypatch: pytest.MonkeyPatch):
    """TestClient running the app's own lifespan over the fixture adapters.

    Only `_build_adapters` is faked -- the seam design D2 introduces exactly
    for this. Settings parsing, the bounded startup retry, `load_index` and the
    startup log line all run for real.
    """
    from fastapi.testclient import TestClient

    from matcher import main as main_module

    monkeypatch.setattr(
        main_module,
        "_build_adapters",
        lambda _settings: (FakeCatalogueSource(fixture_rows), make_cache()),
    )
    with TestClient(main_module.app) as test_client:
        yield test_client
