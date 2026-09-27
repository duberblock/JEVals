"""The UI settings store: provider credential overrides persisted in SQLite.

Shape (single row, id=1, JSON document in a TEXT column)::

    {
      "emulator":     {"endpoint": str|null, "model": str|null, "api_key": <token>|null},
      "jev":          {"endpoint": str|null, "model": str|null, "api_key": <token>|null},
      "judge":        {"endpoint": str|null, "model": str|null, "api_key": <token>|null},
      "independent":  {"endpoint": str|null, "model": str|null, "api_key": <token>|null}
    }

``api_key`` values are ALWAYS Fernet tokens (see app.core.crypto) — this
module never sees plaintext. A per-provider patch replaces only the fields
it carries; explicit null (or "") clears that override, falling the
effective configuration back to the environment layer.
"""

from __future__ import annotations

import json
from typing import Any

from sqlalchemy import text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

PROVIDERS = ("emulator", "jev", "judge", "independent")
FIELDS = ("endpoint", "model", "api_key")

EMPTY_SETTINGS: dict[str, dict[str, str | None]] = {
    name: {"endpoint": None, "model": None, "api_key": None} for name in PROVIDERS
}


def _normalize(value: Any) -> str | None:
    if value is None:
        return None
    stripped = str(value).strip()
    return stripped or None


def _clone_empty() -> dict[str, dict[str, str | None]]:
    return {name: dict(fields) for name, fields in EMPTY_SETTINGS.items()}


def load_overrides(session: Session) -> dict[str, dict[str, str | None]]:
    try:
        row = session.execute(
            text("SELECT data FROM app_settings WHERE id = 1")
        ).scalar_one_or_none()
    except OperationalError:
        # A database that has not run migrations yet has no overrides —
        # degrade to the environment layer instead of crashing reads.
        return _clone_empty()
    result = _clone_empty()
    if row is None:
        return result
    try:
        data = json.loads(row)
    except (TypeError, ValueError):
        return result
    if not isinstance(data, dict):
        return result
    for name in PROVIDERS:
        stored = data.get(name)
        if isinstance(stored, dict):
            for field in FIELDS:
                result[name][field] = _normalize(stored.get(field))
    return result


def save_overrides(
    session: Session, patch: dict[str, dict[str, Any]]
) -> dict[str, dict[str, str | None]]:
    """Merge a per-provider patch into the stored JSON and commit."""
    current = load_overrides(session)
    for name in PROVIDERS:
        provider_patch = patch.get(name)
        if not isinstance(provider_patch, dict):
            continue
        for field in FIELDS:
            if field in provider_patch:
                current[name][field] = _normalize(provider_patch[field])
    session.execute(
        text(
            "INSERT INTO app_settings (id, data) VALUES (1, :data) "
            "ON CONFLICT(id) DO UPDATE SET data = :data"
        ),
        {"data": json.dumps(current)},
    )
    session.commit()
    return current
