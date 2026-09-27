"""LLM Semantic Judge thin client (plan §67; hand-rolled per ruling R10/P19).

An httpx AsyncClient posting to the OpenAI-compatible Chat Completions
endpoint of the configured OpenAI-compatible base URL with a STRICT §67 JSON schema, the
versioned system prompt from `app/prompts/judge/` (v2 — see _PROMPT_PATH),
and temperature 0. The Judge
is deliberately NOT the system-one adapter: it answers a different contract
(the §67 controlled vocabularies), and its prompt is playground-owned
versioned content.

§11 independence is enforced by construction: `build_judge_input` takes
exactly (request, emulator_result, jev_result, comparison) — there is no
parameter through which independent data could reach the Judge.
"""

from __future__ import annotations

import re
from functools import lru_cache
from pathlib import Path

import httpx
from pydantic import ValidationError

from app.domain.executions.judge import JudgeOutcome, JudgeProviderError
from app.domain.executions.models import JsonObject, canonical_request_json
from app.schemas.judge_evaluation import JudgeEvaluation
from app.schemas.system_one_result import SystemOneResult

JUDGE_TIMEOUT_SECONDS = 120.0
CHAT_COMPLETIONS_ENDPOINT = "/chat/completions"

# F5: explicit completion bound. §67's output is compact — one overall block
# plus one structured judgment per question — so tokens stay bounded while
# capping cost, instead of inheriting the endpoint's own default.
# 8192 (amended R30, live evidence): the live model via LLM hit finish_reason=length
# at 4096 mid-JSON on the canonical fixture — the completion budget also pays
# for the model's reasoning — truncating otherwise-valid judge output.
JUDGE_MAX_TOKENS = 8192

# OpenAI reasoning-era models (gpt-5 family and friends) reject two of the
# judge's historical parameters — `max_tokens` (they demand
# `max_completion_tokens`) and any non-default `temperature` — and their
# STRICT structured-output mode imposes schema rules pydantic's generated
# schema does not guarantee. The judge therefore climbs a three-step
# compatibility ladder, one HTTP 400 at a time (never looping: non-400
# verdicts surface immediately, and three refusals end the attempt):
#   1. strict    — the historical body (temperature 0, max_tokens, strict
#                  schema) that lenient OpenAI-compatible deployments take;
#   2. guided    — reasoning-model parameters (max_completion_tokens, no
#                  temperature) with the SAME schema non-strict (guidance,
#                  not enforcement);
#   3. prompted  — schema lives in the system prompt alone (it already
#                  spells the full contract with a worked example — the v2
#                  design), any chat model qualifies.
# The mode that served the request is recorded in the outcome's persisted
# configuration — the evidence shows what actually ran.

# v2 (R30): the output contract is spelled out IN the prompt with a worked
# example. v1 delegated the field list to the wire json_schema, but LLM does
# not reliably deliver strict schemas to the live model (P23), so the model produced
# every field the PROMPT described and omitted `reason`, which only the
# undelivered schema carried. v1.md stays in-tree as the version history.
_PROMPT_PATH = Path(__file__).resolve().parents[1] / "prompts" / "judge" / "v2.md"

# Fix-forward F3: one fenced code block (``` ... ``` or ```lang ... ```)
# possibly surrounded by prose — the same tolerance the independent path's
# adapter applies (`_extract_json`). Non-greedy so prose after the closing
# fence stays out; the leading ```[tag] line is dropped with the match's
# first line consumed by the group start.
_FENCED_BLOCK = re.compile(r"```[^\S\n]*[^\n]*\n(.*?)```", re.DOTALL)


@lru_cache(maxsize=1)
def judge_system_prompt() -> str:
    """The Judge system instruction — the exact content of the versioned prompt file."""
    return _PROMPT_PATH.read_text(encoding="utf-8").strip()


def build_judge_input(
    request: JsonObject,
    emulator_result: SystemOneResult,
    jev_result: SystemOneResult,
    comparison: JsonObject,
) -> JsonObject:
    """Assemble the Judge's user document from its ONLY four inputs (§11)."""
    return {
        "request": request,
        "emulator_result": _dump_result(emulator_result),
        "jev_result": _dump_result(jev_result),
        "comparison": comparison,
    }


def _dump_result(result: SystemOneResult) -> JsonObject:
    return {
        "model": result.model,
        "answers": {name: answer.model_dump() for name, answer in result.answers.items()},
        "usage": result.usage.model_dump(),
    }


def _parse_evaluation(content: str) -> JudgeEvaluation:
    """Parse the §67 answer, tolerating markdown-fenced output (F3).

    LLM may wrap the JSON in a fenced code block (optionally with a
    language tag or prose around it) despite the strict prompt — the same
    tolerance the independent path's adapter applies to its model output.
    Plain content is parsed FIRST so a legitimate payload that happens to
    contain backtick sequences is never mangled; only when that fails is
    the first fenced block extracted and retried. Both failures propagate —
    the vocab closure still rejects anything that is not a §67 answer.
    """
    try:
        return JudgeEvaluation.model_validate_json(content)
    except (ValidationError, ValueError):
        match = _FENCED_BLOCK.search(content)
        if match is None:
            raise
        return JudgeEvaluation.model_validate_json(match.group(1).strip())


class JudgeClient:
    """httpx client for the LLM Judge.

    Authenticates every call with `Authorization: Bearer {api_key}`. The key
    is used only for the request header: never logged, never included in
    errors, never persisted. ONE httpx.AsyncClient is built in __init__ and
    reused for every call (fix-forward F10 pattern); the FastAPI lifespan
    closes it on shutdown via `aclose`.
    """

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        timeout: float = JUDGE_TIMEOUT_SECONDS,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.model = model
        self._timeout_seconds = timeout
        self._client = httpx.AsyncClient(
            base_url=self.base_url,
            timeout=timeout,
            transport=transport,
            headers={"Authorization": f"Bearer {api_key}"},
        )

    def _request_ladder(
        self, judge_input: JsonObject, output_schema: dict
    ) -> list[tuple[JsonObject, JsonObject]]:
        """The three (body, configuration) attempts, most-compatible-first."""
        messages = [
            {"role": "system", "content": judge_system_prompt()},
            # J3: canonical (sorted-keys) serialization — the same
            # discipline as request_hash — so semantically equal inputs
            # are byte-identical on the wire and in persisted evidence,
            # independent of dict insertion order.
            {"role": "user", "content": canonical_request_json(judge_input)},
        ]
        base: JsonObject = {"model": self.model, "messages": messages}
        return [
            (
                {
                    **base,
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "judge_evaluation",
                            "schema": output_schema,
                            "strict": True,
                        },
                    },
                    "temperature": 0,
                    "max_tokens": JUDGE_MAX_TOKENS,
                },
                {
                    "model": self.model,
                    "compatibility": "strict",
                    "temperature": 0,
                    "max_tokens": JUDGE_MAX_TOKENS,
                    "timeout_seconds": self._timeout_seconds,
                },
            ),
            (
                {
                    **base,
                    "response_format": {
                        "type": "json_schema",
                        "json_schema": {
                            "name": "judge_evaluation",
                            "schema": output_schema,
                            "strict": False,
                        },
                    },
                    "max_completion_tokens": JUDGE_MAX_TOKENS,
                },
                {
                    "model": self.model,
                    "compatibility": "guided",
                    "max_completion_tokens": JUDGE_MAX_TOKENS,
                    "timeout_seconds": self._timeout_seconds,
                },
            ),
            (
                {**base, "max_completion_tokens": JUDGE_MAX_TOKENS},
                {
                    "model": self.model,
                    "compatibility": "prompted",
                    "max_completion_tokens": JUDGE_MAX_TOKENS,
                    "timeout_seconds": self._timeout_seconds,
                },
            ),
        ]

    async def evaluate(
        self,
        request: JsonObject,
        emulator_result: SystemOneResult,
        jev_result: SystemOneResult,
        comparison: JsonObject,
    ) -> JudgeOutcome:
        judge_input = build_judge_input(request, emulator_result, jev_result, comparison)
        output_schema = JudgeEvaluation.model_json_schema()
        attempts = self._request_ladder(judge_input, output_schema)
        response = None
        configuration: JsonObject = attempts[-1][1]
        for index, (body, attempt_configuration) in enumerate(attempts):
            configuration = attempt_configuration
            try:
                response = await self._client.post(CHAT_COMPLETIONS_ENDPOINT, json=body)
            except httpx.TimeoutException as error:
                raise JudgeProviderError(
                    message="The LLM Judge did not respond within the timeout."
                ) from error
            except httpx.HTTPError as error:
                raise JudgeProviderError(message="The LLM Judge could not be reached.") from error
            # A 400 says THIS BODY is not acceptable — the ladder's next
            # step is exactly the remedy. Anything else (auth, rate limit,
            # success) is final.
            if response.status_code != 400:
                break
        assert response is not None
        if not response.is_success:
            raise JudgeProviderError(
                message=f"The LLM Judge returned HTTP {response.status_code}.",
                status=response.status_code,
            )
        try:
            content = response.json()["choices"][0]["message"]["content"]
            if not isinstance(content, str):
                raise TypeError("content is not a string")
        except (ValueError, KeyError, IndexError, TypeError) as error:
            raise JudgeProviderError(
                message="The LLM Judge returned an unparsable response."
            ) from error
        try:
            evaluation = _parse_evaluation(content)
        except (ValidationError, ValueError) as error:
            raise JudgeProviderError(
                message="The LLM Judge returned an invalid evaluation."
            ) from error
        return JudgeOutcome(
            model=self.model,
            evaluation=evaluation,
            judge_input=judge_input,
            output_schema=output_schema,
            raw_response=content,
            system_instruction=judge_system_prompt(),
            configuration=configuration,
        )

    async def aclose(self) -> None:
        await self._client.aclose()
