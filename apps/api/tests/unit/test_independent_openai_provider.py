"""Independent provider: the pinned system-one-adapter behind our port.

Hermetic — api.openai.com is never called. Two seams keep it that way, mirroring
the adapter's own design ("the seam tests substitute to drive the client
without a network call" — its providers/base.py):

- `provider=` injects a fake AsyncProvider under the REAL adapter, so the
  full adapter pipeline (dynamic §68 schema, conversion, our constrained
  mirror) runs against canned LLM output.
- `adapter=` replaces the whole adapter, driving only OUR wrapper logic
  (degenerate-output guard, secret redaction).

Pinned rulings: P21 (the SERVER model wins — request.model never reaches the
LLM), P17/P22/P23 (run config + evidence), §45 (llm_attempts evidence,
secrets redacted).
"""

import asyncio
import json

import pytest

from app.api.dependencies import get_independent_openai_provider
from app.domain.executions.independent_openai import IndependentOpenaiProviderError
from app.providers.independent_openai import IndependentOpenaiClient
from app.schemas.system_one_result import ChoiceResult, NoulResult, ScoreResult
from system_one_adapter import AsyncSystemOneAdapterClient, Usage
from system_one_adapter._response import SystemOneResponse
from system_one_adapter.providers import Message, ProviderResult
from typesafe_sdk import NoulAnswer, TypeSafeError

REQUEST = {
    "state": {"message": "I was charged twice on my invoice."},
    "questions": {
        "request_type": {
            "type": "choice",
            "instructions": "Classify this request.",
            "criteria": {"billing": "Billing issue", "technical": "Technical issue"},
        },
        "urgency": {"type": "score", "criteria": ["low", "medium", "high"]},
        "refund_requested": {"type": "noul"},
    },
    # P21: a request-level model hint. The independent path must ignore it.
    "model": "jev-latest",
}

# The raw LLM output the adapter's dynamic §68 schema expects in
# probabilities mode: probability maps for choice/score, a float for noul.
FAKE_LLM_OUTPUT = {
    "answers": {
        "request_type": {"billing": 0.75, "technical": 0.25},
        "urgency": {"0": 0.125, "1": 0.625, "2": 0.25},
        "refund_requested": 0.8125,
    }
}


class FakeAsyncProvider:
    """Stands in for AsyncOpenAIProvider: no network, canned ProviderResult."""

    def __init__(self, *, model_name: str = "gpt-4o-mini", text: str | None = None, error: Exception | None = None):
        self.model_name = model_name
        self._text = text if text is not None else json.dumps(FAKE_LLM_OUTPUT)
        self._error = error
        self.calls: list[dict] = []
        self.closed = False

    async def request(self, messages: list[Message], *, schema: dict, structured: bool) -> ProviderResult:
        self.calls.append(
            {
                "messages": [f"{m.role}:{m.content}" for m in messages],
                "schema": schema,
                "structured": structured,
            }
        )
        if self._error is not None:
            raise self._error
        return ProviderResult(text=self._text, input_tokens=42, output_tokens=17)

    def translate_error(self, error: Exception) -> TypeSafeError:
        return error if isinstance(error, TypeSafeError) else TypeSafeError(str(error))

    async def aclose(self) -> None:
        self.closed = True


class FakeAdapter:
    """Stands in for the whole AsyncSystemOneAdapterClient."""

    def __init__(self, response: SystemOneResponse | None = None, error: Exception | None = None):
        self.response = response
        self.error = error
        self.calls: list[dict] = []
        self.closed = False

    async def system_one(self, state, questions, **kwargs):
        self.calls.append({"state": state, "questions": questions, "kwargs": kwargs})
        if self.error is not None:
            raise self.error
        assert self.response is not None
        return self.response

    async def aclose(self) -> None:
        self.closed = True


def adapter_response(*, noul: float = 0.5, debug: dict | None = None, model: str = "gpt-4o-mini") -> SystemOneResponse:
    """Build a real adapter SystemOneResponse with a controllable noul value."""
    return SystemOneResponse(
        model=model,
        answers={"refund_requested": NoulAnswer(noul=noul)},
        usage=Usage(
            input_tokens=10,
            output_tokens=5,
            input_tokens_total=10,
            output_tokens_total=5,
            n_retries=0,
            n_retries_malformed_structure=0,
            latency=0.01,
        ),
        debug=debug if debug is not None else {"llm_attempts": []},
    )


def client_with_provider(provider: FakeAsyncProvider) -> IndependentOpenaiClient:
    return IndependentOpenaiClient(
        base_url="https://openai.test/api/coding/paas/v4",
        api_key="llm-secret-key",
        model="gpt-4o-mini",
        provider=provider,
    )


def test_execute_flows_the_adapter_response_through_our_constrained_mirror():
    prediction = asyncio.run(client_with_provider(FakeAsyncProvider()).execute(REQUEST))

    result = prediction.result
    assert result.model == "gpt-4o-mini"
    assert isinstance(result.answers["request_type"], ChoiceResult)
    assert isinstance(result.answers["urgency"], ScoreResult)
    assert isinstance(result.answers["refund_requested"], NoulResult)
    # The adapter converts probability maps to typed answers: choice label =
    # argmax, score = expected value over the (already summing) distribution.
    assert result.answers["request_type"].choice == "billing"
    assert result.answers["request_type"].probabilities == {"billing": 0.75, "technical": 0.25}
    assert result.answers["urgency"].score == 0.125 * 0 + 0.625 * 1 + 0.25 * 2
    assert result.answers["refund_requested"].noul == 0.8125
    assert result.usage.input_tokens == 42
    assert result.usage.output_tokens == 17


def test_request_model_never_overrides_the_server_model():
    # P21: the provider instance carries the SERVER-configured model; the
    # request's model field is metadata only. The LLM saw exactly the state
    # and questions — the request-level model never appears anywhere it went.
    provider = FakeAsyncProvider(model_name="gpt-4o-mini")

    prediction = asyncio.run(client_with_provider(provider).execute(REQUEST))

    assert provider.calls, "the fake provider must have been invoked"
    sent = "\n".join(provider.calls[0]["messages"])
    assert "jev-latest" not in sent
    assert prediction.result.model == "gpt-4o-mini"


def test_the_result_model_is_the_one_the_endpoint_reports_having_served():
    """FB2 semantics for the independent leg: each attempt's llm_response
    carries the RESOLVED model name the endpoint served (an ollama tag, a
    dated OpenAI snapshot). The LAST attempt carrying one produced the final
    text — its report wins over the configured-name echo. run_config keeps
    the configured name for provenance."""
    debug = {
        "llm_attempts": [
            {"llm_response": None},
            {"llm_response": {"model": "deepseek-v4-pro:cloud"}},
        ]
    }
    adapter = FakeAdapter(response=adapter_response(debug=debug))
    client = IndependentOpenaiClient(
        base_url="https://openai.test", api_key="llm-secret-key", model="gpt-4o-mini", adapter=adapter
    )

    prediction = asyncio.run(client.execute(REQUEST))

    assert prediction.result.model == "deepseek-v4-pro:cloud"
    assert prediction.run_config["model"] == "gpt-4o-mini"
    # The evidence travels redacted but intact — the served name stays
    # traceable in llm_attempts too.
    assert prediction.llm_attempts[1]["llm_response"]["model"] == "deepseek-v4-pro:cloud"


def test_attempts_without_a_served_model_keep_the_configured_echo():
    prediction = asyncio.run(client_with_provider(FakeAsyncProvider()).execute(REQUEST))

    assert prediction.result.model == "gpt-4o-mini"


def test_the_wrapper_passes_only_state_and_questions_to_the_adapter():
    adapter = FakeAdapter(adapter_response())
    client = IndependentOpenaiClient(
        base_url="https://openai.test", api_key="llm-secret-key", model="gpt-4o-mini", adapter=adapter
    )

    asyncio.run(client.execute(REQUEST))

    assert adapter.calls == [
        {"state": REQUEST["state"], "questions": REQUEST["questions"], "kwargs": {}}
    ]


def test_degenerate_adapter_output_becomes_a_provider_error():
    # Mirror-level guard: an adapter response outside the constrained mirror
    # (noul > 1) is a §66 provider failure, never a corrupted snapshot.
    adapter = FakeAdapter(adapter_response(noul=1.5))
    client = IndependentOpenaiClient(
        base_url="https://openai.test", api_key="llm-secret-key", model="gpt-4o-mini", adapter=adapter
    )

    with pytest.raises(IndependentOpenaiProviderError) as excinfo:
        asyncio.run(client.execute(REQUEST))

    assert "unparsable" in excinfo.value.message.lower()


def test_terminal_malformed_output_is_a_provider_error_not_a_synthetic_success():
    # Synthetic-200 guard (ruling P22): when every corrective attempt fails
    # local validation, the adapter raises TypeSafeAPIResponseValidationError
    # with a synthetic HTTP 200 — the wrapper converts it to a declared
    # provider error (§66 independent unavailable), never a success.
    provider = FakeAsyncProvider(text='{"answers": {"refund_requested": "not a number"}}')
    client = client_with_provider(provider)

    with pytest.raises(IndependentOpenaiProviderError):
        asyncio.run(client.execute(REQUEST))


def test_provider_hard_failure_is_a_provider_error():
    provider = FakeAsyncProvider(error=TypeSafeError("LLM returned HTTP 401 for key llm-secret-key"))
    client = client_with_provider(provider)

    with pytest.raises(IndependentOpenaiProviderError) as excinfo:
        asyncio.run(client.execute(REQUEST))

    assert "llm-secret-key" not in excinfo.value.message


def test_terminal_adapter_failure_carries_redacted_debug_evidence():
    # F4: a terminal adapter failure may already have spent tokens — the
    # exception's debug payload ({llm_attempts, retry_reasons}) must leave
    # the provider REDACTED, with the run_config, so §66 can persist the
    # evidence of the paid run alongside the error.
    terminal = TypeSafeError("LLM returned HTTP 500")
    terminal.debug = {
        "llm_attempts": [
            {
                "messages": [],
                "request": {"headers": {"Authorization": "Bearer llm-secret-key"}},
                "debug_info": {"api_key": "llm-secret-key", "model_name": "gpt-4o-mini"},
            }
        ],
        "retry_reasons": [["http_status", "500"]],
    }
    adapter = FakeAdapter(error=terminal)
    client = IndependentOpenaiClient(
        base_url="https://openai.test", api_key="llm-secret-key", model="gpt-4o-mini", adapter=adapter
    )

    with pytest.raises(IndependentOpenaiProviderError) as excinfo:
        asyncio.run(client.execute(REQUEST))

    failure = excinfo.value
    assert failure.run_config == client.run_config()
    attempt = failure.llm_attempts[0]
    assert attempt["request"]["headers"]["Authorization"] == "[REDACTED]"
    assert attempt["debug_info"]["api_key"] == "[REDACTED]"
    assert "llm-secret-key" not in json.dumps(failure.llm_attempts)
    assert failure.retry_reasons == [["http_status", "500"]]


def test_terminal_failure_through_the_real_adapter_keeps_attempt_traces():
    # The REAL adapter records every attempt on terminal TypeSafeErrors
    # (error.debug = error_debug()); the wrapper must not drop them.
    provider = FakeAsyncProvider(error=TypeSafeError("LLM returned HTTP 500"))
    client = client_with_provider(provider)

    with pytest.raises(IndependentOpenaiProviderError) as excinfo:
        asyncio.run(client.execute(REQUEST))

    failure = excinfo.value
    assert failure.llm_attempts, "the adapter's attempt traces must survive"
    assert failure.run_config["model"] == "gpt-4o-mini"


def test_preparation_failure_carries_no_evidence():
    # The pre-call branch (question contract, configuration) spends no
    # tokens: its error keeps the minimal shape — no invented evidence.
    provider = FakeAsyncProvider()
    client = client_with_provider(provider)

    with pytest.raises(IndependentOpenaiProviderError) as excinfo:
        asyncio.run(client.execute({"state": None, "questions": REQUEST["questions"]}))

    failure = excinfo.value
    assert failure.run_config is None
    assert failure.llm_attempts is None
    assert failure.retry_reasons is None


def test_run_config_records_the_playground_configuration_without_credentials():
    provider = FakeAsyncProvider()
    client = IndependentOpenaiClient(
        base_url="https://openai.test/api/coding/paas/v4",
        api_key="llm-secret-key",
        model="gpt-4o-mini",
        structured_outputs=False,
        provider=provider,
    )

    prediction = asyncio.run(client.execute(REQUEST))

    assert prediction.run_config == {
        "model": "gpt-4o-mini",
        "base_url": "https://openai.test/api/coding/paas/v4",
        "structured_outputs": False,
        "llm_answer_mode": "probabilities",
        "normalize_probabilities": True,
        "max_retries": 2,
        "n_retry_malformed_structure": 1,
        "timeout_seconds": 120.0,
        "retry_budget_seconds": 300.0,
        "api": "chat_completions",
        "temperature": None,
    }
    assert "llm-secret-key" not in json.dumps(prediction.run_config)
    assert "Bearer" not in json.dumps(prediction.run_config)


def test_the_adapter_is_built_with_an_explicit_deliberate_retry_budget(monkeypatch):
    # F2/J2: the SDK's RetryPolicy default is a 30 s TOTAL budget — one slow
    # failing attempt (per-attempt bound 120 s) exhausts it before any retry
    # can start, so P17's two retries only ever ran for FAST failures. The
    # RetryPolicy handed to the adapter must carry an explicit budget that
    # admits bounded slow attempts plus a corrective retry.
    captured: dict = {}

    class CapturingAdapter:
        def __init__(self, **kwargs: object) -> None:
            captured.update(kwargs)

        async def system_one(self, state, questions, **kwargs): ...  # pragma: no cover

        async def aclose(self) -> None: ...  # pragma: no cover

    monkeypatch.setattr(
        "app.providers.independent_openai.AsyncSystemOneAdapterClient", CapturingAdapter
    )

    IndependentOpenaiClient(base_url="https://openai.test", api_key="llm-secret-key", model="gpt-4o-mini")

    policy = captured["retry"]
    assert policy.max_retries == 2
    assert policy.timeout == 300.0


def test_llm_attempts_evidence_is_persisted_and_secrets_are_redacted():
    # Defensive redaction (§45): the adapter does not record credentials
    # today, but anything credential-shaped inside the evidence is replaced
    # before the prediction leaves the provider.
    dirty_attempts = [
        {
            "messages": [{"role": "system", "content": "prompt"}],
            "request": {"model": "gpt-4o-mini", "headers": {"Authorization": "Bearer llm-secret-key"}},
            "debug_info": {"api_key": "llm-secret-key", "model_name": "gpt-4o-mini"},
            "nested": [{"x-api-key": "llm-secret-key", "keep": 1}],
        }
    ]
    adapter = FakeAdapter(adapter_response(debug={"llm_attempts": dirty_attempts}))
    client = IndependentOpenaiClient(
        base_url="https://openai.test", api_key="llm-secret-key", model="gpt-4o-mini", adapter=adapter
    )

    prediction = asyncio.run(client.execute(REQUEST))

    serialized = json.dumps(prediction.llm_attempts)
    assert "llm-secret-key" not in serialized
    assert "Bearer" not in serialized
    attempt = prediction.llm_attempts[0]
    assert attempt["request"]["headers"]["Authorization"] == "[REDACTED]"
    assert attempt["debug_info"]["api_key"] == "[REDACTED]"
    assert attempt["nested"][0]["x-api-key"] == "[REDACTED]"
    assert attempt["nested"][0]["keep"] == 1


def test_structured_outputs_default_matches_the_p17_configuration():
    provider = FakeAsyncProvider()
    client = client_with_provider(provider)

    prediction = asyncio.run(client.execute(REQUEST))

    assert prediction.run_config["structured_outputs"] is True
    # P17: probabilities mode + normalization + bounded retries are the
    # adapter's actual call configuration, asserted through one full run.
    assert provider.calls[0]["structured"] is True
    # The dynamic schema pins the answers to the request's own labels.
    schema_text = json.dumps(provider.calls[0]["schema"])
    for label in ("billing", "technical", "refund_requested"):
        assert label in schema_text


def test_aclose_closes_the_adapter():
    adapter = FakeAdapter(adapter_response())
    client = IndependentOpenaiClient(
        base_url="https://openai.test", api_key="llm-secret-key", model="gpt-4o-mini", adapter=adapter
    )

    asyncio.run(client.aclose())

    assert adapter.closed


def test_aclose_closes_the_provider_the_wrapper_wired_into_the_adapter():
    # F1: the adapter treats an injected provider instance as CALLER-owned —
    # its own aclose never reaches the underlying OpenAI pool. The wrapper
    # created that provider, so the wrapper's aclose must close BOTH.
    provider = FakeAsyncProvider()
    client = client_with_provider(provider)

    asyncio.run(client.aclose())

    assert provider.closed
    assert client._adapter._closed is True  # the adapter shut down too


def test_aclose_of_a_fully_injected_adapter_has_no_provider_to_leak():
    # The adapter= seam replaces the whole adapter: no provider was wired by
    # the wrapper, so aclose must not attempt any extra close.
    adapter = FakeAdapter(adapter_response())
    client = IndependentOpenaiClient(
        base_url="https://openai.test", api_key="llm-secret-key", model="gpt-4o-mini", adapter=adapter
    )

    asyncio.run(client.aclose())

    assert adapter.closed


def test_the_default_construction_builds_the_pinned_adapter_configuration():
    # The real construction path (no injected provider/adapter) must build
    # the exact P17 adapter wiring; the provider's model name is the server
    # model. No network happens at construction time.
    client = IndependentOpenaiClient(
        base_url="https://openai.test", api_key="llm-secret-key", model="gpt-4o-mini"
    )

    adapter = client._adapter
    assert isinstance(adapter, AsyncSystemOneAdapterClient)
    assert adapter.structured_outputs is True
    assert adapter.llm_answer_mode == "probabilities"
    assert adapter.normalize_probabilities is True
    assert adapter.n_retry_malformed_structure == 1
    assert adapter.retry.max_retries == 2
    assert adapter.retry.timeout == 300.0
    assert adapter.model.model_name == "gpt-4o-mini"
    assert adapter.model.api == "chat_completions"


# --- Dependency factory ------------------------------------------------------


def test_get_independent_openai_provider_returns_none_when_key_or_model_unset(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.delenv("OPENAI_MODEL", raising=False)
    assert get_independent_openai_provider() is None

    monkeypatch.setenv("OPENAI_API_KEY", "llm-key")
    assert get_independent_openai_provider() is None

    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")
    assert get_independent_openai_provider() is None


def test_get_independent_openai_provider_builds_client_with_default_base_url(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("OPENAI_API_KEY", "llm-env-key")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")
    monkeypatch.delenv("OPENAI_BASE_URL", raising=False)

    provider = get_independent_openai_provider()

    assert isinstance(provider, IndependentOpenaiClient)
    assert provider.base_url == "https://api.openai.com/v1"
    assert provider.model == "gpt-4o-mini"
    assert provider.api_key == "llm-env-key"


def test_get_independent_openai_provider_honors_the_structured_outputs_seam(tmp_path, monkeypatch):
    # P23: OPENAI_STRUCTURED_OUTPUTS=false is the deployment fallback (prompted
    # output + corrective retries) — a one-line env change.
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("OPENAI_API_KEY", "llm-env-key")
    monkeypatch.setenv("OPENAI_MODEL", "gpt-4o-mini")
    monkeypatch.setenv("OPENAI_STRUCTURED_OUTPUTS", "false")

    provider = get_independent_openai_provider()

    assert provider._adapter.structured_outputs is False


def test_native_structural_failure_falls_back_to_prompted_mode_once():
    """The GLM ladder: a provider that cannot honor json_schema strict mode
    answers PROSE (the adapter classifies it malformed_structure after its
    corrective retries) — one automatic prompted retry (schema in the
    prompt) lands the prediction."""
    fake = FakeAsyncProvider(text=json.dumps(FAKE_LLM_OUTPUT))
    original_request = fake.request
    native_prose = {"n": 0}

    async def prose_until_prompted(messages, *, schema, structured):
        # Native attempts get prose — exactly what glm-5.3 does when the
        # questions live only in the schema. The prompted fallback answers.
        if structured:
            native_prose["n"] += 1
            return ProviderResult(
                text="No questions were supplied for this document.",
                input_tokens=10,
                output_tokens=5,
            )
        return await original_request(messages, schema=schema, structured=structured)

    fake.request = prose_until_prompted  # type: ignore[method-assign]

    client = IndependentOpenaiClient(
        base_url="https://llm.test/v1",
        api_key="k",
        model="glm-5.3",
        structured_outputs=True,
        provider=fake,
    )
    prediction = asyncio.run(client.execute(REQUEST))

    # Native attempts answered prose (the adapter's corrective retry
    # included); the prompted retry is the one that lands.
    assert native_prose["n"] >= 1
    assert [c["structured"] for c in fake.calls] == [False]
    assert prediction.result.model == "gpt-4o-mini"
    asyncio.run(client.aclose())


def test_non_structural_failures_never_fall_back():
    hard = TypeSafeError("LLM returned HTTP 401 for key llm-secret-key")
    fake = FakeAsyncProvider(error=hard)

    client = IndependentOpenaiClient(
        base_url="https://llm.test/v1",
        api_key="k",
        model="glm-5.3",
        structured_outputs=True,
        provider=fake,
    )
    with pytest.raises(IndependentOpenaiProviderError):
        asyncio.run(client.execute(REQUEST))
    assert len(fake.calls) == 1
    asyncio.run(client.aclose())
