from functools import lru_cache
from typing import Literal

from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "sqlite:///./jevals.db"
    emulator_url: str | None = None
    typesafe_api_key: str | None = None
    # API root for the real JEV, matching the vendored SDK's baseURL default.
    typesafe_base_url: str = "https://api.typesafe.ai"
    openai_api_key: str | None = None
    # API root for any OpenAI-compatible chat-completions endpoint (the
    # official OpenAI API is the default; point it at any compatible provider).
    openai_base_url: str = "https://api.openai.com/v1"
    openai_model: str | None = None
    # P23 deployment seam: native structured outputs by default; setting this
    # false switches the independent path to prompted schema + corrective
    # retries with a one-line env change.
    openai_structured_outputs: bool = True
    # Emulator extras (the UI settings override all of these per field).
    emulator_api_key: str | None = None
    emulator_model: str | None = None
    # JEV model passthrough (JevClient keeps its own default when unset).
    typesafe_model: str | None = None
    # Per-leg LLM configuration: when set, wins over the shared OPENAI_*
    # pair so the judge and the independent prediction can point at
    # different endpoints/models/keys.
    judge_api_key: str | None = None
    judge_base_url: str | None = None
    judge_model: str | None = None
    independent_api_key: str | None = None
    independent_base_url: str | None = None
    independent_model: str | None = None
    # Master key for encrypting UI-stored credentials at rest (urlsafe
    # base64 32 bytes). Unset -> a 0600 settings.key file beside the
    # database is generated on first use (see app.core.crypto).
    settings_encryption_key: str | None = None
    settings_key_file: str | None = None
    # Optional product-level default model for capabilities (§63); the key is
    # omitted from the response while unset — never invent names.
    default_model: str | None = None
    auth_user: str | None = None
    auth_pass: str | None = None
    api_port: int = 8000

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Deployment env templates pass empty strings for unset optional
    # variables (compose `${VAR:-}`); an empty provider field means "not
    # configured" and must read as None everywhere downstream.
    @field_validator(
        "emulator_url",
        "emulator_api_key",
        "emulator_model",
        "typesafe_api_key",
        "typesafe_model",
        "openai_api_key",
        "openai_model",
        "default_model",
        "judge_api_key",
        "judge_base_url",
        "judge_model",
        "independent_api_key",
        "independent_base_url",
        "independent_model",
        "settings_encryption_key",
        "settings_key_file",
        mode="before",
    )
    @classmethod
    def _empty_optional_string_is_none(cls, value: object) -> object:
        if isinstance(value, str) and not value.strip():
            return None
        return value


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """The per-process Settings instance (fix-forward F10).

    Cached so every request shares one snapshot of the environment instead
    of re-reading files per call.
    """
    return Settings()


def reset_settings_cache() -> None:
    """Clear the cached Settings — the hermetic-test hook for env overrides."""
    get_settings.cache_clear()
