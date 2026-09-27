import asyncio

import httpx
import pytest

from app.api.dependencies import get_emulator_provider
from app.domain.executions.emulator import EmulatorProviderError
from app.providers.emulator import EmulatorClient
from app.schemas.system_one_result import ChoiceResult, NoulResult, ScoreResult, SystemOneResult

EMULATOR_RESULT = {
    "model": "jev-emulator",
    "answers": {
        "request_type": {
            "type": "choice",
            "choice": "billing",
            "confidence": 0.92,
            "probabilities": {"billing": 0.92, "technical": 0.08},
        },
        "urgency": {
            "type": "score",
            "score": 1.5,
            "confidence": 0.8,
            "legend": {"0": "low", "1": "medium", "2": "high"},
            "probabilities": {"0": 0.1, "1": 0.6, "2": 0.3},
        },
        "refund_requested": {"type": "noul", "noul": 0.87},
    },
    "usage": {"input_tokens": 120, "output_tokens": 45},
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


def client_with(transport: httpx.MockTransport) -> EmulatorClient:
    return EmulatorClient(base_url="https://emulator.test", transport=transport)


def test_execute_posts_system_one_to_the_emulator_endpoint():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=EMULATOR_RESULT)

    result = asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    assert len(captured) == 1
    assert captured[0].method == "POST"
    assert str(captured[0].url) == "https://emulator.test/v1/systemone"
    assert captured[0].read() == httpx.Request("POST", "https://emulator.test", json=REQUEST).read()
    assert result.model == "jev-emulator"
    assert isinstance(result.answers["request_type"], ChoiceResult)
    assert isinstance(result.answers["urgency"], ScoreResult)
    assert isinstance(result.answers["refund_requested"], NoulResult)


def test_non_2xx_response_raises_provider_error_with_status_and_no_body_leak():
    def handler(request: httpx.Request) -> httpx.Response:
        # The body may echo request content; it must never surface in errors.
        return httpx.Response(503, text="SECRET-INTERNAL-DETAILS")

    with pytest.raises(EmulatorProviderError) as excinfo:
        asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    assert excinfo.value.status == 503
    assert "503" in excinfo.value.message
    assert "SECRET-INTERNAL-DETAILS" not in excinfo.value.message


def test_timeout_raises_provider_error_without_status():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out")

    with pytest.raises(EmulatorProviderError) as excinfo:
        asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    assert excinfo.value.status is None
    assert "did not respond" in excinfo.value.message


def test_connection_failure_raises_provider_error_without_status():
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    with pytest.raises(EmulatorProviderError) as excinfo:
        asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    assert excinfo.value.status is None
    assert "could not be reached" in excinfo.value.message


def test_unparsable_success_body_raises_provider_error():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"model": 42, "answers": "nonsense"})

    with pytest.raises(EmulatorProviderError) as excinfo:
        asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    assert excinfo.value.status == 200


def test_provider_error_is_a_plain_safe_surface():
    error = EmulatorProviderError(message="The emulator returned HTTP 500.", status=500)

    assert error.message == "The emulator returned HTTP 500."
    assert error.status == 500
    assert str(error) == "The emulator returned HTTP 500."


def test_get_emulator_provider_returns_none_when_unconfigured(tmp_path, monkeypatch):
    # chdir isolates pydantic-settings' relative env_file resolution so a
    # developer's local .env cannot leak EMULATOR_URL into the test.
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("EMULATOR_URL", raising=False)

    assert get_emulator_provider() is None


def test_get_emulator_provider_builds_client_from_environment(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("EMULATOR_URL", "https://emulator.example/")

    provider = get_emulator_provider()

    assert isinstance(provider, EmulatorClient)
    assert provider.base_url == "https://emulator.example"
