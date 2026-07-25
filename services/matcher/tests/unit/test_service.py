"""T7 RED — read-only catalogue loading and `MatcherService` (REQ-API-2/4/5).

The catalogue is opened through a `mode=ro` URI and loaded into memory once at
startup. Anything wrong with the database is a startup failure
(`CatalogueUnavailableError`), never a degraded service; an unknown
`catalogue_id` at request time is a distinct client error
(`UnknownCatalogueError`), never a `no_match`.
"""
from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import Callable

import pytest

from matcher.catalogue import (
    STOCK_TABLES,
    CatalogueUnavailableError,
    Row,
    load_catalogue,
    open_readonly,
)
from matcher.config import Settings
from matcher.service import MatcherService, UnknownCatalogueError

ACEITE = ("ACEITE DE OLIVA", "Liter", 12.0, "8001")
ARROZ = ("ARROZ BLANCO", "Kilogram", 5.0, "7004")
SIN_UNIDAD = ("PANELA CUADRADA", None, 3.0, None)


def _settings(db_path: Path, **overrides: object) -> Settings:
    return Settings(catalogue_db=db_path, **overrides)  # type: ignore[arg-type]


class TestReadOnlyConnection:
    def test_write_is_rejected(self, make_synthetic_db: Callable[..., Path]) -> None:
        con = open_readonly(make_synthetic_db())
        with pytest.raises(sqlite3.OperationalError):
            con.execute('INSERT INTO "zoologico" (articulo) VALUES (?)', ("X",))
        con.close()

    def test_ddl_is_rejected(self, make_synthetic_db: Callable[..., Path]) -> None:
        con = open_readonly(make_synthetic_db())
        with pytest.raises(sqlite3.OperationalError):
            con.execute("CREATE TABLE scratch (x TEXT)")
        con.close()

    def test_read_still_works(self, make_synthetic_db: Callable[..., Path]) -> None:
        path = make_synthetic_db({"zoologico": [ACEITE]})
        con = open_readonly(path)
        assert con.execute('SELECT articulo FROM "zoologico"').fetchall() == [
            ("ACEITE DE OLIVA",)
        ]
        con.close()

    def test_missing_file_is_not_created(self, tmp_path: Path) -> None:
        missing = tmp_path / "absent.sqlite"
        with pytest.raises(sqlite3.OperationalError):
            open_readonly(missing)
        assert not missing.exists()


class TestLoadCatalogue:
    def test_loads_all_stock_tables(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        catalogue = load_catalogue(make_synthetic_db({"zoologico": [ACEITE, ARROZ]}))
        assert set(catalogue) == set(STOCK_TABLES)
        assert len(STOCK_TABLES) == 8

    def test_rows_carry_every_column(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        catalogue = load_catalogue(make_synthetic_db({"zoologico": [ACEITE]}))
        row = catalogue["zoologico"][0]
        assert isinstance(row, Row)
        assert (row.articulo, row.unidad, row.nr_articulo) == (
            "ACEITE DE OLIVA",
            "Liter",
            "8001",
        )

    def test_null_unidad_is_preserved(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        catalogue = load_catalogue(make_synthetic_db({"zoologico": [SIN_UNIDAD]}))
        assert catalogue["zoologico"][0].unidad is None

    def test_rows_without_articulo_are_skipped(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        path = make_synthetic_db({"zoologico": [ACEITE, (None, "Liter", 1.0, "9")]})
        assert len(load_catalogue(path)["zoologico"]) == 1

    def test_missing_file_raises_catalogue_unavailable(self, tmp_path: Path) -> None:
        with pytest.raises(CatalogueUnavailableError):
            load_catalogue(tmp_path / "absent.sqlite")

    def test_missing_stock_table_raises_catalogue_unavailable(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        partial = make_synthetic_db(tables=[t for t in STOCK_TABLES if t != "zoologico"])
        with pytest.raises(CatalogueUnavailableError):
            load_catalogue(partial)

    def test_error_message_names_the_database(self, tmp_path: Path) -> None:
        missing = tmp_path / "absent.sqlite"
        with pytest.raises(CatalogueUnavailableError) as excinfo:
            load_catalogue(missing)
        assert "absent.sqlite" in str(excinfo.value)


class TestServiceStartup:
    def test_missing_database_fails_at_construction(self, tmp_path: Path) -> None:
        with pytest.raises(CatalogueUnavailableError):
            MatcherService(_settings(tmp_path / "absent.sqlite"))

    def test_catalogues_returns_all_eight_with_counts(
        self, catalogue_db_path: Path
    ) -> None:
        entries = MatcherService(_settings(catalogue_db_path)).catalogues()
        assert len(entries) == 8
        assert [cid for cid, _ in entries] == list(STOCK_TABLES)
        assert all(count > 0 for _, count in entries)

    def test_catalogues_counts_match_the_loaded_rows(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        path = make_synthetic_db({"zoologico": [ACEITE, ARROZ]})
        assert dict(MatcherService(_settings(path)).catalogues())["zoologico"] == 2


class TestServiceMatch:
    def test_unknown_catalogue_raises_not_no_match(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        service = MatcherService(_settings(make_synthetic_db({"zoologico": [ACEITE]})))
        with pytest.raises(UnknownCatalogueError):
            service.match("not_a_table", "aceite de oliva", None)

    def test_unknown_catalogue_error_names_the_id(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        service = MatcherService(_settings(make_synthetic_db({"zoologico": [ACEITE]})))
        with pytest.raises(UnknownCatalogueError) as excinfo:
            service.match("not_a_table", "aceite", None)
        assert "not_a_table" in str(excinfo.value)

    def test_clear_query_is_matched(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        service = MatcherService(_settings(make_synthetic_db({"zoologico": [ACEITE, ARROZ]})))
        result = service.match("zoologico", "aceite de oliva", None)
        assert result.status == "matched"
        assert result.candidates[0].articulo == "ACEITE DE OLIVA"

    def test_garbage_query_is_no_match(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        service = MatcherService(_settings(make_synthetic_db({"zoologico": [ACEITE, ARROZ]})))
        assert service.match("zoologico", "???", None).status == "no_match"

    def test_empty_table_yields_empty_no_match(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        service = MatcherService(_settings(make_synthetic_db()))
        result = service.match("zoologico", "aceite de oliva", None)
        assert (result.status, result.candidates, result.top_score, result.margin) == (
            "no_match",
            [],
            0.0,
            0.0,
        )

    def test_null_unidad_row_surfaces_as_none(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        service = MatcherService(_settings(make_synthetic_db({"zoologico": [SIN_UNIDAD]})))
        top = service.match("zoologico", "panela cuadrada", None).candidates[0]
        assert top.unidad is None
        assert top.unidad_display is None

    def test_response_depth_follows_max_candidates(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        rows = [(f"ACEITE TIPO {i}", "Liter", 1.0, str(i)) for i in range(9)]
        path = make_synthetic_db({"zoologico": rows})
        service = MatcherService(_settings(path, match_max_candidates=3))
        assert len(service.match("zoologico", "aceite tipo 1", None).candidates) == 3

    def test_unrecognized_unit_is_not_an_error(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        service = MatcherService(_settings(make_synthetic_db({"zoologico": [ACEITE]})))
        assert service.match("zoologico", "aceite de oliva", "barriles").status in {
            "matched",
            "ambiguous",
            "no_match",
        }

    def test_unit_rerank_never_removes_candidates(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        path = make_synthetic_db({"zoologico": [ACEITE, ARROZ, SIN_UNIDAD]})
        service = MatcherService(_settings(path))
        with_unit = service.match("zoologico", "aceite de oliva", "litros")
        without = service.match("zoologico", "aceite de oliva", None)
        assert sorted(c.articulo for c in with_unit.candidates) == sorted(
            c.articulo for c in without.candidates
        )

    def test_real_catalogue_matches_a_known_article(
        self, catalogue_db_path: Path
    ) -> None:
        service = MatcherService(_settings(catalogue_db_path))
        result = service.match("stock_almacen_ayb", "achiote molido", None)
        assert result.candidates
        assert result.candidates[0].articulo.upper().startswith("ACHIOTE")

    def test_service_does_not_hold_a_live_connection(
        self, make_synthetic_db: Callable[..., Path]
    ) -> None:
        # Catalogue is loaded fully into memory; deleting the file keeps it serving.
        path = make_synthetic_db({"zoologico": [ACEITE]})
        service = MatcherService(_settings(path))
        path.unlink()
        assert service.match("zoologico", "aceite de oliva", None).candidates
