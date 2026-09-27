from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
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
    authenticated channel and is encrypted BEFORE anything is persisted.
    ``structured_outputs`` is a tri-state (null clears to the environment
    default; true/false are explicit overrides)."""

    endpoint: str | None = None
    model: str | None = None
    api_key: str | None = None
    structured_outputs: bool | None = None


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
    stored_patch: dict[str, dict[str, object]] = {}
    for name in store.PROVIDERS:
        provider_patch = patch.get(name)
        if provider_patch is None:
            continue
        fields: dict[str, object] = {}
        for field in store.FIELDS:
            if field in provider_patch and provider_patch[field] is not None:
                value = provider_patch[field]
                fields[field] = (
                    encrypt_secret(value) if field == "api_key" and value else value
                )
                if field == "structured_outputs":
                    fields[field] = bool(value)
            elif field in provider_patch:
                # Explicit null clears the stored override.
                fields[field] = None
        stored_patch[name] = fields
    store.save_overrides(session, stored_patch)
    # The provider singletons read the effective config at build time —
    # drop them so the next request rebuilds with the new configuration.
    reset_provider_caches()
    return {"providers": public_view(effective_providers(session))}


class CopyJudgeIn(BaseModel):
    """The copy action carries no body fields — it reads the judge's
    EFFECTIVE configuration server-side and never exposes the key."""


@router.post("/copy-judge")
def copy_judge_to_independent(
    session: Annotated[Session, Depends(get_session)],
    _: CopyJudgeIn | None = None,
) -> dict:
    """Copy the Judge's effective configuration into Independent.

    The copy happens server-side: the API key (UI-stored or from the
    environment) moves encrypted-store-to-encrypted-store and never
    reaches the client. Only the fields the Judge actually HAS are
    copied — anything it lacks stays untouched on Independent.
    """
    providers = effective_providers(session)
    judge = providers["judge"]
    # The endpoint always has at least its environment default — a Judge
    # with neither key nor model has nothing worth copying.
    if judge.api_key is None and judge.model is None:
        raise HTTPException(
            status_code=400,
            detail="The Judge has no configuration to copy.",
        )
    fields: dict[str, str | None] = {}
    if judge.endpoint is not None:
        fields["endpoint"] = judge.endpoint
    if judge.model is not None:
        fields["model"] = judge.model
    if judge.api_key is not None:
        fields["api_key"] = encrypt_secret(judge.api_key)
    store.save_overrides(session, {"independent": fields})
    reset_provider_caches()
    return {"providers": public_view(effective_providers(session))}
