from __future__ import annotations

from app.domain.executions.models import Execution
from app.domain.executions.repository import ExecutionRepository


def get_execution(repo: ExecutionRepository, execution_id: str) -> Execution | None:
    return repo.get(execution_id)
