import json
from pathlib import Path

import pytest
from jsonschema import Draft202012Validator
from jsonschema.exceptions import ValidationError

CONTRACTS_ROOT = Path(__file__).resolve().parents[4] / "packages" / "contracts"
SCHEMA_PATH = CONTRACTS_ROOT / "schemas" / "system-one-request.schema.json"
EXECUTION_SCHEMA_PATH = CONTRACTS_ROOT / "schemas" / "system-one-execution-request.schema.json"
FIXTURES_DIR = CONTRACTS_ROOT / "fixtures"

VALID_FIXTURE_PATH = FIXTURES_DIR / "system-one-request.valid.json"
INVALID_FIXTURE_PATH = FIXTURES_DIR / "system-one-request.invalid.json"

# Pinned canonical rulings (ADR-002): each fixture file pins one ruling at the
# wire-schema level.
VALID_RULING_FIXTURES = [
    "system-one-request.valid.json",
    "system-one-request.state-null.valid.json",
    "system-one-request.choice-single-criterion.valid.json",
]

INVALID_RULING_FIXTURES = [
    "system-one-request.invalid.json",
    "system-one-request.choice-empty-criteria.invalid.json",
    "system-one-request.score-single-criterion.invalid.json",
    "system-one-request.unknown-type.invalid.json",
    "system-one-request.alternative-format.invalid.json",
    "system-one-request.model-null.invalid.json",
]

# Execution envelope rulings (plan §64): the envelope wraps a SystemOneRequest
# with a mode and optional advanced options.
EXECUTION_VALID_RULING_FIXTURES = [
    "system-one-execution-request.valid.json",
    "system-one-execution-request.compare-advanced.valid.json",
]

EXECUTION_INVALID_RULING_FIXTURES = [
    "system-one-execution-request.invalid-mode.invalid.json",
    "system-one-execution-request.missing-system-one.invalid.json",
    "system-one-execution-request.unknown-question-type.invalid.json",
    "system-one-execution-request.advanced-null.invalid.json",
]


def load_json(path: Path):
    return json.loads(path.read_text())


@pytest.fixture(scope="module")
def validator():
    schema = load_json(SCHEMA_PATH)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


@pytest.fixture(scope="module")
def execution_validator():
    schema = load_json(EXECUTION_SCHEMA_PATH)
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def test_valid_system_one_request_fixture_matches_schema(validator):
    validator.validate(load_json(VALID_FIXTURE_PATH))


def test_invalid_system_one_request_fixture_is_rejected_by_schema(validator):
    with pytest.raises(ValidationError):
        validator.validate(load_json(INVALID_FIXTURE_PATH))


@pytest.mark.parametrize("fixture_name", VALID_RULING_FIXTURES)
def test_valid_ruling_fixtures_match_schema(validator, fixture_name):
    validator.validate(load_json(FIXTURES_DIR / fixture_name))


@pytest.mark.parametrize("fixture_name", INVALID_RULING_FIXTURES)
def test_invalid_ruling_fixtures_are_rejected_by_schema(validator, fixture_name):
    with pytest.raises(ValidationError):
        validator.validate(load_json(FIXTURES_DIR / fixture_name))


@pytest.mark.parametrize("fixture_name", EXECUTION_VALID_RULING_FIXTURES)
def test_valid_execution_envelope_fixtures_match_schema(execution_validator, fixture_name):
    execution_validator.validate(load_json(FIXTURES_DIR / fixture_name))


@pytest.mark.parametrize("fixture_name", EXECUTION_INVALID_RULING_FIXTURES)
def test_invalid_execution_envelope_fixtures_are_rejected_by_schema(execution_validator, fixture_name):
    with pytest.raises(ValidationError):
        execution_validator.validate(load_json(FIXTURES_DIR / fixture_name))


@pytest.mark.parametrize(
    "fixture_name",
    sorted(path.name for path in FIXTURES_DIR.glob("system-one-request.*.json")),
)
def test_request_fixture_rulings_hold_inside_the_envelope(execution_validator, fixture_name):
    # Lockstep: the envelope embeds its own copy of the SystemOneRequest
    # subschema, so every standalone request fixture is re-run wrapped in a
    # minimal emulator envelope to pin the embedded copy to the standalone
    # schema's rulings (drift between the two copies becomes a test failure).
    wrapped = {"system_one": load_json(FIXTURES_DIR / fixture_name), "mode": "emulator"}

    if fixture_name.endswith(".valid.json"):
        execution_validator.validate(wrapped)
    else:
        with pytest.raises(ValidationError):
            execution_validator.validate(wrapped)
