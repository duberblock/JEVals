from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.exc import DatabaseError

API_ROOT = Path(__file__).resolve().parents[2]


def _alembic_config(database_url: str, monkeypatch) -> Config:
    monkeypatch.setenv("DATABASE_URL", database_url)
    alembic_cfg = Config(str(API_ROOT / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    return alembic_cfg


def test_alembic_migration_creates_and_drops_hybrid_executions_table(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path / 'jevals.db'}"
    alembic_cfg = _alembic_config(database_url, monkeypatch)

    command.upgrade(alembic_cfg, "head")
    engine = create_engine(database_url)
    inspector = inspect(engine)

    columns = {column["name"]: column for column in inspector.get_columns("executions")}
    assert set(columns) == {
        "execution_id",
        "created_at",
        "request_hash",
        "mode",
        "status",
        "question_count",
        "overall_fidelity",
        "aligned_questions",
        "semantic_divergence",
        "duration_ms",
        "payload",
    }
    assert columns["payload"]["nullable"] is False
    assert columns["execution_id"]["primary_key"] == 1

    command.downgrade(alembic_cfg, "base")
    assert not inspect(engine).has_table("executions")


def test_execution_migration_prevents_raw_updates_and_deletes(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path / 'immutable.db'}"
    alembic_cfg = _alembic_config(database_url, monkeypatch)
    command.upgrade(alembic_cfg, "head")
    engine = create_engine(database_url)

    with engine.begin() as connection:
        connection.execute(
            text(
                """
                INSERT INTO executions (
                    execution_id,
                    created_at,
                    request_hash,
                    mode,
                    status,
                    question_count,
                    overall_fidelity,
                    aligned_questions,
                    semantic_divergence,
                    duration_ms,
                    payload
                ) VALUES (
                    'run_immutable',
                    '2026-09-21 12:00:00',
                    'sha256:test',
                    'compare',
                    'completed',
                    1,
                    NULL,
                    NULL,
                    NULL,
                    10,
                    '{"execution_id":"run_immutable"}'
                )
                """
            )
        )

    with pytest.raises(DatabaseError, match="immutable"):
        with engine.begin() as connection:
            connection.execute(text("UPDATE executions SET status = 'failed' WHERE execution_id = 'run_immutable'"))

    with pytest.raises(DatabaseError, match="immutable"):
        with engine.begin() as connection:
            connection.execute(text("DELETE FROM executions WHERE execution_id = 'run_immutable'"))

    command.downgrade(alembic_cfg, "base")
    assert not inspect(engine).has_table("executions")
