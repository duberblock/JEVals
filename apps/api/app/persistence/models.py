from __future__ import annotations

import json
from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

from app.persistence.database import Base


class JSONText(TypeDecorator[dict[str, Any]]):
    impl = Text
    cache_ok = True

    def process_bind_param(self, value: dict[str, Any] | None, dialect) -> str | None:
        if value is None:
            return None
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    def process_result_value(self, value: str | None, dialect) -> dict[str, Any] | None:
        if value is None:
            return None
        return json.loads(value)


class ExecutionRecord(Base):
    __tablename__ = "executions"

    execution_id: Mapped[str] = mapped_column(String, primary_key=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    request_hash: Mapped[str] = mapped_column(String, nullable=False, index=True)
    mode: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[str] = mapped_column(String, nullable=False, index=True)
    question_count: Mapped[int] = mapped_column(Integer, nullable=False)
    overall_fidelity: Mapped[float | None] = mapped_column(Float, nullable=True)
    aligned_questions: Mapped[int | None] = mapped_column(Integer, nullable=True)
    semantic_divergence: Mapped[str | None] = mapped_column(String, nullable=True)
    duration_ms: Mapped[int | None] = mapped_column(Integer, nullable=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JSONText, nullable=False)
