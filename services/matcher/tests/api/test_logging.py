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
from pathlib import Path

import pytest

CATALOGUE = "stock_almacen_ayb"
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


class TestStartupLogging:
    def test_successful_startup_logs_the_catalogue_summary(
        self,
        catalogue_db_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.main import app

        monkeypatch.setenv("CATALOGUE_DB", str(catalogue_db_path))
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            with TestClient(app):
                pass

        startup = [m for m in messages(caplog, logging.INFO) if "catalogue" in m]
        assert startup, "startup must leave an INFO trace"
        line = startup[0]
        assert "catalogues=8" in line
        assert re.search(r"rows=\d+", line)
        assert str(catalogue_db_path) in line

    def test_failed_startup_logs_the_error_before_aborting(
        self,
        tmp_path: Path,
        monkeypatch: pytest.MonkeyPatch,
        caplog: pytest.LogCaptureFixture,
    ) -> None:
        from fastapi.testclient import TestClient

        from matcher.catalogue import CatalogueUnavailableError
        from matcher.main import app

        missing = tmp_path / "absent.sqlite"
        monkeypatch.setenv("CATALOGUE_DB", str(missing))
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            with pytest.raises(CatalogueUnavailableError):
                with TestClient(app):
                    pass

        errors = messages(caplog, logging.ERROR)
        assert errors, "an aborted startup must leave an ERROR trace"
        assert any(str(missing) in m for m in errors)
        assert any("cannot open catalogue database" in m for m in errors)


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
            post_match(client, catalogue_id="not_a_table")

        assert len(messages(caplog, logging.WARNING)) == 1

    def test_the_warning_names_the_offending_catalogue_id(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            post_match(client, catalogue_id="not_a_table")

        assert "catalogue_id=not_a_table" in messages(caplog, logging.WARNING)[0]

    def test_the_warning_carries_a_request_id(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            post_match(client, catalogue_id="not_a_table")
        line = messages(caplog, logging.WARNING)[0]

        assert re.search(
            r"request_id=[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-", line
        ), line

    def test_a_rejected_request_is_not_also_logged_as_a_decision(
        self, client, caplog: pytest.LogCaptureFixture
    ) -> None:
        with caplog.at_level(logging.INFO, logger=LOGGER_NAME):
            post_match(client, catalogue_id="not_a_table")

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
            post_match(client, spoken_name=MATCHED_QUERY, catalogue_id="not_a_table")
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
