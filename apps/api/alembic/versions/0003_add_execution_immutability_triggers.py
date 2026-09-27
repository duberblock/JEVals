"""add execution immutability triggers

Revision ID: 0003_add_execution_immutability_triggers
Revises: 0002_create_executions
Create Date: 2026-09-22 01:00:00.000000
"""

from collections.abc import Sequence

from alembic import op

revision: str = "0003_add_execution_immutability_triggers"
down_revision: str | None = "0002_create_executions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


IMMUTABLE_MESSAGE = "execution snapshots are immutable"


def upgrade() -> None:
    op.execute(
        f"""
        CREATE TRIGGER prevent_executions_update
        BEFORE UPDATE ON executions
        BEGIN
            SELECT RAISE(ABORT, '{IMMUTABLE_MESSAGE}');
        END
        """
    )
    op.execute(
        f"""
        CREATE TRIGGER prevent_executions_delete
        BEFORE DELETE ON executions
        BEGIN
            SELECT RAISE(ABORT, '{IMMUTABLE_MESSAGE}');
        END
        """
    )


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS prevent_executions_delete")
    op.execute("DROP TRIGGER IF EXISTS prevent_executions_update")
