"""HR-defined interview slots per vacancy (recruiter side).

The applicant-facing slot picker lives in the same module once scheduling is wired.
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from sqlalchemy import select
from backend import auth, models as m, schemas as d, services as svc
from backend.db import get_db

router = APIRouter(prefix="/api/v1")


def _csrf(request: Request):
    # Recruiter mutations need CSRF like the main API; the public slot picker does not.
    auth.csrf(request)


@router.get("/vacancies/{id}/slots")
def slots(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    v = svc.own(s, m.Vacancy, id, p)
    rows = s.scalars(
        select(m.InterviewSlot)
        .where(m.InterviewSlot.org_id == p.org_id, m.InterviewSlot.vacancy_id == v.id)
        .order_by(m.InterviewSlot.starts_at)
    ).all()
    return {"items": [svc.public(x) for x in rows]}


@router.post("/vacancies/{id}/slots", status_code=201, dependencies=[Depends(_csrf)])
def add(id: str, body: d.SlotsInput, p=Depends(auth.recruiter), s=Depends(get_db)):
    v = svc.own(s, m.Vacancy, id, p)
    svc.add_slots(s, p, v, body.slots)
    svc.event(s, p, "vacancy.updated", "Recruiter added interview slots.", v.id)
    s.commit()
    return slots(id, p, s)


@router.delete("/slots/{id}", dependencies=[Depends(_csrf)])
def remove(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    slot = svc.own(s, m.InterviewSlot, id, p)
    if slot.application_id:
        raise HTTPException(409, "This slot is already booked")
    s.delete(slot)
    s.commit()
    return {"ok": True}


# --- Shortlisted applicant picks an HR slot (public link, token = auth) ---

import secrets
from fastapi import Request
from pydantic import BaseModel
from backend.db import now


@router.post("/applications/{id}/schedule-link", dependencies=[Depends(_csrf)])
def schedule_link(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    a = svc.own(s, m.Application, id, p)
    if a.decision != "shortlist" or a.reassessment_required:
        raise HTTPException(409, "Current recruiter shortlist required")
    if not a.schedule_token:
        a.schedule_token = secrets.token_urlsafe(24)
        svc.event(s, p, "interview.link_created",
            "Recruiter approved an interview invitation; slot-picker link issued.",
            a.vacancy_id, a.id, details={"tool": "schedule_link", "result": "issued"})
    s.commit()
    return {"application_id": a.id, "token": a.schedule_token}


def _scheduled(application_id: str, token: str, s) -> m.Application:
    a = s.get(m.Application, application_id)
    if (
        not a
        or not a.schedule_token
        or not secrets.compare_digest(a.schedule_token, token)
        or a.decision != "shortlist"
        or a.withdrawn_at
    ):
        raise HTTPException(404, "This scheduling link is not available")
    return a


def _open_slots(s, a):
    return s.scalars(
        select(m.InterviewSlot)
        .where(
            m.InterviewSlot.org_id == a.org_id,
            m.InterviewSlot.vacancy_id == a.vacancy_id,
            m.InterviewSlot.application_id.is_(None),
            m.InterviewSlot.starts_at > now(),
        )
        .order_by(m.InterviewSlot.starts_at)
    ).all()


def _slot(x):
    return {"id": x.id, "starts_at": x.starts_at, "ends_at": x.ends_at}


@router.get("/schedule/{application_id}/{token}")
def schedule_view(application_id: str, token: str, s=Depends(get_db)):
    a = _scheduled(application_id, token, s)
    v = s.get(m.Vacancy, a.vacancy_id)
    org = s.get(m.Organization, a.org_id)
    c = s.get(m.Candidate, a.candidate_id)
    booked = s.scalar(select(m.InterviewSlot).where(m.InterviewSlot.application_id == a.id))
    return {
        "title": v.title,
        "company": org.name if org else "",
        "candidate_name": c.display_name if c else "",
        "slots": [_slot(x) for x in _open_slots(s, a)],
        "booked": _slot(booked) if booked else None,
    }


class BookInput(BaseModel):
    slot_id: str


@router.post("/schedule/{application_id}/{token}/book")
def schedule_book(application_id: str, token: str, body: BookInput, request: Request, s=Depends(get_db)):
    auth.rate_limit(request, "schedule", limit=20, window_seconds=3600, identity=token + ":")
    a = _scheduled(application_id, token, s)
    from sqlalchemy import update
    # Rescheduling releases the previous slot first (application_id is unique).
    s.execute(
        update(m.InterviewSlot)
        .where(m.InterviewSlot.org_id == a.org_id, m.InterviewSlot.application_id == a.id)
        .values(application_id=None, booked_at=None)
    )
    # Conditional claim: only an unbooked, future slot of this vacancy can be taken.
    claimed = s.execute(
        update(m.InterviewSlot)
        .where(
            m.InterviewSlot.id == body.slot_id,
            m.InterviewSlot.org_id == a.org_id,
            m.InterviewSlot.vacancy_id == a.vacancy_id,
            m.InterviewSlot.application_id.is_(None),
            m.InterviewSlot.starts_at > now(),
        )
        .values(application_id=a.id, booked_at=now())
    ).rowcount
    if not claimed:
        s.rollback()  # keeps the applicant's previous booking
        alternatives = [_slot(x) for x in _open_slots(s, a)][:3]
        raise HTTPException(409, {"message": "Slot sudah diambil pelamar lain.", "alternatives": alternatives})
    p = auth.Principal(a.org_id, None, "worker", "schedule")
    svc.event(s, p, "interview.booked", "Shortlisted applicant selected an HR-defined interview slot.",
        a.vacancy_id, a.id, details={"tool": "book_slot", "result": "booked"})
    s.commit()
    slot = s.get(m.InterviewSlot, body.slot_id)
    return {"ok": True, "slot": _slot(slot)}
