from __future__ import annotations

import asyncio
import logging
import time
from collections.abc import Awaitable, Callable, Coroutine
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, TypeVar, cast
from uuid import uuid4

from app.domain.executions.emulator import EmulatorProvider, EmulatorProviderError
from app.domain.executions.fidelity import FidelityComparisonError, compare_system_one_results
from app.domain.executions.independent_alignment import (
    IndependentAlignmentError,
    compute_independent_alignment,
)
from app.domain.executions.independent_openai import (
    IndependentOpenaiPrediction,
    IndependentOpenaiProvider,
    IndependentOpenaiProviderError,
)
from app.domain.executions.jev import JevProvider, JevProviderError
from app.domain.executions.judge import JudgeOutcome, JudgeProvider, JudgeProviderError
from app.domain.executions.models import Execution, JsonObject
from app.domain.executions.repository import ExecutionRepository
from app.domain.requests.detection import validate_and_detect
from app.domain.requests.models import RequestDetection
from app.schemas.execution_request import ExecutionRequestEnvelope
from app.schemas.system_one_result import SystemOneResult

logger = logging.getLogger(__name__)

# Sentinel distinguishing "section absent" from "section present but failed"
# while assembling §66 partial payloads (None is a valid failed section).
_MISSING = object()

T = TypeVar("T")
E = TypeVar("E", bound=Exception)


# --- P28 (FB1): progressive section events -----------------------------------
#
# ONE code path serves both transports (§50/ADR-003 ruling 1): the JSON lane
# runs the use case with the default no-op subscriber, the SSE lane passes an
# async subscriber that receives each section as its outcome resolves. The
# section builders, _build_execution and repo.create stay single-sourced, so
# the persisted snapshot is byte-identical for the same provider outcomes
# whichever transport requested the run.

# SSE section names: snapshot keys independent_openai/ai_evaluation surface as
# independent/judge on the wire (§47 keys stay untouched in the envelope).
@dataclass(frozen=True)
class SectionEvent:
    """One observed section outcome, published the moment it is final.

    `status` is the section's own status field ('success'|'failed') and
    `payload` is EXACTLY the section JSON that lands in the persisted
    snapshot — never a preview, never a re-derivation (§63: never invent
    states).
    """

    section: str
    status: str
    payload: JsonObject


SectionSubscriber = Callable[[SectionEvent], Awaitable[None]]


async def _no_sections(_: SectionEvent) -> None:
    """Default subscriber: the JSON transport ignores progress events."""
    return None


@dataclass(frozen=True)
class PreparedExecution:
    """The pre-provider phase of a run (§65 step 1), shared by both transports.

    P28: the route pre-flights this BEFORE opening an SSE stream so that
    invalid JSON (400), invalid envelopes (422) and configuration
    preconditions (503) still answer their RFC 7807 JSON problems with no
    stream ever opened — exactly the JSON lane's behavior. `timings` carries
    request_validation_ms so the §61.4 timing is computed exactly once.
    """

    detection: RequestDetection
    timings: dict[str, int]
    evaluate_mode: bool
    independent_enabled: bool


def prepare_execution(
    *,
    emulator: EmulatorProvider | None,
    jev: JevProvider | None,
    judge: JudgeProvider | None,
    independent: IndependentOpenaiProvider | None,
    envelope: ExecutionRequestEnvelope,
) -> PreparedExecution:
    """Validate the request and evaluate config preconditions (no providers).

    Raises the SAME exceptions execute_system_one raises before any run
    exists — RequestContractError (422) and the three NotConfigured errors
    (503): nothing is persisted for any of them (ADR-003 ruling 4).
    """
    # §61.4: per-component wall-clock timings accumulated across the run and
    # merged into provenance.timings on every snapshot persisted for it.
    timings: dict[str, int] = {}
    # §65 step 1: validate the canonical request (domain owns the contract).
    validation_started = time.perf_counter()
    detection = validate_and_detect(envelope.system_one)
    timings["request_validation_ms"] = _elapsed_ms(validation_started)

    evaluate_mode = envelope.mode == "compare-and-evaluate"
    independent_enabled = (
        envelope.advanced is not None and envelope.advanced.independent_openai_prediction
    )

    # Preconditions before any provider call (nothing persisted for any).
    if evaluate_mode and judge is None:
        raise LlmNotConfiguredError()
    if independent_enabled and independent is None:
        raise LlmNotConfiguredError()
    if emulator is None:
        raise EmulatorNotConfiguredError()
    if envelope.mode in ("compare", "compare-and-evaluate") and jev is None:
        raise JevNotConfiguredError()
    return PreparedExecution(
        detection=detection,
        timings=timings,
        evaluate_mode=evaluate_mode,
        independent_enabled=independent_enabled,
    )


async def _timed(coro: Coroutine[Any, Any, T], timings: dict[str, int], key: str) -> T:
    """Await `coro`, recording its wall-clock duration (ms) in `timings[key]`.

    §61.4 is a latency view, not a success view: the timing is recorded even
    when the coroutine raises (the wall time was really spent), and the
    exception propagates unchanged so gather(return_exceptions=True) and the
    Judge handlers keep seeing exactly what the provider raised. Wrapping
    each coroutine individually — never the whole gather — keeps the §65
    parallel providers timed per provider.
    """
    started = time.perf_counter()
    try:
        return await coro
    finally:
        timings[key] = _elapsed_ms(started)


def _elapsed_ms(started: float) -> int:
    """Whole milliseconds elapsed since a perf_counter start; never negative."""
    return max(0, int((time.perf_counter() - started) * 1000))


async def _capture_outcome(coro: Coroutine[Any, Any, T]) -> Any:
    """Await one leg and return its outcome, exceptions included.

    gather(return_exceptions=True) parity for a single coroutine — with one
    deliberate divergence: a CancelledError raised by the awaited code itself
    propagates instead of being captured as an outcome (gather would capture
    even a spontaneous one). Real task cancellation must never be mistaken
    for a provider outcome, so the run aborts without a snapshot; no
    declared provider cancels itself (asyncio.timeout/httpx raise
    TimeoutError, which IS captured).
    """
    try:
        return await coro
    except asyncio.CancelledError:
        raise
    except BaseException as exc:  # noqa: BLE001 — outcome narrowing is the point
        return exc


async def _observing_leg(
    coro: Coroutine[Any, Any, T],
    *,
    subscriber: SectionSubscriber,
    section: str,
    timings: dict[str, int],
    key: str,
    error_type: type[E],
) -> Any:
    """Run one §65 parallel leg, publishing its observed section on completion.

    P28 (FB1): the emulator and JEV sections depend only on their own
    outcomes, so each publishes the moment its leg resolves — the stream
    reflects REAL completion order, never a faked sequence. The published
    payload is the exact _observed_section the snapshot persists (§50/§63).
    """
    outcome = await _capture_outcome(_timed(coro, timings, key))
    payload = _observed_section(
        outcome,
        # _observed_section only reads .message; every declared provider
        # error carries it, so the generic E narrows safely here.
        cast(
            "EmulatorProviderError | JevProviderError | None",
            _provider_error(outcome, error_type),
        ),
        _unexpected_exception(outcome, error_type),
    )
    await subscriber(SectionEvent(section=section, status=cast(str, payload["status"]), payload=payload))
    return outcome


class LlmNotConfiguredError(Exception):
    """No LLM provider is configured (Settings or environment), so an LLM
    branch cannot run."""

    def __init__(self) -> None:
        detail = (
            "The LLM integration is not configured. Configure the Judge and "
            "Independent providers in Settings (or the OPENAI_* environment "
            "variables) to run LLM executions."
        )
        super().__init__(detail)
        self.detail = detail


class EmulatorNotConfiguredError(Exception):
    """No emulator endpoint is configured (Settings or environment), so
    executions cannot run."""

    def __init__(self) -> None:
        detail = (
            "The emulator is not configured. Set an endpoint on the Emulator "
            "card in Settings (or EMULATOR_URL) to run emulator executions."
        )
        super().__init__(detail)
        self.detail = detail


class JevNotConfiguredError(Exception):
    """No JEV baseline is configured (Settings or environment), so compare
    executions cannot run."""

    def __init__(self) -> None:
        detail = (
            "The JEV is not configured. Set an API key on the JEV Reference "
            "card in Settings (or TYPESAFE_API_KEY) to run compare executions."
        )
        super().__init__(detail)
        self.detail = detail


class EmulatorExecutionFailedError(Exception):
    """The emulator provider failed; a failed execution snapshot was persisted."""

    def __init__(self, *, execution_id: str, message: str, status: int | None) -> None:
        detail = f"{message} Execution '{execution_id}' was persisted with status 'failed'."
        super().__init__(detail)
        self.execution_id = execution_id
        self.message = message
        self.status = status


class InternalExecutionError(Exception):
    """A run was persisted as failed after an unexpected internal failure.

    Covers the post-provider failure paths (revised ADR-003/004 ruling,
    dual-review B2): the deterministic comparison rejecting otherwise-valid
    provider results, and a provider bug (unexpected exception inside the
    gather — emulator, JEV, independent, or Judge). The snapshot records the
    provider sections as observed and NO comparison/evaluation from the
    failing step; the HTTP problem stays generic — internal details are
    never echoed to clients, only the execution_id so the evidence stays
    reachable.
    """

    def __init__(self, *, execution_id: str) -> None:
        super().__init__(f"Execution '{execution_id}' was persisted with status 'failed'.")
        self.execution_id = execution_id


async def execute_system_one(
    *,
    repo: ExecutionRepository,
    emulator: EmulatorProvider | None,
    jev: JevProvider | None,
    judge: JudgeProvider | None,
    independent: IndependentOpenaiProvider | None,
    envelope: ExecutionRequestEnvelope,
    prepared: PreparedExecution | None = None,
    on_section: SectionSubscriber | None = None,
) -> Execution:
    """Execute a §64 envelope per the §65 order (all three modes + advanced).

    Step 1 (parse + validate) splits across the boundary: the route parses the
    body and validates the envelope shape; this use case validates the
    canonical SystemOneRequest through the domain (`validate_and_detect`,
    ADR-002) before any provider runs. Configuration preconditions (503) raise
    BEFORE a run exists — nothing is persisted for them (ADR-003 ruling 4,
    extended by ADR-004 ruling 8: LLM preconditions fire before the emulator
    and JEV ones). Every run that reaches a provider persists an immutable
    Execution snapshot before returning.

    §65 order: emulator + JEV-if-required + independent-if-enabled run in
    PARALLEL; fidelity follows the emulator+JEV pair WITHOUT waiting for the
    independent leg (P40); the Judge runs last — concurrent with the
    independent leg — and only in evaluate mode with a comparison available,
    never seeing the independent prediction (§11).

    P28 (FB1) transport hooks, both optional and default-inert so every
    existing caller keeps byte-identical behavior: `prepared` reuses a route
    pre-flight (prepare_execution) instead of re-running step 1 — the §61.4
    request_validation_ms is computed exactly once — and `on_section` receives
    each section event as its outcome resolves. The subscriber must not raise;
    it can never influence the run: sections, snapshot and persistence are
    decided before it is called.
    """
    subscriber = on_section if on_section is not None else _no_sections
    run = (
        prepared
        if prepared is not None
        else prepare_execution(
            emulator=emulator, jev=jev, judge=judge, independent=independent, envelope=envelope
        )
    )
    timings = run.timings
    detection = run.detection
    evaluate_mode = run.evaluate_mode
    independent_enabled = run.independent_enabled

    execution_id = f"run_{uuid4().hex}"
    created_at = datetime.now(UTC)
    request = _as_object(envelope.system_one)
    independent_provider = independent if independent_enabled else None
    # prepare_execution (or the passed pre-flight) proved the emulator and —
    # for compare modes — the JEV are configured; narrow for the helpers.
    configured_emulator = cast(EmulatorProvider, emulator)

    if envelope.mode == "emulator":
        return await _execute_emulator(
            repo=repo,
            emulator=configured_emulator,
            independent=independent_provider,
            detection=detection,
            request=request,
            execution_id=execution_id,
            created_at=created_at,
            timings=timings,
            on_section=subscriber,
        )
    return await _execute_compare(
        repo=repo,
        emulator=configured_emulator,
        # The JevNotConfiguredError precondition above guarantees jev is set
        # for both compare modes (the only modes reaching this call).
        jev=cast(JevProvider, jev),
        judge=judge if evaluate_mode else None,
        independent=independent_provider,
        detection=detection,
        request=request,
        execution_id=execution_id,
        created_at=created_at,
        timings=timings,
        on_section=subscriber,
    )


async def _execute_emulator(
    *,
    repo: ExecutionRepository,
    emulator: EmulatorProvider,
    independent: IndependentOpenaiProvider | None,
    detection: RequestDetection,
    request: JsonObject,
    execution_id: str,
    created_at: datetime,
    timings: dict[str, int],
    on_section: SectionSubscriber,
) -> Execution:
    """Emulator mode: §65 parallel phase = emulator (+ independent if enabled)."""
    started = time.perf_counter()
    # Heterogeneous gather: outcomes mix SystemOneResult, IndependentOpenaiPrediction,
    # and exceptions, and are narrowed at runtime via the helpers below. The
    # emulator leg publishes its observed section the moment it resolves (P28);
    # the independent leg's section is only final after the parallel phase (its
    # alignment needs the emulator outcome), so it publishes post-gather below.
    coros: list[Coroutine[Any, Any, Any]] = [
        _observing_leg(
            emulator.execute(request),
            subscriber=on_section,
            section="emulator",
            timings=timings,
            key="emulator_ms",
            error_type=EmulatorProviderError,
        )
    ]
    if independent is not None:
        coros.append(
            _capture_outcome(_timed(independent.execute(request), timings, "independent_openai_ms"))
        )
    outcomes: list[Any] = await asyncio.gather(*coros)
    duration_ms = int((time.perf_counter() - started) * 1000)

    emulator_outcome = outcomes[0]
    independent_outcome = outcomes[1] if independent is not None else None
    emulator_error = _provider_error(emulator_outcome, EmulatorProviderError)
    emulator_bug = _unexpected_exception(emulator_outcome, EmulatorProviderError)
    independent_bug = (
        _unexpected_exception(independent_outcome, IndependentOpenaiProviderError)
        if independent is not None
        else None
    )
    emulator_succeeded = emulator_error is None and emulator_bug is None
    # Built once from the observed outcomes: on failed runs the independent
    # evidence (result, run config, llm_attempts) still persists — with NO
    # alignment key, since alignment needs a successful emulator side.
    independent_section = (
        None
        if independent is None
        else _independent_section(
            independent_outcome,
            error=_provider_error(independent_outcome, IndependentOpenaiProviderError),
            bug=independent_bug,
            detection=detection,
            emulator_result=emulator_outcome if emulator_succeeded else None,
            jev_result=None,
        )
    )
    # P28: the independent section event carries the exact section JSON the
    # snapshot persists (§63) — including its run config and §45 evidence on
    # failure — and fires before any terminal outcome is decided.
    if independent_section is not None:
        await on_section(
            SectionEvent(
                section="independent",
                status=cast(str, independent_section["status"]),
                payload=independent_section,
            )
        )

    def sections(*, emulator_section: JsonObject) -> JsonObject:
        payload: JsonObject = {"emulator": emulator_section}
        if independent_section is not None:
            payload["independent_openai"] = independent_section
        return payload

    if emulator_bug is not None or independent_bug is not None:
        failed = _build_execution(
            execution_id=execution_id,
            created_at=created_at,
            request=request,
            mode="emulator",
            status="failed",
            payload=sections(
                emulator_section=_observed_section(emulator_outcome, emulator_error, emulator_bug),
            ),
            duration_ms=duration_ms,
            timings=timings,
        )
        repo.create(failed)
        _log_completion(failed)
        raise InternalExecutionError(execution_id=execution_id) from (emulator_bug or independent_bug)

    if emulator_error is not None:
        failed = _build_execution(
            execution_id=execution_id,
            created_at=created_at,
            request=request,
            mode="emulator",
            status="failed",
            payload=sections(emulator_section=_failed_section(emulator_error.message)),
            duration_ms=duration_ms,
            timings=timings,
        )
        repo.create(failed)
        _log_completion(failed)
        raise EmulatorExecutionFailedError(
            execution_id=execution_id, message=emulator_error.message, status=emulator_error.status
        ) from emulator_error

    payload = sections(emulator_section=_provider_section(emulator_outcome))
    completed = _build_execution(
        execution_id=execution_id,
        created_at=created_at,
        request=request,
        mode="emulator",
        status="completed",
        payload=payload,
        duration_ms=duration_ms,
        timings=timings,
    )
    persisted = repo.create(completed)
    _log_completion(persisted)
    return persisted


async def _execute_compare(
    *,
    repo: ExecutionRepository,
    emulator: EmulatorProvider,
    jev: JevProvider,
    judge: JudgeProvider | None,
    independent: IndependentOpenaiProvider | None,
    detection: RequestDetection,
    request: JsonObject,
    execution_id: str,
    created_at: datetime,
    timings: dict[str, int],
    on_section: SectionSubscriber,
) -> Execution:
    """Compare (and evaluate) modes: §65 steps 2-4.

    Step 2 — Emulator, JEV, and the independent prediction (when enabled)
    launch CONCURRENTLY, but only the emulator+JEV PAIR is gathered (P40):
    the comparison publishes the moment the pair resolves and never waits
    for the independent leg, which keeps flying as its own task. One
    provider's failure never cancels the others; the snapshot records each
    side as observed. Outcomes:

    - Provider bug (unexpected exception, any side) -> failed snapshot with
      the crashing side as 'unexpected provider error' + 500 carrying the
      execution_id (evidence persisted FIRST, ADR-003/004 ruling).
    - Emulator failed -> failed snapshot + 502 (the emulator result is the
      product's own prediction); the other sides are recorded as observed.
    - JEV failed -> §66 partial STATE: completed snapshot, jev section
      failed, NO comparison, NO ai_evaluation (both unavailable), 201.
    - Independent failed (any mode) -> §66 partial STATE: its section fails,
      everything else proceeds, 201.
    - Both provider sides ok but the comparison rejects them -> failed
      snapshot with the success sections and NO comparison, then 500.
    - Evaluate mode with a comparison -> §65 step 4 Judge: failure is a §66
      partial (ai_evaluation failed, semantic_divergence NULL, 201); an
      unexpected Judge exception persists the failed run first, then 500.

    P40 concurrency: the Judge starts right after the comparison publishes
    and runs CONCURRENT with the still-flying independent leg — never seeing
    it (§11) — while every terminal branch still awaits the independent
    evidence before persisting, exactly as before.
    """
    started = time.perf_counter()
    # Heterogeneous outcomes: same outcome-narrowing contract as
    # _execute_emulator. The emulator and JEV legs publish their observed
    # sections the moment they resolve, in REAL completion order (P28 —
    # never a faked sequence). The independent leg runs as its own task with
    # NO immediate publish: its section is only final once the pair outcomes
    # are available (alignment needs them), and P40 keeps it flying while
    # only the pair is gathered below.
    emulator_leg = _observing_leg(
        emulator.execute(request),
        subscriber=on_section,
        section="emulator",
        timings=timings,
        key="emulator_ms",
        error_type=EmulatorProviderError,
    )
    jev_leg = _observing_leg(
        jev.execute(request),
        subscriber=on_section,
        section="jev",
        timings=timings,
        key="jev_ms",
        error_type=JevProviderError,
    )
    independent_task: asyncio.Task[Any] | None = (
        asyncio.create_task(
            _capture_outcome(_timed(independent.execute(request), timings, "independent_openai_ms"))
        )
        if independent is not None
        else None
    )
    try:
        # P40: gather ONLY the pair — the comparison below no longer waits
        # for the independent leg (§65 de-hostaging).
        pair_outcomes = await asyncio.gather(emulator_leg, jev_leg)
    except asyncio.CancelledError:
        # Cancellation parity with the previous single gather: the in-flight
        # independent leg is cancelled too instead of being orphaned.
        if independent_task is not None:
            independent_task.cancel()
        raise
    emulator_outcome, jev_outcome = pair_outcomes[0], pair_outcomes[1]

    emulator_error = _provider_error(emulator_outcome, EmulatorProviderError)
    jev_error = _provider_error(jev_outcome, JevProviderError)
    emulator_bug = _unexpected_exception(emulator_outcome, EmulatorProviderError)
    jev_bug = _unexpected_exception(jev_outcome, JevProviderError)
    emulator_section = _observed_section(emulator_outcome, emulator_error, emulator_bug)
    jev_section = _observed_section(jev_outcome, jev_error, jev_bug)
    emulator_succeeded = emulator_error is None and emulator_bug is None
    jev_succeeded = jev_error is None and jev_bug is None

    async def independent_tail() -> tuple[JsonObject, BaseException | None]:
        """P40: await the independent leg, then build and publish its §47/§51
        section — possible only once BOTH its outcome resolved and the pair
        outcomes are available (alignment consumes them). Returns the built
        section plus the leg's unexpected exception, if any; the evidence is
        recorded as observed either way (§50)."""
        assert independent_task is not None  # created iff the leg exists
        outcome = await independent_task
        error = _provider_error(outcome, IndependentOpenaiProviderError)
        bug = _unexpected_exception(outcome, IndependentOpenaiProviderError)
        section = _independent_section(
            outcome,
            error=error,
            bug=bug,
            detection=detection,
            # Alignment runs only against sides that actually succeeded; on
            # failed runs the section keeps its evidence and omits alignment.
            emulator_result=emulator_outcome if emulator_succeeded else None,
            jev_result=jev_outcome if jev_succeeded else None,  # ruling 6: jev optional
        )
        await on_section(
            SectionEvent(
                section="independent",
                status=cast(str, section["status"]),
                payload=section,
            )
        )
        return section, bug

    def sections(
        independent_section: JsonObject | None,
        *,
        # Sentinel defaults (Any on purpose): None is a VALID failed section,
        # so _MISSING distinguishes "absent" from "present but failed".
        comparison: Any = _MISSING,
        ai_evaluation: Any = _MISSING,
    ) -> JsonObject:
        payload: JsonObject = {"emulator": emulator_section, "jev": jev_section}
        if independent_section is not None:
            payload["independent_openai"] = independent_section
        if comparison is not _MISSING:
            payload["comparison"] = comparison
        if ai_evaluation is not _MISSING:
            payload["ai_evaluation"] = ai_evaluation
        return payload

    if not (emulator_succeeded and jev_succeeded):
        # A pair leg did not succeed, so no comparison can ever run. The
        # terminal branch — and its snapshot — is only decided once the
        # independent evidence is on board: P40 awaits the leg here and
        # publishes its section as observed, exactly as the pre-P40 gather
        # did implicitly.
        if independent_task is not None:
            independent_section, independent_bug = await independent_tail()
        else:
            independent_section, independent_bug = None, None

        if emulator_bug is not None or jev_bug is not None or independent_bug is not None:
            # A provider bug outranks the expected-failure outcomes: it is the
            # loudest signal, and §66 still gets every side recorded as observed.
            failed = _build_execution(
                execution_id=execution_id,
                created_at=created_at,
                request=request,
                mode="compare" if judge is None else "compare-and-evaluate",
                status="failed",
                payload=sections(independent_section),
                duration_ms=int((time.perf_counter() - started) * 1000),
                timings=timings,
            )
            repo.create(failed)
            _log_completion(failed)
            raise InternalExecutionError(execution_id=execution_id) from (
                emulator_bug or jev_bug or independent_bug
            )

        # emulator_error is not None here (the bug branch above took every
        # unexpected exception; a healthy-but-failed pair leaves exactly one
        # declared failure, emulator or jev).
        if emulator_error is not None:
            failed = _build_execution(
                execution_id=execution_id,
                created_at=created_at,
                request=request,
                mode="compare" if judge is None else "compare-and-evaluate",
                status="failed",
                payload=sections(independent_section),
                duration_ms=int((time.perf_counter() - started) * 1000),
                timings=timings,
            )
            repo.create(failed)
            _log_completion(failed)
            raise EmulatorExecutionFailedError(
                execution_id=execution_id, message=emulator_error.message, status=emulator_error.status
            ) from emulator_error

        # jev_error is not None: §66 partial — fidelity AND ai_evaluation are
        # both unavailable; the independent section (when present) still
        # carries its evidence.
        partial = _build_execution(
            execution_id=execution_id,
            created_at=created_at,
            request=request,
            mode="compare" if judge is None else "compare-and-evaluate",
            status="completed",
            payload=sections(independent_section),
            duration_ms=int((time.perf_counter() - started) * 1000),
            timings=timings,
        )
        persisted = repo.create(partial)
        _log_completion(persisted)
        return persisted

    fidelity_started = time.perf_counter()
    try:
        comparison = compare_system_one_results(detection.request, emulator_outcome, jev_outcome)
    except FidelityComparisonError as error:
        # Both providers succeeded but the results cannot be compared: the
        # evidence (both sections as observed) is persisted BEFORE the error
        # surfaces, and the HTTP problem stays generic. The comparison ran and
        # raised, so its wall time is real (§61.4) and rides on the snapshot.
        timings["fidelity_ms"] = _elapsed_ms(fidelity_started)
        # P40: the terminal failed snapshot still waits for the independent
        # leg — its evidence publishes and persists as observed.
        independent_section = (await independent_tail())[0] if independent_task is not None else None
        failed = _build_execution(
            execution_id=execution_id,
            created_at=created_at,
            request=request,
            mode="compare" if judge is None else "compare-and-evaluate",
            status="failed",
            payload=sections(independent_section),
            duration_ms=int((time.perf_counter() - started) * 1000),
            timings=timings,
        )
        repo.create(failed)
        _log_completion(failed)
        raise InternalExecutionError(execution_id=execution_id) from error
    timings["fidelity_ms"] = _elapsed_ms(fidelity_started)

    comparison_payload = comparison.to_payload()
    # P28/P40: the comparison fires strictly after BOTH the emulator and JEV
    # succeeded (this point is reachable only then) — and never fires when
    # either failed, mirroring the snapshot. Since P40 it publishes the
    # moment the pair resolves, WITHOUT waiting for the independent leg.
    await on_section(
        SectionEvent(section="comparison", status="success", payload=comparison_payload)
    )

    if judge is None:
        # Compare mode: the independent section (when present) closes the
        # stream's sections, then the completed snapshot persists as before.
        independent_section = (await independent_tail())[0] if independent_task is not None else None
        completed = _build_execution(
            execution_id=execution_id,
            created_at=created_at,
            request=request,
            mode="compare",
            status="completed",
            payload=sections(independent_section, comparison=comparison_payload),
            overall_fidelity=comparison.overall_fidelity,
            aligned_questions=comparison.aligned_questions,
            duration_ms=int((time.perf_counter() - started) * 1000),
            timings=timings,
        )
        persisted = repo.create(completed)
        _log_completion(persisted)
        return persisted

    # §65 step 4 (P40): evaluate mode — the Judge starts right after the
    # comparison publishes and runs CONCURRENT with the still-flying
    # independent leg, on the original request + both results + the
    # deterministic comparison only (§11: it never sees the independent
    # prediction). _timed records ai_judge_ms even on failure (§61.4) and
    # re-raises, so both failure handlers below carry the wall time that was
    # really spent.

    async def judge_tail() -> JudgeOutcome | JudgeProviderError:
        """Run the Judge, publishing its section the moment it resolves —
        the failed §66 section included, exactly as persisted. An UNEXPECTED
        exception publishes nothing and propagates: the snapshot itself
        carries no ai_evaluation section, so no event may stream either
        (D6 parity — the terminal error frame speaks for the run)."""
        assert judge is not None  # the compare branch above returned already
        try:
            outcome = await _timed(
                judge.evaluate(request, emulator_outcome, jev_outcome, comparison_payload),
                timings,
                "ai_judge_ms",
            )
        except JudgeProviderError as error:
            judge_section = _failed_section(error.message)
            await on_section(
                SectionEvent(section="judge", status="failed", payload=judge_section)
            )
            return error
        judge_section = _judge_section(outcome)
        await on_section(SectionEvent(section="judge", status="success", payload=judge_section))
        return outcome

    independent_future: asyncio.Task[tuple[JsonObject, BaseException | None]] | None = (
        asyncio.create_task(independent_tail()) if independent_task is not None else None
    )
    judge_future: asyncio.Task[JudgeOutcome | JudgeProviderError] = asyncio.create_task(judge_tail())
    # Both tails are already flying concurrently; the awaits below only read
    # their results. The independent evidence is needed by EVERY terminal
    # branch, so it is awaited first — the judge outcome follows.
    independent_section, independent_bug = (
        await independent_future if independent_future is not None else (None, None)
    )
    judge_result: JudgeOutcome | JudgeProviderError | None = None
    judge_unexpected: BaseException | None = None
    try:
        judge_result = await judge_future
    except Exception as error:
        judge_unexpected = error

    if independent_bug is not None:
        # Bug-branch parity with pre-P40 (which decided this before the
        # comparison ran): an unexpected independent exception fails the run
        # even though the pair succeeded. The persisted snapshot keeps
        # today's shape — sections as observed and NO comparison key — even
        # though the comparison frame already streamed; the concurrently
        # computed judge outcome is dropped with it.
        failed = _build_execution(
            execution_id=execution_id,
            created_at=created_at,
            request=request,
            mode="compare-and-evaluate",
            status="failed",
            payload=sections(independent_section),
            duration_ms=int((time.perf_counter() - started) * 1000),
            timings=timings,
        )
        repo.create(failed)
        _log_completion(failed)
        raise InternalExecutionError(execution_id=execution_id) from independent_bug

    if judge_unexpected is not None:
        # Unexpected Judge exception: persist the failed run first (every
        # executed side as observed, no ai_evaluation), then surface a
        # generic 500 carrying the execution_id. D6 parity: NO judge section
        # event fired — the snapshot carries no ai_evaluation section, and
        # the terminal error frame speaks for the run.
        failed = _build_execution(
            execution_id=execution_id,
            created_at=created_at,
            request=request,
            mode="compare-and-evaluate",
            status="failed",
            payload=sections(independent_section, comparison=comparison_payload),
            overall_fidelity=comparison.overall_fidelity,
            aligned_questions=comparison.aligned_questions,
            duration_ms=int((time.perf_counter() - started) * 1000),
            timings=timings,
        )
        repo.create(failed)
        _log_completion(failed)
        raise InternalExecutionError(execution_id=execution_id) from judge_unexpected

    assert judge_result is not None  # only the unexpected branch above leaves None
    if isinstance(judge_result, JudgeProviderError):
        # §66 partial state: AI evaluation unavailable, run completes. P28:
        # the failed judge section was already streamed by the tail exactly
        # as it is persisted (rebuilt here deterministically) — the chip must
        # read the honest failure, never silence it.
        judge_section = _failed_section(judge_result.message)
        partial = _build_execution(
            execution_id=execution_id,
            created_at=created_at,
            request=request,
            mode="compare-and-evaluate",
            status="completed",
            payload=sections(
                independent_section,
                comparison=comparison_payload,
                ai_evaluation=judge_section,
            ),
            overall_fidelity=comparison.overall_fidelity,
            aligned_questions=comparison.aligned_questions,
            duration_ms=int((time.perf_counter() - started) * 1000),
            timings=timings,
        )
        persisted = repo.create(partial)
        _log_completion(persisted)
        return persisted

    completed = _build_execution(
        execution_id=execution_id,
        created_at=created_at,
        request=request,
        mode="compare-and-evaluate",
        status="completed",
        payload=sections(
            independent_section,
            comparison=comparison_payload,
            ai_evaluation=_judge_section(judge_result),
        ),
        overall_fidelity=comparison.overall_fidelity,
        aligned_questions=comparison.aligned_questions,
        semantic_divergence=judge_result.evaluation.overall.semantic_divergence,
        duration_ms=int((time.perf_counter() - started) * 1000),
        timings=timings,
    )
    persisted = repo.create(completed)
    _log_completion(persisted)
    return persisted


def _log_completion(execution: Execution) -> None:
    """§69: one structured INFO line per persisted execution, logged AFTER
    persistence (success and failed alike).

    Operational metadata only — never state, keys, Authorization, prompts,
    or model bodies (§52/§53). The trailing comparison field (dual-review
    F5) distinguishes §66 partials: `available` exactly when the persisted
    snapshot carries a comparison section; `unavailable` for emulator-mode
    lines and every failed/partial compare (the field is ALWAYS present so
    log consumers never branch on mode).
    """
    logger.info(
        "execution completed execution_id=%s mode=%s question_count=%s duration_ms=%s status=%s comparison=%s",
        execution.execution_id,
        execution.mode,
        execution.question_count,
        execution.duration_ms,
        execution.status,
        "available" if "comparison" in execution.payload else "unavailable",
    )


def _provider_error(outcome: object, error_type: type[E]) -> E | None:
    """Narrow a gather outcome to the provider's expected error type.

    Unexpected exceptions (provider bugs) return None here; the caller
    records them as 'unexpected provider error' sections and surfaces a
    persisted 500 (revised ADR-003/004 ruling) instead of re-raising before
    anything is persisted.
    """
    if isinstance(outcome, error_type):
        return outcome
    return None


def _unexpected_exception(outcome: object, error_type: type[Exception]) -> BaseException | None:
    """The gather outcome is an exception the provider does not declare.

    The provider's own error type is its DECLARED failure mode, so it is not
    a bug — only anything else raised by the call is.
    """
    if isinstance(outcome, BaseException) and not isinstance(outcome, error_type):
        return outcome
    return None


def _observed_section(
    outcome: object,
    error: EmulatorProviderError | JevProviderError | None,
    bug: BaseException | None,
) -> JsonObject:
    """The snapshot section for one provider, exactly as observed."""
    if error is not None:
        return _failed_section(error.message)
    if bug is not None:
        return _failed_section("unexpected provider error")
    # Neither the declared error nor a bug: the outcome is the success value.
    return _provider_section(cast(SystemOneResult, outcome))


def _provider_section(result: SystemOneResult) -> JsonObject:
    """Snapshot section per plan §47: status + model at the section level,
    the typed answers and usage inside `result`."""
    return {
        "status": "success",
        "model": result.model,
        "result": {
            "answers": {name: answer.model_dump() for name, answer in result.answers.items()},
            "usage": result.usage.model_dump(),
        },
    }


def _independent_section(
    outcome: object,
    *,
    error: IndependentOpenaiProviderError | None,
    bug: BaseException | None,
    detection: RequestDetection,
    emulator_result: SystemOneResult | None,
    jev_result: SystemOneResult | None,
) -> JsonObject:
    """The §47/§51 independent_openai section: prediction + alignment (ruling 6)
    + run config (ruling P22) + redacted llm_attempts evidence (§45).

    The alignment key appears only when the emulator side succeeded — it is
    never computed against a failed/absent side and never invented. An
    independent prediction that cannot be aligned against the request
    (missing/mistyped answers — shapes a well-behaved adapter cannot produce
    from this request's §68 schema) is treated as an §66 independent
    failure: the section fails loudly, everything else proceeds.

    A TERMINAL adapter failure (fix-forward F4) carries the paid run's
    evidence on the error — run_config plus provider-redacted llm_attempts
    and retry_reasons — which is persisted alongside the error message so a
    run that cost tokens never loses its §45 evidence. Pre-call failures
    carry none and keep the minimal failed section.
    """
    if error is not None:
        return _failed_independent_section(error)
    if bug is not None:
        return _failed_section("unexpected provider error")
    # Neither the declared error nor a bug: the outcome is the success value.
    prediction = cast(IndependentOpenaiPrediction, outcome)
    section: JsonObject = {
        "status": "success",
        "model": prediction.result.model,
        "result": {
            "answers": {
                name: answer.model_dump() for name, answer in prediction.result.answers.items()
            },
            "usage": prediction.result.usage.model_dump(),
        },
        "run_config": prediction.run_config,
        "llm_attempts": prediction.llm_attempts,
    }
    if emulator_result is not None:
        try:
            alignment = compute_independent_alignment(
                detection.request,
                independent=prediction.result,
                emulator=emulator_result,
                jev=jev_result,
            )
        except IndependentAlignmentError:
            return _failed_section(
                "The independent LLM prediction does not answer the request questions."
            )
        section["alignment"] = alignment.to_payload()
    return section


def _judge_section(outcome: JudgeOutcome) -> JsonObject:
    """The §47/§51 ai_evaluation section: the parsed §67 answer at the top
    plus the Full LLM Exchange evidence (exact input, output schema, raw
    response) — secrets are excluded by construction (§11-safe input, §45)."""
    return {
        "status": "success",
        "model": outcome.model,
        "overall": outcome.evaluation.overall.model_dump(),
        "questions": {
            name: question.model_dump() for name, question in outcome.evaluation.questions.items()
        },
        "evidence": {
            "input": outcome.judge_input,
            "output_schema": outcome.output_schema,
            "raw_response": outcome.raw_response,
            "system_instruction": outcome.system_instruction,
            "configuration": outcome.configuration,
        },
    }


def _failed_section(message: str) -> JsonObject:
    return {"status": "failed", "error": message}


def _failed_independent_section(error: IndependentOpenaiProviderError) -> JsonObject:
    """The §66 failed independent section, keeping a paid run's evidence (F4).

    A terminal adapter failure already spent tokens; the error carries the
    run's own run_config and the provider-redacted attempt traces, and they
    are persisted next to the error. Keys appear only when the provider
    actually produced them — pre-call failures stay minimal.
    """
    section: JsonObject = _failed_section(error.message)
    if error.run_config is not None:
        section["run_config"] = error.run_config
    if error.llm_attempts is not None:
        section["llm_attempts"] = error.llm_attempts
    if error.retry_reasons is not None:
        section["retry_reasons"] = error.retry_reasons
    return section


def _build_execution(
    *,
    execution_id: str,
    created_at: datetime,
    request: JsonObject,
    mode: str,
    status: str,
    payload: JsonObject,
    duration_ms: int,
    timings: dict[str, int],
    overall_fidelity: float | None = None,
    aligned_questions: int | None = None,
    semantic_divergence: str | None = None,
) -> Execution:
    # §61.4: merge the run's per-component wall-clock timings into the
    # payload's provenance. Only components that actually ran on this path
    # are present in `timings`; Execution.create backfills the remaining
    # provenance keys (providers/versions) per key.
    snapshot_payload = dict(payload)
    provenance = dict(snapshot_payload.get("provenance") or {})
    merged_timings = dict(provenance.get("timings") or {})
    merged_timings.update(timings)
    provenance["timings"] = merged_timings
    snapshot_payload["provenance"] = provenance
    return Execution.create(
        execution_id=execution_id,
        created_at=created_at,
        request=request,
        mode=mode,
        status=status,
        # duration_ms lives ONLY in runtime.duration_ms (§47); the domain field
        # below feeds the history summary, not the payload.
        payload=snapshot_payload,
        # semantic_divergence carries the Judge's overall verdict (STEP 6).
        overall_fidelity=overall_fidelity,
        aligned_questions=aligned_questions,
        semantic_divergence=semantic_divergence,
        duration_ms=duration_ms,
    )


def _as_object(system_one: Any) -> JsonObject:
    # validate_and_detect has already accepted the payload, which requires a
    # JSON object at its root.
    return system_one
