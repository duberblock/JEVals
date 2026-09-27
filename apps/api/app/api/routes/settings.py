from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.dependencies import get_session, reset_provider_caches
from app.core.crypto import encrypt_secret
from app.domain.settings import store
from app.domain.settings.service import effective_providers, public_view

router = APIRouter(prefix="/api/v1/settings", tags=["settings"])


class ProviderSettingsIn(BaseModel):
    """One provider's patch: fields present are replaced (null/"" clears),
    absent fields stay as stored. ``api_key`` arrives in plaintext over the
    authenticated channel and is encrypted BEFORE anything is persisted."""

    endpoint: str | None = None
    model: str | None = None
    api_key: str | None = None


class SettingsIn(BaseModel):
    emulator: ProviderSettingsIn | None = None
    jev: ProviderSettingsIn | None = None
    judge: ProviderSettingsIn | None = None
    independent: ProviderSettingsIn | None = None


@router.get("")
def get_settings_view(
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    return {"providers": public_view(effective_providers(session))}


@router.put("")
def put_settings(
    payload: SettingsIn,
    session: Annotated[Session, Depends(get_session)],
) -> dict:
    patch = payload.model_dump(exclude_none=False)
    stored_patch: dict[str, dict[str, str | None]] = {}
    for name in store.PROVIDERS:
        provider_patch = patch.get(name)
        if provider_patch is None:
            continue
        fields: dict[str, str | None] = {}
        for field in store.FIELDS:
            if field in provider_patch and provider_patch[field] is not None:
                value = provider_patch[field]
                fields[field] = (
                    encrypt_secret(value) if field == "api_key" and value else value
                )
            elif field in provider_patch:
                # Explicit null clears the stored override.
                fields[field] = None
        stored_patch[name] = fields
    store.save_overrides(session, stored_patch)
    # The provider singletons read the effective config at build time —
    # drop them so the next request rebuilds with the new configuration.
    reset_provider_caches()
    return {"providers": public_view(effective_providers(session))}
