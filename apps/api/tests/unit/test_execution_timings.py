"""Per-component wall-clock timings in provenance.timings (plan §61.4).

The execution snapshot records integer milliseconds per component that was
ACTUALLY invoked on that run — a key is present even when the component
failed (the wall time was really spent; §61.4 is a latency view, not a
success view). Keys appear only for components that ran: an emulator-mode
snapshot never carries jev_ms, a §66 partial without a comparison never
carries fidelity_ms or ai_judge_ms.

Total execution time stays ONLY in runtime.duration_ms (§47 "no invented
fields") — there is no persistence_ms: the write duration cannot be embedded
inside the document being written. The §65 parallel group is timed PER
PROVIDER by wrapping each coroutine, never by timing the whole gather.
"""

from __future__ import annotations

import asyncio
import json
from datetime import UTC, datetime

import pytest

from app.application.execute_system_one import (
    EmulatorExecutionFailedError,
    InternalExecutionError,
    execute_system_one,
)
from app.domain.executions.emulator import EmulatorProviderError
from app.domain.executions.independent_openai import (
    IndependentOpenaiPrediction,
    IndependentOpenaiProviderError,
)
from app.domain.executions.jev import JevProviderError
from app.domain.executions.judge import JudgeOutcome, JudgeProviderError
from app.domain.executions.models import Execution
from app.schemas.execution_request import ExecutionRequestEnvelope
from app.schemas.judge_evaluation import JudgeEvaluation
from app.schemas.system_one_result import SystemOneResult

REQUEST = {
    "state": {"message": "I was charged twice on my invoice."},
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

# Same answers as the emulator: aligns on every question, both sides of .5.
INDEPENDENT_RESULT = {
    "model": "gpt-4o-mini",
    "answers": {
        "request_type": {
            "type": "choice",
            "choice": "billing",
            "confidence": 0.875,
            "probabilities": {"billing": 0.75, "technical": 0.25},
        },
        "refund_requested": {"type": "noul", "noul": 0.625},
    },
    "usage": {"input_tokens": 30, "output_tokens": 8},
}

JUDGE_ANSWER = {
    "overall": {
        "prediction_quality": "mixed",
        "semantic_divergence": "minor",
        "summary": "Numeric differences leave the interpretation unchanged.",
    },
    "questions": {
        "request_type": {
            "emulator_support": "strong",
            "jev_support": "strong",
            "semantic_divergence": "none",
            "preferred": "tie",
            "reason": "Both select billing.",
        },
        "refund_requested": {
            "emulator_support": "partial",
            "jev_support": "partial",
            "semantic_divergence": "minor",
            "preferred": "tie",
            "reason": "Both above .5.",
        },
    },
}

# Parses through the mirror but answers only 1 of the 2 request questions,
# so the deterministic comparison raises FidelityComparisonError.
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
    """SystemOne provider stand-in with an optional artificial latency."""

    def __init__(self, result: dict | None = None, error: Exception | None = None, delay: float = 0.0):
        self.result = SystemOneResult.model_validate(result) if result else None
        self.error = error
        self.delay = delay

    async def execute(self, request):
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return self.result


class StubIndependentProvider:
    """Independent port stand-in with an optional artificial latency."""

    def __init__(self, result: dict | None = None, error: Exception | None = None, delay: float = 0.0):
        self._result = result if result is not None else INDEPENDENT_RESULT
        self.error = error
        self.delay = delay

    async def execute(self, request):
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return IndependentOpenaiPrediction(
            result=SystemOneResult.model_validate(self._result),
            llm_attempts=[],
            run_config={},
        )


class StubJudgeProvider:
    """Judge port stand-in with an optional artificial latency."""

    def __init__(self, error: Exception | None = None, delay: float = 0.0):
        self.error = error
        self.delay = delay
        self.outcome = JudgeOutcome(
            model="judge-llm",
            evaluation=JudgeEvaluation.model_validate(JUDGE_ANSWER),
            judge_input={},
            output_schema=JudgeEvaluation.model_json_schema(),
            raw_response=json.dumps(JUDGE_ANSWER),
            system_instruction="stub judge system instruction",
            configuration={"model": "judge-llm"},
        )

    async def evaluate(self, request, emulator_result, jev_result, comparison):
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.error is not None:
            raise self.error
        return self.outcome


def make_envelope(mode: str, advanced: bool = False) -> ExecutionRequestEnvelope:
    body = {"system_one": REQUEST, "mode": mode}
    if advanced:
        body["advanced"] = {"independent_openai_prediction": True}
    return ExecutionRequestEnvelope.model_validate(body)


def run(
    *,
    mode: str = "emulator",
    emulator: StubProvider | None = None,
    jev: StubProvider | None = None,
    judge: StubJudgeProvider | None = None,
    independent: StubIndependentProvider | None = None,
    advanced: bool = False,
    repo: StubRepo | None = None,
):
    if emulator is None:
        emulator = StubProvider(RESULT)
    if jev is None and mode in ("compare", "compare-and-evaluate"):
        jev = StubProvider(JEV_RESULT)
    if judge is None and mode == "compare-and-evaluate":
        judge = StubJudgeProvider()
    if independent is None and advanced:
        independent = StubIndependentProvider()
    return execute_system_one(
        repo=repo or StubRepo(),
        emulator=emulator,
        jev=jev,
        judge=judge,
        independent=independent,
        envelope=make_envelope(mode, advanced),
    )


def persisted_timings(repo: StubRepo) -> dict:
    assert len(repo.created) == 1
    return repo.created[0].payload["provenance"]["timings"]


def assert_timing_shape(timings: dict, expected_keys: set[str]) -> None:
    assert set(timings) == expected_keys
    for value in timings.values():
        assert isinstance(value, int)
        assert value >= 0


# --- Success paths: exact key sets per mode ------------------------------------


def test_emulator_mode_success_records_validation_and_emulator_timings():
    repo = StubRepo()

    asyncio.run(run(mode="emulator", repo=repo))

    assert_timing_shape(
        persisted_timings(repo), {"request_validation_ms", "emulator_ms"}
    )


def test_emulator_mode_advanced_adds_independent_timing():
    repo = StubRepo()

    asyncio.run(run(mode="emulator", advanced=True, repo=repo))

    assert_timing_shape(
        persisted_timings(repo),
        {"request_validation_ms", "emulator_ms", "independent_openai_ms"},
    )


def test_compare_mode_success_adds_jev_and_fidelity_timings():
    repo = StubRepo()

    asyncio.run(run(mode="compare", repo=repo))

    assert_timing_shape(
        persisted_timings(repo),
        {"request_validation_ms", "emulator_ms", "jev_ms", "fidelity_ms"},
    )


def test_evaluate_mode_success_adds_ai_judge_timing():
    repo = StubRepo()

    asyncio.run(run(mode="compare-and-evaluate", repo=repo))

    assert_timing_shape(
        persisted_timings(repo),
        {
            "request_validation_ms",
            "emulator_ms",
            "jev_ms",
            "fidelity_ms",
            "ai_judge_ms",
        },
    )


# --- §66 partial states: only what actually ran --------------------------------


def test_jev_failure_partial_has_jev_timing_but_no_fidelity_or_judge():
    repo = StubRepo()

    asyncio.run(
        run(
            mode="compare-and-evaluate",
            jev=StubProvider(error=JevProviderError(message="The JEV returned HTTP 500.", status=500)),
            repo=repo,
        )
    )

    assert repo.created[0].status == "completed"  # §66 partial, not a failure
    assert_timing_shape(
        persisted_timings(repo), {"request_validation_ms", "emulator_ms", "jev_ms"}
    )


def test_independent_failure_partial_keeps_independent_timing():
    repo = StubRepo()

    asyncio.run(
        run(
            mode="compare-and-evaluate",
            advanced=True,
            independent=StubIndependentProvider(
                error=IndependentOpenaiProviderError(message="The independent LLM prediction failed.")
            ),
            repo=repo,
        )
    )

    assert repo.created[0].status == "completed"
    assert_timing_shape(
        persisted_timings(repo),
        {
            "request_validation_ms",
            "emulator_ms",
            "jev_ms",
            "independent_openai_ms",
            "fidelity_ms",
            "ai_judge_ms",
        },
    )


def test_judge_failure_partial_keeps_ai_judge_timing():
    repo = StubRepo()

    asyncio.run(
        run(
            mode="compare-and-evaluate",
            judge=StubJudgeProvider(
                error=JudgeProviderError(message="The LLM Judge returned HTTP 503.", status=503)
            ),
            repo=repo,
        )
    )

    assert repo.created[0].status == "completed"
    assert_timing_shape(
        persisted_timings(repo),
        {
            "request_validation_ms",
            "emulator_ms",
            "jev_ms",
            "fidelity_ms",
            "ai_judge_ms",
        },
    )


# --- Failed snapshots: the wall time was really spent ---------------------------


def test_emulator_failure_in_emulator_mode_keeps_validation_and_emulator_timings():
    repo = StubRepo()

    with pytest.raises(EmulatorExecutionFailedError):
        asyncio.run(
            run(
                mode="emulator",
                emulator=StubProvider(
                    error=EmulatorProviderError(message="The emulator returned HTTP 500.", status=500)
                ),
                repo=repo,
            )
        )

    assert repo.created[0].status == "failed"
    assert_timing_shape(
        persisted_timings(repo), {"request_validation_ms", "emulator_ms"}
    )


def test_emulator_failure_in_compare_mode_keeps_both_provider_timings():
    # In compare mode the JEV ran CONCURRENTLY with the failing emulator, so
    # its wall time is real too — both provider keys ride on the snapshot.
    repo = StubRepo()

    with pytest.raises(EmulatorExecutionFailedError):
        asyncio.run(
            run(
                mode="compare",
                emulator=StubProvider(
                    error=EmulatorProviderError(message="The emulator returned HTTP 500.", status=500)
                ),
                repo=repo,
            )
        )

    assert repo.created[0].status == "failed"
    assert_timing_shape(
        persisted_timings(repo), {"request_validation_ms", "emulator_ms", "jev_ms"}
    )


def test_comparison_rejection_failed_snapshot_keeps_fidelity_timing():
    # Both providers succeeded but the comparison rejected the results: the
    # comparison ran and raised, so fidelity_ms is real and must persist.
    repo = StubRepo()

    with pytest.raises(InternalExecutionError):
        asyncio.run(run(mode="compare", jev=StubProvider(JEV_RESULT_MISSING_ANSWER), repo=repo))

    assert repo.created[0].status == "failed"
    assert_timing_shape(
        persisted_timings(repo),
        {"request_validation_ms", "emulator_ms", "jev_ms", "fidelity_ms"},
    )


@pytest.mark.parametrize("side", ["emulator", "jev"])
def test_provider_bug_keeps_the_crashing_side_timing(side: str):
    # An unexpected provider exception still spent wall time on that side;
    # the persisted failed snapshot carries every side that actually ran.
    repo = StubRepo()
    bug = StubProvider(error=RuntimeError("provider bug"))
    healthy = StubProvider(JEV_RESULT if side == "emulator" else RESULT)

    with pytest.raises(InternalExecutionError):
        asyncio.run(
            run(
                mode="compare",
                emulator=bug if side == "emulator" else healthy,
                jev=bug if side == "jev" else healthy,
                repo=repo,
            )
        )

    assert repo.created[0].status == "failed"
    assert_timing_shape(
        persisted_timings(repo), {"request_validation_ms", "emulator_ms", "jev_ms"}
    )


def test_independent_bug_keeps_independent_timing():
    repo = StubRepo()

    with pytest.raises(InternalExecutionError):
        asyncio.run(
            run(
                mode="emulator",
                advanced=True,
                independent=StubIndependentProvider(error=RuntimeError("independent bug")),
                repo=repo,
            )
        )

    assert repo.created[0].status == "failed"
    assert_timing_shape(
        persisted_timings(repo),
        {"request_validation_ms", "emulator_ms", "independent_openai_ms"},
    )


def test_independent_bug_in_evaluate_keeps_pre_p40_snapshot_shape_with_honest_timings():
    # P40/W1 regression pin (dual-review): in evaluate the independent bug is
    # only decided AFTER the comparison published and the judge ran, but the
    # persisted snapshot keeps the exact pre-P40 shape — failed, every side
    # recorded as observed, NO comparison, NO ai_evaluation — while
    # provenance.timings honestly carries the wall time actually spent
    # (§61.4: fidelity_ms for the comparison that ran, ai_judge_ms for the
    # concurrent judge). Hiding those keys would lie about real latency.
    repo = StubRepo()

    with pytest.raises(InternalExecutionError):
        asyncio.run(
            run(
                mode="compare-and-evaluate",
                advanced=True,
                independent=StubIndependentProvider(error=RuntimeError("independent bug")),
                repo=repo,
            )
        )

    execution = repo.created[0]
    payload = execution.payload
    assert execution.status == "failed"
    assert payload["emulator"]["status"] == "success"
    assert payload["jev"]["status"] == "success"
    assert payload["independent_openai"] == {"status": "failed", "error": "unexpected provider error"}
    assert "comparison" not in payload
    assert "ai_evaluation" not in payload
    assert_timing_shape(
        payload["provenance"]["timings"],
        {
            "request_validation_ms",
            "emulator_ms",
            "jev_ms",
            "independent_openai_ms",
            "fidelity_ms",
            "ai_judge_ms",
        },
    )


def test_judge_unexpected_exception_keeps_ai_judge_timing():
    repo = StubRepo()

    with pytest.raises(InternalExecutionError):
        asyncio.run(
            run(
                mode="compare-and-evaluate",
                judge=StubJudgeProvider(error=RuntimeError("judge bug")),
                repo=repo,
            )
        )

    assert repo.created[0].status == "failed"
    assert_timing_shape(
        persisted_timings(repo),
        {
            "request_validation_ms",
            "emulator_ms",
            "jev_ms",
            "fidelity_ms",
            "ai_judge_ms",
        },
    )


# --- Per-provider timing, not whole-gather timing -------------------------------


def test_sleeping_provider_yields_at_least_its_sleep_in_ms():
    repo = StubRepo()

    asyncio.run(run(mode="emulator", emulator=StubProvider(RESULT, delay=0.02), repo=repo))

    timings = persisted_timings(repo)
    assert timings["emulator_ms"] >= 20


def test_parallel_providers_are_timed_individually_not_as_the_gather():
    # The emulator sleeps 80ms while the JEV sleeps only 20ms inside the same
    # §65 gather: timing the whole gather would report >= 80 for BOTH sides.
    repo = StubRepo()

    asyncio.run(
        run(
            mode="compare",
            emulator=StubProvider(RESULT, delay=0.08),
            jev=StubProvider(JEV_RESULT, delay=0.02),
            repo=repo,
        )
    )

    timings = persisted_timings(repo)
    assert timings["emulator_ms"] >= 80
    assert timings["jev_ms"] < 80


# --- Old snapshots keep working (§47: no invented fields) ----------------------


def test_from_payload_keeps_old_snapshots_without_provenance_verbatim():
    # Snapshots persisted before timings existed carry no provenance at all;
    # reading them back must not crash and must not invent any keys.
    payload = {
        "execution_id": "run_legacy",
        "created_at": "2026-09-21T12:00:00+00:00",
        "request_hash": "sha256:abc",
        "mode": "emulator",
        "status": "completed",
        "request": REQUEST,
        "emulator": {"status": "success", "model": "jev-emulator", "result": {}},
    }

    execution = Execution.from_payload(
        payload=payload,
        question_count=2,
        overall_fidelity=None,
        aligned_questions=None,
        semantic_divergence=None,
        duration_ms=42,
    )

    assert execution.execution_id == "run_legacy"
    assert "provenance" not in execution.payload


def test_create_without_timings_invents_no_timing_keys():
    execution = Execution.create(
        execution_id="run_plain",
        created_at=datetime(2026, 9, 21, 12, 0, tzinfo=UTC),
        request=REQUEST,
        mode="emulator",
        status="completed",
        payload={"emulator": {"status": "success", "model": "jev-emulator", "result": {}}},
        duration_ms=10,
    )

    assert execution.payload["provenance"] == {"providers": [], "versions": {}, "timings": {}}
