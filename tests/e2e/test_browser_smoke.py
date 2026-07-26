"""Browser smoke tests (g)-(i): /auditor plan-param contract and /conteo boot.

Query-param contract (frontend/src/components/auditor/AuditorReview.tsx):
`/auditor` is prerendered, so the island reads `?plan=` and `?auditor=` from
`location.search`. An empty `plan` renders the literal note below; a present
`plan` moves the island to loading/ready/error — the note must be absent.

Both auditor pages hide the shell under 1024px (`.notice` media query in
frontend/src/pages/auditor/index.astro); Playwright's default 1280x720
viewport keeps the shell visible.
"""

from __future__ import annotations

import pytest
from playwright.sync_api import Page, expect

from tests.e2e.conftest import AUDITOR_ID, PLAN_DEMO_002_ID

pytestmark = pytest.mark.e2e

NO_PLAN_NOTE = "Falta el plan a revisar en la dirección de esta página."


def test_auditor_without_plan_shows_missing_plan_note(page: Page, base_url: str) -> None:
    page.goto(f"{base_url}/auditor")
    expect(page.get_by_text(NO_PLAN_NOTE)).to_be_visible()


def test_auditor_with_plan_does_not_show_missing_plan_note(page: Page, base_url: str) -> None:
    page.goto(
        f"{base_url}/auditor?plan={PLAN_DEMO_002_ID}&auditor={AUDITOR_ID}",
        wait_until="networkidle",
    )
    # Prove the island hydrated (it renders the .review shell in every state)
    # before asserting the note's absence — otherwise a blank page would pass.
    expect(page.locator(".review")).to_be_attached()
    expect(page.get_by_text(NO_PLAN_NOTE)).to_have_count(0)


# Failures caused by the KNOWN-DOWN matcher service (crash-looping on a
# Supabase 401) are tolerated — and ONLY those. Anything else must fail.
MATCHER_DOWN_ALLOWLIST = (
    "matcher",
    ":8002",
    "proxy_unreachable",
)


def _tolerated(message: str) -> bool:
    lowered = message.lower()
    return any(marker in lowered for marker in MATCHER_DOWN_ALLOWLIST)


def test_conteo_boots_without_console_errors(page: Page, base_url: str) -> None:
    console_errors: list[str] = []
    page_errors: list[str] = []
    page.on(
        "console",
        lambda msg: console_errors.append(msg.text) if msg.type == "error" else None,
    )
    page.on("pageerror", lambda err: page_errors.append(str(err)))

    page.goto(f"{base_url}/conteo", wait_until="networkidle")
    # Give the CountSession island a moment past hydration to surface late errors.
    page.wait_for_timeout(1000)

    unexpected = [msg for msg in console_errors + page_errors if not _tolerated(msg)]
    assert unexpected == [], f"uncaught browser errors on /conteo: {unexpected}"
