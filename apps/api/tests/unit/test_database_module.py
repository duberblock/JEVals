"""The database module resolves its engine lazily through the canonical
Settings cache — no import-time engine, and a settings change is observable
after reset_database_cache() (the same hermetic pattern as crypto)."""

from app.core.config import get_settings
from app.persistence import database


def test_engine_is_cached_and_responsive_to_settings_reset(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "sqlite:////tmp/jevals-reset-test.db")
    get_settings.cache_clear()
    database.reset_database_cache()
    try:
        assert str(database.get_engine().url) == "sqlite:////tmp/jevals-reset-test.db"
        # lru_cache: one engine per resolution window.
        assert database.get_engine() is database.get_engine()
    finally:
        monkeypatch.delenv("DATABASE_URL", raising=False)
        get_settings.cache_clear()
        database.reset_database_cache()
