from __future__ import annotations

from functools import lru_cache
from typing import Iterator

from sqlalchemy import Engine, create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.core.config import get_settings


# Lazy, hermetic resolution: the engine binds to the CANONICAL Settings
# (get_settings lru_cache) on first use, not at import time — importing this
# module has no side effects, and settings changes are observable after
# reset_database_cache() exactly like the crypto/settings caches.
@lru_cache(maxsize=1)
def get_engine() -> Engine:
    settings = get_settings()
    return create_engine(
        settings.database_url,
        connect_args={"check_same_thread": False} if settings.database_url.startswith("sqlite") else {},
    )


@lru_cache(maxsize=1)
def get_session_local() -> sessionmaker:
    return sessionmaker(autocommit=False, autoflush=False, bind=get_engine())


def reset_database_cache() -> None:
    """Test hook: re-resolve engine and session factory after settings changes."""
    get_engine.cache_clear()
    get_session_local.cache_clear()


def get_session() -> Iterator[Session]:
    db = get_session_local()()
    try:
        yield db
    finally:
        db.close()


class Base(DeclarativeBase):
    pass
