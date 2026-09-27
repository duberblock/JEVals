import json
from pathlib import Path

import pytest

from app.application.validate_request import validate_request
from app.domain.requests.detection import validate_and_detect
from app.domain.requests.models import (
    RequestContractError,
    RequestDetection,
    UnsupportedQuestionTypeError,
)
from app.schemas.system_one import SystemOneRequest

# Pydantic union branch tags are internals and must never leak into error details.
QUESTION_BRANCH_TAGS = ("NoulQuestion", "ChoiceQuestion", "ScoreQuestion")

# Same resolution pattern as test_contract_fixtures.py: the mirror tests run
# against the very fixture files that pin the JSON Schema, making lockstep
# literally transitive.
CONTRACTS_ROOT = Path(__file__).resolve().parents[4] / "packages" / "contracts"
FIXTURES_DIR = CONTRACTS_ROOT / "fixtures"


def assert_no_question_branch_tags(detail: str):
    for tag in QUESTION_BRANCH_TAGS:
        assert tag not in detail


CANONICAL_REQUEST = {
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

# Representative payloads for each forbidden alternative-format family (plan §5).
ALTERNATIVE_FORMAT_PAYLOADS = {
    "primitives_array": {
        "state": {"message": "I was charged twice on my invoice."},
        "primitives": [
            {"name": "request_type", "kind": "classification_single_choice", "allowed_choices": ["billing", "technical"]},
            {"name": "urgency", "kind": "scalar_score", "range": {"min": 0, "max": 2}},
        ],
    },
    "options": {
        "state": {"message": "I was charged twice on my invoice."},
        "questions": {
            "request_type": {"type": "choice", "instructions": "Classify.", "options": ["billing", "technical"]},
        },
    },
    "range": {
        "state": {"message": "I was charged twice on my invoice."},
        "questions": {
            "urgency": {"type": "score", "range": {"min": 0, "max": 2, "step": 1}},
        },
    },
    "threshold": {
        "state": {"message": "I was charged twice on my invoice."},
        "questions": {
            "refund_requested": {"type": "noul", "threshold": 0.7},
        },
    },
    "telemetry": {
        "state": {"message": "I was charged twice on my invoice."},
        "telemetry": {
            "session_id": "legacy-1",
            "questions": [{"name": "refund_requested", "kind": "noul_probabilistic_boolean"}],
        },
    },
    "allowed_choices": {
        "state": {"message": "I was charged twice on my invoice."},
        "questions": {
            "request_type": {"type": "choice", "allowed_choices": ["billing", "technical"]},
        },
    },
    "classification_single_choice": {
        "state": {"message": "I was charged twice on my invoice."},
        "questions": {
            "request_type": {
                "type": "classification_single_choice",
                "criteria": {"billing": "Billing issue", "technical": "Technical issue"},
            },
        },
    },
    "scalar_score": {
        "state": {"message": "I was charged twice on my invoice."},
        "questions": {
            "urgency": {"type": "scalar_score", "criteria": ["low", "medium", "high"]},
        },
    },
    "noul_probabilistic_boolean": {
        "state": {"message": "I was charged twice on my invoice."},
        "questions": {
            "refund_requested": {"type": "noul_probabilistic_boolean"},
        },
    },
}


def test_canonical_plan_example_detects_three_primitives_in_order():
    detection = validate_and_detect(CANONICAL_REQUEST)

    assert [(q.name, q.primitive) for q in detection.questions] == [
        ("request_type", "choice"),
        ("urgency", "score"),
        ("refund_requested", "noul"),
    ]


def test_state_null_is_valid():
    detection = validate_and_detect(CANONICAL_REQUEST | {"state": None})

    assert [q.primitive for q in detection.questions] == ["choice", "score", "noul"]


def test_choice_with_single_criterion_is_valid():
    payload = {
        "state": "Pick one.",
        "questions": {
            "request_type": {"type": "choice", "criteria": {"billing": "Billing issue"}},
        },
    }

    detection = validate_and_detect(payload)

    assert [(q.name, q.primitive) for q in detection.questions] == [("request_type", "choice")]


def test_choice_with_empty_criteria_is_invalid():
    payload = {
        "state": "Pick one.",
        "questions": {"request_type": {"type": "choice", "criteria": {}}},
    }

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert not isinstance(excinfo.value, UnsupportedQuestionTypeError)
    assert excinfo.value.title
    assert "questions.request_type.criteria" in excinfo.value.detail
    assert_no_question_branch_tags(excinfo.value.detail)


def test_score_with_single_criterion_is_invalid():
    payload = {
        "state": "Rate it.",
        "questions": {"urgency": {"type": "score", "criteria": ["low"]}},
    }

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "questions.urgency.criteria" in excinfo.value.detail
    assert_no_question_branch_tags(excinfo.value.detail)


def test_state_with_non_entry_type_reports_state_location():
    payload = {"state": 42, "questions": {"q": {"type": "noul"}}}

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "at 'state'." in excinfo.value.detail
    assert "'state." not in excinfo.value.detail


def test_instructions_with_non_entry_type_reports_instructions_location():
    payload = {
        "state": None,
        "questions": {"q": {"type": "choice", "instructions": True, "criteria": {"a": "b"}}},
    }

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "at 'questions.q.instructions'." in excinfo.value.detail


def test_score_criterion_with_non_entry_type_reports_index_location():
    payload = {"state": None, "questions": {"q": {"type": "score", "criteria": [42, "b"]}}}

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "at 'questions.q.criteria.0'." in excinfo.value.detail


def test_question_named_after_branch_tag_keeps_its_name():
    # 'ChoiceQuestion' is a legal question name; the branch tag at the same
    # position must not eat it (value-based stripping would report
    # 'questions.criteria').
    payload = {"state": None, "questions": {"ChoiceQuestion": {"type": "choice", "criteria": {}}}}

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "at 'questions.ChoiceQuestion.criteria'." in excinfo.value.detail


def test_root_failure_is_not_demoted_below_branch_candidates():
    # F2: the branch preference must only reorder candidates of the SAME
    # failing question; a root-level failure that pydantic reported first
    # still wins.
    payload = {"state": 42, "questions": {"a": {"type": "score", "criteria": ["low"]}}}

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "at 'state'." in excinfo.value.detail


def test_missing_state_is_not_demoted_below_branch_candidates():
    payload = {"questions": {"a": {"type": "score", "criteria": ["low"]}}}

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "at 'state'." in excinfo.value.detail


def test_branch_preference_survives_within_a_single_question():
    # The branch preference is intact when the failure is inside that one
    # question: the matching-branch criteria error beats discrimination noise.
    payload = {"state": None, "questions": {"a": {"type": "score", "criteria": ["low"]}}}

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "at 'questions.a.criteria'." in excinfo.value.detail


def test_first_failing_question_wins_over_later_branch_candidates():
    payload = {
        "state": None,
        "questions": {
            "a": {"type": "noul", "instructions": 42},
            "b": {"type": "choice", "criteria": {}},
        },
    }

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "at 'questions.a.instructions'." in excinfo.value.detail


def test_criteria_key_named_type_reports_criteria_type_location():
    # F3: a criteria KEY literally named 'type' is a genuine failure; the
    # type-terminal skip must only swallow discrimination noise
    # (literal_error/missing), not this real location.
    payload = {"state": None, "questions": {"q": {"type": "choice", "criteria": {"type": 42}}}}

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "at 'questions.q.criteria.type'." in excinfo.value.detail


def test_non_string_type_forces_type_location_even_behind_earlier_failures():
    # F5 pin: the forced non-string-type scan (R3 precedence) outranks the
    # first-error ordering, so a later question's non-string type pins the
    # detail even when an earlier question failed first.
    payload = {
        "state": None,
        "questions": {
            "a": {"type": "noul", "instructions": 42},
            "b": {"type": 42},
        },
    }

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "at 'questions.b.type'." in excinfo.value.detail


def test_unknown_question_type_is_unsupported():
    payload = {
        "state": "Classify this.",
        "questions": {"request_type": {"type": "classification"}},
    }

    with pytest.raises(UnsupportedQuestionTypeError) as excinfo:
        validate_and_detect(payload)

    error = excinfo.value
    assert error.title == "Unsupported question type"
    assert error.expected == "choice | score | noul"
    assert error.question_name == "request_type"
    assert error.question_type == "classification"


def test_missing_question_type_reports_type_location():
    payload = {"state": None, "questions": {"q": {"criteria": {"a": "b"}}}}

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "at 'questions.q.type'." in excinfo.value.detail


def test_non_string_question_type_reports_type_location():
    payload = {"state": None, "questions": {"q": {"type": 42, "criteria": {"a": "b"}}}}

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert "at 'questions.q.type'." in excinfo.value.detail


def test_non_string_question_type_is_not_an_unsupported_type_error():
    # UnsupportedQuestionTypeError is exclusively for unknown STRING types;
    # a non-string type is a generic contract violation at questions.<name>.type.
    payload = {"state": None, "questions": {"q": {"type": 42}}}

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert not isinstance(excinfo.value, UnsupportedQuestionTypeError)
    assert "at 'questions.q.type'." in excinfo.value.detail


def test_empty_questions_is_invalid():
    payload = {"state": "No questions.", "questions": {}}

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert excinfo.value.title == "Invalid SystemOneRequest"
    assert "at 'questions'." in excinfo.value.detail
    assert_no_question_branch_tags(excinfo.value.detail)


def test_primitives_array_alternative_format_is_invalid_with_contract_title():
    payload = ALTERNATIVE_FORMAT_PAYLOADS["primitives_array"]

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert excinfo.value.title == "Invalid SystemOneRequest"
    assert not isinstance(excinfo.value, UnsupportedQuestionTypeError)


def test_model_is_optional_and_root_extras_are_preserved():
    without_model = {"state": "Plain.", "questions": {"q": {"type": "noul"}}}
    with_model_and_extras = {
        "state": "Plain.",
        "questions": {"q": {"type": "noul"}},
        "model": "jev-latest",
        "metadata": {"source": "playground"},
    }

    detection_omitted = validate_and_detect(without_model)
    detection_present = validate_and_detect(with_model_and_extras)

    assert detection_omitted.request.model is None
    assert detection_present.request.model == "jev-latest"
    assert detection_present.request.model_extra == {"metadata": {"source": "playground"}}


def test_alternative_format_names_as_null_extras_are_forwarded():
    # Root extras are forwarded per the oracle (SDK forwards them, including
    # null values). A null 'telemetry'/'primitives' KEY is a legal extra, not
    # an alternative-format payload: future tightening must not ban the names.
    payload = CANONICAL_REQUEST | {"telemetry": None, "primitives": None}

    detection = validate_and_detect(payload)

    assert detection.request.model_extra == {"telemetry": None, "primitives": None}
    assert [q.primitive for q in detection.questions] == ["choice", "score", "noul"]


def test_model_null_is_invalid():
    payload = CANONICAL_REQUEST | {"model": None}

    with pytest.raises(RequestContractError) as excinfo:
        validate_and_detect(payload)

    assert not isinstance(excinfo.value, UnsupportedQuestionTypeError)
    assert "at 'model'." in excinfo.value.detail


def test_generated_schema_publishes_model_as_non_nullable_string():
    # The generated schema is a published surface (FastAPI embeds it in the
    # OpenAPI document). It is string-typed LIKE the wire schema and never a
    # nullable anyOf union, but deliberately diverges on the default: the
    # generated surface publishes {"type": "string", "default": null} while
    # the wire schema publishes no default. A null default is not a valid
    # string instance (a model_dump() of an omitted model would not validate
    # against the generated schema); accepted because the playground never
    # re-validates dumps against the generated schema — it exists for OpenAPI
    # consumers (ADR-002).
    model_property = SystemOneRequest.model_json_schema()["properties"]["model"]

    assert model_property["type"] == "string"
    assert "anyOf" not in model_property
    assert model_property["default"] is None


@pytest.mark.parametrize("format_name", sorted(ALTERNATIVE_FORMAT_PAYLOADS))
def test_alternative_format_family_is_rejected(format_name):
    payload = ALTERNATIVE_FORMAT_PAYLOADS[format_name]

    with pytest.raises(RequestContractError):
        validate_and_detect(payload)


def test_application_use_case_wraps_domain_detection():
    detection = validate_request(CANONICAL_REQUEST)

    assert [q.name for q in detection.questions] == ["request_type", "urgency", "refund_requested"]


@pytest.mark.parametrize(
    "fixture_name",
    sorted(path.name for path in FIXTURES_DIR.glob("system-one-request.*.json")),
)
def test_contract_fixture_agrees_with_the_mirror(fixture_name):
    payload = json.loads((FIXTURES_DIR / fixture_name).read_text())

    if fixture_name.endswith(".valid.json"):
        detection = validate_and_detect(payload)
        assert isinstance(detection, RequestDetection)
        assert detection.questions
    elif fixture_name.endswith(".invalid.json"):
        with pytest.raises(RequestContractError):
            validate_and_detect(payload)
    else:
        pytest.fail(f"Fixture '{fixture_name}' must be classified as .valid.json or .invalid.json")
