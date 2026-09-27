from __future__ import annotations

import base64
import binascii
import json
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session

from app.domain.executions.models import Execution
from app.domain.executions.repository import ExecutionListItem, ExecutionPage, ExecutionRepository, InvalidExecutionCursor
from app.persistence.models import ExecutionRecord


class SQLAlchemyExecutionRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def create(self, execution: Execution) -> Execution:
        self._session.add(_record_from_execution(execution))
        self._session.commit()
        return execution

    def get(self, execution_id: str) -> Execution | None:
        record = self._session.get(ExecutionRecord, execution_id)
        if record is None:
            return None
        return _execution_from_record(record)

    def list(
        self,
        *,
        limit: int,
        cursor: str | None = None,
        request_hash: str | None = None,
        status: str | None = None,
    ) -> ExecutionPage:
        effective_limit = max(1, min(limit, 100))
        statement = select(ExecutionRecord)
        filters = []
        if request_hash is not None:
            filters.append(ExecutionRecord.request_hash == request_hash)
        if status is not None:
            filters.append(ExecutionRecord.status == status)
        if cursor is not None:
            cursor_value = _decode_cursor(cursor)
            filters.append(
                or_(
                    ExecutionRecord.created_at < cursor_value["created_at"],
                    and_(
                        ExecutionRecord.created_at == cursor_value["created_at"],
                        ExecutionRecord.execution_id < cursor_value["execution_id"],
                    ),
                )
            )
        if filters:
            statement = statement.where(and_(*filters))

        rows = list(
            self._session.scalars(
                statement.order_by(ExecutionRecord.created_at.desc(), ExecutionRecord.execution_id.desc()).limit(effective_limit + 1)
            )
        )
        page_rows = rows[:effective_limit]
        items = [ExecutionListItem(execution=_execution_from_record(record), cursor=_encode_cursor(record)) for record in page_rows]
        next_cursor = items[-1].cursor if len(rows) > effective_limit and items else None
        return ExecutionPage(items=items, next_cursor=next_cursor)


def execution_repository_for_session(session: Session) -> ExecutionRepository:
    return SQLAlchemyExecutionRepository(session)


def _record_from_execution(execution: Execution) -> ExecutionRecord:
    return ExecutionRecord(
        execution_id=execution.execution_id,
        created_at=_as_naive_utc(execution.created_at),
        request_hash=execution.request_hash,
        mode=execution.mode,
        status=execution.status,
        question_count=execution.question_count,
        overall_fidelity=execution.overall_fidelity,
        aligned_questions=execution.aligned_questions,
        semantic_divergence=execution.semantic_divergence,
        duration_ms=execution.duration_ms,
        payload=execution.payload,
    )


def _execution_from_record(record: ExecutionRecord) -> Execution:
    return Execution(
        execution_id=record.execution_id,
        created_at=_as_aware_utc(record.created_at),
        request_hash=record.request_hash,
        mode=record.mode,
        status=record.status,
        question_count=record.question_count,
        overall_fidelity=record.overall_fidelity,
        aligned_questions=record.aligned_questions,
        semantic_divergence=record.semantic_divergence,
        duration_ms=record.duration_ms,
        payload=dict(record.payload),
    )


def _encode_cursor(record: ExecutionRecord) -> str:
    created_at = _as_aware_utc(record.created_at)
    raw = json.dumps(
        {"created_at": created_at.isoformat(), "execution_id": record.execution_id},
        sort_keys=True,
        separators=(",", ":"),
    )
    return base64.urlsafe_b64encode(raw.encode("utf-8")).decode("ascii").rstrip("=")


def _decode_cursor(cursor: str) -> dict[str, Any]:
    try:
        padded = cursor + "=" * (-len(cursor) % 4)
        decoded_bytes = base64.b64decode(padded.encode("ascii"), altchars=b"-_", validate=True)
        decoded = json.loads(decoded_bytes.decode("utf-8"))
        if not isinstance(decoded, dict):
            raise ValueError("cursor payload must be a JSON object")
        created_at = decoded.get("created_at")
        execution_id = decoded.get("execution_id")
        if not isinstance(created_at, str) or not isinstance(execution_id, str) or not execution_id:
            raise ValueError("cursor payload is missing required fields")
        return {"created_at": _as_naive_utc(datetime.fromisoformat(created_at)), "execution_id": execution_id}
    except (binascii.Error, json.JSONDecodeError, UnicodeDecodeError, UnicodeEncodeError, ValueError, TypeError) as exc:
        raise InvalidExecutionCursor("Malformed execution cursor.") from exc


def _as_aware_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _as_naive_utc(value: datetime) -> datetime:
    return _as_aware_utc(value).replace(tzinfo=None)
