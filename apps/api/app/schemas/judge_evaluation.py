"""§67 LLM Judge structured output contract.

The Judge's answer lives inside a CLOSED surface: every vocabulary is a
Pydantic Literal (unknown values raise ValidationError at parse time, so a
drifting model output becomes a JudgeProviderError and flows through the §66
partial-state table), every level forbids extra fields (§47: no invented
fields), and no numeric quality score exists anywhere (§67: NEVER ask the
LLM for a 0-100 score).
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict

# §67 controlled vocabularies — closed sets, single-sourced here.
PredictionQuality = Literal["excellent", "good", "mixed", "poor", "undetermined"]
SemanticDivergence = Literal["none", "minor", "material", "undetermined"]
Support = Literal["strong", "partial", "weak", "insufficient"]
Preferred = Literal["emulator", "jev", "tie", "undetermined"]

# Pydantic enforces `extra="forbid"` at validation time but does not emit
# `additionalProperties: false` in generated JSON schemas by default; the
# explicit json_schema_extra keeps the WIRE schema closed too — required by
# OpenAI-compatible strict structured outputs and pinned by tests.
_CLOSED = ConfigDict(extra="forbid", json_schema_extra={"additionalProperties": False})


class JudgeOverall(BaseModel):
    """The execution-level semantic evaluation (plan §67 `overall`)."""

    prediction_quality: PredictionQuality
    semantic_divergence: SemanticDivergence
    summary: str

    model_config = _CLOSED


class JudgeQuestionEvaluation(BaseModel):
    """The per-question semantic evaluation (plan §67 `questions` values)."""

    emulator_support: Support
    jev_support: Support
    semantic_divergence: SemanticDivergence
    preferred: Preferred
    reason: str

    model_config = _CLOSED


class JudgeEvaluation(BaseModel):
    """The Judge's full structured answer: overall + one entry per question."""

    overall: JudgeOverall
    questions: dict[str, JudgeQuestionEvaluation]

    model_config = _CLOSED
