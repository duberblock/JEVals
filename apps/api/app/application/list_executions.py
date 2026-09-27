from __future__ import annotations

from app.domain.executions.repository import ExecutionPage, ExecutionRepository

DEFAULT_LIMIT = 20
MAX_LIMIT = 100


def list_executions(
    repo: ExecutionRepository,
    *,
    limit: int = DEFAULT_LIMIT,
    cursor: str | None = None,
    request_hash: str | None = None,
    status: str | None = None,
) -> ExecutionPage:
    bounded_limit = max(1, min(limit, MAX_LIMIT))
    return repo.list(limit=bounded_limit, cursor=cursor, request_hash=request_hash, status=status)
