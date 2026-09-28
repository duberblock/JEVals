from __future__ import annotations

import base64
import secrets
from collections.abc import Awaitable, Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import get_settings
from app.core.problems import problem_response

PUBLIC_PATHS = {"/health", "/ready"}


def _is_truthy(raw: str | None) -> bool:
    return (raw or "").strip().lower() in {"1", "true", "yes"}


class BasicAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next: Callable[[Request], Awaitable[Response]]) -> Response:
        if request.url.path in PUBLIC_PATHS:
            return await call_next(request)

        # Canonical Settings — the same source every other module reads.
        # This is what makes credentials in apps/api/.env (loaded by
        # pydantic-settings into Settings, never exported to the process
        # environment) actually reach the middleware.
        settings = get_settings()
        auth_user = settings.auth_user
        auth_pass = settings.auth_pass
        if not auth_user or not auth_pass:
            # AUTH_REQUIRED (deploy posture, ADR-005 R28 ruling): fail closed
            # when origin credentials are missing — the Docker network is not
            # an auth boundary. Unset/false keeps the dev pass-through
            # (scripts/dev.sh sets no credentials).
            if _is_truthy(settings.auth_required):
                return problem_response(
                    request,
                    status=401,
                    title="Unauthorized",
                    detail="Valid Basic Auth credentials are required.",
                    problem_type="unauthorized",
                    headers={"WWW-Authenticate": "Basic"},
                )
            return await call_next(request)

        authorization = request.headers.get("authorization", "")
        if self._authorized(authorization, auth_user, auth_pass):
            return await call_next(request)

        return problem_response(
            request,
            status=401,
            title="Unauthorized",
            detail="Valid Basic Auth credentials are required.",
            problem_type="unauthorized",
            headers={"WWW-Authenticate": "Basic"},
        )

    @staticmethod
    def _authorized(authorization: str, expected_user: str, expected_pass: str) -> bool:
        scheme, _, token = authorization.partition(" ")
        if scheme.lower() != "basic" or not token:
            return False
        try:
            decoded = base64.b64decode(token, validate=True).decode("utf-8")
        except Exception:
            return False
        user, sep, password = decoded.partition(":")
        if not sep:
            return False
        return secrets.compare_digest(user, expected_user) and secrets.compare_digest(password, expected_pass)
