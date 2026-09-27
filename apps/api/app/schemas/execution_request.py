from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

# Plan §10: exactly three execution modes.
ExecutionMode = Literal["emulator", "compare", "compare-and-evaluate"]


class AdvancedOptions(BaseModel):
    """Plan §11 Advanced flags. Defaults to disabled when the key is omitted."""

    independent_openai_prediction: bool = False

    model_config = {"extra": "forbid"}


class ExecutionRequestEnvelope(BaseModel):
    """Pydantic mirror of the plan §64 execution envelope wire contract.

    `system_one` is kept as the RAW validated value (dict/Any) on purpose: the
    envelope only pins its own shape. The canonical SystemOneRequest contract
    is owned by the domain via `validate_and_detect` (ADR-002), which the
    application layer invokes after this envelope parses.
    """

    system_one: Any
    mode: ExecutionMode
    # The wire schema ("advanced": {"$ref": "#/$defs/advancedOptions"}) is not
    # nullable. Annotated as `AdvancedOptions` with a None default (instead of
    # `AdvancedOptions | None`) so the GENERATED schema publishes a plain
    # object type: omission keeps the None default (disabled), while an
    # explicit null fails model validation with location 'advanced'.
    advanced: AdvancedOptions = Field(default=None)  # type: ignore[assignment]

    model_config = {"extra": "forbid"}
