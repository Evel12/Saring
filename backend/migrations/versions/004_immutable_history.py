"""Database-level approved criteria and append-only history protections."""

from alembic import op

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None

HISTORY = (
    "extraction_versions",
    "evidence_items",
    "findings",
    "finding_revisions",
    "finding_evidence",
    "clarification_responses",
    "approvals",
    "recruiter_decisions",
    "workflow_events",
    "metrics",
)


def rules():
    result = []
    for table in HISTORY:
        result.append((table, "UPDATE", "1=1", "TRUE"))
        result.append(
            (
                table,
                "DELETE",
                "NOT EXISTS (SELECT 1 FROM organizations WHERE id=OLD.org_id AND is_demo=1)",
                "NOT EXISTS (SELECT 1 FROM organizations WHERE id=OLD.org_id AND is_demo=TRUE)",
            )
        )
    result.append(
        (
            "requirement_versions",
            "UPDATE",
            "OLD.state='approved'",
            "OLD.state='approved'",
        )
    )
    result.append(
        (
            "requirement_versions",
            "DELETE",
            "OLD.state='approved' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id=OLD.org_id AND is_demo=1)",
            "OLD.state='approved' AND NOT EXISTS (SELECT 1 FROM organizations WHERE id=OLD.org_id AND is_demo=TRUE)",
        )
    )
    for action in ("INSERT", "UPDATE", "DELETE"):
        record = "NEW" if action == "INSERT" else "OLD"
        condition = f"EXISTS (SELECT 1 FROM requirement_versions WHERE id={record}.version_id AND state='approved')"
        if action == "DELETE":
            result.append(
                (
                    "requirements",
                    action,
                    condition
                    + " AND NOT EXISTS (SELECT 1 FROM organizations WHERE id=OLD.org_id AND is_demo=1)",
                    condition
                    + " AND NOT EXISTS (SELECT 1 FROM organizations WHERE id=OLD.org_id AND is_demo=TRUE)",
                )
            )
        else:
            result.append(("requirements", action, condition, condition))
    return result


def upgrade():
    dialect = op.get_bind().dialect.name
    for table, action, sqlite_condition, pg_condition in rules():
        name = f"protect_{table}_{action.lower()}"
        if dialect == "sqlite":
            op.execute(
                f"CREATE TRIGGER {name} BEFORE {action} ON {table} WHEN {sqlite_condition} BEGIN SELECT RAISE(ABORT, 'immutable history'); END"
            )
        elif dialect == "postgresql":
            op.execute(
                f"CREATE FUNCTION {name}_fn() RETURNS trigger AS $$ BEGIN IF {pg_condition} THEN RAISE EXCEPTION 'immutable history'; END IF; RETURN {'NEW' if action!='DELETE' else 'OLD'}; END; $$ LANGUAGE plpgsql"
            )
            op.execute(
                f"CREATE TRIGGER {name} BEFORE {action} ON {table} FOR EACH ROW EXECUTE FUNCTION {name}_fn()"
            )


def downgrade():
    dialect = op.get_bind().dialect.name
    for table, action, _, _ in reversed(rules()):
        name = f"protect_{table}_{action.lower()}"
        if dialect == "sqlite":
            op.execute(f"DROP TRIGGER IF EXISTS {name}")
        elif dialect == "postgresql":
            op.execute(f"DROP TRIGGER IF EXISTS {name} ON {table}")
            op.execute(f"DROP FUNCTION IF EXISTS {name}_fn()")
