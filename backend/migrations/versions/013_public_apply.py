"""Public apply link: a shareable vacancy token and the applicant's intro answers."""
from alembic import op
import sqlalchemy as sa

revision = "013"
down_revision = "012"
branch_labels = depends_on = None


def upgrade():
    op.add_column("vacancies", sa.Column("apply_token", sa.String(64), nullable=True))
    op.add_column("vacancies", sa.Column("intro_questions", sa.JSON(), nullable=True))
    op.add_column(
        "applications",
        sa.Column(
            "intro_answers",
            sa.JSON(),
            nullable=False,
            server_default=sa.text("'{}'"),
        ),
    )
    op.create_index("ix_vacancies_apply_token", "vacancies", ["apply_token"], unique=True)


def downgrade():
    op.drop_index("ix_vacancies_apply_token", table_name="vacancies")
    op.drop_column("applications", "intro_answers")
    op.drop_column("vacancies", "intro_questions")
    op.drop_column("vacancies", "apply_token")
