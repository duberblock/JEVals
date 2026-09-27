from datetime import UTC, datetime

import pytest

from app.domain.executions.models import (
    Execution,
    MalformedExecutionRequestError,
    compute_request_hash,
)


REQUEST = {
    "state": {"b": 2, "a": 1},
    "questions": {
        "is_safe": {
            "type": "noul",
            "instructions": "Is the answer safe?",
            "criteria": {"true": "safe", "false": "unsafe"},
        }
    },
    "model": "jev-latest",
}


def test_request_hash_is_stable_for_canonical_json_key_ordering():
    reordered_request = {
        "model": "jev-latest",
        "questions": REQUEST["questions"],
        "state": {"a": 1, "b": 2},
    }

    assert compute_request_hash(REQUEST) == compute_request_hash(reordered_request)
    assert compute_request_hash(REQUEST).startswith("sha256:")


def test_request_hash_changes_when_the_request_changes():
    changed_request = REQUEST | {"model": "other-model"}

    assert compute_request_hash(REQUEST) != compute_request_hash(changed_request)


def test_execution_snapshot_stores_request_hash_and_fixture_provenance_shape():
    execution = Execution.create(
        execution_id="run_0001",
        created_at=datetime(2026, 9, 21, 12, 0, tzinfo=UTC),
        request=REQUEST,
        mode="compare-and-evaluate",
        status="completed",
        payload={
            "emulator": {"status": "success", "model": "fixture-emulator", "result": {}},
            "runtime": {"duration_ms": 184},
            "provenance": {
                "providers": [],
                "versions": {"application": "test-fixture"},
                "timings": {"total_ms": 184},
            },
        },
        overall_fidelity=0.968,
        aligned_questions=1,
        semantic_divergence="none",
        duration_ms=184,
    )

    assert execution.question_count == 1
    assert execution.request_hash == compute_request_hash(REQUEST)
    assert execution.payload["execution_id"] == "run_0001"
    assert execution.payload["request_hash"] == execution.request_hash
    assert execution.payload["request"] == REQUEST
    assert execution.payload["provenance"] == {
        "providers": [],
        "versions": {"application": "test-fixture"},
        "timings": {"total_ms": 184},
    }


def make_execution(request: dict) -> Execution:
    return Execution.create(
        execution_id="run_0001",
        created_at=datetime(2026, 9, 21, 12, 0, tzinfo=UTC),
        request=request,
        mode="compare",
        status="completed",
    )


def test_execution_create_fails_fast_when_questions_is_not_a_dict():
    # F8b: direct domain construction (bypassing the API's Pydantic boundary)
    # with a non-dict questions shape must raise a loud domain error instead
    # of silently persisting question_count=0.
    with pytest.raises(MalformedExecutionRequestError, match="questions"):
        make_execution({"state": "x", "questions": ["not", "a", "dict"]})


def test_execution_create_fails_fast_when_questions_is_none():
    with pytest.raises(MalformedExecutionRequestError, match="questions"):
        make_execution({"state": "x", "questions": None})


def test_execution_create_fails_fast_when_questions_is_missing():
    # The canonical SystemOneRequest contract requires questions; a missing
    # key is just as malformed as a wrong-typed one and must not silently
    # produce question_count=0.
    with pytest.raises(MalformedExecutionRequestError, match="questions"):
        make_execution({"state": "x"})


def test_execution_create_is_immutable_snapshot_against_later_payload_mutations():
    # F9b: the created Execution is an in-memory snapshot. Mutating the
    # caller's payload dict (nested) after create must NOT leak into the
    # stored execution.
    payload = {
        "emulator": {"status": "success", "result": {"answers": {}}},
        "provenance": {"providers": ["emulator"], "versions": {"a": "1"}, "timings": {"t": 1}},
    }
    execution = Execution.create(
        execution_id="run_snapshot_payload",
        created_at=datetime(2026, 9, 21, 12, 0, tzinfo=UTC),
        request=REQUEST,
        mode="compare",
        status="completed",
        payload=payload,
    )

    payload["emulator"]["status"] = "failed"
    payload["emulator"]["result"]["answers"]["q"] = {"type": "noul"}
    payload["provenance"]["providers"].append("judge")

    assert execution.payload["emulator"]["status"] == "success"
    assert execution.payload["emulator"]["result"]["answers"] == {}
    assert execution.payload["provenance"]["providers"] == ["emulator"]


def test_execution_create_is_immutable_snapshot_against_later_request_mutations():
    # F9b: same contract for the request object — the snapshot stores its own
    # copy, so later caller mutations cannot rewrite history (or invalidate
    # the stored request_hash relationship).
    request = {
        "state": {"topic": "billing"},
        "questions": {"q": {"type": "noul"}},
    }
    execution = Execution.create(
        execution_id="run_snapshot_request",
        created_at=datetime(2026, 9, 21, 12, 0, tzinfo=UTC),
        request=request,
        mode="compare",
        status="completed",
    )

    request["state"]["topic"] = "mutated"
    request["questions"]["q"]["type"] = "choice"

    assert execution.payload["request"] == {
        "state": {"topic": "billing"},
        "questions": {"q": {"type": "noul"}},
    }
    assert compute_request_hash(execution.payload["request"]) == execution.request_hash
