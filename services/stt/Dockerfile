FROM python:3.12-slim
COPY --from=ghcr.io/astral-sh/uv:latest /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev
COPY src/ ./src/
EXPOSE 8001
# --no-sync: the environment is baked above with --frozen --no-dev. Without it
# `uv run` re-resolves at every container start, which pulls the dev group into
# the production image and makes boot depend on PyPI being reachable - exactly
# when a restart matters most (JD-5).
CMD ["uv", "run", "--no-sync", "uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8001"]
