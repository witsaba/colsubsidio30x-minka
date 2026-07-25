"""Stdlib logging configuration (design Decision 8, REQ-PRV-3).

No structlog, no middleware: one endpoint needs neither. Per-request INFO
records carry ONLY request_id, duration and vendor - transcript bodies are
personal data under Ley 1581 and are never logged at any level.
"""

import logging

LOGGER_NAME = "stt"


def configure_logging(log_level: str) -> logging.Logger:
    """Configure and return the service logger."""
    logging.basicConfig(
        level=log_level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
        force=True,
    )
    logger = logging.getLogger(LOGGER_NAME)
    logger.setLevel(log_level.upper())
    return logger


def get_logger() -> logging.Logger:
    return logging.getLogger(LOGGER_NAME)
