FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_CACHE_DIR=/tmp/uv-cache

WORKDIR /app/apps/api

# Non-root runtime (uid 1000). The app only writes /data (the SQLite
# volume) and the uv cache. Linux hosts bind-mounting ./data must let uid
# 1000 write it (see docs/DEPLOYMENT.md); macOS/Windows file sharing maps
# permissions transparently.
RUN useradd --system --uid 1000 --create-home jevals \
    && mkdir -p /data /tmp/uv-cache \
    && chown -R jevals:jevals /data /tmp/uv-cache

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN chown -R jevals:jevals /app
USER jevals
# The venv is created BY the runtime user — no re-sync, no root ownership.
# Runtime uses the venv binaries directly (no uv): nothing ever tries to
# write into .venv again.
RUN uv sync --frozen --no-dev

COPY --chown=jevals:jevals apps/api ./

EXPOSE 8000
CMD [".venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
