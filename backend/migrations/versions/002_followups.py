"""Persist bounded follow-up reminders."""

from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"


def upgrade():
    columns = {c["name"] for c in sa.inspect(op.get_bind()).get_columns("jobs")}
    if "kind" not in columns:
        op.add_column(
            "jobs",
            sa.Column("kind", sa.String(), nullable=False, server_default="review"),
        )
    if "candidate_id" not in columns:
        op.add_column(
            "jobs",
            sa.Column("candidate_id", sa.String(), nullable=False, server_default=""),
        )


def downgrade():
    op.drop_column("jobs", "candidate_id")
    op.drop_column("jobs", "kind")
