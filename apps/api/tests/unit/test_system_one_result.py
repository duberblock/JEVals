import pytest
from pydantic import ValidationError

from app.schemas.system_one_result import (
    ChoiceResult,
    NoulResult,
    ScoreResult,
    SystemOneResult,
    Usage,
)

# Raw wire payloads mirroring vendor/types.ts response types verbatim (SDK
# v0.6.0 oracle, lines ~100-190): every field below exists in the oracle and
# nothing the oracle forbids is added.

NOUL_ANSWER = {"type": "noul", "noul": 0.87}

CHOICE_ANSWER = {
    "type": "choice",
    "choice": "billing",
    "confidence": 0.92,
    "probabilities": {"billing": 0.92, "technical": 0.05, "sales": 0.03},
}

# A score may fall between integer rubric levels; legend and probabilities
# are keyed by score (JSON object keys are strings).
SCORE_ANSWER = {
    "type": "score",
    "score": 1.5,
    "confidence": 0.8,
    "legend": {"0": "low", "1": "medium", "2": "high"},
    "probabilities": {"0": 0.1, "1": 0.6, "2": 0.3},
}

FULL_RESULT = {
    "model": "jev-emulator",
    "answers": {
        "request_type": CHOICE_ANSWER,
        "urgency": SCORE_ANSWER,
        "refund_requested": NOUL_ANSWER,
    },
    "usage": {"input_tokens": 120, "output_tokens": 45},
}


def test_noul_result_parses_probability():
    result = NoulResult.model_validate(NOUL_ANSWER)

    assert result.type == "noul"
    assert result.noul == 0.87


def test_choice_result_parses_selection_and_probabilities():
    result = ChoiceResult.model_validate(CHOICE_ANSWER)

    assert result.type == "choice"
    assert result.choice == "billing"
    assert result.confidence == 0.92
    assert result.probabilities == {"billing": 0.92, "technical": 0.05, "sales": 0.03}


def test_score_result_parses_non_integer_score_with_legend_and_probabilities():
    result = ScoreResult.model_validate(SCORE_ANSWER)

    assert result.type == "score"
    assert result.score == 1.5
    assert result.confidence == 0.8
    assert result.legend == {"0": "low", "1": "medium", "2": "high"}
    assert result.probabilities == {"0": 0.1, "1": 0.6, "2": 0.3}


def test_score_legend_accepts_every_entry_type_value():
    result = ScoreResult.model_validate(
        {
            "type": "score",
            "score": 0,
            "confidence": 1.0,
            "legend": {"0": None, "1": {"detail": "object"}, "2": ["a", "b"]},
            "probabilities": {"0": 1.0},
        }
    )

    assert result.legend == {"0": None, "1": {"detail": "object"}, "2": ["a", "b"]}


def test_system_one_result_parses_model_answers_and_usage():
    result = SystemOneResult.model_validate(FULL_RESULT)

    assert result.model == "jev-emulator"
    assert result.usage == Usage(input_tokens=120, output_tokens=45)
    assert set(result.answers) == {"request_type", "urgency", "refund_requested"}


def test_answers_discriminate_on_type():
    result = SystemOneResult.model_validate(FULL_RESULT)

    assert isinstance(result.answers["request_type"], ChoiceResult)
    assert isinstance(result.answers["urgency"], ScoreResult)
    assert isinstance(result.answers["refund_requested"], NoulResult)


@pytest.mark.parametrize(
    ("model", "payload"),
    [
        (NoulResult, NOUL_ANSWER | {"extra": 1}),
        (ChoiceResult, CHOICE_ANSWER | {"extra": 1}),
        (ScoreResult, SCORE_ANSWER | {"extra": 1}),
        (SystemOneResult, FULL_RESULT | {"extra": 1}),
    ],
)
def test_oracle_forbidden_extra_fields_are_rejected(model, payload):
    # The oracle defines closed interfaces for the response types (unlike
    # SystemOneRequest, which forwards extras): no invented fields accepted.
    with pytest.raises(ValidationError):
        model.model_validate(payload)


@pytest.mark.parametrize(
    "payload",
    [
        {"type": "noul"},  # missing noul
        {"type": "choice", "choice": "a"},  # missing confidence + probabilities
        {"type": "score", "score": 1},  # missing confidence + legend + probabilities
    ],
)
def test_missing_required_fields_are_rejected(payload):
    with pytest.raises(ValidationError):
        SystemOneResult.model_validate({"model": "m", "answers": {"q": payload}, "usage": {"input_tokens": 0, "output_tokens": 0}})


def test_unknown_answer_type_is_rejected():
    with pytest.raises(ValidationError):
        SystemOneResult.model_validate(
            {
                "model": "m",
                "answers": {"q": {"type": "classification"}},
                "usage": {"input_tokens": 0, "output_tokens": 0},
            }
        )


# --- Degenerate provider results rejected AT PARSE TIME (dual-review B1) ---
#
# A probability outside [0, 1], a non-finite float, or an empty distribution
# map is a degenerate provider result: the mirror rejects it here so the
# clients turn it into a provider error (§66 flow) and it NEVER reaches
# fidelity.

OUT_OF_UNIT_VALUES = [-0.01, 1.01, float("nan"), float("inf"), float("-inf")]


def with_noul(value: float) -> dict:
    return {"type": "noul", "noul": value}


def with_choice_confidence(value: float) -> dict:
    return CHOICE_ANSWER | {"confidence": value}


def with_choice_probability(value: float) -> dict:
    return CHOICE_ANSWER | {"probabilities": {"billing": value}}


def with_score_confidence(value: float) -> dict:
    return SCORE_ANSWER | {"confidence": value}


def with_score_probability(value: float) -> dict:
    return SCORE_ANSWER | {"probabilities": {"1": value}}


@pytest.mark.parametrize(
    ("answer", "field"),
    [
        (with_noul(-0.01), "noul"),
        (with_noul(1.01), "noul"),
        (with_noul(float("nan")), "noul"),
        (with_noul(float("inf")), "noul"),
        (with_noul(float("-inf")), "noul"),
        (with_choice_confidence(-0.01), "confidence"),
        (with_choice_confidence(1.01), "confidence"),
        (with_choice_confidence(float("nan")), "confidence"),
        (with_choice_confidence(float("inf")), "confidence"),
        (with_choice_confidence(float("-inf")), "confidence"),
        (with_choice_probability(-0.01), "probabilities"),
        (with_choice_probability(1.01), "probabilities"),
        (with_choice_probability(float("nan")), "probabilities"),
        (with_choice_probability(float("inf")), "probabilities"),
        (with_choice_probability(float("-inf")), "probabilities"),
        (with_score_confidence(-0.01), "confidence"),
        (with_score_confidence(1.01), "confidence"),
        (with_score_confidence(float("nan")), "confidence"),
        (with_score_confidence(float("inf")), "confidence"),
        (with_score_confidence(float("-inf")), "confidence"),
        (with_score_probability(-0.01), "probabilities"),
        (with_score_probability(1.01), "probabilities"),
        (with_score_probability(float("nan")), "probabilities"),
        (with_score_probability(float("inf")), "probabilities"),
        (with_score_probability(float("-inf")), "probabilities"),
    ],
)
def test_degenerate_probability_values_are_rejected_at_parse_time(answer, field):
    with pytest.raises(ValidationError):
        SystemOneResult.model_validate(
            {
                "model": "m",
                "answers": {"q": answer},
                "usage": {"input_tokens": 0, "output_tokens": 0},
            }
        )


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_score_is_rejected_at_parse_time(value):
    with pytest.raises(ValidationError):
        ScoreResult.model_validate(SCORE_ANSWER | {"score": value})


def test_score_accepts_any_finite_value_outside_the_rubric_range():
    # Scores may fall between rubric levels — and outside them: 7.5 is finite,
    # so the mirror accepts it (the §24 scoreSimilarity formula clamps).
    result = ScoreResult.model_validate(SCORE_ANSWER | {"score": 7.5})

    assert result.score == 7.5


def test_empty_probabilities_map_is_rejected():
    # A distribution needs at least one label/level to be a distribution.
    with pytest.raises(ValidationError):
        ChoiceResult.model_validate(CHOICE_ANSWER | {"probabilities": {}})
    with pytest.raises(ValidationError):
        ScoreResult.model_validate(SCORE_ANSWER | {"probabilities": {}})


def test_boundary_probabilities_zero_and_one_are_accepted():
    assert NoulResult.model_validate(with_noul(0.0)).noul == 0.0
    assert NoulResult.model_validate(with_noul(1.0)).noul == 1.0
    choice = ChoiceResult.model_validate(
        CHOICE_ANSWER | {"confidence": 1.0, "probabilities": {"billing": 1.0}}
    )
    assert choice.confidence == 1.0
    assert choice.probabilities == {"billing": 1.0}


def test_fully_valid_real_shaped_result_still_parses():
    # Regression against the real emulator smoke shape: the constraints reject
    # degenerate values only — a well-formed mixed-primitive result parses.
    result = SystemOneResult.model_validate(FULL_RESULT)

    assert set(result.answers) == {"request_type", "urgency", "refund_requested"}
    assert isinstance(result.answers["request_type"], ChoiceResult)
    assert isinstance(result.answers["urgency"], ScoreResult)
    assert isinstance(result.answers["refund_requested"], NoulResult)


def test_generated_schema_pins_primitive_required_fields_and_closed_surfaces():
    noul = NoulResult.model_json_schema()
    assert noul["properties"]["type"]["const"] == "noul"
    assert noul["required"] == ["type", "noul"]
    # Constrained surface (B1): probabilities-family floats are [0, 1].
    assert noul["properties"]["noul"]["type"] == "number"
    assert noul["properties"]["noul"]["minimum"] == 0.0
    assert noul["properties"]["noul"]["maximum"] == 1.0
    assert noul["additionalProperties"] is False

    choice = ChoiceResult.model_json_schema()
    assert choice["properties"]["confidence"]["minimum"] == 0.0
    assert choice["properties"]["confidence"]["maximum"] == 1.0
    probabilities = choice["properties"]["probabilities"]
    assert probabilities["minProperties"] == 1
    assert probabilities["additionalProperties"]["minimum"] == 0.0
    assert probabilities["additionalProperties"]["maximum"] == 1.0

    score = ScoreResult.model_json_schema()
    assert score["required"] == ["type", "score", "confidence", "legend", "probabilities"]
    # The score is finite but deliberately UNBOUNDED (may fall between rubric
    # levels): no minimum/maximum may appear on it.
    assert score["properties"]["score"]["type"] == "number"
    assert "minimum" not in score["properties"]["score"]
    assert "maximum" not in score["properties"]["score"]
    assert score["properties"]["confidence"]["minimum"] == 0.0
    assert score["properties"]["confidence"]["maximum"] == 1.0
    score_probabilities = score["properties"]["probabilities"]
    assert score_probabilities["minProperties"] == 1
    assert score_probabilities["additionalProperties"]["minimum"] == 0.0
    assert score_probabilities["additionalProperties"]["maximum"] == 1.0
    assert score["additionalProperties"] is False


def test_generated_schema_pins_system_one_result_surface():
    schema = SystemOneResult.model_json_schema()

    assert schema["required"] == ["model", "answers", "usage"]
    assert schema["additionalProperties"] is False
    usage = schema["$defs"]["Usage"]
    assert usage["required"] == ["input_tokens", "output_tokens"]
    assert usage["properties"]["input_tokens"]["type"] == "integer"
    assert usage["properties"]["output_tokens"]["type"] == "integer"
