"""Team invitations, platform administrators, organization status, stored AI key."""
from alembic import op
import sqlalchemy as sa

revision = "015"
down_revision = "014"
branch_labels = depends_on = None


def upgrade():
    op.add_column("users", sa.Column("is_platform_admin", sa.Boolean(), nullable=False, server_default=sa.false()))
    # Status is validated in code; a CHECK would need SQLite to rebuild this
    # heavily referenced table, which existing local databases should not risk.
    op.add_column("organizations", sa.Column("status", sa.String(20), nullable=False, server_default="active"))
    # Fernet-encrypted provider key chosen in the platform console (never returned to browsers).
    op.add_column("ai_model_configs", sa.Column("api_key_enc", sa.Text(), nullable=True))
    op.create_table(
        "team_invitations",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("created_at", sa.Float(), nullable=False),
        sa.Column("org_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("email", sa.String(254), nullable=False),
        sa.Column("display_name", sa.String(160), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("invited_by", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("expires_at", sa.Float(), nullable=False),
        sa.Column("accepted_at", sa.Float(), nullable=True),
        sa.Column("accepted_user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=True),
        sa.Column("revoked_at", sa.Float(), nullable=True),
        sa.UniqueConstraint("org_id", "id"),
        sa.CheckConstraint("role IN ('admin','recruiter')"),
    )
    op.create_index("ix_team_invitations_org_id", "team_invitations", ["org_id"])
    op.create_index("ix_team_invitations_email", "team_invitations", ["email"])
    op.create_index("ix_team_invitations_created_at", "team_invitations", ["created_at"])
    # Existing installs: the first account created becomes the platform administrator.
    op.execute(
        "UPDATE users SET is_platform_admin = true WHERE id = "
        "(SELECT id FROM users ORDER BY created_at LIMIT 1)"
    )


def downgrade():
    op.drop_table("team_invitations")
    op.drop_column("ai_model_configs", "api_key_enc")
    op.drop_column("organizations", "status")
    op.drop_column("users", "is_platform_admin")
