from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from app.domain.executions.models import JsonObject
from app.schemas.judge_evaluation import JudgeEvaluation
from app.schemas.system_one_result import SystemOneResult


class JudgeProviderError(Exception):
    """The LLM Judge integration failed to produce a usable evaluation.

    Carries only a safe message and the upstream HTTP status (when one
    exists) — never response bodies and never the API key.
    """

    def __init__(self, *, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status = status


@dataclass(frozen=True)
class JudgeOutcome:
    """Everything §51 requires the snapshot to retain about the Judge run.

    `evaluation` is the parsed §67 answer; `judge_input`, `output_schema`,
    and `raw_response` are the exact input document, JSON schema, and raw
    model text behind it, so the Full LLM Exchange view reconstructs the
    exchange without re-invoking the provider. Secrets never appear here —
    the input builder sees only the four §11-safe sections.
    """

    model: str
    evaluation: JudgeEvaluation
    judge_input: JsonObject
    output_schema: JsonObject
    raw_response: str
    # §45 Full LLM Exchange completeness: the exact system instruction sent
    # and the request configuration (model, temperature, max_tokens,
    # timeout) so the exchange reconstructs fully without re-invoking.
    system_instruction: str
    configuration: JsonObject


class JudgeProvider(Protocol):
    """Port for the LLM Semantic Judge (plan §12: providers are integrations
    behind ports, not domain objects)."""

    async def evaluate(
        self,
        request: JsonObject,
        emulator_result: SystemOneResult,
        jev_result: SystemOneResult,
        comparison: JsonObject,
    ) -> JudgeOutcome:
        """Semantically evaluate an executed comparison (plan §67).

        §11 independence rule: the Judge NEVER sees the Independent
        prediction — the port's signature has no place to pass it.
        """
        ...

    async def aclose(self) -> None:
        """Release underlying resources; the app lifespan calls this on
        shutdown (fix-forward F10 — the concrete client owns connections)."""
        ...
