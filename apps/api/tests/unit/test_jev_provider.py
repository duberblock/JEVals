import asyncio
import json

import httpx
import pytest

from app.api.dependencies import get_jev_provider
from app.domain.executions.jev import JevProviderError
from app.providers.jev import JevClient
from app.schemas.system_one_result import ChoiceResult, NoulResult, ScoreResult

JEV_RESULT = {
    "model": "jev-latest",
    "answers": {
        "request_type": {
            "type": "choice",
            "choice": "billing",
            "confidence": 0.9,
            "probabilities": {"billing": 0.9, "technical": 0.1},
        },
        "urgency": {
            "type": "score",
            "score": 1.0,
            "confidence": 0.7,
            "legend": {"0": "low", "1": "medium", "2": "high"},
            "probabilities": {"0": 0.2, "1": 0.5, "2": 0.3},
        },
        "refund_requested": {"type": "noul", "noul": 0.75},
    },
    "usage": {"input_tokens": 200, "output_tokens": 60},
}

REQUEST = {
    "state": {"message": "I was charged twice on my invoice."},
    "questions": {
        "request_type": {
            "type": "choice",
            "criteria": {"billing": "Billing issue", "technical": "Technical issue"},
        },
        "urgency": {"type": "score", "criteria": ["low", "medium", "high"]},
        "refund_requested": {"type": "noul"},
    },
}


def client_with(transport: httpx.MockTransport) -> JevClient:
    return JevClient(base_url="https://api.typesafe.test", api_key="ts-secret-key", transport=transport)


def test_execute_posts_payload_with_model_resolved():
    # vendor/types.ts: the wire body is SystemOneRequestPayload — the request
    # with `model` REQUIRED. The canonical request omits it, so the client
    # must resolve the default (the live API 422s a model-less body).
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=JEV_RESULT)

    result = asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    expected_payload = {**REQUEST, "model": "jev-latest"}
    assert len(captured) == 1
    assert captured[0].method == "POST"
    assert str(captured[0].url) == "https://api.typesafe.test/v1/systemone"
    assert captured[0].headers["Authorization"] == "Bearer ts-secret-key"
    assert captured[0].read() == httpx.Request(
        "POST", "https://api.typesafe.test", json=expected_payload
    ).read()
    # The response parses through the SAME oracle-exact mirror as the emulator.
    assert result.model == "jev-latest"
    assert isinstance(result.answers["request_type"], ChoiceResult)
    assert isinstance(result.answers["urgency"], ScoreResult)
    assert isinstance(result.answers["refund_requested"], NoulResult)


def test_execute_forwards_explicit_model_override_untouched():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=JEV_RESULT)

    request_with_model = {**REQUEST, "model": "jev-beta"}
    asyncio.run(client_with(httpx.MockTransport(handler)).execute(request_with_model))

    sent = json.loads(captured[0].read())
    assert sent["model"] == "jev-beta"
    assert sent["state"] == REQUEST["state"]
    assert sent["questions"] == REQUEST["questions"]


def test_execute_resolves_default_model_for_null_or_empty_override():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=JEV_RESULT)

    asyncio.run(client_with(httpx.MockTransport(handler)).execute({**REQUEST, "model": None}))

    assert json.loads(captured[0].read())["model"] == "jev-latest"


def test_non_2xx_response_raises_provider_error_with_status_and_no_body_leak():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="invalid api key ts-secret-key")

    with pytest.raises(JevProviderError) as excinfo:
        asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    assert excinfo.value.status == 401
    assert "401" in excinfo.value.message
    # The API key must never surface in the error surface.
    assert "ts-secret-key" not in excinfo.value.message


def test_server_error_raises_provider_error_with_status():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(500, text="boom")

    with pytest.raises(JevProviderError) as excinfo:
        asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    assert excinfo.value.status == 500


def test_timeout_raises_provider_error_without_status():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out")

    with pytest.raises(JevProviderError) as excinfo:
        asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    assert excinfo.value.status is None
    assert "did not respond" in excinfo.value.message


def test_connection_failure_raises_provider_error_without_status():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    with pytest.raises(JevProviderError) as excinfo:
        asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    assert excinfo.value.status is None
    assert "could not be reached" in excinfo.value.message


def test_unparsable_success_body_raises_provider_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"model": 42, "answers": "nonsense"})

    with pytest.raises(JevProviderError) as excinfo:
        asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    assert excinfo.value.status == 200


def test_provider_error_is_a_plain_safe_surface():
    error = JevProviderError(message="The JEV returned HTTP 401.", status=401)

    assert error.message == "The JEV returned HTTP 401."
    assert error.status == 401
    assert str(error) == "The JEV returned HTTP 401."


def test_get_jev_provider_returns_none_when_api_key_unset(tmp_path, monkeypatch):
    # chdir isolates pydantic-settings' relative env_file resolution so a
    # developer's local .env cannot leak TYPESAFE_API_KEY into the test.
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)

    assert get_jev_provider() is None


def test_get_jev_provider_builds_client_from_environment(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts-env-key")
    monkeypatch.setenv("TYPESAFE_BASE_URL", "https://api.typesafe.example/")

    provider = get_jev_provider()

    assert isinstance(provider, JevClient)
    assert provider.base_url == "https://api.typesafe.example"
    assert provider.api_key == "ts-env-key"


def test_get_jev_provider_defaults_to_the_public_typesafe_api(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("TYPESAFE_API_KEY", "ts-env-key")
    monkeypatch.delenv("TYPESAFE_BASE_URL", raising=False)

    provider = get_jev_provider()

    assert provider.base_url == "https://api.typesafe.ai"


def test_a_full_systemone_url_posts_verbatim():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=JEV_RESULT)

    client = JevClient(
        base_url="https://jevs.example/v1/systemone",
        api_key="k",
        transport=httpx.MockTransport(handler),
    )
    asyncio.run(client.execute(REQUEST))

    assert len(captured) == 1
    assert str(captured[0].url) == "https://jevs.example/v1/systemone"
    # The wire body still resolves the model (required on the wire).
    assert json.loads(captured[0].read())["model"] == client.model


def test_a_full_classifier_url_speaks_the_simple_jev_contract():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(
            200,
            json={
                "model": "featherless-ai/Qwen3.6-35B-A3B-classifier",
                "answers": {
                    "q": {
                        "type": "choice",
                        "choice": "yes",
                        "confidence": 0.9,
                        "probabilities": {"yes": 0.9, "no": 0.1},
                        "extra": "stripped",
                    }
                },
                "usage": {"input_tokens": 7, "output_tokens": 1},
            },
        )

    request = {
        "state": "s",
        "questions": {"q": {"type": "choice", "criteria": {"yes": None, "no": None}}},
    }
    client = JevClient(
        base_url="https://simple-jev.example/v1/classifier",
        api_key="k",
        transport=httpx.MockTransport(handler),
    )
    result = asyncio.run(client.execute(request))

    assert len(captured) == 1
    assert str(captured[0].url) == "https://simple-jev.example/v1/classifier"
    body = json.loads(captured[0].read())
    # The client's resolved model feeds the REQUIRED classifier model, and
    # the missing instructions gain their name-derived default.
    assert body["model"] == client.model
    assert body["questions"]["q"]["instructions"] == "Answer the question 'q'."
    assert result.answers["q"].choice == "yes"
    assert result.usage.input_tokens == 7
