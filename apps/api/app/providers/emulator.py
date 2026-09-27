from __future__ import annotations

from urllib.parse import urlparse

import httpx
from pydantic import ValidationError

from app.domain.executions.emulator import EmulatorProviderError
from app.domain.executions.models import JsonObject
from app.schemas.system_one_result import SystemOneResult

EMULATOR_TIMEOUT_SECONDS = 60.0
SYSTEM_ONE_ENDPOINT = "/v1/systemone"
CLASSIFIER_ENDPOINT = "/v1/classifier"

# When the endpoint turns out to speak the Simple Jev classifier protocol
# (https://simple-jev.featherless.ai/ — an open-source structured-decision
# classifier sharing the same choice/score/noul question taxonomy), a model
# is REQUIRED; this default serves the pasted-demo-URL case with zero
# configuration.
DEFAULT_CLASSIFIER_MODEL = "featherless-ai/Qwen3.6-35B-A3B-classifier"

# The SystemOneResult contract forbids extras per answer, so classifier
# answers are reduced to exactly the keys each type allows.
_CLASSIFIER_ANSWER_KEYS = {
    "noul": {"type", "noul"},
    "choice": {"type", "choice", "confidence", "probabilities"},
    "score": {"type", "score", "confidence", "legend", "probabilities"},
}


def _classifier_payload(request: JsonObject, default_model: str | None) -> JsonObject:
    """Map a SystemOneRequest onto the Simple Jev classifier request."""
    if "state" not in request or "questions" not in request:
        raise EmulatorProviderError(
            message="The emulator request needs 'state' and 'questions'."
        )
    # Simple Jev REQUIRES `instructions` on every question; the SystemOne
    # contract allows omitting them (the canonical sample does for its noul
    # and score questions). A default derived from the question's name
    # fills the gap without touching the caller's request.
    questions: JsonObject = {}
    raw_questions = request["questions"]
    if isinstance(raw_questions, dict):
        for name, question in raw_questions.items():
            if isinstance(question, dict):
                copied = dict(question)
                if not copied.get("instructions"):
                    copied["instructions"] = f"Answer the question '{name}'."
                questions[name] = copied
            else:
                questions[name] = question
    return {
        "model": (
            request["model"]
            if isinstance(request.get("model"), str) and request["model"]
            else (default_model or DEFAULT_CLASSIFIER_MODEL)
        ),
        "state": request["state"],
        "questions": questions,
    }


def _parse_result(body: object) -> SystemOneResult:
    """Parse either contract: a strict SystemOneResult first, the Simple Jev
    classifier mapping second — gateways may serve either shape on either
    path (the public demo answers /v1/systemone with classifier semantics
    and classifier-shaped bodies)."""
    try:
        return SystemOneResult.model_validate(body)
    except (ValidationError, ValueError):
        return _result_from_classifier(body)


def _result_from_classifier(data: object) -> SystemOneResult:
    """Map the classifier response onto the SystemOneResult contract."""
    if not isinstance(data, dict):
        raise EmulatorProviderError(message="The emulator returned an unparsable result.")
    answers_raw = data.get("answers")
    if not isinstance(answers_raw, dict) or not answers_raw:
        raise EmulatorProviderError(message="The emulator returned an unparsable result.")
    answers: dict[str, JsonObject] = {}
    for name, answer in answers_raw.items():
        if not isinstance(answer, dict):
            raise EmulatorProviderError(message="The emulator returned an unparsable result.")
        answer_type = answer.get("type")
        allowed = _CLASSIFIER_ANSWER_KEYS.get(answer_type) if isinstance(answer_type, str) else None
        if allowed is None or not allowed.issubset(answer):
            raise EmulatorProviderError(message="The emulator returned an unparsable result.")
        answers[name] = {key: answer[key] for key in allowed}
    usage_raw = data.get("usage")
    usage = usage_raw if isinstance(usage_raw, dict) else {}
    model = data.get("model")
    return SystemOneResult.model_validate(
        {
            "model": model if isinstance(model, str) and model else DEFAULT_CLASSIFIER_MODEL,
            "answers": answers,
            "usage": {
                "input_tokens": usage.get("input_tokens", 0) or 0,
                "output_tokens": usage.get("output_tokens", 0) or 0,
            },
        }
    )


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
