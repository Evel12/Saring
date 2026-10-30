"""Immutable finding analysis provenance."""
from alembic import op
import sqlalchemy as sa

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("finding_revisions", sa.Column("provenance", sa.JSON(), nullable=False, server_default="{}"))


def downgrade():
    op.drop_column("finding_revisions", "provenance")
