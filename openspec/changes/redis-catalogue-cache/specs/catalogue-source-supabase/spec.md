# catalogue-source-supabase Specification

## Purpose

Defines Supabase as the sole source of truth for the matcher catalogue: which tables are read, the row identity and shape, active-row filtering, stock-data isolation (RF-18), and startup abort semantics. Replaces the removed SQLite catalogue path.

## Requirements

### Requirement: Supabase is the only catalogue source (REQ-CSS-1)

The matcher SHALL load its entire catalogue from the Supabase tables `warehouses`, `products`, `warehouse_products`, and `units` — at startup and refresh time only, never per request. The SQLite catalogue path SHALL be removed entirely: no SQLite catalogue loading code, no `CATALOGUE_DB` setting, and no fallback data source of any kind.

#### Scenario: Cold load builds the catalogue from the four tables

- GIVEN a reachable catalogue source populated from `warehouses`, `products`, `warehouse_products`, `units`
- WHEN the service starts
- THEN the in-memory catalogue is keyed by warehouse code and contains one row per active `warehouse_products` link, and the service reports healthy

#### Scenario: No SQLite remnant in the matcher runtime

- GIVEN the matcher package and the root Compose file after the change
- WHEN they are searched for `CATALOGUE_DB` and SQLite catalogue loading
- THEN no reference remains

### Requirement: Row identity and shape (REQ-CSS-2)

Each catalogue row SHALL be identified by `uid` = `warehouse_products.id` (uuid, replacing the former `table#rowid`) and SHALL carry `warehouse_code` = `warehouses.code`, `articulo` = `products.name`, `unidad` = `warehouse_products.unit_code` (nullable, never coerced), and `nr_articulo` = `products.sku` (nullable). The row shape MUST NOT include a stock quantity field (`sd` is dropped; extends REQ-ENG-2).

#### Scenario: Row fields map from the joined tables

- GIVEN a `warehouse_products` link joining a warehouse and a product
- WHEN the catalogue is loaded
- THEN the resulting row's `uid` equals the link's uuid, `articulo` equals the product name, `nr_articulo` equals the product SKU, and `unidad` equals the link's unit code

#### Scenario: No stock quantity on the row

- GIVEN any loaded catalogue row
- WHEN its attributes are inspected
- THEN it exposes no `sd` and no stock-quantity attribute

### Requirement: Active-row filtering (REQ-CSS-3)

The catalogue SHALL include only rows where `warehouses.is_active`, `products.is_active`, and `warehouse_products.is_active` are all true, and SHALL exclude every warehouse whose `merged_into_warehouse_id` is set (together with all its rows). An operator MUST never be offered an inactive or merged warehouse to count against.

#### Scenario: Inactive rows are excluded

- GIVEN a product (or warehouse_products link) with `is_active = false`
- WHEN the catalogue is loaded
- THEN no row for it appears in any catalogue

#### Scenario: Merged warehouses are excluded

- GIVEN a warehouse with `merged_into_warehouse_id` set
- WHEN the catalogue is loaded
- THEN its code is absent from the catalogue and from `GET /catalogues`

### Requirement: Stock-data isolation (REQ-CSS-4)

The matcher MUST NOT query `warehouse_stock_balances` under any circumstance: `theoretical_qty` is RF-18 / RLS-protected and MUST NOT reach an operator-facing service, nor enter the Redis snapshot. (Extends REQ-ENG-2: stock is never a matching prior — now it is never even loaded.)

Isolation SHALL be enforced in the service, not by the credential. The matcher authenticates with the Supabase `service_role` key, which bypasses RLS: a least-privilege alternative was investigated and is not available today, because the `anon` role holds no `GRANT` on any catalogue table (PostgREST returns HTTP 401 `42501`) and every read policy targets the `authenticated` role, with `warehouse_products_read` further requiring `private.is_staff()`. The credential is therefore *capable* of reading stock balances and MUST NOT be relied on as the control. Restoring a genuinely least-privilege catalogue-reader role is recorded as a follow-up for the Data Engineer.

Because the credential is not the control, the following two controls are load-bearing and MUST both hold.

#### Scenario: No stock query is ever issued

- GIVEN a catalogue source that records every table it is asked for
- WHEN the service starts and completes a refresh cycle
- THEN the set of queried tables is exactly the four catalogue tables and never `warehouse_stock_balances`

#### Scenario: The snapshot never carries stock data

- GIVEN a snapshot encoded from any catalogue
- WHEN its stored payload is inspected
- THEN the payload carries exactly the five `Row` fields and no `theoretical_qty` or `sd` key

#### Scenario: The credential never leaks through an error path

- GIVEN a Supabase request that fails
- WHEN the resulting exception is rendered
- THEN its message contains no part of `SUPABASE_KEY`

### Requirement: Startup abort when no source can supply a catalogue (REQ-CSS-5)

When neither a valid Redis snapshot nor Supabase can supply the catalogue at startup, loading SHALL raise `CatalogueUnavailableError`, pass through the existing startup retry loop (REQ-API-7), and exit non-zero on exhaustion. The service MUST NOT start serving an empty catalogue.

#### Scenario: Both Supabase and Redis unreachable aborts

- GIVEN Supabase and Redis both unreachable
- WHEN the service starts and all retry attempts fail
- THEN an ERROR is logged and the process exits non-zero, never reporting healthy

#### Scenario: Redis down but Supabase up still starts

- GIVEN Redis unreachable and Supabase reachable at startup
- WHEN the service starts
- THEN it loads from Supabase, logs a WARNING about the cache, and reports healthy
