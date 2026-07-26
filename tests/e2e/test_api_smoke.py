"""API-only smoke tests (a)-(f): health, plan selection, auditor records.

Contracts asserted here come from the source, not from guesses:
- frontend/src/pages/health.ts       -> GET /health returns 200 {"status":"ok"}
- frontend/src/pages/api/plans.ts    -> GET /api/plans?operator=<uuid>;
  missing operator -> 400; returns [{id, name, warehouseId, catalogueId}] where
  catalogueId is warehouses.code; unassigned operator -> [].
- frontend/src/pages/api/auditor/records.ts -> GET /api/auditor/records?plan=;
  missing plan -> 400; returns a JSON array of records.
"""

from __future__ import annotations

import pytest

from tests.e2e.conftest import (
    OPERATOR_1_ID,
    PLAN_DEMO_002_ID,
    UNASSIGNED_OPERATOR_ID,
    WAREHOUSE_CODE,
    body_snippet,
)

pytestmark = pytest.mark.e2e


def test_health_returns_200(api) -> None:
    response = api.get("/health")
    assert response.status == 200, f"/health -> {response.status}: {body_snippet(response)}"


def test_plans_without_operator_param_returns_400(api) -> None:
    response = api.get("/api/plans")
    assert response.status == 400, f"/api/plans -> {response.status}: {body_snippet(response)}"


def test_plans_for_assigned_operator_contains_seeded_plan(api) -> None:
    """THE end-to-end proof: demo.operador1 sees PLAN-DEMO-002 with the real
    warehouse code as its catalogueId."""
    response = api.get("/api/plans", params={"operator": OPERATOR_1_ID})
    assert response.status == 200, (
        f"/api/plans?operator= -> {response.status}: {body_snippet(response)}"
    )

    plans = response.json()
    assert isinstance(plans, list), f"expected JSON array, got: {body_snippet(response)}"

    seeded = [plan for plan in plans if plan.get("id") == PLAN_DEMO_002_ID]
    assert seeded, (
        f"PLAN-DEMO-002 ({PLAN_DEMO_002_ID}) not in response: {body_snippet(response)}"
    )
    assert seeded[0].get("catalogueId") == WAREHOUSE_CODE, (
        f"expected catalogueId {WAREHOUSE_CODE!r}, got {seeded[0].get('catalogueId')!r}"
    )


def test_plans_for_unassigned_operator_is_empty(api) -> None:
    """No assignment must mean `[]` — never a listing of other plans."""
    response = api.get("/api/plans", params={"operator": UNASSIGNED_OPERATOR_ID})
    assert response.status == 200, (
        f"/api/plans?operator=<unassigned> -> {response.status}: {body_snippet(response)}"
    )
    assert response.json() == [], f"plan disclosure to unassigned operator: {body_snippet(response)}"


def test_auditor_records_without_plan_param_returns_400(api) -> None:
    response = api.get("/api/auditor/records")
    assert response.status == 400, (
        f"/api/auditor/records -> {response.status}: {body_snippet(response)}"
    )


def test_auditor_records_for_seeded_plan_returns_json_array(api) -> None:
    """PLAN-DEMO-002 currently has 0 count_records, so assert list-ness only."""
    response = api.get("/api/auditor/records", params={"plan": PLAN_DEMO_002_ID})
    assert response.status == 200, (
        f"/api/auditor/records?plan= -> {response.status}: {body_snippet(response)}"
    )
    assert isinstance(response.json(), list), (
        f"expected JSON array, got: {body_snippet(response)}"
    )
