from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field, RootModel, model_validator

EntryType = str | dict[str, Any] | list[Any] | None


class NoulCriteria(BaseModel):
    true: EntryType = None
    false: EntryType = None

    model_config = {"extra": "forbid"}


class NoulQuestion(BaseModel):
    type: Literal["noul"]
    instructions: EntryType = None
    criteria: NoulCriteria | None = None

    model_config = {"extra": "forbid"}


class ChoiceQuestion(BaseModel):
    type: Literal["choice"]
    instructions: EntryType = None
    criteria: dict[str, EntryType] = Field(min_length=1)

    model_config = {"extra": "forbid"}


class ScoreQuestion(BaseModel):
    type: Literal["score"]
    instructions: EntryType = None
    criteria: list[EntryType] = Field(min_length=2)

    model_config = {"extra": "forbid"}


Question = NoulQuestion | ChoiceQuestion | ScoreQuestion


class Questions(RootModel[dict[str, Question]]):
    @model_validator(mode="after")
    def must_not_be_empty(self) -> "Questions":
        if not self.root:
            raise ValueError("questions must not be empty")
        return self


class SystemOneRequest(BaseModel):
    state: EntryType
    questions: Questions
    # The oracle (`model?: string` in vendor/types.ts) and the wire schema
    # ("model": {"type": "string"}) are not nullable. Annotated as `str` with a
    # None default (instead of `str | None`) so the GENERATED schema publishes
    # a plain string type: omission keeps the None default, while an explicit
    # null fails string validation with location 'model'.
    model: str = Field(default=None)  # type: ignore[assignment]

    model_config = {"extra": "allow"}
