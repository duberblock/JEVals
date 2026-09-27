import json

import pytest
from pydantic import ValidationError

from app.schemas.execution_request import (
    AdvancedOptions,
    ExecutionMode,
    ExecutionRequestEnvelope,
)

CANONICAL_SYSTEM_ONE = {
    "state": {"message": "I was charged twice on my invoice."},
    "questions": {
        "request_type": {
            "type": "choice",
            "instructions": "Classify this request.",
            "criteria": {
                "billing": "Billing issue",
                "technical": "Technical issue",
                "sales": "Sales request",
            },
        },
        "urgency": {"type": "score", "criteria": ["low", "medium", "high"]},
        "refund_requested": {"type": "noul"},
    },
}


def emulator_envelope(system_one: dict, **extra) -> dict:
    return {"system_one": system_one, "mode": "emulator"} | extra


def test_envelope_parses_emulator_mode_and_keeps_system_one_raw():
    envelope = ExecutionRequestEnvelope.model_validate(emulator_envelope(CANONICAL_SYSTEM_ONE))

    assert envelope.mode == "emulator"
    assert envelope.advanced is None
    # system_one stays the RAW validated value: dict equality with the input,
    # never re-validated as SystemOneRequest here (domain validate_and_detect
    # owns that ruling).
    assert envelope.system_one == CANONICAL_SYSTEM_ONE


def test_system_one_is_not_revalidated_by_the_envelope():
    # A system_one that would FAIL SystemOneRequest validation still parses as
    # an envelope: the envelope contract only pins its own shape (§64).
    raw = {"state": None, "questions": {"q": {"type": "classification"}}}

    envelope = ExecutionRequestEnvelope.model_validate(emulator_envelope(raw))

    assert envelope.system_one == raw


def test_envelope_parses_every_documented_mode():
    for mode in ("emulator", "compare", "compare-and-evaluate"):
        envelope = ExecutionRequestEnvelope.model_validate(
            {"system_one": CANONICAL_SYSTEM_ONE, "mode": mode}
        )
        assert envelope.mode == mode


def test_advanced_independent_openai_prediction_parses():
    envelope = ExecutionRequestEnvelope.model_validate(
        emulator_envelope(CANONICAL_SYSTEM_ONE, advanced={"independent_openai_prediction": True})
    )

    assert isinstance(envelope.advanced, AdvancedOptions)
    assert envelope.advanced.independent_openai_prediction is True


def test_advanced_defaults_to_disabled_when_omitted():
    envelope = ExecutionRequestEnvelope.model_validate(emulator_envelope(CANONICAL_SYSTEM_ONE))

    assert envelope.advanced is None


def test_advanced_explicit_null_is_rejected():
    # The wire schema's advanced ($ref advancedOptions) is not nullable, so an
    # explicit null is a contract violation — only omission means disabled.
    with pytest.raises(ValidationError) as excinfo:
        ExecutionRequestEnvelope.model_validate(
            emulator_envelope(CANONICAL_SYSTEM_ONE, advanced=None)
        )

    assert ("advanced",) in [error["loc"] for error in excinfo.value.errors()]


def test_advanced_independent_openai_prediction_defaults_to_false_when_key_omitted():
    envelope = ExecutionRequestEnvelope.model_validate(
        emulator_envelope(CANONICAL_SYSTEM_ONE, advanced={})
    )

    assert envelope.advanced.independent_openai_prediction is False


def test_missing_mode_is_rejected():
    with pytest.raises(ValidationError) as excinfo:
        ExecutionRequestEnvelope.model_validate({"system_one": CANONICAL_SYSTEM_ONE})

    assert ("mode",) in [error["loc"] for error in excinfo.value.errors()]


def test_unknown_mode_is_rejected():
    with pytest.raises(ValidationError) as excinfo:
        ExecutionRequestEnvelope.model_validate(
            {"system_one": CANONICAL_SYSTEM_ONE, "mode": "fast"}
        )

    assert ("mode",) in [error["loc"] for error in excinfo.value.errors()]


def test_missing_system_one_is_rejected():
    with pytest.raises(ValidationError) as excinfo:
        ExecutionRequestEnvelope.model_validate({"mode": "emulator"})

    assert ("system_one",) in [error["loc"] for error in excinfo.value.errors()]


def test_envelope_rejects_unknown_top_level_keys():
    # The envelope is the API's own contract (not a user document), so extra
    # keys are rejected — unlike SystemOneRequest, which forwards extras.
    with pytest.raises(ValidationError):
        ExecutionRequestEnvelope.model_validate(
            emulator_envelope(CANONICAL_SYSTEM_ONE, unexpected=1)
        )


def test_advanced_rejects_unknown_keys():
    with pytest.raises(ValidationError):
        ExecutionRequestEnvelope.model_validate(
            emulator_envelope(
                CANONICAL_SYSTEM_ONE,
                advanced={"independent_openai_prediction": True, "other": 1},
            )
        )


def test_mode_literal_exposes_exactly_the_three_plan_modes():
    assert ExecutionMode.__args__ == ("emulator", "compare", "compare-and-evaluate")


def test_generated_schema_pins_mode_enum_and_required_non_nullable_fields():
    # The generated schema is a published surface (FastAPI embeds it in the
    # OpenAPI document), pinned in the style of STEP 3's generated-surface
    # tests: mode enum exactly the three plan §10 modes, both core fields
    # required, mode non-nullable, advanced optional defaulting to disabled.
    schema = ExecutionRequestEnvelope.model_json_schema()

    assert schema["required"] == ["system_one", "mode"]
    assert schema["additionalProperties"] is False
    mode_property = schema["properties"]["mode"]
    assert mode_property["enum"] == ["emulator", "compare", "compare-and-evaluate"]
    assert "anyOf" not in mode_property
    advanced_property = schema["properties"]["advanced"]
    assert advanced_property["default"] is None
    advanced_schema = schema["$defs"]["AdvancedOptions"]
    assert advanced_schema["properties"]["independent_openai_prediction"]["type"] == "boolean"
    assert advanced_schema["additionalProperties"] is False


def test_generated_schema_does_not_publish_null_type_for_advanced():
    # The published OpenAPI surface must match the wire schema: advanced is a
    # plain (non-nullable) object reference, so no null type may appear.
    advanced_property = ExecutionRequestEnvelope.model_json_schema()["properties"]["advanced"]

    assert "anyOf" not in advanced_property
    assert '"null"' not in json.dumps(advanced_property)
