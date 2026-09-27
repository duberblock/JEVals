from functools import lru_cache

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
    # Optional product-level default model for capabilities (§63); the key is
    # omitted from the response while unset — never invent names.
    default_model: str | None = None
    auth_user: str | None = None
    auth_pass: str | None = None
    api_port: int = 8000

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


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
