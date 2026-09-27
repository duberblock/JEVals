from __future__ import annotations

import secrets
from collections.abc import Mapping
from typing import Any

from fastapi import Request
from fastapi.responses import JSONResponse

from app.core.logging import get_trace_id

PROBLEM_BASE = "https://jevals.local/problems"


def problem_body(
    request: Request | None,
    *,
    status: int,
    title: str,
    detail: str,
    problem_type: str,
    extra: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Build the RFC 7807 problem document shared by every transport.

    P28: the SSE lane serializes this same body into its terminal `error`
    frames (byte-shape parity with the JSON lane's problems), so the builder
    is split from the JSONResponse wrapper. `request` is Optional only for
    transports that never see one (direct generator tests); production calls
    always pass the live request.
    """
    body: dict[str, Any] = {
        "type": f"{PROBLEM_BASE}/{problem_type}",
        "title": title,
        "status": status,
        "detail": detail,
        "instance": str(request.url.path) if request is not None else "",
        "trace_id": get_trace_id()
        or (getattr(request.state, "trace_id", None) if request is not None else None),
        "ref": secrets.randbelow(900000) + 100000,
    }
    if extra:
        body.update(extra)
    return body


def problem_response(
    request: Request,
    *,
    status: int,
    title: str,
    detail: str,
    problem_type: str,
    headers: Mapping[str, str] | None = None,
    extra: dict[str, Any] | None = None,
) -> JSONResponse:
    body = problem_body(
        request,
        status=status,
        title=title,
        detail=detail,
        problem_type=problem_type,
        extra=extra,
    )
    return JSONResponse(body, status_code=status, media_type="application/problem+json", headers=headers)
