"""create app_settings (UI provider credentials, keys encrypted)

Revision ID: 0004_create_app_settings
Revises: 0003_add_execution_immutability_triggers
Create Date: 2026-09-27 00:00:00.000000
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0004_create_app_settings"
down_revision: str | None = "0003_add_execution_immutability_triggers"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Single-row JSON document (id=1). `api_key` values inside `data` are
    # Fernet tokens — plaintext keys never touch this table.
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("data", sa.Text(), nullable=False),
    )
    op.execute("INSERT INTO app_settings (id, data) VALUES (1, '{}')")


def downgrade() -> None:
    op.drop_table("app_settings")
