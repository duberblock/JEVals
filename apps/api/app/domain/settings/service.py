"""Effective provider configuration: environment layer + UI overrides.

The environment (compose, .env) is the base layer; anything saved through
the settings UI overrides it per field. Explicitly clearing a UI value
falls that field back to the environment. Availability rules mirror the
providers' own preconditions: the emulator needs an endpoint, JEV needs a
key, and each LLM leg (judge, independent) needs key AND model.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy.orm import Session

from app.core.config import DEFAULT_EMULATOR_URL, get_settings
from app.core.crypto import decrypt_secret
from app.domain.settings import store

PROVIDERS = store.PROVIDERS


@dataclass(frozen=True)
class EffectiveProvider:
    endpoint: str | None
    model: str | None
    api_key: str | None
    ui_endpoint: bool = False
    ui_model: bool = False
    ui_api_key: bool = False

    @property
    def available(self) -> bool:
        if self.endpoint is None and self.api_key is None and self.model is None:
            return False
        return True


def _env_layer() -> dict[str, dict[str, str | None]]:
    settings = get_settings()
    shared_llm_base = settings.openai_base_url
    return {
        "emulator": {
            "endpoint": settings.emulator_url,
            "model": settings.emulator_model,
            "api_key": settings.emulator_api_key,
        },
        "jev": {
            "endpoint": settings.typesafe_base_url,
            "model": settings.typesafe_model,
            "api_key": settings.typesafe_api_key,
        },
        "judge": {
            "endpoint": settings.judge_base_url or shared_llm_base,
            "model": settings.judge_model or settings.openai_model,
            "api_key": settings.judge_api_key or settings.openai_api_key,
        },
        "independent": {
            "endpoint": settings.independent_base_url or shared_llm_base,
            "model": settings.independent_model or settings.openai_model,
            "api_key": settings.independent_api_key or settings.openai_api_key,
        },
    }


def _available(name: str, config: dict[str, str | None]) -> bool:
    if name == "emulator":
        return bool(config["endpoint"])
    if name == "jev":
        return bool(config["api_key"])
    # LLM legs: key AND model (the providers' own precondition).
    return bool(config["api_key"]) and bool(config["model"])


def effective_providers(session: Session) -> dict[str, EffectiveProvider]:
    env = _env_layer()
    overrides = store.load_overrides(session)
    result: dict[str, EffectiveProvider] = {}
    for name in PROVIDERS:
        base = env[name]
        stored = overrides[name]
        api_key = (
            decrypt_secret(stored["api_key"]) if stored["api_key"] else None
        ) or base["api_key"]
        result[name] = EffectiveProvider(
            endpoint=stored["endpoint"] or base["endpoint"],
            model=stored["model"] or base["model"],
            api_key=api_key,
            ui_endpoint=stored["endpoint"] is not None,
            ui_model=stored["model"] is not None,
            ui_api_key=stored["api_key"] is not None,
        )
    return result


def _source(ui: bool, value: str | None, default: str | None = None) -> str:
    if ui:
        return "ui"
    if value is None:
        return "none"
    if default is not None and value == default:
        return "default"
    return "env"


def public_view(providers: dict[str, EffectiveProvider]) -> dict[str, dict]:
    """The GET /settings shape: effective endpoint/model, whether a key is
    set, which fields come from the UI, and the SOURCE of every value
    (default | env | ui | none) — NEVER the key itself."""
    view: dict[str, dict] = {}
    for name in PROVIDERS:
        provider = providers[name]
        entry = {
            "endpoint": provider.endpoint,
            "model": provider.model,
            "keySet": provider.api_key is not None,
            "available": _available(
                name,
                {"endpoint": provider.endpoint, "model": provider.model, "api_key": provider.api_key},
            ),
            "configuredHere": {
                "endpoint": provider.ui_endpoint,
                "model": provider.ui_model,
                "apiKey": provider.ui_api_key,
            },
            "sources": {
                "endpoint": _source(provider.ui_endpoint, provider.endpoint, DEFAULT_EMULATOR_URL)
                if name == "emulator"
                else _source(provider.ui_endpoint, provider.endpoint),
                "model": _source(provider.ui_model, provider.model),
                "apiKey": _source(provider.ui_api_key, provider.api_key),
            },
        }
        if name == "emulator":
            # The preset selector needs the factory default client-side.
            entry["defaultEndpoint"] = DEFAULT_EMULATOR_URL
        view[name] = entry
    return view
