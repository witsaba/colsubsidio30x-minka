# Module 3 — product matching service.
# Build context is the REPOSITORY ROOT (design D5): the service is a uv
# workspace member, so the root `pyproject.toml` and `uv.lock` must be visible.
#   docker build -f services/matcher/Dockerfile .
FROM python:3.12-slim

COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv

WORKDIR /app

# Dependency layer — cached until the lockfile changes.
COPY pyproject.toml uv.lock ./
COPY services/matcher/pyproject.toml services/matcher/pyproject.toml
RUN uv sync --frozen --no-dev --no-install-workspace --package matcher

# Source layer — changes on every commit, so it comes last.
COPY services/matcher/src services/matcher/src
RUN uv sync --frozen --no-dev --package matcher

ENV PATH="/app/.venv/bin:$PATH"

EXPOSE 8002
CMD ["uvicorn", "matcher.main:app", "--host", "0.0.0.0", "--port", "8002"]
