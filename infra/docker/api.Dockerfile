FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    UV_CACHE_DIR=/tmp/uv-cache

WORKDIR /app/apps/api

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
COPY apps/api/pyproject.toml apps/api/uv.lock ./
RUN uv sync --frozen --no-dev

COPY apps/api ./

# Non-root runtime (uid 1000): the app only writes /data (the SQLite
# volume) and the uv cache. Linux hosts bind-mounting ./data must let uid
# 1000 write it (see docs/DEPLOYMENT.md); macOS/Windows file sharing maps
# permissions transparently.
RUN useradd --system --uid 1000 --create-home jevals \
    && mkdir -p /data /tmp/uv-cache \
    && chown -R jevals:jevals /data /tmp/uv-cache
USER jevals

EXPOSE 8000
CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
