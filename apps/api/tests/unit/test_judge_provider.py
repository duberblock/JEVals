"""LLM Judge thin client (plan §67, ADR R10): wire shape, parsing, errors.

Hermetic via httpx.MockTransport — api.openai.com is never called. The §11 judge
independence rule is pinned BY CONSTRUCTION: the input builder accepts only
(request, emulator_result, jev_result, comparison) — there is no parameter
through which independent data could reach the Judge.
"""

import asyncio
import inspect
import json
from pathlib import Path

import httpx
import pytest

from app.domain.executions.judge import JudgeProviderError
from app.providers.judge import JudgeClient, build_judge_input, judge_system_prompt
from app.schemas.judge_evaluation import JudgeEvaluation
from app.schemas.system_one_result import SystemOneResult

JUDGE_PROMPT_PATH = Path(__file__).resolve().parents[2] / "app" / "prompts" / "judge" / "v2.md"

REQUEST = {
    "state": {"message": "I was charged twice on my invoice."},
    "questions": {
        "request_type": {
            "type": "choice",
            "criteria": {"billing": "Billing issue", "technical": "Technical issue"},
        }
    },
}

EMULATOR_RESULT = SystemOneResult.model_validate(
    {
        "model": "jev-emulator",
        "answers": {
            "request_type": {
                "type": "choice",
                "choice": "billing",
                "confidence": 0.75,
                "probabilities": {"billing": 0.75, "technical": 0.25},
            }
        },
        "usage": {"input_tokens": 100, "output_tokens": 30},
    }
)

JEV_RESULT = SystemOneResult.model_validate(
    {
        "model": "jev-latest",
        "answers": {
            "request_type": {
                "type": "choice",
                "choice": "technical",
                "confidence": 0.6,
                "probabilities": {"billing": 0.4, "technical": 0.6},
            }
        },
        "usage": {"input_tokens": 200, "output_tokens": 60},
    }
)

COMPARISON = {
    "overall_fidelity": 0.75,
    "questions": {
        "request_type": {
            "primitive": "choice",
            "fidelity": 0.75,
            "aligned": False,
            "components": {
                "decision_match": False,
                "confidence_delta": 0.15,
                "distribution_similarity": 0.75,
            },
        }
    },
}

JUDGE_EVALUATION = {
    "overall": {
        "prediction_quality": "mixed",
        "semantic_divergence": "material",
        "summary": "The two sides pick different labels.",
    },
    "questions": {
        "request_type": {
            "emulator_support": "strong",
            "jev_support": "weak",
            "semantic_divergence": "material",
            "preferred": "emulator",
            "reason": "The state clearly describes a billing problem.",
        }
    },
}


def judge_client(transport: httpx.MockTransport) -> JudgeClient:
    return JudgeClient(
        base_url="https://openai.test/api/coding/paas/v4",
        api_key="llm-secret-key",
        model="gpt-4o-mini",
        transport=transport,
    )


def wire_response(evaluation: dict) -> httpx.Response:
    return httpx.Response(
        200,
        json={"choices": [{"message": {"content": json.dumps(evaluation)}}]},
    )


# --- Prompt -----------------------------------------------------------------


def test_judge_system_prompt_is_the_v2_md_file_content():
    assert judge_system_prompt() == JUDGE_PROMPT_PATH.read_text(encoding="utf-8").strip()
    # The prompt names every controlled vocabulary of §67.
    for token in (
        "excellent",
        "good",
        "mixed",
        "poor",
        "undetermined",
        "none",
        "minor",
        "material",
        "strong",
        "partial",
        "weak",
        "insufficient",
        "emulator",
        "jev",
        "tie",
    ):
        assert token in judge_system_prompt()


# --- §11 independence: pinned by construction --------------------------------


def test_build_judge_input_signature_has_no_independent_parameter():
    parameters = inspect.signature(build_judge_input).parameters

    assert list(parameters) == ["request", "emulator_result", "jev_result", "comparison"]


def test_build_judge_input_carries_only_the_four_declared_sections():
    judge_input = build_judge_input(REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON)

    assert set(judge_input) == {"request", "emulator_result", "jev_result", "comparison"}
    assert judge_input["request"] == REQUEST
    assert judge_input["comparison"] == COMPARISON
    assert judge_input["emulator_result"]["model"] == "jev-emulator"
    assert judge_input["emulator_result"]["answers"]["request_type"]["choice"] == "billing"
    assert judge_input["jev_result"]["model"] == "jev-latest"
    assert judge_input["jev_result"]["answers"]["request_type"]["choice"] == "technical"
    # No independent data can appear: serialized input holds exactly the four
    # sections and none of them is named after the independent prediction.
    assert "independent" not in json.dumps(judge_input).lower()


# --- Wire shape --------------------------------------------------------------


def test_evaluate_posts_strict_json_schema_request_with_v2_system_prompt():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return wire_response(JUDGE_EVALUATION)

    outcome = asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
        REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
    ))

    assert len(captured) == 1
    sent = captured[0]
    assert sent.method == "POST"
    assert str(sent.url) == "https://openai.test/api/coding/paas/v4/chat/completions"
    assert sent.headers["Authorization"] == "Bearer llm-secret-key"

    body = json.loads(sent.read())
    assert body["model"] == "gpt-4o-mini"
    assert body["temperature"] == 0
    assert [message["role"] for message in body["messages"]] == ["system", "user"]
    assert body["messages"][0]["content"] == judge_system_prompt()
    assert json.loads(body["messages"][1]["content"]) == build_judge_input(
        REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
    )
    assert body["response_format"] == {
        "type": "json_schema",
        "json_schema": {
            "name": "judge_evaluation",
            "schema": JudgeEvaluation.model_json_schema(),
            "strict": True,
        },
    }

    assert outcome.model == "gpt-4o-mini"
    assert outcome.evaluation == JudgeEvaluation.model_validate(JUDGE_EVALUATION)
    assert outcome.judge_input == build_judge_input(REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON)
    assert outcome.output_schema == JudgeEvaluation.model_json_schema()
    assert outcome.raw_response == json.dumps(JUDGE_EVALUATION)
    # §45 Full LLM Exchange completeness: the system instruction and the
    # request configuration travel with the evidence.
    assert outcome.system_instruction == judge_system_prompt()
    # The compatibility-ladder run that served the request is part of the
    # persisted evidence ("strict" = the historical body).
    assert outcome.configuration == {
        "model": "gpt-4o-mini",
        "compatibility": "strict",
        "temperature": 0,
        "max_tokens": 8192,
        "timeout_seconds": 120.0,
    }


# --- Error paths -------------------------------------------------------------


def test_non_2xx_raises_judge_provider_error_with_status_and_no_key_leak():
    from app.domain.executions.judge import JudgeProviderError

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(401, text="invalid key llm-secret-key")

    with pytest.raises(JudgeProviderError) as excinfo:
        asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
            REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
        ))

    assert excinfo.value.status == 401
    assert "401" in excinfo.value.message
    assert "llm-secret-key" not in excinfo.value.message


def test_timeout_raises_judge_provider_error_without_status():
    from app.domain.executions.judge import JudgeProviderError

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("timed out")

    with pytest.raises(JudgeProviderError) as excinfo:
        asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
            REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
        ))

    assert excinfo.value.status is None
    assert "timeout" in excinfo.value.message.lower()


def test_connection_failure_raises_judge_provider_error_without_status():
    from app.domain.executions.judge import JudgeProviderError

    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused")

    with pytest.raises(JudgeProviderError) as excinfo:
        asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
            REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
        ))

    assert excinfo.value.status is None
    assert "could not be reached" in excinfo.value.message


def test_body_without_choices_raises_judge_provider_error():
    from app.domain.executions.judge import JudgeProviderError

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"id": "chatcmpl-1"})

    with pytest.raises(JudgeProviderError) as excinfo:
        asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
            REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
        ))

    assert "unparsable" in excinfo.value.message.lower()


def test_content_that_is_not_json_raises_judge_provider_error():
    from app.domain.executions.judge import JudgeProviderError

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": "not json"}}]})

    with pytest.raises(JudgeProviderError):
        asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
            REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
        ))


def test_content_outside_the_controlled_vocabulary_raises_judge_provider_error():
    from app.domain.executions.judge import JudgeProviderError

    drifting = json.loads(json.dumps(JUDGE_EVALUATION))
    drifting["overall"]["prediction_quality"] = "amazing"

    def handler(request: httpx.Request) -> httpx.Response:
        return wire_response(drifting)

    with pytest.raises(JudgeProviderError) as excinfo:
        asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
            REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
        ))

    assert "invalid evaluation" in excinfo.value.message.lower()


# --- Fenced content (F3) ------------------------------------------------------


@pytest.mark.parametrize(
    "content",
    [
        # Plain (the strict-prompt happy path).
        json.dumps(JUDGE_EVALUATION),
        # Fenced, no language tag — tolerated whitespace inside and out.
        "\n```    \n" + json.dumps(JUDGE_EVALUATION) + "\n   ```\n",
        # Fenced with the json language tag.
        "```json\n" + json.dumps(JUDGE_EVALUATION) + "\n```",
        # Fenced with prose around it — the model added chatter anyway.
        "Here is the evaluation you asked for:\n```json\n"
        + json.dumps(JUDGE_EVALUATION)
        + "\n```\nHope this helps!",
    ],
    ids=["plain", "fenced", "fenced-json-tag", "fenced-with-prose"],
)
def test_fenced_content_is_still_parsed(content):
    # F3: LLM may wrap the JSON in markdown fences despite the strict
    # prompt (the independent path's adapter already strips them); a fenced
    # but otherwise valid §67 answer must parse, keeping vocab enforcement.
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    outcome = asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
        REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
    ))

    assert outcome.evaluation == JudgeEvaluation.model_validate(JUDGE_EVALUATION)
    assert outcome.raw_response == content


@pytest.mark.parametrize(
    "content",
    [
        # Garbage INSIDE the fences still fails cleanly (never a success).
        "```json\nnot json at all\n```",
        # Garbage fenced with prose around: same clean failure.
        "Here you go:\n```\n{'single': 'quotes'}\n```\nbye",
        # Prose with NO fences at all and no JSON: unchanged failure.
        "The two models broadly agree.",
    ],
    ids=["garbage-in-fences", "garbage-in-fences-with-prose", "plain-garbage"],
)
def test_garbage_inside_fences_still_fails_cleanly(content):
    from app.domain.executions.judge import JudgeProviderError

    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"choices": [{"message": {"content": content}}]})

    with pytest.raises(JudgeProviderError):
        asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
            REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
        ))


def test_request_carries_an_explicit_max_tokens_bound():
    # F5: the Judge request must state its own completion bound instead of
    # inheriting whatever the endpoint defaults to. §67's output is compact
    # (one structured judgment per question), bounding cost — R30: 8192
    # because the live model's reasoning eats budget and 4096 truncated valid
    # output live (finish_reason=length mid-JSON).
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return wire_response(JUDGE_EVALUATION)

    asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
        REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
    ))

    body = json.loads(captured[0].read())
    assert body["max_tokens"] == 8192


def test_semantically_equal_inputs_serialize_identically_on_the_wire():
    # J3: the user message must be canonically serialized (sorted keys), so
    # semantically equal inputs — same content, different key insertion
    # order — produce byte-identical judge input and persisted evidence.
    captured: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(json.loads(request.read())["messages"][1]["content"])
        return wire_response(JUDGE_EVALUATION)

    # Same content as REQUEST/EMULATOR_RESULT/JEV_RESULT/COMPARISON, with
    # deliberately shuffled key insertion orders everywhere.
    shuffled_request = {
        "questions": {
            "request_type": {
                "criteria": {"billing": "Billing issue", "technical": "Technical issue"},
                "type": "choice",
            }
        },
        "state": {"message": "I was charged twice on my invoice."},
    }
    shuffled_emulator = SystemOneResult.model_validate(
        {
            "usage": {"output_tokens": 30, "input_tokens": 100},
            "answers": {
                "request_type": {
                    "probabilities": {"technical": 0.25, "billing": 0.75},
                    "confidence": 0.75,
                    "choice": "billing",
                    "type": "choice",
                }
            },
            "model": "jev-emulator",
        }
    )
    shuffled_jev = SystemOneResult.model_validate(
        {
            "usage": {"output_tokens": 60, "input_tokens": 200},
            "answers": {
                "request_type": {
                    "probabilities": {"technical": 0.6, "billing": 0.4},
                    "confidence": 0.6,
                    "choice": "technical",
                    "type": "choice",
                }
            },
            "model": "jev-latest",
        }
    )
    shuffled_comparison = {
        "questions": {
            "request_type": {
                "components": {
                    "distribution_similarity": 0.75,
                    "confidence_delta": 0.15,
                    "decision_match": False,
                },
                "aligned": False,
                "fidelity": 0.75,
                "primitive": "choice",
            }
        },
        "overall_fidelity": 0.75,
    }

    client = judge_client(httpx.MockTransport(handler))
    asyncio.run(client.evaluate(REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON))
    asyncio.run(client.evaluate(
        shuffled_request, shuffled_emulator, shuffled_jev, shuffled_comparison
    ))
    asyncio.run(client.aclose())

    assert captured[0] == captured[1]
    # And the canonical form is exactly the sorted-keys serialization.
    from app.domain.executions.models import canonical_request_json

    assert captured[0] == canonical_request_json(
        build_judge_input(REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON)
    )


def test_aclose_closes_the_underlying_client():
    client = judge_client(httpx.MockTransport(lambda request: wire_response(JUDGE_EVALUATION)))

    asyncio.run(client.aclose())

    with pytest.raises(RuntimeError):
        asyncio.run(client._client.get("/anything"))


# --- Compatibility ladder -----------------------------------------------------


def test_a_400_on_strict_escalates_to_guided_reasoning_model_parameters():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        if len(captured) == 1:
            # The OpenAI reasoning-model rejection (max_tokens/temperature/
            # strict schema) — the ladder's second step is the remedy.
            return httpx.Response(400, json={"error": {"message": "Unsupported parameter: 'max_tokens'"}})
        return wire_response(JUDGE_EVALUATION)

    outcome = asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
        REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
    ))

    assert len(captured) == 2
    second = json.loads(captured[1].read())
    assert "max_completion_tokens" in second
    assert "max_tokens" not in second
    assert "temperature" not in second
    assert second["response_format"]["json_schema"]["strict"] is False
    assert outcome.configuration["compatibility"] == "guided"


def test_repeated_400s_escalate_to_prompted_and_then_fail_honestly():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        if len(captured) < 3:
            return httpx.Response(400, json={"error": {"message": "no"}})
        return wire_response(JUDGE_EVALUATION)

    outcome = asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
        REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
    ))
    assert len(captured) == 3
    third = json.loads(captured[2].read())
    assert "response_format" not in third
    assert outcome.configuration["compatibility"] == "prompted"

    # Three refusals end the attempt — the ladder never loops.
    captured.clear()

    def always_400(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(400, json={"error": {"message": "no"}})

    with pytest.raises(JudgeProviderError) as excinfo:
        asyncio.run(judge_client(httpx.MockTransport(always_400)).evaluate(
            REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
        ))
    assert len(captured) == 3
    assert "HTTP 400" in str(excinfo.value)


def test_non_400_failures_never_escalate():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return httpx.Response(401, json={"error": {"message": "bad key"}})

    with pytest.raises(JudgeProviderError):
        asyncio.run(judge_client(httpx.MockTransport(handler)).evaluate(
            REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON
        ))
    assert len(captured) == 1


def test_structured_first_false_goes_straight_to_prompted():
    captured: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        captured.append(request)
        return wire_response(JUDGE_EVALUATION)

    client = JudgeClient(
        base_url="https://openai.test/v1",
        api_key="k",
        model="glm-5.3",
        structured_first=False,
        transport=httpx.MockTransport(handler),
    )
    outcome = asyncio.run(client.evaluate(REQUEST, EMULATOR_RESULT, JEV_RESULT, COMPARISON))

    assert len(captured) == 1
    body = json.loads(captured[0].read())
    assert "response_format" not in body
    assert "max_completion_tokens" in body
    assert outcome.configuration["compatibility"] == "prompted"
