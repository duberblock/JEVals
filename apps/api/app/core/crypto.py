"""Secret encryption at rest for the UI-configured provider credentials.

Provider API keys saved through the settings UI are stored as Fernet tokens
in the database — the plaintext key exists only in memory while building a
provider client. The master key comes from (in order):

1. ``SETTINGS_ENCRYPTION_KEY`` — urlsafe-base64 32-byte Fernet key (compose
   secret managers / .env).
2. A key file (``SETTINGS_KEY_FILE``, else ``settings.key`` next to the
   SQLite database) — created with 0600 permissions on first use.

Losing the master key loses the stored credentials (they fall back to the
environment configuration) — keys are never recoverable by design.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings


def _key_file_path() -> Path:
    settings = get_settings()
    if settings.settings_key_file:
        return Path(settings.settings_key_file)
    # Default: beside the SQLite database (sqlite:////data/jevals.db -> /data,
    # sqlite:///./jevals.db -> .). Non-sqlite URLs fall back to the CWD.
    url = settings.database_url
    if url.startswith("sqlite:///"):
        path = url[len("sqlite:///") :]
        return (Path(path).parent / "settings.key").resolve()
    return Path("settings.key").resolve()


def _load_or_create_key() -> bytes:
    key_file = _key_file_path()
    if key_file.exists():
        data = key_file.read_bytes().strip()
        if data:
            return data
    key = Fernet.generate_key()
    key_file.parent.mkdir(parents=True, exist_ok=True)
    key_file.write_bytes(key)
    key_file.chmod(0o600)
    return key


@lru_cache(maxsize=1)
def _fernet() -> Fernet:
    settings = get_settings()
    if settings.settings_encryption_key:
        return Fernet(settings.settings_encryption_key.encode("utf-8"))
    return Fernet(_load_or_create_key())


def reset_crypto_cache() -> None:
    """Test hook: re-resolve the master key after env changes."""
    _fernet.cache_clear()


def encrypt_secret(plaintext: str) -> str:
    """Encrypt one secret into a storable Fernet token."""
    return _fernet().encrypt(plaintext.encode("utf-8")).decode("ascii")


def decrypt_secret(token: str) -> str | None:
    """Decrypt a stored token; None when it cannot be decrypted (a rotated
    or lost master key degrades to "not configured", never to a crash)."""
    try:
        return _fernet().decrypt(token.encode("ascii")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None
