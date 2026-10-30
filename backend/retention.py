"""Explicit tenant-scoped application erasure and restartable private-file cleanup.

Run with API/workers stopped. Backups and external providers need separate erasure.
"""
import argparse
import os
from pathlib import Path
from sqlalchemy import select, delete, or_, text
from backend import models as m
from backend.db import Base, Session, now


def erase_application(s, org_id, application_id):
    a = s.scalar(select(m.Application).where(m.Application.org_id == org_id, m.Application.id == application_id))
    if not a:
        raise ValueError("Application not found in organization")
    if not a.withdrawn_at:
        raise ValueError("Withdraw application and stop workers before erasure")
    # Do not erase provider identifiers until uncertain outcomes/event cancellation are resolved.
    active = s.scalar(select(m.InterviewCoordination).where(m.InterviewCoordination.org_id == org_id,
        m.InterviewCoordination.application_id == a.id,
        m.InterviewCoordination.state.not_in(["cancelled", "response_timeout"])))
    if active:
        raise ValueError("Resolve calendar cancellation/provider uncertainty before erasure")
    candidate_id = a.candidate_id
    selected = {"applications": {a.id}}
    tables = [t for t in Base.metadata.sorted_tables if "org_id" in t.c]
    # Walk actual FK references, never text matching or unscoped IDs. Includes caches,
    # responses, immutable revisions, token sessions, provider payloads and history.
    changed = True
    while changed:
        changed = False
        for t in tables:
            predicates = []
            for fk in t.foreign_keys:
                if fk.column.name == "id" and fk.column.table.name in selected:
                    predicates.append(fk.parent.in_(selected[fk.column.table.name]))
            # Attempt records intentionally retain no FK to support interrupted/deleted targets.
            if t.name == "execution_attempts":
                predicates.append(t.c.application_id == a.id)
            if t.name == "approvals":
                predicates.append(t.c.target_id.in_(set().union(*selected.values())))
            if t.name == "metrics":
                predicates.append(t.c.labels["application_id"].as_string() == a.id)
            if not predicates:
                continue
            ids = set(s.scalars(select(t.c.id).where(t.c.org_id == org_id, or_(*predicates))))
            delta = ids - selected.get(t.name, set())
            if delta:
                selected.setdefault(t.name, set()).update(delta)
                changed = True
    for doc in s.scalars(select(m.Document).where(m.Document.org_id == org_id, m.Document.application_id == a.id)):
        if not doc.synthetic:
            s.add(m.FileErasure(org_id=org_id, storage_key=doc.storage_key))
    grant = m.ErasureGrant(org_id=org_id, expires_at=now() + 300)
    s.add(grant)
    s.flush()
    count = 0
    for t in reversed(tables):
        ids = selected.get(t.name)
        if ids:
            count += s.execute(delete(t).where(t.c.org_id == org_id, t.c.id.in_(ids))).rowcount
    # Operational contact identity may be shared by multiple applications.
    if not s.scalar(select(m.Application.id).where(m.Application.org_id == org_id, m.Application.candidate_id == candidate_id).limit(1)):
        s.execute(delete(m.Candidate).where(m.Candidate.org_id == org_id, m.Candidate.id == candidate_id))
    s.execute(delete(m.ErasureGrant).where(m.ErasureGrant.id == grant.id))
    return count


def cleanup_files(s, org_id=None):
    root = Path(os.getenv("STORAGE_ROOT", "storage")).resolve()
    query = select(m.FileErasure).where(m.FileErasure.state.in_(["queued", "failed"]), m.FileErasure.attempts < 3, m.FileErasure.available_at <= now())
    if org_id:
        query = query.where(m.FileErasure.org_id == org_id)
    for row in s.scalars(query.limit(100)):
        row.attempts += 1
        try:
            target = (root / row.storage_key).resolve()
            if not target.is_relative_to(root) or target == root:
                raise ValueError("unsafe_storage_key")
            target.unlink(missing_ok=True)
            row.state = "deleted"
            row.storage_key = ""
            row.error_code = ""
        except (OSError, ValueError) as exc:
            row.state = "needs_attention" if row.attempts >= 3 else "failed"
            row.available_at = now() + 2 ** row.attempts
            row.error_code = type(exc).__name__
    s.commit()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--organization", required=True)
    parser.add_argument("--application")
    parser.add_argument("--execute", action="store_true")
    parser.add_argument("--cleanup-files", action="store_true")
    parser.add_argument("--retry-files", action="store_true", help="Explicitly reset exhausted file cleanup attempts in this organization")
    args = parser.parse_args()
    days = int(os.getenv("RETENTION_WITHDRAWN_DAYS", "365"))
    if days < 1:
        raise ValueError("RETENTION_WITHDRAWN_DAYS must be positive")
    with Session() as s:
        if s.bind.dialect.name == "sqlite":
            s.execute(text("PRAGMA secure_delete=ON"))
        if args.cleanup_files:
            if args.retry_files:
                from sqlalchemy import update
                s.execute(update(m.FileErasure).where(m.FileErasure.org_id == args.organization,
                    m.FileErasure.state == "needs_attention").values(state="queued",attempts=0,available_at=now()))
                s.commit()
            cleanup_files(s, args.organization)
            return
        q = select(m.Application).where(m.Application.org_id == args.organization)
        q = q.where(m.Application.id == args.application) if args.application else q.where(m.Application.withdrawn_at < now() - days * 86400)
        ids = list(s.scalars(q.with_only_columns(m.Application.id)))
        print(f"{len(ids)} application(s) {'selected for erasure' if args.execute else 'eligible; dry run'}")
        if args.execute:
            for app_id in ids:
                erase_application(s, args.organization, app_id)
            s.commit()
            cleanup_files(s, args.organization)
            if s.bind.dialect.name == "sqlite":
                # Offline maintenance only. Backups/snapshots still need their own lifecycle.
                s.execute(text("VACUUM"))


if __name__ == "__main__":
    main()
