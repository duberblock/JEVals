from __future__ import annotations

from urllib.parse import urlparse

import httpx
from pydantic import ValidationError

from app.domain.executions.jev import JevProviderError
from app.domain.executions.models import JsonObject
from app.schemas.system_one_result import SystemOneResult

JEV_TIMEOUT_SECONDS = 60.0
SYSTEM_ONE_ENDPOINT = "/v1/systemone"
# vendor/types.ts: the client resolves `model` itself (defaultModel option,
# TYPESAFE_DEFAULT_MODEL env, then this SDK fallback) because the WIRE body is
# SystemOneRequestPayload — the request with `model` REQUIRED, even though the
# canonical request carries it as optional ("omitted values inherit
# defaultModel"). The live typesafe API rejects a model-less body with 422.
DEFAULT_JEV_MODEL = "jev-latest"


class JevClient:
    """httpx client for the real JEV (Typesafe API) provider (plan §12).

    Authenticates every call with `Authorization: Bearer {api_key}`. The key
    is used only for the request header: it is never logged, never included
    in errors, and never persisted. The response parses through the SAME
    oracle-exact SystemOneResult mirror the emulator uses — both providers
    speak the identical wire contract per the vendored SDK. ONE
    httpx.AsyncClient is built in __init__ and reused for every call
    (fix-forward F10) — the FastAPI lifespan closes it on shutdown via
    `aclose`.

    Single-loop assumption (dual-review F9): the shared AsyncClient assumes
    it serves ONE event loop for its whole life (uvicorn prod and the
    TestClient lifespan portal each qualify). Multi-loop tests pass only
    because they inject httpx.MockTransport, which performs no I/O and keeps
    no loop-bound state; see app/providers/emulator.py for the full note.
    """

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str,
        timeout: float = JEV_TIMEOUT_SECONDS,
        model: str = DEFAULT_JEV_MODEL,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        # The same explicit-endpoint convention as the emulator: a full URL
        # ending in /v1/systemone is POSTed VERBATIM (the user chose the
        # endpoint by pasting it); a bare base gets the path appended.
        path = urlparse(self.base_url).path.rstrip("/")
        self._target = self.base_url if path.endswith("/v1/systemone") else self.base_url + SYSTEM_ONE_ENDPOINT
        self._client = httpx.AsyncClient(
            timeout=timeout,
            transport=transport,
            headers={"Authorization": f"Bearer {self.api_key}"},
        )

    async def execute(self, request: JsonObject) -> SystemOneResult:
        # vendor/types.ts: POST /v1/systemone takes SystemOneRequestPayload —
        # the request with `model` resolved (required on the wire). An absent,
        # None, or empty model inherits this client's default; an explicit
        # override is forwarded untouched. All other request properties are
        # forwarded as-is, exactly as the SDK forwards them.
        payload: JsonObject = dict(request)
        if not payload.get("model"):
            payload["model"] = self.model
        try:
            response = await self._client.post(self._target, json=payload)
        except httpx.TimeoutException as error:
            raise JevProviderError(
                message="The JEV did not respond within the timeout."
            ) from error
        except httpx.HTTPError as error:
            raise JevProviderError(message="The JEV could not be reached.") from error
        if not response.is_success:
            raise JevProviderError(
                message=f"The JEV returned HTTP {response.status_code}.",
                status=response.status_code,
            )
        try:
            return SystemOneResult.model_validate(response.json())
        except (ValidationError, ValueError) as error:
            raise JevProviderError(
                message="The JEV returned an unparsable result.",
                status=response.status_code,
            ) from error

    async def aclose(self) -> None:
        await self._client.aclose()
