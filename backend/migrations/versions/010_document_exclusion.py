"""Recover from an unreadable original without deleting source history."""
from alembic import op
import sqlalchemy as sa
revision = "010"
down_revision = "009"
branch_labels = depends_on = None

def upgrade():
    op.add_column("documents", sa.Column("excluded_at", sa.Float(), nullable=True))
    op.add_column("documents", sa.Column("exclusion_reason", sa.Text(), nullable=False, server_default=""))

def downgrade():
    op.drop_column("documents", "exclusion_reason")
    op.drop_column("documents", "excluded_at")
