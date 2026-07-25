"""HTTP surface smoke suite (REQ-API-1/2/3/4, design §HTTP contract).

These tests exercise the real FastAPI app through `fastapi.testclient`, with
the app's own lifespan loading the committed catalogue read-only. They prove
the wire contract, not the engine: engine semantics are already pinned by the
unit suite, so what matters here is that every field survives serialization,
that all three statuses are reachable by a caller, and that the two client
error paths (unknown catalogue, blank name) never masquerade as a `no_match`.

Query provenance (measured against `data/bodegas-y-stock.sqlite`):
  - "achiote molido"  -> matched   (top 1.0, margin 0.65)
  - "aceite de oliva" -> ambiguous (wide trigram margin, crowded token_set_ratio)
  - "zzzzqqq xkcd"    -> no_match  (top 0.048)
"""
from __future__ import annotations

import uuid
from pathlib import Path

import pytest

CATALOGUE = "stock_almacen_ayb"

MATCHED_QUERY = "achiote molido"
AMBIGUOUS_QUERY = "aceite de oliva"
NO_MATCH_QUERY = "zzzzqqq xkcd"

CANDIDATE_FIELDS = {"nr_articulo", "articulo", "unidad", "unidad_display", "score"}
RESPONSE_FIELDS = {"status", "candidates", "top_score", "margin", "request_id"}


def post_match(client, **overrides) -> object:
    payload = {
        "spoken_name": MATCHED_QUERY,
        "catalogue_id": CATALOGUE,
        "unit": None,
    }
    payload.update(overrides)
    return client.post("/match", json=payload)


class TestMatchResponseShape:
    def test_matched_query_returns_200(self, client) -> None:
        assert post_match(client).status_code == 200

    def test_response_carries_exactly_the_contract_fields(self, client) -> None:
        assert set(post_match(client).json()) == RESPONSE_FIELDS

    def test_matched_status(self, client) -> None:
        assert post_match(client).json()["status"] == "matched"

    def test_candidates_are_non_empty(self, client) -> None:
        assert post_match(client).json()["candidates"]

    def test_candidate_carries_exactly_the_contract_fields(self, client) -> None:
        candidate = post_match(client).json()["candidates"][0]
        assert set(candidate) == CANDIDATE_FIELDS

    def test_top_candidate_is_the_expected_row(self, client) -> None:
        candidate = post_match(client).json()["candidates"][0]
        assert candidate["articulo"] == "ACHIOTE MOLIDO"
        assert candidate["nr_articulo"] == "7003"

    def test_unidad_display_is_the_spanish_short_form(self, client) -> None:
        candidate = post_match(client).json()["candidates"][0]
        assert candidate["unidad"] == "Kilogram"
        assert candidate["unidad_display"] == "kg"

    def test_scores_are_floats_in_the_unit_interval(self, client) -> None:
        body = post_match(client).json()
        assert 0.0 <= body["candidates"][0]["score"] <= 1.0
        assert 0.0 <= body["top_score"] <= 1.0
        assert 0.0 <= body["margin"] <= 1.0

    def test_top_score_equals_the_first_candidate_score(self, client) -> None:
        body = post_match(client).json()
        assert body["top_score"] == pytest.approx(body["candidates"][0]["score"])

    def test_candidate_depth_respects_max_candidates(self, client) -> None:
        assert len(post_match(client).json()["candidates"]) <= 5

    def test_request_id_is_a_uuid4(self, client) -> None:
        parsed = uuid.UUID(post_match(client).json()["request_id"])
        assert parsed.version == 4

    def test_request_id_is_unique_per_request(self, client) -> None:
        first = post_match(client).json()["request_id"]
        second = post_match(client).json()["request_id"]
        assert first != second

    def test_unit_is_optional_in_the_request_body(self, client) -> None:
        response = client.post(
            "/match",
            json={"spoken_name": MATCHED_QUERY, "catalogue_id": CATALOGUE},
        )
        assert response.status_code == 200

    def test_known_unit_does_not_remove_candidates(self, client) -> None:
        without = post_match(client).json()["candidates"]
        with_unit = post_match(client, unit="kilos").json()["candidates"]
        assert len(with_unit) == len(without)


class TestAllThreeStatusesReachable:
    def test_clear_match_is_matched(self, client) -> None:
        body = post_match(client, spoken_name=MATCHED_QUERY).json()
        assert body["status"] == "matched"

    def test_crowded_field_is_ambiguous(self, client) -> None:
        body = post_match(client, spoken_name=AMBIGUOUS_QUERY).json()
        assert body["status"] == "ambiguous"

    def test_garbage_input_is_no_match(self, client) -> None:
        body = post_match(client, spoken_name=NO_MATCH_QUERY).json()
        assert body["status"] == "no_match"

    def test_garbage_input_still_returns_200(self, client) -> None:
        assert post_match(client, spoken_name=NO_MATCH_QUERY).status_code == 200

    def test_three_distinct_statuses_observed(self, client) -> None:
        statuses = {
            post_match(client, spoken_name=q).json()["status"]
            for q in (MATCHED_QUERY, AMBIGUOUS_QUERY, NO_MATCH_QUERY)
        }
        assert statuses == {"matched", "ambiguous", "no_match"}

    def test_empty_trigram_query_is_no_match_not_an_error(self, client) -> None:
        body = post_match(client, spoken_name="???").json()
        assert body["status"] == "no_match"
        assert body["top_score"] == 0.0


class TestClientErrors:
    def test_unknown_catalogue_is_404(self, client) -> None:
        assert post_match(client, catalogue_id="not_a_table").status_code == 404

    def test_unknown_catalogue_detail_names_the_id(self, client) -> None:
        detail = post_match(client, catalogue_id="not_a_table").json()["detail"]
        assert "not_a_table" in detail

    def test_unknown_catalogue_is_never_a_no_match(self, client) -> None:
        body = post_match(client, catalogue_id="not_a_table").json()
        assert "status" not in body

    def test_blank_spoken_name_is_422(self, client) -> None:
        assert post_match(client, spoken_name="").status_code == 422

    def test_whitespace_spoken_name_is_422(self, client) -> None:
        assert post_match(client, spoken_name="   ").status_code == 422

    def test_missing_spoken_name_is_422(self, client) -> None:
        response = client.post("/match", json={"catalogue_id": CATALOGUE})
        assert response.status_code == 422

    def test_oversized_spoken_name_is_422(self, client) -> None:
        """An unbounded name would be buffered and trigram-expanded (JD-2)."""
        assert post_match(client, spoken_name="a" * 301).status_code == 422

    def test_spoken_name_at_the_limit_is_accepted(self, client) -> None:
        assert post_match(client, spoken_name="a" * 300).status_code == 200

    def test_oversized_catalogue_id_is_422_not_404(self, client) -> None:
        assert post_match(client, catalogue_id="c" * 101).status_code == 422

    def test_oversized_unit_is_422(self, client) -> None:
        assert post_match(client, unit="u" * 51).status_code == 422

    def test_unrecognized_unit_is_not_an_error(self, client) -> None:
        response = post_match(client, unit="cucharadas soperas")
        assert response.status_code == 200
        assert response.json()["status"] == "matched"


class TestCatalogues:
    def test_returns_200(self, client) -> None:
        assert client.get("/catalogues").status_code == 200

    def test_lists_the_eight_stock_tables(self, client) -> None:
        entries = client.get("/catalogues").json()["catalogues"]
        assert len(entries) == 8

    def test_ids_match_the_stock_table_names(self, client) -> None:
        from matcher.catalogue import STOCK_TABLES

        entries = client.get("/catalogues").json()["catalogues"]
        assert [e["catalogue_id"] for e in entries] == STOCK_TABLES

    def test_every_entry_has_a_positive_row_count(self, client) -> None:
        entries = client.get("/catalogues").json()["catalogues"]
        assert all(e["rows"] > 0 for e in entries)

    def test_entry_shape(self, client) -> None:
        entry = client.get("/catalogues").json()["catalogues"][0]
        assert set(entry) == {"catalogue_id", "rows"}

    def test_listed_ids_are_all_matchable(self, client) -> None:
        entries = client.get("/catalogues").json()["catalogues"]
        for entry in entries:
            response = post_match(client, catalogue_id=entry["catalogue_id"])
            assert response.status_code == 200


class TestHealth:
    def test_returns_200(self, client) -> None:
        assert client.get("/health").status_code == 200

    def test_reports_ok(self, client) -> None:
        assert client.get("/health").json()["status"] == "ok"

    def test_reports_catalogue_and_row_totals(self, client) -> None:
        body = client.get("/health").json()
        assert body["catalogues"] == 8
        assert body["rows"] > 0

    def test_row_total_equals_the_sum_of_catalogue_rows(self, client) -> None:
        entries = client.get("/catalogues").json()["catalogues"]
        assert client.get("/health").json()["rows"] == sum(e["rows"] for e in entries)

    def test_health_shape(self, client) -> None:
        assert set(client.get("/health").json()) == {"status", "catalogues", "rows"}


class TestStartupFailsFast:
    def test_missing_database_aborts_startup(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.catalogue import CatalogueUnavailableError
        from matcher.main import app

        monkeypatch.setenv("CATALOGUE_DB", str(tmp_path / "absent.sqlite"))
        with pytest.raises(CatalogueUnavailableError):
            with TestClient(app):
                pass

    def test_invalid_threshold_aborts_startup(
        self, catalogue_db_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from fastapi.testclient import TestClient
        from pydantic import ValidationError

        from matcher.main import app

        monkeypatch.setenv("CATALOGUE_DB", str(catalogue_db_path))
        monkeypatch.setenv("MATCH_ACCEPT_SCORE", "not-a-number")
        with pytest.raises(ValidationError):
            with TestClient(app):
                pass

    def test_no_service_is_left_behind_after_a_failed_startup(
        self, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.catalogue import CatalogueUnavailableError
        from matcher.main import app

        monkeypatch.setenv("CATALOGUE_DB", str(tmp_path / "absent.sqlite"))
        with pytest.raises(CatalogueUnavailableError):
            with TestClient(app):
                pass
        assert getattr(app.state, "service", None) is None
