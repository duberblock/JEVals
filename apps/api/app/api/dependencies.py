from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.domain.executions.emulator import EmulatorProvider
from app.domain.executions.independent_openai import IndependentOpenaiProvider
from app.domain.executions.jev import JevProvider
from app.domain.executions.judge import JudgeProvider
from app.domain.executions.repository import ExecutionRepository
from app.persistence.database import get_session
from app.persistence.repositories.executions import execution_repository_for_session
from app.providers.emulator import EmulatorClient
from app.providers.independent_openai import IndependentOpenaiClient
from app.providers.jev import JevClient
from app.providers.judge import JudgeClient


def get_execution_repository(session: Annotated[Session, Depends(get_session)]) -> ExecutionRepository:
    return execution_repository_for_session(session)


@lru_cache(maxsize=1)
def get_emulator_provider() -> EmulatorProvider | None:
    """Build the emulator integration from environment settings.

    Returns None when EMULATOR_URL is unset; the application layer turns that
    into a clear 503-style problem instead of attempting an execution.
    Per-process singleton (fix-forward F10): the underlying client is built
    once and closed by the FastAPI lifespan on shutdown.
    """
    settings = get_settings()
    if not settings.emulator_url:
        return None
    return EmulatorClient(base_url=settings.emulator_url)


@lru_cache(maxsize=1)
def get_jev_provider() -> JevProvider | None:
    """Build the real JEV (Typesafe API) integration from environment settings.

    Returns None when TYPESAFE_API_KEY is unset — a configuration
    precondition, not a provider failure (ADR-003 ruling 4 pattern): the
    application layer answers 503 without persisting anything. Per-process
    singleton (fix-forward F10), closed by the lifespan on shutdown.
    """
    settings = get_settings()
    if not settings.typesafe_api_key:
        return None
    return JevClient(base_url=settings.typesafe_base_url, api_key=settings.typesafe_api_key)


@lru_cache(maxsize=1)
def get_independent_openai_provider() -> IndependentOpenaiProvider | None:
    """Build the Independent LLM prediction integration (ruling R10).

    Returns None when OPENAI_API_KEY OR OPENAI_MODEL is unset — a configuration
    precondition (ADR-003 ruling 4 pattern): the application layer answers
    503 llm-not-configured without persisting anything. Per-process
    singleton (fix-forward F10), closed by the lifespan on shutdown.
    """
    settings = get_settings()
    if not settings.openai_api_key or not settings.openai_model:
        return None
    return IndependentOpenaiClient(
        base_url=settings.openai_base_url,
        api_key=settings.openai_api_key,
        model=settings.openai_model,
        structured_outputs=settings.openai_structured_outputs,
    )


@lru_cache(maxsize=1)
def get_judge_provider() -> JudgeProvider | None:
    """Build the LLM Semantic Judge integration (ruling R10/P19).

    Same availability rule as the independent provider: both LLM settings
    (key AND model) are required; otherwise None and the application layer
    answers 503 llm-not-configured before any provider runs.
    """
    settings = get_settings()
    if not settings.openai_api_key or not settings.openai_model:
        return None
    return JudgeClient(
        base_url=settings.openai_base_url,
        api_key=settings.openai_api_key,
        model=settings.openai_model,
    )


def reset_provider_caches() -> None:
    """Clear the provider singletons — the hermetic-test hook for env
    overrides, and the post-shutdown reset used by the lifespan."""
    get_emulator_provider.cache_clear()
    get_jev_provider.cache_clear()
    get_independent_openai_provider.cache_clear()
    get_judge_provider.cache_clear()
