"""Supabase catalogue source: one paginated PostgREST read (design D1).

The whole catalogue is one embedded-resource query against
`warehouse_products`, inner-joined to `warehouses` and `products` so the
active-row filters of REQ-CSS-3 actually restrict the result set:

    GET {base}/rest/v1/warehouse_products
      ?select=id,unit_code,warehouses!inner(code),products!inner(name,sku)
      &is_active=eq.true
      &warehouses.is_active=eq.true
      &warehouses.merged_into_warehouse_id=is.null
      &products.is_active=eq.true
      &order=id

Plain `httpx` rather than the `supabase` SDK: the load path is synchronous and
runs twice per three hours, so a query builder that drags gotrue, realtime and
storage3 into the image buys nothing and widens the supply-chain surface.

**Pagination is mandatory, not defensive.** PostgREST caps a response at
1,000 rows and the catalogue is ~1,405, so a single unpaged request returns a
silently truncated catalogue that still looks perfectly healthy. The `Range`
loop reads until a short page arrives; `order=id` keeps the window stable
across requests so no row is duplicated or dropped at a page boundary.

`warehouse_stock_balances` is never referenced here, and no `select=` names a
stock column: `theoretical_qty` is RF-18 data that must not reach an
operator-facing service (REQ-CSS-4). `units` is granted to the credential but
never fetched -- `unit_code` is denormalized on the link row and `UNIT_DISPLAY`
is local (D1).

Every transient failure -- transport, timeout, any HTTP error status, a
malformed body, or zero rows -- becomes a cause-chained
`CatalogueUnavailableError`, which the startup retry loop already understands
(D5). The credential is never interpolated into an error message.
"""
from __future__ import annotations

from typing import Any

import httpx

from matcher.catalogue import CatalogueUnavailableError
from matcher.ports import Row

CATALOGUE_PATH = "/rest/v1/warehouse_products"
SELECT = "id,unit_code,warehouses!inner(code),products!inner(name,sku)"
PAGE_SIZE = 1000

FILTERS = {
    "select": SELECT,
    "is_active": "eq.true",
    "warehouses.is_active": "eq.true",
    "warehouses.merged_into_warehouse_id": "is.null",
    "products.is_active": "eq.true",
    "order": "id",
}


class SupabaseCatalogueSource:
    """`CatalogueSource` over PostgREST, read at startup and refresh time only."""

    def __init__(
        self,
        client: httpx.Client,
        base_url: str,
        key: str,
        page_size: int = PAGE_SIZE,
    ) -> None:
        self._client = client
        self._base_url = base_url.rstrip("/")
        self._key = key
        self._page_size = page_size

    def load(self) -> dict[str, list[Row]]:
        """Return every active catalogue row grouped by warehouse code."""
        catalogue: dict[str, list[Row]] = {}
        total = 0
        for page in self._pages():
            for payload in page:
                row = self._to_row(payload)
                catalogue.setdefault(row.warehouse_code, []).append(row)
                total += 1
        if total == 0:
            raise CatalogueUnavailableError(
                "the Supabase catalogue returned zero rows; refusing to serve "
                "an empty catalogue"
            )
        return catalogue

    def _pages(self) -> list[list[dict[str, Any]]]:
        """Read `Range`-windowed pages until a short one ends the sequence."""
        pages: list[list[dict[str, Any]]] = []
        offset = 0
        while True:
            page = self._fetch_page(offset)
            pages.append(page)
            if len(page) < self._page_size:
                return pages
            offset += self._page_size

    def _fetch_page(self, offset: int) -> list[dict[str, Any]]:
        headers = {
            "apikey": self._key,
            "Authorization": f"Bearer {self._key}",
            "Range": f"{offset}-{offset + self._page_size - 1}",
            "Accept": "application/json",
        }
        try:
            response = self._client.get(
                f"{self._base_url}{CATALOGUE_PATH}", params=FILTERS, headers=headers
            )
            response.raise_for_status()
            page = response.json()
        except httpx.HTTPStatusError as exc:
            raise CatalogueUnavailableError(
                "the Supabase catalogue request failed with HTTP "
                f"{exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise CatalogueUnavailableError(
                f"cannot reach the Supabase catalogue: {type(exc).__name__}"
            ) from exc
        except ValueError as exc:
            raise CatalogueUnavailableError(
                "the Supabase catalogue response was not valid JSON"
            ) from exc
        if not isinstance(page, list):
            raise CatalogueUnavailableError(
                "the Supabase catalogue response was not a list of rows"
            )
        return page

    @staticmethod
    def _to_row(payload: dict[str, Any]) -> Row:
        """Flatten one joined link row (REQ-CSS-2). Nulls are never coerced."""
        try:
            return Row(
                warehouse_code=payload["warehouses"]["code"],
                uid=payload["id"],
                articulo=payload["products"]["name"],
                unidad=payload["unit_code"],
                nr_articulo=payload["products"]["sku"],
            )
        except (KeyError, TypeError) as exc:
            raise CatalogueUnavailableError(
                "the Supabase catalogue row is missing a required field"
            ) from exc
