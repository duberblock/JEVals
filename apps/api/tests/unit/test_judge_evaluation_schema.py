"""§67 LLM Judge structured output schema: exact shape + closed vocabularies.

The Judge's answer is a constrained surface: unknown vocabulary values and
unknown fields are REJECTED at parse time so a drifting model output becomes
a JudgeProviderError (§66 partial state), never a corrupted snapshot.
"""

import json

import pytest
from pydantic import ValidationError

from app.schemas.judge_evaluation import (
    JudgeEvaluation,
    JudgeOverall,
    JudgeQuestionEvaluation,
)

VALID_EVALUATION = {
    "overall": {
        "prediction_quality": "good",
        "semantic_divergence": "minor",
        "summary": "Answers differ numerically but not semantically.",
    },
    "questions": {
        "request_type": {
            "emulator_support": "strong",
            "jev_support": "partial",
            "semantic_divergence": "minor",
            "preferred": "tie",
            "reason": "Both pick billing; probabilities differ.",
        }
    },
}


def test_valid_document_parses_with_exact_roundtrip():
    evaluation = JudgeEvaluation.model_validate(VALID_EVALUATION)

    assert evaluation.overall.prediction_quality == "good"
    assert evaluation.overall.semantic_divergence == "minor"
    assert evaluation.questions["request_type"].preferred == "tie"
    assert JudgeEvaluation.model_validate(json.loads(evaluation.model_dump_json())) == evaluation


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("prediction_quality", "amazing"),
        ("prediction_quality", 95),
        ("semantic_divergence", "severe"),
        ("semantic_divergence", ""),
    ],
)
def test_overall_vocabulary_is_closed(field, value):
    document = json.loads(json.dumps(VALID_EVALUATION))
    document["overall"][field] = value

    with pytest.raises(ValidationError):
        JudgeEvaluation.model_validate(document)


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("emulator_support", "medium"),
        ("jev_support", "strong-ish"),
        ("semantic_divergence", "huge"),
        ("preferred", "both"),
        ("preferred", "emulator/jev"),
    ],
)
def test_question_vocabulary_is_closed(field, value):
    document = json.loads(json.dumps(VALID_EVALUATION))
    document["questions"]["request_type"][field] = value

    with pytest.raises(ValidationError):
        JudgeEvaluation.model_validate(document)


def test_unknown_fields_are_rejected_on_every_level():
    for mutation in (
        {"overall": {**VALID_EVALUATION["overall"], "score": 87}},
        {"questions": {"request_type": {**VALID_EVALUATION["questions"]["request_type"], "confidence": 0.9}}},
        {**VALID_EVALUATION, "model": "gpt-4o-mini"},
    ):
        with pytest.raises(ValidationError):
            JudgeEvaluation.model_validate(mutation)


def test_missing_required_fields_are_rejected():
    with pytest.raises(ValidationError):
        JudgeOverall.model_validate({"prediction_quality": "good", "semantic_divergence": "none"})

    with pytest.raises(ValidationError):
        JudgeQuestionEvaluation.model_validate(
            {"emulator_support": "strong", "jev_support": "strong", "semantic_divergence": "none", "preferred": "tie"}
        )


def test_generated_schema_pins_the_67_contract_and_vocabularies():
    schema = JudgeEvaluation.model_json_schema()

    overall = schema["$defs"]["JudgeOverall"]
    assert overall["additionalProperties"] is False
    assert overall["properties"]["prediction_quality"]["enum"] == [
        "excellent",
        "good",
        "mixed",
        "poor",
        "undetermined",
    ]
    assert overall["properties"]["semantic_divergence"]["enum"] == [
        "none",
        "minor",
        "material",
        "undetermined",
    ]
    assert set(overall["required"]) == {"prediction_quality", "semantic_divergence", "summary"}

    question = schema["$defs"]["JudgeQuestionEvaluation"]
    assert question["additionalProperties"] is False
    assert question["properties"]["emulator_support"]["enum"] == ["strong", "partial", "weak", "insufficient"]
    assert question["properties"]["jev_support"]["enum"] == ["strong", "partial", "weak", "insufficient"]
    assert question["properties"]["semantic_divergence"]["enum"] == [
        "none",
        "minor",
        "material",
        "undetermined",
    ]
    assert question["properties"]["preferred"]["enum"] == ["emulator", "jev", "tie", "undetermined"]

    assert schema["additionalProperties"] is False
    assert set(schema["required"]) == {"overall", "questions"}
    # §67: the model is NEVER asked for a 0-100 (or any numeric) score.
    assert "score" not in json.dumps(schema).lower()
