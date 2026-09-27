"""create executions table

Revision ID: 0002_create_executions
Revises: 0001_empty_baseline
Create Date: 2026-09-22 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0002_create_executions"
down_revision: str | None = "0001_empty_baseline"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "executions",
        sa.Column("execution_id", sa.String(), primary_key=True, nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("request_hash", sa.String(), nullable=False),
        sa.Column("mode", sa.String(), nullable=False),
        sa.Column("status", sa.String(), nullable=False),
        sa.Column("question_count", sa.Integer(), nullable=False),
        sa.Column("overall_fidelity", sa.Float(), nullable=True),
        sa.Column("aligned_questions", sa.Integer(), nullable=True),
        sa.Column("semantic_divergence", sa.String(), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("payload", sa.Text(), nullable=False),
    )
    op.create_index("ix_executions_created_at", "executions", ["created_at"])
    op.create_index("ix_executions_request_hash", "executions", ["request_hash"])
    op.create_index("ix_executions_status", "executions", ["status"])


def downgrade() -> None:
    op.drop_index("ix_executions_status", table_name="executions")
    op.drop_index("ix_executions_request_hash", table_name="executions")
    op.drop_index("ix_executions_created_at", table_name="executions")
    op.drop_table("executions")
