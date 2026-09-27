import base64
import json
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, text
from sqlalchemy.exc import DatabaseError
from sqlalchemy.orm import sessionmaker

from app.domain.executions.models import Execution
from app.persistence.database import Base
from app.persistence.models import ExecutionRecord
from app.persistence.repositories.executions import SQLAlchemyExecutionRepository


API_ROOT = Path(__file__).resolve().parents[2]

REQUEST = {
    "state": "hello",
    "questions": {"tone": {"type": "choice", "criteria": {"warm": None, "cold": None}}},
}


@pytest.fixture
def session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(bind=engine)
    with SessionLocal() as db:
        yield db


def _alembic_config(database_url: str, monkeypatch) -> Config:
    monkeypatch.setenv("DATABASE_URL", database_url)
    alembic_cfg = Config(str(API_ROOT / "alembic.ini"))
    alembic_cfg.set_main_option("script_location", str(API_ROOT / "alembic"))
    return alembic_cfg


def _decode_cursor(cursor: str) -> dict:
    padded = cursor + "=" * (-len(cursor) % 4)
    return json.loads(base64.urlsafe_b64decode(padded.encode()).decode())


def make_execution(execution_id: str, created_at: datetime, status: str = "completed") -> Execution:
    return Execution.create(
        execution_id=execution_id,
        created_at=created_at,
        request=REQUEST,
        mode="compare",
        status=status,
        payload={
            "runtime": {"duration_ms": 10},
            "provenance": {"providers": [], "versions": {}, "timings": {}},
        },
        overall_fidelity=None,
        aligned_questions=None,
        semantic_divergence=None,
        duration_ms=10,
    )


def test_repository_creates_and_reads_an_immutable_snapshot_roundtrip(session):
    repo = SQLAlchemyExecutionRepository(session)
    execution = make_execution("run_0001", datetime(2026, 9, 21, 12, 0, tzinfo=UTC))

    repo.create(execution)
    found = repo.get("run_0001")

    assert found == execution
    stored = session.get(ExecutionRecord, "run_0001")
    assert stored is not None
    assert stored.payload["execution_id"] == "run_0001"
    assert stored.request_hash == execution.request_hash


def test_same_request_hash_can_have_multiple_execution_ids(session):
    repo = SQLAlchemyExecutionRepository(session)
    first = make_execution("run_0001", datetime(2026, 9, 21, 12, 0, tzinfo=UTC))
    second = make_execution("run_0002", datetime(2026, 9, 21, 12, 1, tzinfo=UTC))

    repo.create(first)
    repo.create(second)

    assert first.request_hash == second.request_hash
    page = repo.list(limit=10, request_hash=first.request_hash)
    assert [item.execution.execution_id for item in page.items] == ["run_0002", "run_0001"]


def test_repository_surface_has_no_update_or_delete_mutation_api(session):
    repo = SQLAlchemyExecutionRepository(session)

    assert not hasattr(repo, "update")
    assert not hasattr(repo, "delete")


def test_repository_normalizes_non_utc_created_at_to_utc_for_storage_domain_and_cursor(session):
    repo = SQLAlchemyExecutionRepository(session)
    plus_five = timezone(timedelta(hours=5))
    execution = make_execution("run_tz", datetime(2026, 9, 21, 12, 0, tzinfo=plus_five))

    repo.create(execution)

    stored = session.get(ExecutionRecord, "run_tz")
    assert stored is not None
    assert stored.created_at == datetime(2026, 9, 21, 7, 0)

    page = repo.list(limit=1)
    assert page.items[0].execution.created_at == datetime(2026, 9, 21, 7, 0, tzinfo=UTC)
    assert _decode_cursor(page.items[0].cursor)["created_at"] == "2026-09-21T07:00:00+00:00"


def test_repository_hydrates_domain_from_authoritative_columns_not_payload_duplicates(session):
    repo = SQLAlchemyExecutionRepository(session)
    stale_created_at = "2000-01-01T00:00:00+00:00"
    record = ExecutionRecord(
        execution_id="run_column_wins",
        created_at=datetime(2026, 9, 21, 12, 0),
        request_hash="sha256:column",
        mode="compare",
        status="completed",
        question_count=3,
        overall_fidelity=0.75,
        aligned_questions=2,
        semantic_divergence="low",
        duration_ms=15,
        payload={
            "execution_id": "run_payload",
            "created_at": stale_created_at,
            "request_hash": "sha256:payload",
            "mode": "payload-mode",
            "status": "payload-status",
            "request": REQUEST,
            "provenance": {"providers": [], "versions": {}, "timings": {}},
        },
    )
    session.add(record)
    session.commit()

    execution = repo.get("run_column_wins")

    assert execution is not None
    assert execution.execution_id == "run_column_wins"
    assert execution.created_at == datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
    assert execution.request_hash == "sha256:column"
    assert execution.mode == "compare"
    assert execution.status == "completed"
    assert execution.payload["created_at"] == stale_created_at
    assert execution.payload["execution_id"] == "run_payload"


def test_repository_roundtrip_and_raw_update_abort_against_alembic_migrated_schema(tmp_path, monkeypatch):
    database_url = f"sqlite:///{tmp_path / 'migrated.db'}"
    command.upgrade(_alembic_config(database_url, monkeypatch), "head")
    engine = create_engine(database_url, connect_args={"check_same_thread": False})
    SessionLocal = sessionmaker(bind=engine)
    execution = make_execution("run_migrated", datetime(2026, 9, 21, 12, 0, tzinfo=UTC))

    with SessionLocal() as db:
        repo = SQLAlchemyExecutionRepository(db)
        repo.create(execution)
        assert repo.get("run_migrated") == execution

    with pytest.raises(DatabaseError, match="immutable"):
        with engine.begin() as connection:
            connection.execute(text("UPDATE executions SET status = 'failed' WHERE execution_id = 'run_migrated'"))


def test_repository_lists_with_cursor_pagination_and_status_filter(session):
    repo = SQLAlchemyExecutionRepository(session)
    base = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
    repo.create(make_execution("run_0001", base, status="completed"))
    repo.create(make_execution("run_0002", base + timedelta(minutes=1), status="failed"))
    repo.create(make_execution("run_0003", base + timedelta(minutes=2), status="completed"))

    first_page = repo.list(limit=1, status="completed")
    second_page = repo.list(limit=1, status="completed", cursor=first_page.next_cursor)

    assert [item.execution.execution_id for item in first_page.items] == ["run_0003"]
    assert first_page.next_cursor is not None
    assert [item.execution.execution_id for item in second_page.items] == ["run_0001"]
    assert second_page.next_cursor is None


def walk_all_pages(repo, limit: int) -> list[str]:
    """Walk the full keyset-pagination history collecting execution ids."""
    seen: list[str] = []
    cursor: str | None = None
    while True:
        page = repo.list(limit=limit, cursor=cursor)
        if not page.items:
            return seen
        seen.extend(item.execution.execution_id for item in page.items)
        if page.next_cursor is None:
            return seen
        cursor = page.next_cursor


def test_keyset_pagination_with_equal_created_at_has_exact_coverage_and_stable_order(session):
    # F8a: five executions sharing ONE created_at force every page transition
    # to happen at a tie boundary. The (created_at DESC, execution_id DESC)
    # keyset must deliver each row exactly once, in a deterministic order,
    # with no gaps — a missing secondary sort key would surface here as
    # skipped or duplicated rows.
    repo = SQLAlchemyExecutionRepository(session)
    same_instant = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
    ids = [f"run_{n:04d}" for n in range(1, 6)]
    for execution_id in ids:
        repo.create(make_execution(execution_id, same_instant))

    first_page = repo.list(limit=2)
    assert [item.execution.execution_id for item in first_page.items] == ["run_0005", "run_0004"]
    second_page = repo.list(limit=2, cursor=first_page.next_cursor)
    assert [item.execution.execution_id for item in second_page.items] == ["run_0003", "run_0002"]
    third_page = repo.list(limit=2, cursor=second_page.next_cursor)
    assert [item.execution.execution_id for item in third_page.items] == ["run_0001"]
    assert third_page.next_cursor is None

    walked = walk_all_pages(repo, limit=2)
    assert walked == list(reversed(ids))
    assert len(walked) == len(set(walked))


def test_keyset_pagination_with_equal_created_at_is_deterministic_across_repeated_walks(session):
    # Same tie-heavy fixture, walked twice with a fresh session order: the
    # sequence must be identical every time (stable deterministic order).
    repo = SQLAlchemyExecutionRepository(session)
    same_instant = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
    ids = [f"run_{n:04d}" for n in range(1, 6)]
    for execution_id in reversed(ids):
        repo.create(make_execution(execution_id, same_instant))

    first_walk = walk_all_pages(repo, limit=2)
    second_walk = walk_all_pages(repo, limit=2)

    assert first_walk == second_walk == list(reversed(ids))


def test_keyset_pagination_page_transition_at_tie_boundary_never_skips_older_timestamps(session):
    # Mixed fixture: two rows share the newest instant, three share an older
    # one. The page transition lands exactly on the equal-created_at boundary;
    # the cursor must carry enough information to continue with the remaining
    # tie rows and then fall through to the older instant without skipping.
    repo = SQLAlchemyExecutionRepository(session)
    newer = datetime(2026, 9, 21, 12, 2, tzinfo=UTC)
    older = datetime(2026, 9, 21, 12, 0, tzinfo=UTC)
    repo.create(make_execution("run_old_1", older))
    repo.create(make_execution("run_old_2", older))
    repo.create(make_execution("run_old_3", older))
    repo.create(make_execution("run_new_1", newer))
    repo.create(make_execution("run_new_2", newer))

    walked = walk_all_pages(repo, limit=2)

    assert walked == ["run_new_2", "run_new_1", "run_old_3", "run_old_2", "run_old_1"]
    assert len(walked) == len(set(walked))
