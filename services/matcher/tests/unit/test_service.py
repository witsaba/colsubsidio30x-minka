"""`MatcherService` over the two ports (REQ-API-1/2, design D2/D4/D5).

The service composes a `CatalogueSource` and a `SnapshotCache` and resolves the
catalogue exactly once, at construction, through `load_index`. Everything it
answers afterwards is read from one immutable in-process `CatalogueIndex`, so
`POST /match` performs no I/O at all (REQ-RCC-3).

`catalogue_id` is a `warehouses.code`. An unknown one is a client error
(`UnknownCatalogueError`), never a `no_match`; a catalogue that cannot be
resolved at all is a startup failure (`CatalogueUnavailableError`), never a
degraded service (REQ-CSS-5).

The SQLite loader tests that used to live here retired with the loader itself:
REQ-API-5 (read-only SQLite catalogue) is REMOVED by this change's spec delta.
"""
from __future__ import annotations

from dataclasses import FrozenInstanceError

import pytest
from conftest import (
    FIXTURE_CATALOGUE_ID,
    FIXTURE_ROW_COUNT,
    FIXTURE_WAREHOUSES,
    FakeCatalogueSource,
    make_cache,
    make_rows,
)

from matcher.catalogue import CatalogueUnavailableError
from matcher.config import Settings
from matcher.ports import Row
from matcher.scoring import TrigramSimilarityMatcher
from matcher.service import CatalogueIndex, MatcherService, UnknownCatalogueError

ACEITE = "ACEITE DE OLIVA"
ARROZ = "ARROZ BLANCO"


def build(settings: Settings, rows: list[Row] | None = None, **kwargs):
    source = FakeCatalogueSource(rows if rows is not None else make_rows())
    return MatcherService(settings, source, make_cache(), **kwargs)


class TestAtomicIndex:
    """D4: one immutable reference bundling the catalogue and its matcher."""

    def test_the_service_holds_one_immutable_catalogue_index(
        self, settings: Settings
    ) -> None:
        service = build(settings)

        index = service._index

        assert isinstance(index, CatalogueIndex)
        assert isinstance(index.matcher, TrigramSimilarityMatcher)
        assert sorted(index.catalogue) == sorted(FIXTURE_WAREHOUSES)
        with pytest.raises(FrozenInstanceError):
            index.catalogue = {}

    def test_the_bundled_matcher_is_already_built_over_the_catalogue(
        self, settings: Settings
    ) -> None:
        """A half-built index must never be reachable: the matcher travels with
        the catalogue it was built from, in the same frozen object."""
        service = build(settings)

        index = service._index

        assert index.matcher.rows_by_table is index.catalogue
        assert index.matcher.rank(FIXTURE_CATALOGUE_ID, "arroz blanco", top_k=1)

    def test_the_index_records_where_the_catalogue_came_from(
        self, settings: Settings
    ) -> None:
        assert build(settings).source == "supabase"


class TestServiceStartup:
    def test_an_unavailable_source_fails_at_construction(
        self, settings: Settings
    ) -> None:
        """REQ-CSS-5: startup aborts rather than serving an empty catalogue."""
        with pytest.raises(CatalogueUnavailableError):
            MatcherService(
                settings, FakeCatalogueSource(fail_times=1), make_cache()
            )

    def test_the_source_is_read_exactly_once_at_construction(
        self, settings: Settings
    ) -> None:
        source = FakeCatalogueSource(make_rows())
        service = MatcherService(settings, source, make_cache())

        service.match(FIXTURE_CATALOGUE_ID, "arroz blanco", None)
        service.catalogues()

        assert source.calls == 1

    def test_catalogues_reports_each_warehouse_code_with_its_row_count(
        self, settings: Settings
    ) -> None:
        entries = build(settings).catalogues()

        assert sorted(code for code, _ in entries) == sorted(FIXTURE_WAREHOUSES)
        assert sum(count for _, count in entries) == FIXTURE_ROW_COUNT
        assert all(count > 0 for _, count in entries)

    def test_catalogues_counts_match_the_loaded_rows(
        self, settings: Settings
    ) -> None:
        rows = make_rows({"BOD-77": [ACEITE, ARROZ]})

        assert dict(build(settings, rows).catalogues()) == {"BOD-77": 2}


class TestServiceMatch:
    def test_an_unknown_warehouse_code_raises_unknown_catalogue(
        self, settings: Settings
    ) -> None:
        service = build(settings, make_rows({"BOD-77": [ACEITE]}))

        with pytest.raises(UnknownCatalogueError):
            service.match("BOD-99", "aceite de oliva", None)

    def test_unknown_catalogue_error_names_the_id(self, settings: Settings) -> None:
        service = build(settings, make_rows({"BOD-77": [ACEITE]}))

        with pytest.raises(UnknownCatalogueError) as excinfo:
            service.match("BOD-99", "aceite", None)

        assert "BOD-99" in str(excinfo.value)

    def test_a_stock_table_name_is_no_longer_a_catalogue_id(
        self, settings: Settings
    ) -> None:
        """REQ-API-2, BREAKING: the SQLite table names are gone for good."""
        service = build(settings)

        with pytest.raises(UnknownCatalogueError):
            service.match("stock_almacen_ayb", "arroz blanco", None)

    def test_clear_query_is_matched(self, settings: Settings) -> None:
        service = build(settings, make_rows({"BOD-77": [ACEITE, ARROZ]}))

        result = service.match("BOD-77", "aceite de oliva", None)

        assert result.status == "matched"
        assert result.candidates[0].articulo == ACEITE

    def test_garbage_query_is_no_match(self, settings: Settings) -> None:
        service = build(settings, make_rows({"BOD-77": [ACEITE, ARROZ]}))

        assert service.match("BOD-77", "???", None).status == "no_match"

    def test_an_empty_warehouse_yields_an_empty_no_match(
        self, settings: Settings
    ) -> None:
        """A warehouse with no active products is still a valid catalogue_id."""
        rows = make_rows({"BOD-77": [ACEITE]})
        source = FakeCatalogueSource(rows)
        service = MatcherService(settings, source, make_cache())
        service._index.catalogue["BOD-EMPTY"] = []
        service._index.matcher.build(service._index.catalogue)

        result = service.match("BOD-EMPTY", "aceite de oliva", None)

        assert (result.status, result.candidates, result.top_score, result.margin) == (
            "no_match",
            [],
            0.0,
            0.0,
        )

    def test_null_unidad_row_surfaces_as_none(self, settings: Settings) -> None:
        rows = [
            Row(
                warehouse_code="BOD-77",
                uid="BOD-77-0001",
                articulo="PANELA CUADRADA",
                unidad=None,
                nr_articulo=None,
            )
        ]
        service = build(settings, rows)

        top = service.match("BOD-77", "panela cuadrada", None).candidates[0]

        assert top.unidad is None
        assert top.unidad_display is None

    def test_response_depth_follows_max_candidates(self, settings: Settings) -> None:
        rows = make_rows({"BOD-77": [f"ACEITE TIPO {i}" for i in range(9)]})
        service = build(
            settings.model_copy(update={"match_max_candidates": 3}), rows
        )

        assert len(service.match("BOD-77", "aceite tipo 1", None).candidates) == 3

    def test_unrecognized_unit_is_not_an_error(self, settings: Settings) -> None:
        service = build(settings, make_rows({"BOD-77": [ACEITE]}))

        assert service.match("BOD-77", "aceite de oliva", "barriles").status in {
            "matched",
            "ambiguous",
            "no_match",
        }

    def test_unit_rerank_never_removes_candidates(self, settings: Settings) -> None:
        service = build(settings, make_rows({"BOD-77": [ACEITE, ARROZ]}))

        with_unit = service.match("BOD-77", "aceite de oliva", "litros")
        without = service.match("BOD-77", "aceite de oliva", None)

        assert sorted(c.articulo for c in with_unit.candidates) == sorted(
            c.articulo for c in without.candidates
        )

    def test_match_reads_the_index_once_at_entry(self, settings: Settings) -> None:
        """D4: the whole answer comes from a single index reference, so a swap
        mid-request can never pair a catalogue with a foreign matcher."""
        service = build(settings, make_rows({"BOD-77": [ACEITE, ARROZ]}))
        original = service._index

        result = service.match("BOD-77", "aceite de oliva", None)

        assert service._index is original
        assert result.candidates[0].articulo == ACEITE

    def test_the_service_performs_no_io_per_request(
        self, settings: Settings
    ) -> None:
        """REQ-RCC-3: the source is never touched again after startup."""
        source = FakeCatalogueSource(make_rows({"BOD-77": [ACEITE, ARROZ]}))
        service = MatcherService(settings, source, make_cache())

        for _ in range(5):
            service.match("BOD-77", "aceite de oliva", None)

        assert source.calls == 1


class TestUnitVocabulary:
    """REQ-ENG-5 end to end: `unidad` speaks `warehouse_products.unit_code`.

    The retired SQLite catalogue stored the workbook *labels*
    (`Kilogram`/`Liter`/`Unidad`/`Portion`); Supabase keeps those in
    `units.source_label` and serves the *codes* (`KG`/`LT`/`UND`/`POR`/`CAJA`)
    on `warehouse_products.unit_code`, which is what `Row.unidad` now carries.
    A display map keyed on the retired vocabulary silently returns `None` for
    every real row, so this is asserted through `MatcherService.match()` -- the
    exact path `POST /match` takes -- rather than against the map directly.
    """

    @pytest.mark.parametrize(
        ("unit_code", "display"),
        [
            ("KG", "kg"),
            ("LT", "litros"),
            ("UND", "unidades"),
            ("POR", "porciones"),
        ],
    )
    def test_a_code_vocabulary_unidad_still_renders_its_display_copy(
        self, settings: Settings, unit_code: str, display: str
    ) -> None:
        rows = [
            Row(
                warehouse_code="BOD-77",
                uid="BOD-77-0001",
                articulo="PANELA CUADRADA",
                unidad=unit_code,
                nr_articulo="7100",
            )
        ]
        service = build(settings, rows)

        top = service.match("BOD-77", "panela cuadrada", None).candidates[0]

        assert top.unidad == unit_code
        assert top.unidad_display == display
