from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.domain.executions.models import Execution


@dataclass(frozen=True)
class ExecutionListItem:
    execution: Execution
    cursor: str


@dataclass(frozen=True)
class ExecutionPage:
    items: list[ExecutionListItem]
    next_cursor: str | None


class InvalidExecutionCursor(ValueError):
    """Raised when a client supplied pagination cursor cannot be decoded safely."""


class ExecutionRepository(Protocol):
    def create(self, execution: Execution) -> Execution:
        """Persist an immutable execution snapshot."""
        ...

    def get(self, execution_id: str) -> Execution | None:
        """Return an execution snapshot by id, if it exists."""
        ...

    def list(
        self,
        *,
        limit: int,
        cursor: str | None = None,
        request_hash: str | None = None,
        status: str | None = None,
    ) -> ExecutionPage:
        """Return a page of execution snapshots in repository-defined order."""
        ...
