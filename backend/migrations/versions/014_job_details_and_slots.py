"""Job details (department/type/location) and HR-defined interview slots."""
from alembic import op
import sqlalchemy as sa

revision = "014"
down_revision = "013"
branch_labels = depends_on = None


def upgrade():
    op.add_column("vacancies", sa.Column("department", sa.String(80), nullable=True))
    op.add_column("vacancies", sa.Column("employment_type", sa.String(40), nullable=True))
    op.add_column("vacancies", sa.Column("location", sa.String(80), nullable=True))
    # Per-application token for the public slot-picker link (sent after shortlist).
    op.add_column("applications", sa.Column("schedule_token", sa.String(64), nullable=True))
    op.create_index("ix_applications_schedule_token", "applications", ["schedule_token"], unique=True)
    op.create_table(
        "interview_slots",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("org_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("vacancy_id", sa.String(36), nullable=False),
        sa.Column("starts_at", sa.Float(), nullable=False),
        sa.Column("ends_at", sa.Float(), nullable=False),
        sa.Column("application_id", sa.String(36), nullable=True),
        sa.Column("booked_at", sa.Float(), nullable=True),
        sa.UniqueConstraint("org_id", "id"),
        sa.UniqueConstraint("application_id"),
        sa.ForeignKeyConstraint(["org_id", "vacancy_id"], ["vacancies.org_id", "vacancies.id"]),
        sa.ForeignKeyConstraint(["org_id", "application_id"], ["applications.org_id", "applications.id"]),
        sa.CheckConstraint("ends_at > starts_at"),
    )
    op.create_index("ix_interview_slots_org_id", "interview_slots", ["org_id"])
    op.create_index("ix_interview_slots_created_at", "interview_slots", ["created_at"])
    op.create_index("ix_interview_slots_vacancy_id", "interview_slots", ["vacancy_id"])


def downgrade():
    op.drop_table("interview_slots")
    op.drop_index("ix_applications_schedule_token", table_name="applications")
    op.drop_column("applications", "schedule_token")
    op.drop_column("vacancies", "location")
    op.drop_column("vacancies", "employment_type")
    op.drop_column("vacancies", "department")
