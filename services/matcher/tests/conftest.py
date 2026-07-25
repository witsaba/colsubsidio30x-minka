"""Shared fixtures and test doubles for the matcher test suite."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Callable, Iterable, Sequence

import pytest

from matcher.catalogue import CatalogueUnavailableError
from matcher.ports import Row

REPO_ROOT = Path(__file__).resolve().parents[3]

StockRow = tuple[str | None, str | None, float | None, str | None]
"""(articulo, unidad, sd, nr_articulo) — the columns the loader reads."""


def make_rows(
    catalogue: dict[str, Sequence[str]] | None = None,
) -> list[Row]:
    """Build flat catalogue rows from `{warehouse_code: [articulo, ...]}`.

    The replacement for `make_synthetic_db`: the catalogue is no longer a file,
    so a test fixture is now just data. `uid` and `nr_articulo` are derived
    deterministically so a test can assert on them without restating them.
    """
    catalogue = catalogue or {"BOD-01": ["ARROZ BLANCO", "AZUCAR MORENA"]}
    rows: list[Row] = []
    for warehouse_code, articulos in catalogue.items():
        for position, articulo in enumerate(articulos, start=1):
            rows.append(
                Row(
                    warehouse_code=warehouse_code,
                    uid=f"{warehouse_code}-{position:04d}",
                    articulo=articulo,
                    unidad="KG",
                    nr_articulo=f"SKU-{warehouse_code}-{position:04d}",
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


@pytest.fixture(autouse=True)
def instant_startup_retry(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the bounded startup retry real but instant across the suite.

    Startup-failure tests still perform every configured attempt; only the
    wait between them is removed, so the suite does not pay the production
    `STARTUP_RETRY_DELAY_SECONDS` default. Tests that assert on the delay set
    the variable themselves and override this.
    """
    monkeypatch.setenv("STARTUP_RETRY_DELAY_SECONDS", "0")


@pytest.fixture(scope="session")
def catalogue_db_path() -> Path:
    """Path to the real catalogue SQLite built by `make build-sqlite`."""
    path = REPO_ROOT / "data" / "bodegas-y-stock.sqlite"
    if not path.exists():
        pytest.skip(f"catalogue database not present at {path}")
    return path


@pytest.fixture
def settings(catalogue_db_path: Path):
    """Default `Settings` pinned to the real catalogue, independent of cwd."""
    from matcher.config import Settings

    return Settings(catalogue_db=catalogue_db_path)


@pytest.fixture(scope="session")
def service(catalogue_db_path: Path):
    """A `MatcherService` over the real catalogue, loaded once per session."""
    from matcher.config import Settings
    from matcher.service import MatcherService

    return MatcherService(Settings(catalogue_db=catalogue_db_path))


@pytest.fixture
def client(catalogue_db_path: Path, monkeypatch: pytest.MonkeyPatch):
    """TestClient with the app's own lifespan running against the real DB."""
    from fastapi.testclient import TestClient

    from matcher.main import app

    monkeypatch.setenv("CATALOGUE_DB", str(catalogue_db_path))
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def make_synthetic_db(
    tmp_path: Path,
) -> Callable[..., Path]:
    """Build a throwaway catalogue SQLite with the real column layout.

    `rows` maps a table name to its rows; `tables` controls which stock tables
    exist at all, so a test can omit one and exercise the missing-table path.
    """

    def _make(
        rows: dict[str, Sequence[StockRow]] | None = None,
        tables: Iterable[str] | None = None,
        name: str = "synthetic.sqlite",
    ) -> Path:
        from matcher.catalogue import STOCK_TABLES

        rows = rows or {}
        table_names = list(STOCK_TABLES if tables is None else tables)
        path = tmp_path / name
        con = sqlite3.connect(str(path))
        for table in table_names:
            con.execute(
                f'CREATE TABLE "{table}" '
                "(articulo TEXT, unidad TEXT, sd REAL, nr_articulo TEXT)"
            )
            con.executemany(
                f'INSERT INTO "{table}" (articulo, unidad, sd, nr_articulo) '
                "VALUES (?, ?, ?, ?)",
                list(rows.get(table, [])),
            )
        con.commit()
        con.close()
        return path

    return _make
