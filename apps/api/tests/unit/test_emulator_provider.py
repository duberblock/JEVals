import asyncio
import json

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


# --- Simple Jev classifier fallback ---------------------------------------------


def _classifier_reply() -> dict:
    return {
        "model": "featherless-ai/Qwen3.6-35B-A3B-classifier",
        "answers": {
            "q": {
                "type": "choice",
                "choice": "yes",
                "confidence": 0.91,
                "probabilities": {"yes": 0.91, "no": 0.09},
                "extra_upstream_field": "stripped",
            }
        },
        "usage": {"input_tokens": 42, "output_tokens": 1},
    }


def test_a_404_on_systemone_falls_back_to_the_classifier_protocol():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        if request.url.path == "/v1/systemone":
            return httpx.Response(404, json={"error": "not found"})
        return httpx.Response(200, json=_classifier_reply())

    result = asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    assert len(captured) == 2
    classifier_body = json.loads(captured[1].read())
    assert str(captured[1].url).endswith("/v1/classifier")
    # The classifier contract REQUIRES a model — the default fills an
    # unconfigured deployment (paste-the-URL simplicity).
    assert classifier_body["model"] == "featherless-ai/Qwen3.6-35B-A3B-classifier"
    assert classifier_body["state"] == REQUEST["state"]
    assert classifier_body["questions"] == REQUEST["questions"]
    # Extras stripped to the strict answer contract; usage mapped.
    assert result.answers["q"].model_dump() == {
        "type": "choice",
        "choice": "yes",
        "confidence": pytest.approx(0.91),
        "probabilities": {"yes": pytest.approx(0.91), "no": pytest.approx(0.09)},
    }
    assert result.usage.input_tokens == 42
    assert result.usage.output_tokens == 1


def test_a_configured_model_wins_as_the_classifier_default():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        if request.url.path == "/v1/systemone":
            return httpx.Response(404, json={})
        return httpx.Response(200, json=_classifier_reply())

    client = EmulatorClient(
        base_url="https://emulator.test",
        default_model="featherless-ai/Qwen3.8-27B-classifier",
        transport=httpx.MockTransport(handler),
    )
    asyncio.run(client.execute(REQUEST))

    assert json.loads(captured[1].read())["model"] == "featherless-ai/Qwen3.8-27B-classifier"


def test_classifier_rejection_surfaces_honestly_and_non_404_never_falls_back():
    captured: list[httpx.Request] = []

    def both_reject(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        if request.url.path == "/v1/systemone":
            return httpx.Response(404, json={})
        return httpx.Response(400, json={"error": {"message": "bad model"}})

    with pytest.raises(EmulatorProviderError) as excinfo:
        asyncio.run(client_with(httpx.MockTransport(both_reject)).execute(REQUEST))
    assert len(captured) == 2
    assert "HTTP 400" in str(excinfo.value)

    # A non-404 verdict on the systemone route is final — no probing.
    captured.clear()

    def unauthorized(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(401, json={})

    with pytest.raises(EmulatorProviderError):
        asyncio.run(client_with(httpx.MockTransport(unauthorized)).execute(REQUEST))
    assert len(captured) == 1


def test_a_400_on_systemone_escalates_too_and_either_body_shape_parses():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        if request.url.path == "/v1/systemone":
            # The public demo's actual behavior: the gateway answers the
            # systemone path with classifier semantics ("model required").
            return httpx.Response(400, json={"error": {"message": "The 'model' field is required."}})
        return httpx.Response(200, json=_classifier_reply())

    result = asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))

    assert len(captured) == 2
    assert str(captured[1].url).endswith("/v1/classifier")
    assert result.answers["q"].choice == "yes"


def test_a_classifier_shaped_body_on_the_systemone_path_still_parses():
    def handler(request: httpx.Request) -> httpx.Response:
        # Extra per-answer keys and no systemone envelope — the tolerant
        # parser maps the classifier shape wherever it arrives.
        return httpx.Response(200, json=_classifier_reply())

    result = asyncio.run(client_with(httpx.MockTransport(handler)).execute(REQUEST))
    assert result.model == "featherless-ai/Qwen3.6-35B-A3B-classifier"
    assert result.usage.input_tokens == 42


# --- Explicit full endpoint URLs -------------------------------------------------


def test_a_full_systemone_url_posts_verbatim_with_no_probing():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=EMULATOR_RESULT)

    client = EmulatorClient(
        base_url="https://jevs.example/v1/systemone",
        transport=httpx.MockTransport(handler),
    )
    result = asyncio.run(client.execute(REQUEST))

    assert len(captured) == 1
    assert str(captured[0].url) == "https://jevs.example/v1/systemone"
    assert result.model == EMULATOR_RESULT["model"]


def test_a_full_classifier_url_posts_verbatim_with_the_translated_payload():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(200, json=_classifier_reply())

    client = EmulatorClient(
        base_url="https://simple-jev.example/v1/classifier",
        transport=httpx.MockTransport(handler),
    )
    result = asyncio.run(client.execute(REQUEST))

    assert len(captured) == 1
    assert str(captured[0].url) == "https://simple-jev.example/v1/classifier"
    body = json.loads(captured[0].read())
    assert body["model"] == "featherless-ai/Qwen3.6-35B-A3B-classifier"
    assert result.answers["q"].choice == "yes"


def test_an_explicit_url_verdict_is_final():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(401, json={})

    client = EmulatorClient(
        base_url="https://jevs.example/v1/systemone",
        transport=httpx.MockTransport(handler),
    )
    with pytest.raises(EmulatorProviderError):
        asyncio.run(client.execute(REQUEST))
    assert len(captured) == 1
