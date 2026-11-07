"""Server-level AI provider and model selection, including Ollama."""
from alembic import op
import sqlalchemy as sa

revision = "011"
down_revision = "010"
branch_labels = depends_on = None


def upgrade():
    op.create_table(
        "ai_model_configs",
        sa.Column("context", sa.String(length=16), nullable=False),
        sa.Column("provider", sa.String(length=16), nullable=False),
        sa.Column("base_url", sa.String(length=500), server_default="", nullable=False),
        sa.Column("model", sa.String(length=200), server_default="", nullable=False),
        sa.Column("updated_by", sa.String(length=254), server_default="", nullable=False),
        sa.Column("updated_at", sa.Float(), nullable=False),
        sa.CheckConstraint("provider IN ('openai', 'ollama')", name="ck_ai_provider"),
        sa.PrimaryKeyConstraint("context"),
    )


def downgrade():
    op.drop_table("ai_model_configs")
