"""Shared fixtures for the E2E smoke suite.

These tests hit the LIVE docker compose stack (frontend on :4321 by default);
they are opt-in via `-m e2e` and are never part of the default testpaths.
"""

from __future__ import annotations

import os
from collections.abc import Iterator

import pytest
from playwright.sync_api import APIRequestContext, Playwright

DEFAULT_BASE_URL = "http://localhost:4321"

# Seeded Supabase fixtures (real rows, not mocks — see tests/e2e/README.md).
PLAN_DEMO_002_ID = "88f14e0e-199b-48b3-87c7-3a6ab9b3ff3c"
PLAN_DEMO_001_ID = "44444444-4444-4444-8444-444444444444"
WAREHOUSE_ID = "28f1c715-4c42-4920-bf4b-6127e40ce11f"
WAREHOUSE_CODE = "STOCK_RESTAURANTE_FUENTES_AYB"
OPERATOR_1_ID = "11111111-1111-4111-8111-111111111111"  # demo.operador1
OPERATOR_2_ID = "22222222-2222-4222-8222-222222222222"  # demo.operador2
AUDITOR_ID = "33333333-3333-4333-8333-333333333333"  # demo.auditor1
# Valid v4 UUID that is deliberately assigned to NO plan (fixed, not random at
# runtime, so a failure is reproducible).
UNASSIGNED_OPERATOR_ID = "de1e7a7e-0000-4000-8000-000000000000"


@pytest.fixture(scope="session")
def base_url() -> str:
    """Frontend origin; overrides pytest-base-url's fixture so E2E_BASE_URL wins."""
    return os.environ.get("E2E_BASE_URL", DEFAULT_BASE_URL)


@pytest.fixture(scope="session")
def api(playwright: Playwright, base_url: str) -> Iterator[APIRequestContext]:
    """Playwright APIRequestContext for the API-only tests (no browser)."""
    context = playwright.request.new_context(base_url=base_url)
    yield context
    context.dispose()


def body_snippet(response) -> str:
    """First 300 chars of a response body, for assertion messages."""
    try:
        return response.text()[:300]
    except Exception:  # noqa: BLE001 — a body that cannot be read is still reportable
        return "<unreadable body>"
