# Build context is the repo root so the shared contracts/ directory is available.
FROM ghcr.io/astral-sh/uv:python3.12-bookworm-slim
ENV UV_COMPILE_BYTECODE=1 UV_NO_CACHE=1
WORKDIR /app/apps/worker
COPY apps/worker/pyproject.toml apps/worker/uv.lock ./
RUN uv sync --frozen --no-install-project --no-dev
COPY apps/worker/worker ./worker
COPY contracts /app/contracts
RUN uv sync --frozen --no-dev
CMD ["uv", "run", "--no-sync", "python", "-m", "worker"]
