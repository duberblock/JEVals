from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.domain.executions.models import JsonObject
from app.schemas.system_one_result import SystemOneResult


class IndependentOpenaiProviderError(Exception):
    """The independent LLM prediction failed to produce a usable result.

    Carries only a safe message — never response bodies, the API key, or
    Authorization material. A TERMINAL adapter failure (fix-forward F4) may
    additionally carry the paid run's evidence — `run_config` plus the
    already-redacted `llm_attempts` and `retry_reasons` from the adapter
    error's debug payload — so §66 can persist what the run actually spent.
    Pre-call failures (no tokens spent) carry None for all three.
    """

    def __init__(
        self,
        *,
        message: str,
        run_config: JsonObject | None = None,
        llm_attempts: list[JsonObject] | None = None,
        retry_reasons: list[JsonObject] | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.run_config = run_config
        self.llm_attempts = llm_attempts
        self.retry_reasons = retry_reasons


@dataclass(frozen=True)
class IndependentOpenaiPrediction:
    """A §11-conformant independent prediction plus its §45 evidence.

    `result` has already passed OUR constrained SystemOneResult mirror. The
    evidence carries the adapter's per-attempt traces (`llm_attempts`, the
    canonical independent prompt per §45 — the adapter's embedded prompt is
    forked nowhere) and the playground-level run configuration (ruling P22)
    with credentials excluded by construction.
    """

    result: SystemOneResult
    llm_attempts: list[JsonObject]
    run_config: JsonObject


class IndependentOpenaiProvider(Protocol):
    """Port for the Independent LLM prediction (plan §12/§11: providers are
    integrations behind ports; the independent path receives ONLY the
    original request — never emulator/JEV/comparison/Judge data)."""

    async def execute(self, request: JsonObject) -> IndependentOpenaiPrediction:
        """Answer a canonical SystemOneRequest with an independent model."""
        ...

    async def aclose(self) -> None:
        """Release underlying resources; the app lifespan calls this on
        shutdown (fix-forward F10 — the concrete client owns connections)."""
        ...
