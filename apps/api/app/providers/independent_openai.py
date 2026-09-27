"""Independent provider: the pinned system-one-adapter behind our port.

Adopted by owner decision R10: PyPI `system-one-adapter==0.2.0` (with the
`[openai]` extra) wrapped exactly per ruling P17 —

    AsyncSystemOneAdapterClient(
        structured_outputs=<OPENAI_STRUCTURED_OUTPUTS, default True (P23)>,
        llm_answer_mode="probabilities",
        normalize_probabilities=True,
        n_retry_malformed_structure=1,
        retry=RetryPolicy(max_retries=2),
        model=<async OpenAI-compatible provider: OpenAI-compatible base URL, server model,
              api="chat_completions", bounded per-attempt timeout>,
    )

The provider instance (not a model STRING) is the adapter's model: it fixes
the SERVER-configured model for every call, so `request.model` never
overrides it in the independent path (ruling P21) — the request document is
persisted as-is as metadata, which the snapshot already does.

The adapter's own prompts are the canonical independent prompts (ruling P19:
fork rejected) — they are captured verbatim in the persisted llm_attempts
evidence (§45).

The adapter is NOT imported by app/domain — this module is the only seam
(port pattern).
"""

from __future__ import annotations

from typing import Any, Literal, Protocol

import openai
from pydantic import ValidationError
from system_one_adapter import AsyncSystemOneAdapterClient, RetryPolicy
from system_one_adapter.providers import AsyncProvider
from system_one_adapter.providers.base import SupportsAsyncClose
from system_one_adapter.providers.openai import AsyncOpenAIProvider
from typesafe_sdk import TypeSafeError

from app.domain.executions.independent_openai import (
    IndependentOpenaiPrediction,
    IndependentOpenaiProviderError,
)
from app.domain.executions.models import JsonObject
from app.schemas.system_one_result import SystemOneResult

# Bounded per-attempt timeout (the superseded plan's ops content): without it
# the OpenAI SDK defaults to 600 s per request, which would let one hung
# LLM attempt stall an execution far past any useful budget.
INDEPENDENT_OPENAI_TIMEOUT_SECONDS = 120.0

# Deliberate TOTAL retry budget (fix-forward F2/review J2). The SDK default
# RetryPolicy timeout is 30 s: the budget governs whether another retry may
# START (it never interrupts an in-flight call), so one slow failing attempt
# (bounded at 120 s above) exhausted the default and P17's two retries only
# ever ran for FAST failures. 300 s deliberately admits the worst useful
# sequence — one bounded 120 s attempt + backoff (<=5 s) + a corrective
# retry (<=120 s), ~245 s — while capping the whole policy far below the
# OpenAI SDK's 600 s per-request default.
INDEPENDENT_OPENAI_RETRY_BUDGET_SECONDS = 300.0

_REDACTED = "[REDACTED]"
# Defensive §45 redaction: credential-shaped keys anywhere inside the
# llm_attempts evidence are replaced before the prediction leaves the
# provider. The adapter records none today; this guards its evolution.
_SENSITIVE_KEYS = frozenset(
    {"authorization", "api_key", "api-key", "apikey", "x-api-key", "x_api_key"}
)


class _TimeoutBoundedAsyncOpenAIProvider(AsyncOpenAIProvider):
    """AsyncOpenAIProvider with a bounded per-attempt HTTP timeout.

    The adapter's provider does not expose a timeout option, so the subclass
    rebuilds the underlying OpenAI client with one (ruling P17). Everything
    else — base_url, api_key, explicit chat_completions API — is inherited.
    """

    def __init__(
        self,
        model_name: str,
        *,
        base_url: str | None,
        api_key: str | None,
        api: Literal["responses", "chat_completions"],
        timeout: float,
    ) -> None:
        super().__init__(model_name, base_url=base_url, api_key=api_key, api=api)
        self._client = openai.AsyncOpenAI(
            base_url=base_url, api_key=api_key, max_retries=0, timeout=timeout
        )


class _AsyncAdapterClient(Protocol):
    """The slice of AsyncSystemOneAdapterClient the wrapper depends on.

    Mirrors the adapter's real positional-call shape (the keyword-only
    provider/model/retry overrides are defaulted there); test doubles only
    ever see the two positional arguments this wrapper passes.
    """

    async def system_one(
        self, state: str | dict[str, Any] | list[Any], questions: Any
    ) -> Any: ...

    async def aclose(self) -> None: ...


class IndependentOpenaiClient:
    """The Independent LLM prediction behind the domain port (plan §11)."""

    def __init__(
        self,
        *,
        base_url: str,
        api_key: str,
        model: str,
        structured_outputs: bool = True,
        timeout: float = INDEPENDENT_OPENAI_TIMEOUT_SECONDS,
        adapter: _AsyncAdapterClient | None = None,
        provider: AsyncProvider | None = None,
    ) -> None:
        """Configure the adapter wiring once for the process.

        `adapter` and `provider` are hermetic-test seams: `provider` injects
        a fake LLM under the REAL adapter (the adapter's own substitution
        seam), `adapter` replaces the adapter entirely to drive only this
        wrapper's logic.
        """
        self.base_url = base_url.rstrip("/")
        self.api_key = api_key
        self.model = model
        self._structured_outputs = structured_outputs
        self._timeout = timeout
        # The provider this wrapper wired into the adapter as `model=`, if it
        # built the adapter itself. The adapter deliberately treats injected
        # provider instances as CALLER-owned (it closes only the providers it
        # built from model strings), so the wrapper — the caller here — must
        # close this provider itself on shutdown (fix-forward F1).
        self._wired_provider: AsyncProvider | None = None
        resolved: _AsyncAdapterClient
        if adapter is None:
            llm: AsyncProvider = provider or _TimeoutBoundedAsyncOpenAIProvider(
                model_name=model,
                base_url=self.base_url,
                api_key=api_key,
                api="chat_completions",
                timeout=timeout,
            )
            resolved = AsyncSystemOneAdapterClient(
                structured_outputs=structured_outputs,
                llm_answer_mode="probabilities",
                normalize_probabilities=True,
                n_retry_malformed_structure=1,
                retry=RetryPolicy(
                    max_retries=2,
                    timeout=INDEPENDENT_OPENAI_RETRY_BUDGET_SECONDS,
                ),
                model=llm,
            )
            self._wired_provider = llm
        else:
            resolved = adapter
        self._adapter = resolved

    async def execute(self, request: JsonObject) -> IndependentOpenaiPrediction:
        # §11: the independent call receives ONLY the original request's
        # state and questions — no emulator/JEV/comparison data exists on
        # this path, and request.model is deliberately not forwarded (P21).
        # Both stay unvalidated Any on purpose: the adapter is the contract
        # authority here and rejects bad shapes (e.g. a None state) with
        # ValueError, which becomes IndependentOpenaiProviderError below.
        state: Any = request.get("state")
        questions: Any = request.get("questions")
        try:
            response = await self._adapter.system_one(state, questions)
        except TypeSafeError as error:
            # Covers the adapter's terminal outcomes, including the synthetic
            # HTTP 200 TypeSafeAPIResponseValidationError raised when output
            # is still malformed after every corrective retry: the adapter
            # RAISES (never returns) that state, so it can never be counted
            # as success here (ruling P22).
            #
            # F4: the terminal error carries `error.debug = {llm_attempts,
            # retry_reasons}` — evidence of a run that already spent tokens.
            # It leaves here REDACTED (same §45 scrub as the success path)
            # together with the run_config, so the §66 failed section can
            # persist what the paid run actually did instead of discarding it.
            debug = getattr(error, "debug", None) or {}
            raise IndependentOpenaiProviderError(
                message="The independent LLM prediction failed.",
                run_config=self.run_config(),
                llm_attempts=_redact_secrets(debug.get("llm_attempts") or []),
                retry_reasons=_redact_secrets(debug.get("retry_reasons") or []),
            ) from error
        except (ValidationError, ValueError, RuntimeError) as error:
            # Question-contract rejections (pydantic), invalid answer modes,
            # or use after shutdown — all configuration/provider failures.
            raise IndependentOpenaiProviderError(
                message="The independent LLM prediction could not be prepared."
            ) from error

        data = response.model_dump(mode="json")
        try:
            result = SystemOneResult.model_validate(
                {
                    "model": data["model"],
                    "answers": data["answers"],
                    "usage": {
                        "input_tokens": data["usage"]["input_tokens"],
                        "output_tokens": data["usage"]["output_tokens"],
                    },
                }
            )
        except (ValidationError, KeyError, TypeError) as error:
            # Mirror-level guard (ADR-004 ruling 15 pattern): a degenerate
            # adapter output becomes a provider error and flows through §66.
            raise IndependentOpenaiProviderError(
                message="The independent LLM prediction returned an unparsable result."
            ) from error

        debug = data.get("debug") or {}
        attempts = debug.get("llm_attempts", [])
        return IndependentOpenaiPrediction(
            result=result,
            llm_attempts=_redact_secrets(attempts),
            run_config=self.run_config(),
        )

    def run_config(self) -> JsonObject:
        """The playground-level run configuration (ruling P22): everything a
        future run needs to reproduce this call EXCEPT credentials — the
        base URL is included, the key never is."""
        return {
            "model": self.model,
            "base_url": self.base_url,
            "structured_outputs": self._structured_outputs,
            "llm_answer_mode": "probabilities",
            "normalize_probabilities": True,
            "max_retries": 2,
            "n_retry_malformed_structure": 1,
            "timeout_seconds": self._timeout,
            # The persisted config must match the RetryPolicy actually handed
            # to the adapter (F2/J2): the budget governs whether a retry may
            # start, not the per-attempt timeout above.
            "retry_budget_seconds": INDEPENDENT_OPENAI_RETRY_BUDGET_SECONDS,
            # F6: the wire mode is explicit per P17 — the provider is pinned
            # to Chat Completions rather than the SDK's host-based default.
            "api": "chat_completions",
            # F6: HONEST null — the adapter exposes no temperature seam, so
            # the playground does not control it. Recorded as absent rather
            # than inventing a value the call never carried.
            "temperature": None,
        }

    async def aclose(self) -> None:
        """Close the adapter AND the provider this wrapper wired into it.

        The adapter's aclose closes only the providers it OWNS (built from
        model strings); the provider instance injected as `model=` stays
        caller-owned — and the caller is this wrapper. Closing in this order
        lets the adapter reject new work and drain its own pools first, then
        releases the underlying OpenAI connection pool (fix-forward F1).
        """
        await self._adapter.aclose()
        wired = self._wired_provider
        if wired is not None and isinstance(wired, SupportsAsyncClose):
            await wired.aclose()


def _redact_secrets(value: Any) -> Any:
    """Recursively replace credential-shaped keys with [REDACTED] (§45)."""
    if isinstance(value, dict):
        return {
            key: (_REDACTED if _is_sensitive_key(key) else _redact_secrets(item))
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [_redact_secrets(item) for item in value]
    return value


def _is_sensitive_key(key: str) -> bool:
    return key.lower() in _SENSITIVE_KEYS
