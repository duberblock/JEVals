from __future__ import annotations

from urllib.parse import urlparse

import httpx
from pydantic import ValidationError

from app.domain.executions.emulator import EmulatorProviderError
from app.domain.executions.models import JsonObject
from app.providers.simple_jev import (
    DEFAULT_CLASSIFIER_MODEL,
    classifier_payload as _classifier_payload,
    result_from_classifier as _result_from_classifier,
)
from app.schemas.system_one_result import SystemOneResult

EMULATOR_TIMEOUT_SECONDS = 60.0
SYSTEM_ONE_ENDPOINT = "/v1/systemone"
CLASSIFIER_ENDPOINT = "/v1/classifier"

# The Simple Jev classifier translation is SHARED with the JEV client
# (app.providers.simple_jev) — both boxes accept both protocols.
def _parse_result(body: object) -> SystemOneResult:
    """Parse either contract: a strict SystemOneResult first, the Simple Jev
    classifier mapping second — gateways may serve either shape on either
    path (the public demo answers /v1/systemone with classifier semantics
    and classifier-shaped bodies)."""
    try:
        return SystemOneResult.model_validate(body)
    except (ValidationError, ValueError):
        return _result_from_classifier(body)


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
        # EXPLICIT beats implicit: a full endpoint URL (ending in
        # /v1/systemone or /v1/classifier) is POSTed VERBATIM — the user
        # chose the protocol by choosing the URL, no probing. A bare base
        # keeps the legacy behavior (systemone first, classifier fallback)
        # for environment-configured deployments.
        path = urlparse(self.base_url).path.rstrip("/")
        self._explicit_systemone = path.endswith("/v1/systemone")
        self._explicit_classifier = path.endswith("/v1/classifier")
        headers = {}
        if api_key:
            # Optional when the emulator deployment requires auth; the key
            # lives only in this header, never in logs or errors.
            headers["Authorization"] = f"Bearer {api_key}"
        self._client = httpx.AsyncClient(timeout=timeout, transport=transport, headers=headers)
        # Legacy bare-base mode posts these absolute targets.
        self._systemone_url = self.base_url + SYSTEM_ONE_ENDPOINT
        self._classifier_url = self.base_url + CLASSIFIER_ENDPOINT

    async def _post(self, target: str, payload: JsonObject) -> httpx.Response:
        try:
            return await self._client.post(target, json=payload)
        except httpx.TimeoutException as error:
            raise EmulatorProviderError(
                message="The emulator did not respond within the timeout."
            ) from error
        except httpx.HTTPError as error:
            raise EmulatorProviderError(message="The emulator could not be reached.") from error

    async def execute(self, request: JsonObject) -> SystemOneResult:
        payload = dict(request)
        if not payload.get("model") and self.default_model:
            # The effective configuration's model fills an absent request
            # model on the FORWARD payload only — the persisted snapshot
            # keeps the request exactly as it arrived.
            payload["model"] = self.default_model

        if self._explicit_systemone:
            response = await self._post(self.base_url, payload)
            if not response.is_success:
                raise EmulatorProviderError(
                    message=f"The emulator returned HTTP {response.status_code}.",
                    status=response.status_code,
                )
            return self._parse_success(response)

        if self._explicit_classifier:
            response = await self._post(
                self.base_url, _classifier_payload(request, self.default_model)
            )
            if not response.is_success:
                raise EmulatorProviderError(
                    message=f"The emulator returned HTTP {response.status_code}.",
                    status=response.status_code,
                )
            return self._parse_success(response)

        try:
            response = await self._client.post(self._systemone_url, json=payload)
        except httpx.TimeoutException as error:
            raise EmulatorProviderError(
                message="The emulator did not respond within the timeout."
            ) from error
        except httpx.HTTPError as error:
            raise EmulatorProviderError(message="The emulator could not be reached.") from error

        # A 404/400 means THIS ENDPOINT does not speak the systemone
        # contract as posted: it may be a Simple Jev classifier deployment
        # instead (paste-the-URL simplicity — no adapter, no protocol
        # ceremony; the public demo even answers /v1/systemone with
        # classifier semantics and "model required"). One translation hop;
        # any other verdict (auth, rate limit…) is final.
        if response.status_code in (400, 404):
            classifier_response = await self._post(
                self._classifier_url, _classifier_payload(request, self.default_model)
            )
            if not classifier_response.is_success:
                raise EmulatorProviderError(
                    message=f"The emulator returned HTTP {classifier_response.status_code}.",
                    status=classifier_response.status_code,
                )
            return self._parse_success(classifier_response)

        if not response.is_success:
            raise EmulatorProviderError(
                message=f"The emulator returned HTTP {response.status_code}.",
                status=response.status_code,
            )
        return self._parse_success(response)

    def _parse_success(self, response: httpx.Response) -> SystemOneResult:
        try:
            return _parse_result(response.json())
        except (ValidationError, ValueError, EmulatorProviderError) as error:
            raise EmulatorProviderError(
                message="The emulator returned an unparsable result.",
                status=response.status_code,
            ) from error

    async def aclose(self) -> None:
        await self._client.aclose()
