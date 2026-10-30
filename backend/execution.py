"""Operational metadata only: no payloads, candidate passages or provider responses."""
import threading
from contextlib import contextmanager
from sqlalchemy import select, update
from backend import models as m
from backend.db import Session, now


def begin(s, row, kind, token):
    # A recovered lease is an interrupted attempt, not successful execution.
    s.execute(update(m.ExecutionAttempt).where(
        m.ExecutionAttempt.org_id == row.org_id, m.ExecutionAttempt.target_kind == kind,
        m.ExecutionAttempt.target_id == row.id, m.ExecutionAttempt.state == "running"
    ).values(state="interrupted", finished_at=now(), error_code="lease_expired"))
    number = (s.scalar(select(m.ExecutionAttempt.number).where(
        m.ExecutionAttempt.org_id == row.org_id, m.ExecutionAttempt.target_kind == kind,
        m.ExecutionAttempt.target_id == row.id).order_by(m.ExecutionAttempt.number.desc()).limit(1)) or 0) + 1
    application_id = row.application_id if hasattr(row, "application_id") else s.get(m.InterviewCoordination, row.coordination_id).application_id
    s.add(m.ExecutionAttempt(org_id=row.org_id, target_kind=kind, target_id=row.id,
        application_id=application_id, number=number, lease_token=token))


def end(s, kind, target_id, token, state, error_code=""):
    s.execute(update(m.ExecutionAttempt).where(m.ExecutionAttempt.target_kind == kind,
        m.ExecutionAttempt.target_id == target_id, m.ExecutionAttempt.lease_token == token,
        m.ExecutionAttempt.state == "running").values(state=state, finished_at=now(),
        heartbeat_at=now(), error_code=error_code[:80]))


@contextmanager
def heartbeat(model, target_id, token, interval=20, lease_seconds=600, active_state="running"):
    stop = threading.Event()
    def beat():
        while not stop.wait(interval):
            try:
                with Session() as s:
                    changed = s.execute(update(model).where(model.id == target_id,
                        model.lease_token == token, model.state == active_state
                    ).values(lease_until=now() + lease_seconds)).rowcount
                    if changed:
                        s.execute(update(m.ExecutionAttempt).where(
                            m.ExecutionAttempt.target_id == target_id,
                            m.ExecutionAttempt.lease_token == token,
                            m.ExecutionAttempt.state == "running").values(heartbeat_at=now()))
                    s.commit()
                    if not changed:
                        return
            except Exception:
                # Database contention never extends ownership locally; final CAS still fences.
                continue
    thread = threading.Thread(target=beat, daemon=True)
    thread.start()
    try:
        yield
    finally:
        stop.set()
        thread.join(timeout=1)
