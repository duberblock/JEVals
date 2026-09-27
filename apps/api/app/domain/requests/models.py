from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

from app.schemas.system_one import SystemOneRequest

Primitive = Literal["choice", "score", "noul"]

PRIMITIVES: tuple[Primitive, ...] = ("choice", "score", "noul")


@dataclass(frozen=True)
class QuestionDetection:
    name: str
    primitive: Primitive


@dataclass(frozen=True)
class RequestDetection:
    request: SystemOneRequest
    questions: tuple[QuestionDetection, ...]


class RequestContractError(Exception):
    """A payload does not satisfy the canonical SystemOneRequest contract.

    Carries a stable minimal surface (title + detail) so an RFC 7807 problem
    response can be built from it at the API boundary.
    """

    def __init__(self, *, title: str, detail: str) -> None:
        super().__init__(f"{title}: {detail}")
        self.title = title
        self.detail = detail


class UnsupportedQuestionTypeError(RequestContractError):
    """A question type outside the canonical choice | score | noul family."""

    def __init__(self, *, question_name: str, question_type: str) -> None:
        self.expected = "choice | score | noul"
        super().__init__(
            title="Unsupported question type",
            detail=(
                f"Question '{question_name}' has unsupported type '{question_type}'. "
                f"Expected: {self.expected}."
            ),
        )
        self.question_name = question_name
        self.question_type = question_type
