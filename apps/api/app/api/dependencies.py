from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from fastapi import Depends
from sqlalchemy.orm import Session

from app.domain.executions.emulator import EmulatorProvider
from app.domain.executions.independent_openai import IndependentOpenaiProvider
from app.domain.executions.jev import JevProvider
from app.domain.executions.judge import JudgeProvider
from app.domain.executions.repository import ExecutionRepository
from app.domain.settings.service import EffectiveProvider, effective_providers
from app.persistence.database import SessionLocal, get_session
from app.persistence.repositories.executions import execution_repository_for_session
from app.providers.emulator import EmulatorClient
from app.providers.independent_openai import IndependentOpenaiClient
from app.providers.jev import JevClient
from app.providers.judge import JudgeClient


def get_effective_providers(
    session: Annotated[Session, Depends(get_session)],
) -> dict[str, EffectiveProvider]:
    """Request-scoped effective provider configuration (env + UI).
    Routes consume THIS — never the persistence layer directly."""
    return effective_providers(session)


def effective_without_request() -> dict:
    """Composition-root helper: the dependency-cached provider builders
    have no request session, so they read the settings store through a
    short-lived one."""
    session = SessionLocal()
    try:
        return effective_providers(session)
    finally:
        session.close()


def get_execution_repository(session: Annotated[Session, Depends(get_session)]) -> ExecutionRepository:
    return execution_repository_for_session(session)


@lru_cache(maxsize=1)
def get_emulator_provider() -> EmulatorProvider | None:
    """Build the emulator integration from the EFFECTIVE configuration
    (environment + UI-saved overrides).

    Returns None when no endpoint is configured; the application layer turns
    that into a clear 503-style problem instead of attempting an execution.
    Per-process singleton (fix-forward F10): the underlying client is built
    once and closed by the FastAPI lifespan on shutdown; saving settings
    clears the cache so the next request rebuilds.
    """
    config = effective_without_request()["emulator"]
    if not config.endpoint:
        return None
    return EmulatorClient(
        base_url=config.endpoint,
        api_key=config.api_key,
        default_model=config.model,
    )


@lru_cache(maxsize=1)
def get_jev_provider() -> JevProvider | None:
    """Build the real JEV (Typesafe API) integration from the EFFECTIVE
    configuration.

    Returns None when no key is configured — a configuration precondition,
    not a provider failure: the application layer answers 503 without
    persisting anything. Per-process singleton (fix-forward F10), closed by
    the lifespan on shutdown.
    """
    config = effective_without_request()["jev"]
    if not config.api_key:
        return None
    return JevClient(
        base_url=config.endpoint or "https://api.typesafe.ai",
        api_key=config.api_key,
        model=config.model,
    )


@lru_cache(maxsize=1)
def get_independent_openai_provider() -> IndependentOpenaiProvider | None:
    """Build the Independent LLM prediction integration from the EFFECTIVE
    configuration (independent overrides, else the shared OPENAI_* pair).

    Returns None when key OR model is unset — a configuration precondition:
    the application layer answers 503 llm-not-configured without persisting
    anything. Per-process singleton (fix-forward F10), closed by the
    lifespan on shutdown.
    """
    from app.core.config import get_settings

    settings = get_settings()
    config = effective_without_request()["independent"]
    if not config.api_key or not config.model:
        return None
    return IndependentOpenaiClient(
        base_url=config.endpoint or settings.openai_base_url,
        api_key=config.api_key,
        model=config.model,
        structured_outputs=(
            config.structured_outputs
            if config.structured_outputs is not None
            else settings.openai_structured_outputs
        ),
    )


@lru_cache(maxsize=1)
def get_judge_provider() -> JudgeProvider | None:
    """Build the LLM Semantic Judge integration from the EFFECTIVE
    configuration (judge overrides, else the shared OPENAI_* pair).

    Same availability rule as the independent provider: key AND model are
    both required; otherwise None and the application layer answers 503
    llm-not-configured before any provider runs.
    """
    from app.core.config import get_settings

    settings = get_settings()
    config = effective_without_request()["judge"]
    if not config.api_key or not config.model:
        return None
    return JudgeClient(
        base_url=config.endpoint or settings.openai_base_url,
        api_key=config.api_key,
        model=config.model,
    )


def reset_provider_caches() -> None:
    """Clear the provider singletons — the hermetic-test hook for env
    overrides, the post-save rebuild (PUT /settings), and the post-shutdown
    reset used by the lifespan."""
    get_emulator_provider.cache_clear()
    get_jev_provider.cache_clear()
    get_independent_openai_provider.cache_clear()
    get_judge_provider.cache_clear()
