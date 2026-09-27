from __future__ import annotations

from typing import Protocol

from app.domain.executions.models import JsonObject
from app.schemas.system_one_result import SystemOneResult


class JevProviderError(Exception):
    """The JEV integration failed to produce a usable SystemOneResult.

    Carries only a safe message and the upstream HTTP status (when one
    exists) — never response bodies, which may echo request content, and
    never the API key or Authorization header.
    """

    def __init__(self, *, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


class JevProvider(Protocol):
    """Port for the real JEV integration (plan §12: providers are
    integrations behind ports, not domain objects)."""

    async def execute(self, request: JsonObject) -> SystemOneResult:
        """Answer a canonical SystemOneRequest through the real JEV."""
        ...

    async def aclose(self) -> None:
        """Release underlying resources; the app lifespan calls this on
        shutdown (fix-forward F10 — the concrete client owns connections)."""
        ...
