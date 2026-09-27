from __future__ import annotations

from dataclasses import asdict, dataclass
from typing import Any

from app.domain.requests.models import Primitive

JsonObject = dict[str, Any]


@dataclass(frozen=True)
class ChoiceComponents:
    """Per-primitive fidelity inputs for a choice question (plan §24)."""

    decision_match: bool
    confidence_delta: float
    distribution_similarity: float


@dataclass(frozen=True)
class ScoreComponents:
    """Per-primitive fidelity inputs for a score question (plan §24)."""

    score_delta: float
    max_score: int
    score_similarity: float
    distribution_similarity: float
    confidence_delta: float
    # Dominant rubric level per side (§26 argmax) — carried in the payload so
    # the web renders "High ↔ High" rows without re-implementing the rule.
    emulator_dominant_level: str
    jev_dominant_level: str


@dataclass(frozen=True)
class NoulComponents:
    """Per-primitive fidelity inputs for a noul question (plan §24)."""

    probability_delta: float
    # P38/FB11: the §26/§27 midpoint category per side (-1 strictly below /
    # 0 exactly at / 1 strictly above the 0.5 mathematical midpoint) —
    # carried in the payload so the web composes the verdict without
    # re-deriving the classification client-side (precedent:
    # independent_dominant_level, ADR-006 ruling 2). Absent only on pre-P38
    # persisted snapshots, which are served verbatim and render the legacy
    # geometry-only verdict.
    emulator_midpoint_category: int
    jev_midpoint_category: int


@dataclass(frozen=True)
class QuestionComparison:
    """The deterministic comparison of one question's two answers.

    `fidelity` is the §25 per-question fidelity; `aligned` is the §26
    deterministic UI summary. Values are raw floats — no rounding here;
    display rounding belongs to the web.
    """

    name: str
    primitive: Primitive
    fidelity: float
    aligned: bool
    components: ChoiceComponents | ScoreComponents | NoulComponents

    def to_payload(self) -> JsonObject:
        return {
            "primitive": self.primitive,
            "fidelity": self.fidelity,
            "aligned": self.aligned,
            "components": asdict(self.components),
        }


@dataclass(frozen=True)
class ComparisonResult:
    """The §25 overall fidelity plus every per-question comparison."""

    questions: tuple[QuestionComparison, ...]
    overall_fidelity: float
    aligned_questions: int

    def to_payload(self) -> JsonObject:
        return {
            "overall_fidelity": self.overall_fidelity,
            "questions": {question.name: question.to_payload() for question in self.questions},
        }
