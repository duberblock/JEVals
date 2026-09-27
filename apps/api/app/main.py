from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from starlette.exceptions import HTTPException
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.dependencies import (
    get_emulator_provider,
    get_independent_openai_provider,
    get_jev_provider,
    get_judge_provider,
    reset_provider_caches,
)
from app.api.routes import capabilities, executions, health, ready, validations
from app.core.logging import configure_logging, new_trace_id
from app.core.problems import problem_response
from app.core.security import BasicAuthMiddleware
from app.domain.requests.detection import sanitize_problem_errors

configure_logging()
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_: FastAPI) -> AsyncIterator[None]:
    """Fix-forward F10: close the shared provider clients on shutdown.

    The provider factories are per-process singletons whose clients are
    built once; after closing them the factories are cleared so a later
    startup (e.g. TestClient reuse in tests, or a process manager restart)
    builds fresh clients instead of reusing dead ones.
    """
    yield
    for factory in (
        get_emulator_provider,
        get_jev_provider,
        get_independent_openai_provider,
        get_judge_provider,
    ):
        provider = factory()
        if provider is not None:
            await provider.aclose()
    reset_provider_caches()


app = FastAPI(title="jevals Playground API", lifespan=lifespan)


class TraceIdMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        trace_id = new_trace_id()
        request.state.trace_id = trace_id
        logger.info("request started %s %s", request.method, request.url.path)
        return await call_next(request)


EXECUTIONS_PATH = "/api/v1/executions"


class NoStoreCacheMiddleware(BaseHTTPMiddleware):
    """Plan §13: execution responses must never be cached.

    Scoped to the executions router's paths only, and applied to EVERY
    response they produce — success and problem paths alike, including the
    401s rejected by auth and the 404 problems raised beyond the route
    handler. The one exception is the unhandled-exception 500: Starlette
    runs that handler in ServerErrorMiddleware, OUTSIDE this middleware, so
    the header is set there instead (see unhandled_exception_handler).
    /health, /ready and /capabilities stay cacheable.

    P28 (FB1): the SSE lane negotiates its own stream-safe directives
    (no-cache, no-transform) on the response it returns — setdefault keeps
    §13's no-store as the default for every response that did not choose
    its own Cache-Control (all of them, before streaming existed).
    """

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path == EXECUTIONS_PATH or path.startswith(f"{EXECUTIONS_PATH}/"):
            response.headers.setdefault("Cache-Control", "no-store")
        return response


app.add_middleware(BasicAuthMiddleware)
app.add_middleware(TraceIdMiddleware)
app.add_middleware(NoStoreCacheMiddleware)

app.include_router(health.router)
app.include_router(ready.router)
app.include_router(capabilities.router)
app.include_router(executions.router)
app.include_router(validations.router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    return problem_response(
        request,
        status=422,
        title="Validation Error",
        detail="The request payload does not match the expected contract.",
        problem_type="validation-error",
        # Sanitized before encoding: no mirror union branch tags in locs, no
        # raw payload echo (the 'input' key) in the published errors[].
        extra={"errors": jsonable_encoder(sanitize_problem_errors(exc.errors()))},
    )


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    status = exc.status_code
    title = "Not Found" if status == 404 else "HTTP Error"
    problem_type = "not-found" if status == 404 else "http-error"
    return problem_response(
        request,
        status=status,
        title=title,
        detail=str(exc.detail),
        problem_type=problem_type,
        headers=exc.headers,
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    trace_id = getattr(request.state, "trace_id", None)
    logger.exception("unhandled exception trace_id=%s", trace_id)
    # This handler runs in ServerErrorMiddleware, outside NoStoreCacheMiddleware,
    # so the §13 no-store rule for executions must be applied here as well.
    headers = {}
    path = request.url.path
    if path == EXECUTIONS_PATH or path.startswith(f"{EXECUTIONS_PATH}/"):
        headers["Cache-Control"] = "no-store"
    return problem_response(
        request,
        status=500,
        title="Internal Server Error",
        detail="An unexpected error occurred.",
        problem_type="internal-server-error",
        headers=headers or None,
    )
