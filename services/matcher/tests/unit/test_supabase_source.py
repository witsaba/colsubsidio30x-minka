"""`SupabaseCatalogueSource`: the PostgREST adapter behind `CatalogueSource`.

Covers the WU-3 contract of the redis-catalogue-cache change:

* the exact query shape of design D1 -- one embedded-resource request against
  `warehouse_products`, carrying the active-row filters of REQ-CSS-3;
* **`Range`-header pagination**. PostgREST caps a response at 1,000 rows and
  the real catalogue is ~1,405, so a non-paginating implementation silently
  serves a truncated catalogue -- the worst failure mode available here,
  because it looks healthy. The boundary crossing is asserted explicitly;
* row assembly per REQ-CSS-2: `uid` = `warehouse_products.id`,
  `articulo` = `products.name`, `unidad` = `unit_code` (nullable, never
  coerced), `nr_articulo` = `products.sku`, grouped by `warehouses.code`;
* **REQ-CSS-4**: the source provably never constructs a request touching
  `warehouse_stock_balances`, `theoretical_qty` or stock of any kind. This is
  the offline half of the stock-isolation guarantee; the live credential
  denial is manual evidence (task 9.3);
* the D5 error taxonomy: transport, HTTP, decode and zero-row failures all
  surface as a cause-chained `CatalogueUnavailableError`.

The real `httpx.Client` runs over an `httpx.MockTransport` -- the repo's
real-but-throwaway convention. **No test here touches the network.**
"""
from __future__ import annotations

import httpx
import pytest

from matcher.catalogue import CatalogueUnavailableError
from matcher.ports import CatalogueSource, Row
from matcher.supabase_source import SupabaseCatalogueSource

BASE_URL = "http://supabase.invalid"
API_KEY = "test-service-key"
PAGE_SIZE = 1000

FORBIDDEN_FRAGMENTS = ("warehouse_stock_balances", "theoretical_qty", "stock")


def make_payload_row(
    link_id: str = "11111111-1111-4111-8111-111111111111",
    warehouse_code: str = "BOD-01",
    name: str = "AZUCAR MORENA X 500 G",
    sku: str | None = "SKU-0001",
    unit_code: str | None = "KG",
) -> dict[str, object]:
    """One PostgREST row of the D1 embedded-resource select."""
    return {
        "id": link_id,
        "unit_code": unit_code,
        "warehouses": {"code": warehouse_code},
        "products": {"name": name, "sku": sku},
    }


def build_source(handler: object) -> SupabaseCatalogueSource:
    client = httpx.Client(transport=httpx.MockTransport(handler))  # type: ignore[arg-type]
    return SupabaseCatalogueSource(client, base_url=BASE_URL, key=API_KEY)


def recording_source(
    pages: list[list[dict[str, object]]],
) -> tuple[SupabaseCatalogueSource, list[httpx.Request]]:
    """A source whose transport serves `pages` in order and records requests."""
    recorded: list[httpx.Request] = []
    remaining = list(pages)

    def handler(request: httpx.Request) -> httpx.Response:
        recorded.append(request)
        page = remaining.pop(0) if remaining else []
        return httpx.Response(200, json=page)

    return build_source(handler), recorded


def single_page_source(
    rows: list[dict[str, object]],
) -> tuple[SupabaseCatalogueSource, list[httpx.Request]]:
    return recording_source([rows])


class TestPortConformance:
    def test_the_adapter_satisfies_the_catalogue_source_port(self) -> None:
        source, _ = single_page_source([make_payload_row()])

        assert isinstance(source, CatalogueSource)


class TestQueryShape:
    def test_it_queries_only_the_warehouse_products_endpoint(self) -> None:
        source, recorded = single_page_source([make_payload_row()])

        source.load()

        assert len(recorded) == 1
        assert [r.url.path for r in recorded] == ["/rest/v1/warehouse_products"]

    def test_it_never_queries_warehouse_stock_balances(self) -> None:
        """REQ-CSS-4: stock is RF-18 data and is never even requested.

        Checked against the whole URL -- path *and* query -- because an
        embedded-resource select could smuggle a stock join into `select=`
        without ever changing the path.
        """
        source, recorded = recording_source(
            [[make_payload_row(link_id=f"uid-{n}") for n in range(PAGE_SIZE)], []]
        )

        source.load()

        assert len(recorded) == 2
        for request in recorded:
            url = str(request.url).lower()
            for fragment in FORBIDDEN_FRAGMENTS:
                assert fragment not in url, f"{fragment!r} appeared in {url}"

    def test_it_filters_inactive_and_merged_rows(self) -> None:
        """REQ-CSS-3: inactive or merged warehouses are never offered."""
        source, recorded = single_page_source([make_payload_row()])

        source.load()

        query = recorded[0].url.query.decode()
        assert "is_active=eq.true" in query
        assert "warehouses.is_active=eq.true" in query
        assert "warehouses.merged_into_warehouse_id=is.null" in query
        assert "products.is_active=eq.true" in query

    def test_it_selects_the_five_catalogue_columns_through_inner_joins(self) -> None:
        """D1: `!inner` is what makes the warehouse/product filters restrictive."""
        source, recorded = single_page_source([make_payload_row()])

        source.load()

        assert (
            recorded[0].url.params.get("select")
            == "id,unit_code,warehouses!inner(code),products!inner(name,sku)"
        )

    def test_it_orders_by_id_so_pagination_is_stable(self) -> None:
        """An unordered paginated read can duplicate or drop rows across pages."""
        source, recorded = single_page_source([make_payload_row()])

        source.load()

        assert recorded[0].url.params.get("order") == "id"

    def test_it_sends_the_apikey_and_bearer_headers(self) -> None:
        source, recorded = single_page_source([make_payload_row()])

        source.load()

        assert recorded[0].headers["apikey"] == API_KEY
        assert recorded[0].headers["authorization"] == f"Bearer {API_KEY}"

    def test_it_never_fetches_the_units_table(self) -> None:
        """D1: `unit_code` is denormalized and `UNIT_DISPLAY` is local."""
        source, recorded = single_page_source([make_payload_row()])

        source.load()

        assert all("units" not in str(r.url) for r in recorded)


class TestPagination:
    def test_it_follows_the_range_header_past_the_thousand_row_page(self) -> None:
        """D1: PostgREST caps at 1,000 rows; the real catalogue is 1,405.

        A non-paginating implementation truncates silently and still looks
        healthy -- this is the truncation guard from the design risk table.
        """
        first = [make_payload_row(link_id=f"uid-{n}") for n in range(PAGE_SIZE)]
        second = [make_payload_row(link_id=f"uid-{n}") for n in range(1000, 1405)]
        source, recorded = recording_source([first, second])

        catalogue = source.load()

        assert [r.headers["range"] for r in recorded] == ["0-999", "1000-1999"]
        assert sum(len(rows) for rows in catalogue.values()) == 1405

    def test_a_short_first_page_stops_after_one_request(self) -> None:
        source, recorded = recording_source([[make_payload_row()], [make_payload_row()]])

        source.load()

        assert len(recorded) == 1

    def test_an_exactly_full_page_followed_by_an_empty_one_is_not_truncated(
        self,
    ) -> None:
        """The boundary case: a full page must be followed by one more read."""
        full = [make_payload_row(link_id=f"uid-{n}") for n in range(PAGE_SIZE)]
        source, recorded = recording_source([full, []])

        catalogue = source.load()

        assert len(recorded) == 2
        assert sum(len(rows) for rows in catalogue.values()) == PAGE_SIZE


class TestRowMapping:
    def test_rows_map_uid_articulo_unidad_and_nr_articulo_from_the_joined_tables(
        self,
    ) -> None:
        """REQ-CSS-2."""
        source, _ = single_page_source(
            [
                make_payload_row(
                    link_id="9f1d0d2e-0000-4000-8000-000000000001",
                    warehouse_code="BOD-07",
                    name="ARROZ BLANCO X 500 G",
                    sku="SKU-4242",
                    unit_code="UND",
                )
            ]
        )

        catalogue = source.load()

        row = catalogue["BOD-07"][0]
        assert row == Row(
            warehouse_code="BOD-07",
            uid="9f1d0d2e-0000-4000-8000-000000000001",
            articulo="ARROZ BLANCO X 500 G",
            unidad="UND",
            nr_articulo="SKU-4242",
        )

    def test_a_null_unit_code_and_null_sku_are_preserved_as_none(self) -> None:
        source, _ = single_page_source(
            [make_payload_row(warehouse_code="BOD-02", unit_code=None, sku=None)]
        )

        catalogue = source.load()

        row = catalogue["BOD-02"][0]
        assert row.unidad is None
        assert row.nr_articulo is None
        assert row.articulo == "AZUCAR MORENA X 500 G"

    def test_rows_are_grouped_by_warehouse_code(self) -> None:
        source, _ = single_page_source(
            [
                make_payload_row(link_id="a", warehouse_code="BOD-01", name="ARROZ"),
                make_payload_row(link_id="b", warehouse_code="BOD-02", name="PANELA"),
                make_payload_row(link_id="c", warehouse_code="BOD-01", name="LENTEJA"),
            ]
        )

        catalogue = source.load()

        assert set(catalogue) == {"BOD-01", "BOD-02"}
        assert [row.uid for row in catalogue["BOD-01"]] == ["a", "c"]
        assert [row.uid for row in catalogue["BOD-02"]] == ["b"]

    def test_the_loaded_rows_carry_no_stock_attribute(self) -> None:
        """REQ-CSS-4 / REQ-ENG-2: stock is not merely unused, it is never loaded."""
        source, _ = single_page_source([make_payload_row()])

        row = source.load()["BOD-01"][0]

        assert not hasattr(row, "sd")
        assert not hasattr(row, "theoretical_qty")


class TestFailureModes:
    """D5: every transient failure is one cause-chained taxonomy."""

    def _failing_source(self, handler: object) -> SupabaseCatalogueSource:
        return build_source(handler)

    def test_a_5xx_raises_catalogue_unavailable(self) -> None:
        source = self._failing_source(
            lambda request: httpx.Response(503, text="upstream down")
        )

        with pytest.raises(CatalogueUnavailableError):
            source.load()

    def test_a_401_raises_catalogue_unavailable(self) -> None:
        source = self._failing_source(
            lambda request: httpx.Response(401, json={"message": "invalid key"})
        )

        with pytest.raises(CatalogueUnavailableError):
            source.load()

    def test_a_transport_timeout_raises_catalogue_unavailable(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            raise httpx.ConnectTimeout("timed out", request=request)

        with pytest.raises(CatalogueUnavailableError) as caught:
            self._failing_source(handler).load()

        assert isinstance(caught.value.__cause__, httpx.HTTPError)

    def test_invalid_json_raises_catalogue_unavailable(self) -> None:
        source = self._failing_source(
            lambda request: httpx.Response(
                200, content=b"{not json", headers={"content-type": "application/json"}
            )
        )

        with pytest.raises(CatalogueUnavailableError):
            source.load()

    def test_a_payload_of_the_wrong_shape_raises_catalogue_unavailable(self) -> None:
        source = self._failing_source(
            lambda request: httpx.Response(200, json=[{"id": "a", "unit_code": "KG"}])
        )

        with pytest.raises(CatalogueUnavailableError):
            source.load()

    def test_zero_rows_raises_catalogue_unavailable(self) -> None:
        """REQ-CSS-5: an empty catalogue is never a valid result."""
        source = self._failing_source(lambda request: httpx.Response(200, json=[]))

        with pytest.raises(CatalogueUnavailableError) as caught:
            source.load()

        assert "empty" in str(caught.value).lower()

    def test_the_error_message_never_leaks_the_credential(self) -> None:
        """REQ-API-8: the key must not reach a log line through an exception."""
        source = self._failing_source(
            lambda request: httpx.Response(401, json={"message": "invalid key"})
        )

        with pytest.raises(CatalogueUnavailableError) as caught:
            source.load()

        assert API_KEY not in str(caught.value)
