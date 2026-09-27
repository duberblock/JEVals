from __future__ import annotations

import asyncio
import json
import logging
import time
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.encoders import jsonable_encoder
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import ValidationError

from app.api.dependencies import (
    get_emulator_provider,
    get_execution_repository,
    get_independent_openai_provider,
    get_jev_provider,
    get_judge_provider,
)
from app.application.execute_system_one import (
    EmulatorExecutionFailedError,
    EmulatorNotConfiguredError,
    InternalExecutionError,
    JevNotConfiguredError,
    PreparedExecution,
    SectionEvent,
    LlmNotConfiguredError,
    execute_system_one,
    prepare_execution,
)
from app.application.get_execution import get_execution
from app.application.list_executions import DEFAULT_LIMIT, MAX_LIMIT, list_executions as list_execution_page
from app.core.problems import problem_body, problem_response
from app.domain.executions.emulator import EmulatorProvider
from app.domain.executions.independent_openai import IndependentOpenaiProvider
from app.domain.executions.jev import JevProvider
from app.domain.executions.judge import JudgeProvider
from app.domain.executions.models import operational_status
from app.domain.executions.repository import ExecutionRepository, InvalidExecutionCursor
from app.domain.requests.detection import sanitize_problem_errors
from app.domain.requests.models import RequestContractError
from app.schemas.execution_request import ExecutionRequestEnvelope

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/v1/executions", tags=["executions"])

SSE_MEDIA_TYPE = "text/event-stream"

# Keep-alive cadence (dual-review hardening): mid-run silences are REAL
# (judge timeout 120s, independent retry budget 300s), and an idle-timeout
# intermediary (nginx-style 60s) would cut a silent stream — losing the
# feature exactly where it matters, on slow runs. The cadence emits SSE
# comment frames (": keep-alive"), which every consumer ignores by contract;
# it never delays a real frame (any resolved future wins the wait) and never
# trails the stream (terminal frames end it).
SSE_KEEPALIVE_SECONDS = 15.0
SSE_KEEPALIVE_FRAME = ": keep-alive\n\n"


# --- P28 (FB1): the SSE transport ---------------------------------------------
#
# Content negotiation on the run POST: an Accept header carrying
# text/event-stream streams §65 section events as they resolve and closes
# with ONE terminal frame — `final` carrying the complete §64 envelope for
# every run that is 201/completed today (§66 partials included), or `error`
# carrying the RFC 7807 problem the JSON lane builds for post-provider
# failures. Everything else keeps the single-shot JSON envelope,
# byte-identical.

# §50 (ADR-003 ruling 1): strong references to in-flight streaming runs. A
# client disconnect cancels the SSE generator, never the shielded run — this
# set keeps the orphaned task alive on the event loop until it finishes
# persisting its immutable snapshot (evidence must not be lost).
_STREAMING_RUNS: set[asyncio.Task[Any]] = set()


def _wants_event_stream(request: Request) -> bool:
    """P28 content negotiation: only an explicit text/event-stream in Accept
    opts into the stream; a missing header or application/json keeps today's
    JSON contract untouched (scripts/smoke_live.py sends Accept:
    application/json and must keep parsing pure JSON)."""
    return SSE_MEDIA_TYPE in (request.headers.get("accept") or "")


def _sse_frame(event: str, data: Any) -> str:
    """One SSE frame: `event:` line, single `data:` line, blank separator.
    Compact separators mirror FastAPI's JSON encoding of the JSON lane."""
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
    return f"event: {event}\ndata: {payload}\n\n"


def _section_frame(event: SectionEvent) -> str:
    return _sse_frame("section", {"section": event.section, "status": event.status, "payload": event.payload})


def _pre_execution_problem(request: Request, error: Exception) -> JSONResponse:
    """The RFC 7807 problem for a failure BEFORE any provider ran (nothing
    persisted). Single mapping shared by the JSON lane and the SSE pre-flight
    so both transports answer identical problems and neither opens a stream
    for them. The problem_type literals stay in keyword form — the contracts
    catalog test scans app/ for exactly this shape (ADR-006 Decision 3)."""
    if isinstance(error, RequestContractError):
        # R17 fix-forward consumed by STEP 4: the domain's canonical §7 copy
        # (title + detail) reaches HTTP clients verbatim.
        return problem_response(
            request,
            status=422,
            title=error.title,
            detail=error.detail,
            problem_type="invalid-system-one-request",
        )
    if isinstance(error, LlmNotConfiguredError):
        # Configuration precondition (evaluate mode or advanced independent
        # without LLM configured), ADR-003 ruling 4 pattern: nothing was
        # persisted because no run ever started.
        return problem_response(
            request,
            status=503,
            title="LLM Not Configured",
            detail=error.detail,
            problem_type="llm-not-configured",
        )
    if isinstance(error, EmulatorNotConfiguredError):
        return problem_response(
            request,
            status=503,
            title="Emulator Not Configured",
            detail=error.detail,
            problem_type="emulator-not-configured",
        )
    if isinstance(error, JevNotConfiguredError):
        return problem_response(
            request,
            status=503,
            title="JEV Not Configured",
            detail=error.detail,
            problem_type="jev-not-configured",
        )
    raise AssertionError(f"unmapped pre-execution error: {error!r}")


async def stream_execution_events(
    *,
    repo: ExecutionRepository,
    emulator: EmulatorProvider | None,
    jev: JevProvider | None,
    judge: JudgeProvider | None,
    independent: IndependentOpenaiProvider | None,
    envelope: ExecutionRequestEnvelope,
    request: Request | None = None,
    prepared: PreparedExecution | None = None,
) -> AsyncIterator[str]:
    """Yield the SSE frames of one execution run (§50: ONE code path).

    The SAME execute_system_one that serves the JSON lane runs here, with a
    subscriber relaying its section events onto an unbounded FIFO queue — so
    frames reach the wire in the run's REAL completion order and the persisted
    snapshot is byte-identical across transports. Terminal frames: `final`
    (exactly execution.payload) for completed runs, `error` (the problem the
    JSON lane builds for 502/500) otherwise — never both.

    Client disconnect: the generator is cancelled where it awaits, the run is
    shielded (§50 — provider work completes, snapshot persists) and no frames
    are yielded after the disconnect.
    """
    queue: asyncio.Queue[SectionEvent] = asyncio.Queue()

    async def on_section(event: SectionEvent) -> None:
        # Unbounded FIFO: put_nowait can never block or drop, so the run's
        # publication order is preserved verbatim for the consumer.
        queue.put_nowait(event)

    run_prepared = (
        prepared
        if prepared is not None
        else prepare_execution(
            emulator=emulator, jev=jev, judge=judge, independent=independent, envelope=envelope
        )
    )
    task = asyncio.create_task(
        execute_system_one(
            repo=repo,
            emulator=emulator,
            jev=jev,
            judge=judge,
            independent=independent,
            envelope=envelope,
            prepared=run_prepared,
            on_section=on_section,
        )
    )
    _STREAMING_RUNS.add(task)
    task.add_done_callback(_STREAMING_RUNS.discard)

    # §50: the shield — a consumer disconnect cancels at most the shield
    # wrapper; the run task itself keeps going to persistence.
    shielded: asyncio.Future[Any] = asyncio.ensure_future(asyncio.shield(task))
    getter: asyncio.Future[SectionEvent] | None = None
    last_frame_at = time.monotonic()
    try:
        while True:
            # The pending getter SURVIVES keep-alive yields: re-creating it
            # each iteration would leave an orphaned queue.get() holding a
            # published event forever (a lost frame).
            if getter is None:
                getter = asyncio.ensure_future(queue.get())
            # Wait at most until the next keep-alive deadline: a section or
            # the run's completion always wins (FIRST_COMPLETED); the timeout
            # only fires on true silence.
            timeout = max(0.0, SSE_KEEPALIVE_SECONDS - (time.monotonic() - last_frame_at))
            done, _ = await asyncio.wait(
                {shielded, getter}, timeout=timeout, return_when=asyncio.FIRST_COMPLETED
            )
            if getter.done() and not getter.cancelled():
                yield _section_frame(getter.result())
                getter = None
                last_frame_at = time.monotonic()
            if shielded.done():
                break
            if not done:
                # Neither the run nor a section resolved within the cadence:
                # a comment frame keeps the connection observably alive.
                yield SSE_KEEPALIVE_FRAME
                last_frame_at = time.monotonic()
    finally:
        # Disconnect or normal exit: stop the pending queue read and the
        # shield wrapper — NEVER the run task itself (§50: evidence first).
        if getter is not None and not getter.done():
            getter.cancel()
        if not shielded.done():
            shielded.cancel()

    # The run task is done here, so every event it published is already
    # queued (publications happen strictly before completion): drain the
    # remaining section frames in order, then exactly one terminal frame.
    while not queue.empty():
        yield _section_frame(queue.get_nowait())
    try:
        execution = await asyncio.shield(task)
    except EmulatorExecutionFailedError as error:
        # §66 partial failure: the failed run was persisted and stays
        # inspectable through its execution_id — the frame mirrors the JSON
        # lane's 502 problem shape verbatim.
        yield _sse_frame(
            "error",
            problem_body(
                request,
                status=502,
                title="Emulator Unavailable",
                detail=str(error),
                problem_type="emulator-unavailable",
                extra={"execution_id": error.execution_id},
            ),
        )
        return
    except InternalExecutionError as error:
        # Post-provider failure (comparison rejection or provider bug): the
        # failed run was persisted FIRST and stays inspectable through its
        # execution_id. The detail stays generic — comparison internals and
        # crash details are never echoed to clients.
        yield _sse_frame(
            "error",
            problem_body(
                request,
                status=500,
                title="Internal Server Error",
                detail="An unexpected error occurred.",
                problem_type="internal-server-error",
                extra={"execution_id": error.execution_id},
            ),
        )
        return
    except (RequestContractError, LlmNotConfiguredError, EmulatorNotConfiguredError, JevNotConfiguredError) as error:
        # The route pre-flight answers these BEFORE any stream opens; kept as
        # a defensive terminal so a stream can never end without one. The
        # frame reuses the JSON lane's problem document itself (decoded from
        # the JSONResponse body — one source of truth, byte-shape parity).
        if request is not None:
            problem_bytes = bytes(_pre_execution_problem(request, error).body)
            yield _sse_frame("error", json.loads(problem_bytes))
            return
        yield _sse_frame(
            "error",
            problem_body(
                request,
                status=500,
                title="Internal Server Error",
                detail="An unexpected error occurred.",
                problem_type="internal-server-error",
            ),
        )
        return
    except Exception:
        # Mirrors the app's unhandled_exception_handler: log server-side,
        # answer with the generic 500 problem — internals never reach clients.
        logger.exception("streaming execution failed unexpectedly")
        yield _sse_frame(
            "error",
            problem_body(
                request,
                status=500,
                title="Internal Server Error",
                detail="An unexpected error occurred.",
                problem_type="internal-server-error",
            ),
        )
        return
    yield _sse_frame("final", execution.payload)


@router.post("", status_code=201)
async def create_execution(
    request: Request,
    repo: Annotated[ExecutionRepository, Depends(get_execution_repository)],
    emulator: Annotated[EmulatorProvider | None, Depends(get_emulator_provider)],
    jev: Annotated[JevProvider | None, Depends(get_jev_provider)],
    judge: Annotated[JudgeProvider | None, Depends(get_judge_provider)],
    independent: Annotated[IndependentOpenaiProvider | None, Depends(get_independent_openai_provider)],
):
    """Create an execution from a §64 envelope (§65 order; all modes).

    The body is parsed as raw JSON here so invalid JSON yields a 400 problem
    instead of FastAPI's 422; the envelope's own shape is then validated and
    failures are routed through the same sanitized 422 problem used by the
    RequestValidationError handler. The response is 201 Created carrying the
    very snapshot payload served by GET /api/v1/executions/{id}, so the web
    can reuse either document — including every §66 partial state.

    P28 (FB1): when the request negotiates text/event-stream via Accept, the
    SAME run is served as a 201 SSE stream (section events as the §65 legs
    resolve, then one terminal final/error frame). Pre-stream failures
    (invalid JSON 400, invalid envelope 422, configuration preconditions 503)
    still answer their RFC 7807 JSON problems — no stream is opened.
    """
    try:
        raw = await request.json()
    except ValueError:
        # json.JSONDecodeError (and UnicodeDecodeError) are ValueErrors.
        return problem_response(
            request,
            status=400,
            title="Invalid JSON",
            detail="The request body is not valid JSON.",
            problem_type="invalid-json",
        )
    try:
        envelope = ExecutionRequestEnvelope.model_validate(raw)
    except ValidationError as error:
        return problem_response(
            request,
            status=422,
            title="Validation Error",
            detail="The request payload does not match the expected contract.",
            problem_type="validation-error",
            # Sanitized before encoding: no mirror union branch tags in locs,
            # no raw payload echo (the 'input' key) in the published errors[].
            extra={"errors": jsonable_encoder(sanitize_problem_errors(error.errors()))},
        )
    if _wants_event_stream(request):
        # Pre-flight step 1 + configuration preconditions BEFORE the stream
        # opens, so 422/503 problems keep their JSON transport (and their
        # nothing-was-persisted semantics, ADR-003 ruling 4).
        try:
            prepared = prepare_execution(
                emulator=emulator,
                jev=jev,
                judge=judge,
                independent=independent,
                envelope=envelope,
            )
        except (
            RequestContractError,
            LlmNotConfiguredError,
            EmulatorNotConfiguredError,
            JevNotConfiguredError,
        ) as error:
            return _pre_execution_problem(request, error)
        return StreamingResponse(
            stream_execution_events(
                repo=repo,
                emulator=emulator,
                jev=jev,
                judge=judge,
                independent=independent,
                envelope=envelope,
                request=request,
                prepared=prepared,
            ),
            status_code=201,
            media_type=SSE_MEDIA_TYPE,
            # Stream-safe directives replace the §13 no-store default on this
            # lane only: no caching, and no intermediary re-encoding of the
            # incremental frames.
            headers={"cache-control": "no-cache, no-transform"},
        )
    try:
        execution = await execute_system_one(
            repo=repo,
            emulator=emulator,
            jev=jev,
            judge=judge,
            independent=independent,
            envelope=envelope,
        )
    except RequestContractError as error:
        return _pre_execution_problem(request, error)
    except LlmNotConfiguredError as error:
        return _pre_execution_problem(request, error)
    except EmulatorNotConfiguredError as error:
        return _pre_execution_problem(request, error)
    except JevNotConfiguredError as error:
        return _pre_execution_problem(request, error)
    except EmulatorExecutionFailedError as error:
        # §66 partial failure: the failed run was persisted and stays
        # inspectable through its execution_id.
        return problem_response(
            request,
            status=502,
            title="Emulator Unavailable",
            detail=str(error),
            problem_type="emulator-unavailable",
            extra={"execution_id": error.execution_id},
        )
    except InternalExecutionError as error:
        # Post-provider failure (comparison rejection or provider bug): the
        # failed run was persisted FIRST and stays inspectable through its
        # execution_id. The detail stays generic — comparison internals and
        # crash details are never echoed to clients.
        return problem_response(
            request,
            status=500,
            title="Internal Server Error",
            detail="An unexpected error occurred.",
            problem_type="internal-server-error",
            extra={"execution_id": error.execution_id},
        )
    return execution.payload


@router.get("")
def list_executions(
    request: Request,
    repo: Annotated[ExecutionRepository, Depends(get_execution_repository)],
    limit: Annotated[int, Query(ge=1, le=MAX_LIMIT)] = DEFAULT_LIMIT,
    cursor: str | None = None,
    request_hash: str | None = None,
    status: str | None = None,
) -> dict[str, Any]:
    try:
        page = list_execution_page(repo, limit=limit, cursor=cursor, request_hash=request_hash, status=status)
    except InvalidExecutionCursor:
        # Problem branches return the RFC 7807 JSONResponse directly; the
        # dict annotation above describes the success body for OpenAPI.
        return problem_response(  # type: ignore[return-value]
            request,
            status=400,
            title="Invalid Cursor",
            detail="The pagination cursor is malformed or no longer valid.",
            problem_type="invalid-cursor",
        )
    return {
        "items": [_summary(item.execution) for item in page.items],
        "next_cursor": page.next_cursor,
    }


@router.get("/{execution_id}")
def get_execution_detail(
    execution_id: str,
    repo: Annotated[ExecutionRepository, Depends(get_execution_repository)],
) -> dict[str, Any]:
    execution = get_execution(repo, execution_id)
    if execution is None:
        raise HTTPException(status_code=404, detail="Execution not found.")
    return execution.payload


def _summary(execution) -> dict[str, Any]:
    return {
        "execution_id": execution.execution_id,
        "created_at": execution.created_at.isoformat(),
        "request_hash": execution.request_hash,
        "mode": execution.mode,
        "status": execution.status,
        # §66 single-sourced operational VIEW classification: the web renders
        # it verbatim and never re-derives partial from fidelity nulls. The
        # persisted status column stays completed|failed.
        "operational_status": operational_status(execution.status, execution.payload),
        "question_count": execution.question_count,
        "overall_fidelity": execution.overall_fidelity,
        "aligned_questions": execution.aligned_questions,
        "semantic_divergence": execution.semantic_divergence,
        "duration_ms": execution.duration_ms,
    }
