"""Execution attempt history, redacted event details and controlled retention erasure."""
from alembic import op
import sqlalchemy as sa

revision = "009"
down_revision = "008"
branch_labels = depends_on = None


def upgrade():
    op.create_index("uq_workflow_job_operation", "workflow_jobs", ["org_id", "run_id", "application_id", "kind"], unique=True)
    op.add_column("workflow_events", sa.Column("details", sa.JSON(), nullable=False, server_default="{}"))
    common = lambda: [sa.Column("org_id", sa.String(36), sa.ForeignKey("organizations.id"), nullable=False),
        sa.Column("id", sa.String(36), primary_key=True), sa.Column("created_at", sa.Float(), nullable=False),
        sa.UniqueConstraint("org_id", "id")]
    op.create_table("execution_attempts", *common(),
        sa.Column("target_kind", sa.String(30), nullable=False), sa.Column("target_id", sa.String(36), nullable=False),
        sa.Column("application_id", sa.String(36)), sa.Column("number", sa.Integer(), nullable=False),
        sa.Column("lease_token", sa.String(64), nullable=False), sa.Column("started_at", sa.Float(), nullable=False),
        sa.Column("heartbeat_at", sa.Float(), nullable=False), sa.Column("finished_at", sa.Float()),
        sa.Column("state", sa.String(30), nullable=False), sa.Column("error_code", sa.String(80), nullable=False),
        sa.UniqueConstraint("org_id", "target_kind", "target_id", "number"))
    op.create_table("erasure_grants", *common(), sa.Column("expires_at", sa.Float(), nullable=False))
    op.create_table("file_erasures", *common(), sa.Column("storage_key", sa.Text(), nullable=False),
        sa.Column("state", sa.String(30), nullable=False), sa.Column("error_code", sa.String(80), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False), sa.Column("available_at", sa.Float(), nullable=False))
    # Only DELETE receives a narrowly time-bound maintenance override. UPDATE protections remain.
    dialect = op.get_bind().dialect.name
    inspector = sa.inspect(op.get_bind())
    for table in inspector.get_table_names():
        name = "protect_" + table + "_delete"
        if dialect == "sqlite":
            sql = op.get_bind().execute(sa.text("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=:name"), {"name": name}).scalar()
            if sql:
                op.execute(f'DROP TRIGGER "{name}"')
                sql = sql.replace(" BEGIN SELECT", " AND NOT EXISTS (SELECT 1 FROM erasure_grants WHERE org_id=OLD.org_id AND expires_at > CAST(strftime('%s','now') AS REAL)) BEGIN SELECT")
                op.execute(sql)
        elif dialect == "postgresql":
            exists = op.get_bind().execute(sa.text("SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname=:name)"), {"name": name + "_fn"}).scalar()
            if exists:
                definition = op.get_bind().execute(sa.text("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname=:name"), {"name": name + "_fn"}).scalar()
                definition = definition.replace("BEGIN IF ", "BEGIN IF NOT EXISTS (SELECT 1 FROM erasure_grants WHERE org_id=OLD.org_id AND expires_at > EXTRACT(EPOCH FROM clock_timestamp())) AND (").replace(" THEN RAISE", ") THEN RAISE")
                op.execute(definition)


def downgrade():
    op.drop_index("uq_workflow_job_operation", table_name="workflow_jobs")
    dialect = op.get_bind().dialect.name
    for table in sa.inspect(op.get_bind()).get_table_names():
        name = "protect_" + table + "_delete"
        if dialect == "sqlite":
            sql = op.get_bind().execute(sa.text("SELECT sql FROM sqlite_master WHERE type='trigger' AND name=:name"), {"name": name}).scalar()
            if sql:
                op.execute(f'DROP TRIGGER "{name}"')
                op.execute(sql.replace(" AND NOT EXISTS (SELECT 1 FROM erasure_grants WHERE org_id=OLD.org_id AND expires_at > CAST(strftime('%s','now') AS REAL))", ""))
        elif dialect == "postgresql":
            exists = op.get_bind().execute(sa.text("SELECT EXISTS(SELECT 1 FROM pg_proc WHERE proname=:name)"), {"name": name + "_fn"}).scalar()
            if exists:
                definition = op.get_bind().execute(sa.text("SELECT pg_get_functiondef(oid) FROM pg_proc WHERE proname=:name"), {"name": name + "_fn"}).scalar()
                definition = definition.replace("BEGIN IF NOT EXISTS (SELECT 1 FROM erasure_grants WHERE org_id=OLD.org_id AND expires_at > EXTRACT(EPOCH FROM clock_timestamp())) AND (", "BEGIN IF ").replace(") THEN RAISE", " THEN RAISE")
                op.execute(definition)
    op.drop_table("file_erasures")
    op.drop_table("erasure_grants")
    op.drop_table("execution_attempts")
    op.drop_column("workflow_events", "details")
