"""Wire-contract guards on the request model (JD-2).

`MatchRequest` is the only place untrusted text enters the process. Without an
upper bound, an oversized `spoken_name` is buffered, trigram-expanded and
scored against every catalogue row, so the bound belongs on the schema rather
than on any single caller. The existing blank-string guard must survive
untouched.
"""
from __future__ import annotations

import pytest
from pydantic import ValidationError

from matcher.schemas import MatchRequest

CATALOGUE = "stock_almacen_ayb"

MAX_SPOKEN_NAME = 300
MAX_CATALOGUE_ID = 100
MAX_UNIT = 50


class TestSpokenNameLength:
    def test_max_length_is_declared_on_the_field(self) -> None:
        assert (
            MatchRequest.model_fields["spoken_name"].metadata[0].max_length
            == MAX_SPOKEN_NAME
        )

    def test_a_name_at_the_limit_is_accepted(self) -> None:
        request = MatchRequest(
            spoken_name="a" * MAX_SPOKEN_NAME, catalogue_id=CATALOGUE
        )
        assert len(request.spoken_name) == MAX_SPOKEN_NAME

    def test_an_oversized_name_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            MatchRequest(
                spoken_name="a" * (MAX_SPOKEN_NAME + 1), catalogue_id=CATALOGUE
            )

    def test_a_hugely_oversized_name_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            MatchRequest(spoken_name="a" * 100_000, catalogue_id=CATALOGUE)

    def test_the_blank_guard_still_applies(self) -> None:
        with pytest.raises(ValidationError):
            MatchRequest(spoken_name="   ", catalogue_id=CATALOGUE)

    def test_an_ordinary_name_is_still_stripped(self) -> None:
        request = MatchRequest(
            spoken_name="  achiote molido  ", catalogue_id=CATALOGUE
        )
        assert request.spoken_name == "achiote molido"


class TestCatalogueIdLength:
    def test_max_length_is_declared_on_the_field(self) -> None:
        assert (
            MatchRequest.model_fields["catalogue_id"].metadata[0].max_length
            == MAX_CATALOGUE_ID
        )

    def test_an_oversized_catalogue_id_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            MatchRequest(spoken_name="achiote", catalogue_id="c" * 101)

    def test_every_real_catalogue_id_fits_the_limit(self) -> None:
        from matcher.catalogue import STOCK_TABLES

        assert all(len(table) <= MAX_CATALOGUE_ID for table in STOCK_TABLES)


class TestUnitLength:
    def test_max_length_is_declared_on_the_field(self) -> None:
        assert (
            MatchRequest.model_fields["unit"].metadata[0].max_length == MAX_UNIT
        )

    def test_an_oversized_unit_is_rejected(self) -> None:
        with pytest.raises(ValidationError):
            MatchRequest(
                spoken_name="achiote", catalogue_id=CATALOGUE, unit="u" * 51
            )

    def test_unit_stays_optional(self) -> None:
        assert MatchRequest(spoken_name="achiote", catalogue_id=CATALOGUE).unit is None
