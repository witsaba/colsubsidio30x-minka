"""Application logging contract (JD-3).

An outage has to be diagnosable from the container log alone, so startup,
startup failure, every `/match` decision and every unknown-catalogue rejection
leave a server-side trace, all correlatable through `request_id`.

HARD PRIVACY CONSTRAINT (Ley 1581 / project policy): `spoken_name` -- and any
other transcript text -- must NEVER reach the log, at any level. The dictated
text is personal data captured from a caller; the log is operational
telemetry. `TestNoTranscriptEverReachesTheLog` is the executable form of that
rule and must stay green.
"""
from __future__ import annotations

import logging
import re

import pytest
from conftest import (
    FIXTURE_CATALOGUE_ID,
    FIXTURE_ROW_COUNT,
    FIXTURE_WAREHOUSES,
    FakeCatalogueSource,
    make_cache,
    make_rows,
)

CATALOGUE = FIXTURE_CATALOGUE_ID
UNKNOWN_CATALOGUE = "BOD-99"
MATCHED_QUERY = "achiote molido"
NO_MATCH_QUERY = "zzzzqqq xkcd"

LOGGER_NAME = "matcher"


def post_match(client, **overrides):
    payload = {"spoken_name": MATCHED_QUERY, "catalogue_id": CATALOGUE}
    payload.update(overrides)
    return client.post("/match", json=payload)


def records(caplog: pytest.LogCaptureFixture) -> list[logging.LogRecord]:
    return [r for r in caplog.records if r.name == LOGGER_NAME]


def messages(caplog: pytest.LogCaptureFixture, level: int) -> list[str]:
    return [r.getMessage() for r in records(caplog) if r.levelno == level]


class TestLoggerConfiguration:
    def test_the_service_logger_is_named_matcher(self) -> None:
        from matcher.main import logger

        assert logger.name == LOGGER_NAME

    def test_the_service_logger_serves_info(self) -> None:
        from matcher.main import logger

        assert logger.isEnabledFor(logging.INFO)

    def test_the_formatter_carries_time_level_name_and_message(self) -> None:
        from matcher.main import LOG_FORMAT

        for token in ("%(asctime)s", "%(levelname)s", "%(name)s", "%(message)s"):
            assert token in LOG_FORMAT

    def test_configuring_twice_does_not_duplicate_handlers(self) -> None:
        from matcher.main import configure_logging, logger

        configure_logging()
        before = len(logger.handlers)
        configure_logging()

        assert len(logger.handlers) == before
        assert before == 1


def _startup_line(caplog: pytest.LogCaptureFixture) -> str:
    """The most recent startup summary.

    The last one, not the first: `caplog` keeps every propagated record for the
    whole test, so a test that starts the app twice would otherwise assert
    against the first start's line.
    """
    startup = [m for m in messages(caplog, logging.INFO) if "catalogue loaded" in m]
    assert startup, "startup must leave an INFO trace"
    return startup[-1]


class TestStartupLogging:
    def test_successful_startup_logs_the_catalogue_summary(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.main import app

        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            with TestClient(app):
                pass

        line = _startup_line(caplog)
        assert f"catalogues={len(FIXTURE_WAREHOUSES)}" in line
        assert f"rows={FIXTURE_ROW_COUNT}" in line

    def test_it_reports_which_source_the_catalogue_came_from(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        """D5: a replica quietly running on a stale snapshot must be visible."""
        from fastapi.testclient import TestClient

        from matcher.main import app

        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            with TestClient(app):
                pass

        line = _startup_line(caplog)
        match = re.search(r"source=(\S+)", line)
        assert match, line
        assert match.group(1) in {"redis-snapshot", "supabase", "redis-snapshot-stale"}
        assert "db=" not in line

    def test_a_warm_start_reports_the_redis_snapshot_as_its_source(
        self, monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The label is real provenance, not a constant: a shared cache that
        already holds a fresh snapshot changes it."""
        from fastapi.testclient import TestClient

        from matcher import main as main_module

        shared_cache = make_cache()
        source = FakeCatalogueSource(make_rows())
        monkeypatch.setattr(
            main_module, "_build_adapters", lambda _s: (source, shared_cache)
        )

        with TestClient(main_module.app):
            pass
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            with TestClient(main_module.app):
                pass

        assert "source=redis-snapshot" in _startup_line(caplog)
        assert source.calls == 1, "the second start must not re-read Supabase"

    def test_failed_startup_logs_the_error_before_aborting(
        self,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher import main as main_module
        from matcher.catalogue import CatalogueUnavailableError

        monkeypatch.setattr(
            main_module,
            "_build_adapters",
            lambda _s: (FakeCatalogueSource(fail_times=99), make_cache()),
        )
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            with pytest.raises(CatalogueUnavailableError):
                with TestClient(main_module.app):
                    pass

        errors = messages(caplog, logging.ERROR)
        assert errors, "an aborted startup must leave an ERROR trace"
        assert any("startup aborted after" in m for m in errors)
        assert any("fake catalogue source failing" in m for m in errors)


class TestMatchRequestLogging:
    def test_every_match_logs_one_info_line(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            post_match(client)

        assert len(messages(caplog, logging.INFO)) == 1

    def test_the_line_carries_the_response_request_id(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            body = post_match(client).json()

        assert body["request_id"] in messages(caplog, logging.INFO)[0]

    def test_the_line_carries_catalogue_status_score_count_and_latency(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            body = post_match(client).json()
        line = messages(caplog, logging.INFO)[0]

        assert f"catalogue_id={CATALOGUE}" in line
        assert f"status={body['status']}" in line
        assert f"top_score={body['top_score']:.4f}" in line
        assert f"candidates={len(body['candidates'])}" in line
        assert re.search(r"latency_ms=\d+(\.\d+)?", line)

    def test_a_no_match_is_logged_too(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            post_match(client, spoken_name=NO_MATCH_QUERY)

        assert "status=no_match" in messages(caplog, logging.INFO)[0]


class TestUnknownCatalogueLogging:
    def test_unknown_catalogue_logs_a_warning(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            post_match(client, catalogue_id=UNKNOWN_CATALOGUE)

        assert len(messages(caplog, logging.WARNING)) == 1

    def test_the_warning_names_the_offending_catalogue_id(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            post_match(client, catalogue_id=UNKNOWN_CATALOGUE)

        assert f"catalogue_id={UNKNOWN_CATALOGUE}" in messages(caplog, logging.WARNING)[0]

    def test_the_warning_carries_a_request_id(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            post_match(client, catalogue_id=UNKNOWN_CATALOGUE)
        line = messages(caplog, logging.WARNING)[0]

        assert re.search(
            r"request_id=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-", line
        ), line

    def test_a_rejected_request_is_not_also_logged_as_a_decision(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            post_match(client, catalogue_id=UNKNOWN_CATALOGUE)

        assert messages(caplog, logging.INFO) == []


class TestNoTranscriptEverReachesTheLog:
    """Ley 1581: dictated text is personal data and never becomes telemetry."""

    @pytest.mark.parametrize(
        "query",
        [MATCHED_QUERY, NO_MATCH_QUERY, "aceite de oliva", "a" * 300],
    )
    def test_the_spoken_name_never_appears_at_any_level(
        self, client, caplog: pytest.LogCaptureFixture, query: str
    ) -> None:
        with caplog.at_level(logging.DEBUG):
            post_match(client, spoken_name=query)
        blob = "\n".join(r.getMessage() for r in caplog.records).lower()

        assert query.lower() not in blob

    def test_the_spoken_name_never_appears_on_the_404_path(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.DEBUG):
            post_match(client, spoken_name=MATCHED_QUERY, catalogue_id=UNKNOWN_CATALOGUE)
        blob = "\n".join(r.getMessage() for r in caplog.records).lower()

        assert MATCHED_QUERY.lower() not in blob

    def test_no_matched_catalogue_text_is_logged_either(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        """The top candidate's `articulo` echoes the query and stays out too."""
        with caplog.at_level(logging.DEBUG):
            body = post_match(client).json()
        blob = "\n".join(r.getMessage() for r in caplog.records).lower()

        assert body["candidates"][0]["articulo"].lower() not in blob
