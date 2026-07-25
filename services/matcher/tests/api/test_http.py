"""HTTP surface smoke suite (REQ-API-1/2/3/4, design §HTTP contract).

These tests exercise the real FastAPI app through `fastapi.testclient`, with
the app's own lifespan resolving the catalogue through the real `load_index`
over the fixture adapters. They prove the wire contract, not the engine:
engine semantics are already pinned by the unit suite, so what matters here is
that every field survives serialization, that all three statuses are reachable
by a caller, and that the two client error paths (unknown catalogue, blank
name) never masquerade as a `no_match`.

**BREAKING (REQ-API-2)**: `catalogue_id` is a `warehouses.code`, not one of the
eight retired SQLite stock-table names.

Query provenance (measured against `conftest.FIXTURE_CATALOGUE`):
  - "achiote molido"  -> matched   (a single close row)
  - "aceite de oliva" -> ambiguous (two near-identical olive-oil rows)
  - "zzzzqqq xkcd"    -> no_match  (nothing above the accept score)
"""
from __future__ import annotations

import uuid

import pytest
from conftest import (
    FIXTURE_CATALOGUE_ID,
    FIXTURE_ROW_COUNT,
    FIXTURE_WAREHOUSES,
    FakeCatalogueSource,
    make_cache,
)

CATALOGUE = FIXTURE_CATALOGUE_ID
UNKNOWN_CATALOGUE = "BOD-99"

MATCHED_QUERY = "achiote molido"
AMBIGUOUS_QUERY = "aceite de oliva"
NO_MATCH_QUERY = "zzzzqqq xkcd"

CANDIDATE_FIELDS = {"nr_articulo", "articulo", "unidad", "unidad_display", "score"}
RESPONSE_FIELDS = {"status", "candidates", "top_score", "margin", "request_id"}


def _install_failing_adapters(monkeypatch: pytest.MonkeyPatch) -> None:
    """Both legs of the D5 chain dead: an empty cache and a failing source."""
    from matcher import main as main_module

    monkeypatch.setattr(
        main_module,
        "_build_adapters",
        lambda _settings: (FakeCatalogueSource(fail_times=99), make_cache()),
    )


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
        assert post_match(client, catalogue_id=UNKNOWN_CATALOGUE).status_code == 404

    def test_unknown_catalogue_detail_names_the_id(self, client) -> None:
        detail = post_match(client, catalogue_id=UNKNOWN_CATALOGUE).json()["detail"]
        assert UNKNOWN_CATALOGUE in detail

    def test_unknown_catalogue_is_never_a_no_match(self, client) -> None:
        body = post_match(client, catalogue_id=UNKNOWN_CATALOGUE).json()
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

    def test_it_lists_warehouse_codes_with_row_counts(self, client) -> None:
        """REQ-API-2: one entry per warehouse, keyed by `warehouses.code`."""
        entries = client.get("/catalogues").json()["catalogues"]

        assert sorted(e["catalogue_id"] for e in entries) == sorted(
            FIXTURE_WAREHOUSES
        )
        assert sum(e["rows"] for e in entries) == FIXTURE_ROW_COUNT

    def test_no_stock_table_name_is_listed_any_more(self, client) -> None:
        """BREAKING: the eight SQLite table names are gone (REQ-CSS-1)."""
        entries = client.get("/catalogues").json()["catalogues"]

        assert not any(
            e["catalogue_id"].startswith(("stock_", "zoologico"))
            for e in entries
        )

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
        assert body["catalogues"] == len(FIXTURE_WAREHOUSES)
        assert body["rows"] == FIXTURE_ROW_COUNT

    def test_row_total_equals_the_sum_of_catalogue_rows(self, client) -> None:
        entries = client.get("/catalogues").json()["catalogues"]
        assert client.get("/health").json()["rows"] == sum(e["rows"] for e in entries)

    def test_health_shape(self, client) -> None:
        assert set(client.get("/health").json()) == {"status", "catalogues", "rows"}


class TestStartupFailsFast:
    def test_an_unavailable_catalogue_aborts_startup(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """REQ-CSS-5: no catalogue means no service, never an empty one."""
        from fastapi.testclient import TestClient

        from matcher.catalogue import CatalogueUnavailableError
        from matcher.main import app

        _install_failing_adapters(monkeypatch)
        with pytest.raises(CatalogueUnavailableError):
            with TestClient(app):
                pass

    def test_invalid_threshold_aborts_startup(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from fastapi.testclient import TestClient
        from pydantic import ValidationError

        from matcher.main import app

        monkeypatch.setenv("MATCH_ACCEPT_SCORE", "not-a-number")
        with pytest.raises(ValidationError):
            with TestClient(app):
                pass

    def test_a_missing_supabase_url_aborts_startup(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        """REQ-API-4: a missing credential is permanent, never retried."""
        from fastapi.testclient import TestClient
        from pydantic import ValidationError

        from matcher.main import app

        monkeypatch.delenv("SUPABASE_URL", raising=False)
        with pytest.raises(ValidationError):
            with TestClient(app):
                pass

    def test_no_service_is_left_behind_after_a_failed_startup(
        self, monkeypatch: pytest.MonkeyPatch
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.catalogue import CatalogueUnavailableError
        from matcher.main import app

        _install_failing_adapters(monkeypatch)
        with pytest.raises(CatalogueUnavailableError):
            with TestClient(app):
                pass
        assert getattr(app.state, "service", None) is None
