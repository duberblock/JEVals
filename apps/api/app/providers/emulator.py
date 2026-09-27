from __future__ import annotations

import httpx
from pydantic import ValidationError

from app.domain.executions.emulator import EmulatorProviderError
from app.domain.executions.models import JsonObject
from app.schemas.system_one_result import SystemOneResult

EMULATOR_TIMEOUT_SECONDS = 60.0
SYSTEM_ONE_ENDPOINT = "/v1/systemone"


class EmulatorClient:
    """httpx client for the emulator provider (plan §12: an integration).

    The emulator needs no authentication, so this client carries no secrets.
    ONE httpx.AsyncClient is built in __init__ and reused for every call
    (fix-forward F10) — the FastAPI lifespan closes it on shutdown via
    `aclose`. Errors surface as EmulatorProviderError with status/message
    only — response bodies are never propagated.

    Single-loop assumption (dual-review F9): the shared AsyncClient assumes
    it serves ONE event loop for its whole life. Production (uvicorn) runs a
    single loop per process, and TestClient's lifespan portal serves every
    request through one loop too, so both are safe. Multi-loop tests still
    pass because they inject httpx.MockTransport, which performs no I/O and
    keeps no loop-bound state (an empty connection pool never binds the
    client to the first loop); a real transport across loops would not be.
    """

    def __init__(
        self,
        base_url: str,
        *,
        api_key: str | None = None,
        default_model: str | None = None,
        timeout: float = EMULATOR_TIMEOUT_SECONDS,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.default_model = default_model
        headers = {}
        if api_key:
            # Optional when the emulator deployment requires auth; the key
            # lives only in this header, never in logs or errors.
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(
            base_url=self.base_url, timeout=timeout, transport=transport, headers=headers
        )

    async def execute(self, request: JsonObject) -> SystemOneResult:
        payload = dict(request)
        if not payload.get("model") and self.default_model:
            # The effective configuration's model fills an absent request
            # model on the FORWARD payload only — the persisted snapshot
            # keeps the request exactly as it arrived.
            payload["model"] = self.default_model
        try:
            response = await self._client.post(SYSTEM_ONE_ENDPOINT, json=payload)
        except httpx.TimeoutException as error:
            raise EmulatorProviderError(
                message="The emulator did not respond within the timeout."
            ) from error
        except httpx.HTTPError as error:
            raise EmulatorProviderError(message="The emulator could not be reached.") from error
        if not response.is_success:
            raise EmulatorProviderError(
                message=f"The emulator returned HTTP {response.status_code}.",
                status=response.status_code,
            )
        try:
            return SystemOneResult.model_validate(response.json())
        except (ValidationError, ValueError) as error:
            raise EmulatorProviderError(
                message="The emulator returned an unparsable result.",
                status=response.status_code,
            ) from error

    async def aclose(self) -> None:
        await self._client.aclose()
