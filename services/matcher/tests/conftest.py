"""Shared fixtures for the matcher test suite."""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Callable, Iterable, Sequence

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]

StockRow = tuple[str | None, str | None, float | None, str | None]
"""(articulo, unidad, sd, nr_articulo) — the columns the loader reads."""


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
