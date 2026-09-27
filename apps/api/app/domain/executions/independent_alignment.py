"""Independent alignment (plan §31/§41, ruling 6) — pure functions.

Computes, per request question, whether the independent prediction's answer
agrees with each executed side using the SAME §26 decision rules as the
deterministic comparison — choice: same label; score: same dominant rubric
level; noul: same 0.5 category — with the tie-break rules single-sourced in
`app.domain.executions.fidelity`. The persisted payload carries the
per-question booleans plus one overall `aligned` (agrees with ALL executed
sides on ALL questions); the web renders "aligned"/"diverged" from these
booleans and never re-derives the rules client-side.

JEV flags are null when the JEV side did not run (emulator mode, or a §66
JEV failure): alignment then tracks the emulator side only.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.domain.executions.fidelity import dominant_rubric_level, noul_midpoint_category
from app.domain.executions.models import JsonObject
from app.domain.requests.models import Primitive
from app.schemas.system_one import SystemOneRequest
from app.schemas.system_one_result import (
    ChoiceResult,
    NoulResult,
    PrimitiveResult,
    ScoreResult,
    SystemOneResult,
)


class IndependentAlignmentError(Exception):
    """The independent result cannot be aligned against the request.

    Like FidelityComparisonError, these shapes cannot come from a
    well-behaved provider answering this request (the §68 dynamic schema is
    generated from the same questions), so they fail loudly instead of
    being silently skipped.
    """


@dataclass(frozen=True)
class QuestionAlignment:
    """Whether the independent answer agrees with each executed side."""

    name: str
    agrees_with_emulator: bool
    # Null when the JEV side did not execute (§66 partial states).
    agrees_with_jev: bool | None
    # Score only: the independent's dominant rubric level (§26 argmax) so
    # the §41 display ("LLM 1.71 · High") never re-derives the rule
    # client-side. None for choice/noul questions.
    independent_dominant_level: str | None = None

    def to_payload(self) -> JsonObject:
        payload: JsonObject = {
            "agrees_with_emulator": self.agrees_with_emulator,
            "agrees_with_jev": self.agrees_with_jev,
        }
        if self.independent_dominant_level is not None:
            payload["independent_dominant_level"] = self.independent_dominant_level
        return payload


@dataclass(frozen=True)
class IndependentAlignment:
    """Per-question agreement plus the overall §31 aligned summary."""

    questions: tuple[QuestionAlignment, ...]

    @property
    def aligned(self) -> bool:
        """Ruling 6: agrees with ALL executed sides on ALL questions."""
        return all(
            question.agrees_with_emulator
            and (question.agrees_with_jev is not False)
            for question in self.questions
        )

    def to_payload(self) -> JsonObject:
        return {
            "aligned": self.aligned,
            "questions": {question.name: question.to_payload() for question in self.questions},
        }


def compute_independent_alignment(
    request: SystemOneRequest,
    *,
    independent: SystemOneResult,
    emulator: SystemOneResult,
    jev: SystemOneResult | None = None,
) -> IndependentAlignment:
    """Align the independent prediction with each executed side (§26 rules)."""
    def _level(name: str, primitive: Primitive) -> str | None:
        if primitive != "score":
            return None
        answer = _answer(independent, name, primitive)
        assert isinstance(answer, ScoreResult)
        return dominant_rubric_level(answer.probabilities)

    questions = tuple(
        QuestionAlignment(
            name=name,
            agrees_with_emulator=_agrees(question.type, _answer(independent, name, question.type), _answer(emulator, name, question.type)),
            agrees_with_jev=(
                None
                if jev is None
                else _agrees(question.type, _answer(independent, name, question.type), _answer(jev, name, question.type))
            ),
            independent_dominant_level=_level(name, question.type),
        )
        for name, question in request.questions.root.items()
    )
    return IndependentAlignment(questions=questions)


def _agrees(primitive: Primitive, independent: PrimitiveResult, side: PrimitiveResult) -> bool:
    """One §26 decision rule per primitive, applied to two answers."""
    if primitive == "choice":
        assert isinstance(independent, ChoiceResult) and isinstance(side, ChoiceResult)
        return independent.choice == side.choice
    if primitive == "score":
        assert isinstance(independent, ScoreResult) and isinstance(side, ScoreResult)
        return dominant_rubric_level(independent.probabilities) == dominant_rubric_level(side.probabilities)
    assert isinstance(independent, NoulResult) and isinstance(side, NoulResult)
    return noul_midpoint_category(independent.noul) == noul_midpoint_category(side.noul)


def _answer(result: SystemOneResult, name: str, primitive: Primitive) -> PrimitiveResult:
    """Fetch one answer, failing loudly on gaps and primitive mismatches."""
    if name not in result.answers:
        raise IndependentAlignmentError(
            f"Result from model '{result.model}' has no answer for question '{name}'."
        )
    answer = result.answers[name]
    expected = {"choice": ChoiceResult, "score": ScoreResult, "noul": NoulResult}[primitive]
    if not isinstance(answer, expected):
        raise IndependentAlignmentError(
            f"Answer for question '{name}' has primitive '{answer.type}' "
            f"but the request declares '{primitive}'."
        )
    return answer
