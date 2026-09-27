"""§69 structured completion logs (fix-forward F11): one INFO line per
persisted execution, from the application layer, after persistence.

Pins the exact line shape and — critically — the absence of payload content:
no state, no prompts, no model bodies, no keys, no Authorization material.
Every line ends with the F5 partial-distinguishability field:
comparison=available when the persisted snapshot carries a comparison,
comparison=unavailable otherwise (emulator mode and compare failures alike —
the field is ALWAYS present so log consumers never branch on mode).
"""

from __future__ import annotations

import asyncio
import logging
import re

import pytest

from app.application.execute_system_one import (
    EmulatorExecutionFailedError,
    InternalExecutionError,
    execute_system_one,
)
from app.domain.executions.emulator import EmulatorProviderError
from app.domain.executions.jev import JevProviderError
from app.schemas.execution_request import ExecutionRequestEnvelope
from app.schemas.system_one_result import SystemOneResult

LINE_PATTERN = re.compile(
    r"^execution completed execution_id=(run_[0-9a-f]+) "
    r"mode=(emulator|compare) "
    r"question_count=(\d+) "
    r"duration_ms=(\d+) "
    r"status=(completed|failed) "
    r"comparison=(available|unavailable)$"
)

STATE_SECRET = "I was charged twice on my invoice."

REQUEST = {
    "state": {"message": STATE_SECRET},
    "questions": {
        "request_type": {
            "type": "choice",
            "criteria": {"billing": "Billing issue", "technical": "Technical issue"},
        },
        "refund_requested": {"type": "noul"},
    },
}

RESULT = {
    "model": "jev-emulator",
    "answers": {
        "request_type": {
            "type": "choice",
            "choice": "billing",
            "confidence": 0.875,
            "probabilities": {"billing": 0.75, "technical": 0.25},
        },
        "refund_requested": {"type": "noul", "noul": 0.625},
    },
    "usage": {"input_tokens": 10, "output_tokens": 5},
}

JEV_RESULT = {
    "model": "jev-latest",
    "answers": {
        "request_type": {
            "type": "choice",
            "choice": "billing",
            "confidence": 0.625,
            "probabilities": {"billing": 0.625, "technical": 0.375},
        },
        "refund_requested": {"type": "noul", "noul": 0.75},
    },
    "usage": {"input_tokens": 10, "output_tokens": 5},
}

# Parses cleanly through the mirror (the mirror never cross-checks answers
# against a REQUEST) but has no answer for 'refund_requested', so the
# deterministic comparison raises FidelityComparisonError.
JEV_RESULT_MISSING_ANSWER = {
    "model": "jev-latest",
    "answers": {
        "request_type": JEV_RESULT["answers"]["request_type"],
    },
    "usage": {"input_tokens": 10, "output_tokens": 5},
}


class StubRepo:
    def __init__(self):
        self.created = []

    def create(self, execution):
        self.created.append(execution)
        return execution


class StubProvider:
    def __init__(self, result: dict | None = None, error: Exception | None = None):
        self.result = SystemOneResult.model_validate(result) if result else None
        self.error = error

    async def execute(self, request):
        if self.error is not None:
            raise self.error
        return self.result


def envelope(mode: str) -> ExecutionRequestEnvelope:
    return ExecutionRequestEnvelope.model_validate({"system_one": REQUEST, "mode": mode})


def run(mode: str = "emulator", emulator=None, jev=None, repo: StubRepo | None = None):
    return execute_system_one(
        repo=repo or StubRepo(),
        emulator=emulator if emulator is not None else StubProvider(RESULT),
        jev=jev,
        judge=None,
        independent=None,
        envelope=envelope(mode),
    )


@pytest.fixture
def completion_lines(caplog):
    caplog.set_level(logging.INFO, logger="app.application.execute_system_one")

    def collect() -> list[str]:
        return [
            record.getMessage()
            for record in caplog.records
            if record.levelno == logging.INFO and "execution completed" in record.getMessage()
        ]

    return collect


def test_successful_emulator_execution_logs_one_structured_completion_line(completion_lines):
    execution = asyncio.run(run())

    lines = completion_lines()
    assert len(lines) == 1
    match = LINE_PATTERN.match(lines[0])
    assert match is not None
    assert match.group(1) == execution.execution_id
    assert match.group(2) == "emulator"
    assert match.group(3) == "2"
    assert int(match.group(4)) >= 0
    assert match.group(5) == "completed"
    # PIN: the field is present on emulator-mode lines too, as unavailable.
    assert match.group(6) == "unavailable"


def test_failed_emulator_execution_logs_completion_with_failed_status(completion_lines):
    with pytest.raises(EmulatorExecutionFailedError):
        asyncio.run(
            run(emulator=StubProvider(error=EmulatorProviderError(message="The emulator returned HTTP 503.", status=503)))
        )

    lines = completion_lines()
    assert len(lines) == 1
    match = LINE_PATTERN.match(lines[0])
    assert match is not None
    assert match.group(2) == "emulator"
    assert match.group(5) == "failed"
    assert match.group(6) == "unavailable"


def test_successful_compare_execution_logs_compare_mode(completion_lines):
    execution = asyncio.run(run(mode="compare", jev=StubProvider(JEV_RESULT)))

    lines = completion_lines()
    assert len(lines) == 1
    match = LINE_PATTERN.match(lines[0])
    assert match is not None
    assert match.group(1) == execution.execution_id
    assert match.group(2) == "compare"
    assert match.group(5) == "completed"
    # F5: a full compare carries a comparison in the snapshot.
    assert match.group(6) == "available"


def test_jev_partial_failure_still_logs_completed_status(completion_lines):
    # §66: JEV failure is a persisted partial STATE, not a failed run.
    asyncio.run(
        run(mode="compare", jev=StubProvider(error=JevProviderError(message="The JEV returned HTTP 500.", status=500)))
    )

    lines = completion_lines()
    assert len(lines) == 1
    match = LINE_PATTERN.match(lines[0])
    assert match.group(5) == "completed"
    # F5: the partial state has fidelity unavailable — no comparison section.
    assert match.group(6) == "unavailable"


def test_comparison_failure_persists_failed_snapshot_and_logs_failed_status(completion_lines):
    # Both providers succeeded but the comparison raised: persist FIRST
    # (both sections as observed, no comparison), then surface the error.
    repo = StubRepo()

    with pytest.raises(InternalExecutionError) as excinfo:
        asyncio.run(run(mode="compare", jev=StubProvider(JEV_RESULT_MISSING_ANSWER), repo=repo))

    assert len(repo.created) == 1
    snapshot = repo.created[0]
    assert snapshot.status == "failed"
    assert snapshot.payload["emulator"]["status"] == "success"
    assert snapshot.payload["jev"]["status"] == "success"
    assert "comparison" not in snapshot.payload
    assert excinfo.value.execution_id == snapshot.execution_id

    lines = completion_lines()
    assert len(lines) == 1
    match = LINE_PATTERN.match(lines[0])
    assert match is not None
    assert match.group(5) == "failed"
    assert match.group(6) == "unavailable"


@pytest.mark.parametrize("side", ["emulator", "jev"])
def test_unexpected_provider_exception_persists_failed_snapshot_and_logs_failed_status(
    completion_lines, side
):
    # Revised ADR-004 ruling: a provider BUG (non-provider-error exception in
    # the gather) persists a failed snapshot with the failing side recorded as
    # 'unexpected provider error' and the other side as observed — no more
    # re-raise-before-persist.
    repo = StubRepo()
    bug = StubProvider(error=RuntimeError("provider bug"))
    healthy = StubProvider(JEV_RESULT if side == "emulator" else RESULT)

    with pytest.raises(InternalExecutionError) as excinfo:
        asyncio.run(
            run(
                mode="compare",
                emulator=bug if side == "emulator" else healthy,
                jev=bug if side == "jev" else healthy,
                repo=repo,
            )
        )

    assert len(repo.created) == 1
    snapshot = repo.created[0]
    assert snapshot.status == "failed"
    assert snapshot.payload[side] == {"status": "failed", "error": "unexpected provider error"}
    other = "jev" if side == "emulator" else "emulator"
    assert snapshot.payload[other]["status"] == "success"
    assert "comparison" not in snapshot.payload
    assert excinfo.value.execution_id == snapshot.execution_id

    lines = completion_lines()
    assert len(lines) == 1
    match = LINE_PATTERN.match(lines[0])
    assert match.group(5) == "failed"
    assert match.group(6) == "unavailable"


def test_unexpected_exception_takes_precedence_over_the_provider_error_path(completion_lines):
    # Mixed gather (expected emulator failure + JEV bug): the bug wins — a
    # persisted failed snapshot plus the generic 500, never the 502 path.
    repo = StubRepo()

    with pytest.raises(InternalExecutionError):
        asyncio.run(
            run(
                mode="compare",
                emulator=StubProvider(error=EmulatorProviderError(message="The emulator returned HTTP 500.", status=500)),
                jev=StubProvider(error=RuntimeError("provider bug")),
                repo=repo,
            )
        )

    assert len(repo.created) == 1
    snapshot = repo.created[0]
    assert snapshot.status == "failed"
    assert snapshot.payload["emulator"] == {"status": "failed", "error": "The emulator returned HTTP 500."}
    assert snapshot.payload["jev"] == {"status": "failed", "error": "unexpected provider error"}


def test_completion_log_never_contains_payload_or_secret_material(completion_lines, caplog):
    asyncio.run(run(mode="compare", jev=StubProvider(JEV_RESULT)))

    everything = " ".join(record.getMessage() for record in caplog.records)
    assert STATE_SECRET not in everything  # state
    assert "Billing issue" not in everything  # prompts/criteria
    assert "jev-emulator" not in everything  # model bodies
    assert "Bearer" not in everything  # Authorization material
