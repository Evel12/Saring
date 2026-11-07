"""Persisted agent-review results (summary, strengths, details, link checks)."""
from alembic import op
import sqlalchemy as sa

revision = "012"
down_revision = "011"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "analysis_insights",
        sa.Column("id", sa.String(length=36), primary_key=True),
        sa.Column("org_id", sa.String(length=36), nullable=False),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("application_id", sa.String(length=36), nullable=False),
        sa.Column("run_id", sa.String(length=36), nullable=True),
        sa.Column("kind", sa.String(length=20), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("payload", sa.JSON(), nullable=False),
        sa.ForeignKeyConstraint(["org_id", "application_id"], ["applications.org_id", "applications.id"]),
        sa.ForeignKeyConstraint(["org_id", "run_id"], ["workflow_runs.org_id", "workflow_runs.id"]),
        sa.CheckConstraint("kind IN ('summary','strength','detail','link')", name="ck_insight_kind"),
        sa.UniqueConstraint("org_id", "id"),
    )
    op.create_index("ix_analysis_insights_application", "analysis_insights", ["org_id", "application_id", "created_at"])


def downgrade():
    op.drop_index("ix_analysis_insights_application", table_name="analysis_insights")
    op.drop_table("analysis_insights")
