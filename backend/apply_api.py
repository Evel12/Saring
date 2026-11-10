"""Public, no-login vacancy application link.

Anyone holding the vacancy's share token can view the posting and submit their
name, email, documents (CV etc.) and short answers to the company's
intro questions. The link is the only authentication: submissions are strictly
rate- and size-limited, files are validated with the same size/magic-byte rules
as recruiter uploads (via svc.store_upload), and everything lands in the
recruiting workspace as a normal pending application reviewed like any other.
"""
import json, re, secrets
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from backend import auth, models as m, services as svc
from backend.db import get_db
from sqlalchemy import select

router = APIRouter(prefix="/api/v1")

EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _vacancy(vacancy_id: str, token: str, s) -> m.Vacancy:
    v = s.get(m.Vacancy, vacancy_id)
    if (
        not v
        or not v.apply_token
        or not secrets.compare_digest(v.apply_token, token)
        or not v.active_requirement_version_id
    ):
        raise HTTPException(404, "This application link is not available")
    if v.deleted_at or v.state != "published":
        # Valid link, but HR closed/deleted the vacancy: tell the applicant so.
        org = s.get(m.Organization, v.org_id)
        raise HTTPException(410, {"message": "This vacancy is closed",
            "title": v.title, "company": (org.name if org else "") or ""})
    return v


@router.get("/apply/{vacancy_id}/{token}")
def apply_view(vacancy_id: str, token: str, s=Depends(get_db)):
    v = _vacancy(vacancy_id, token, s)
    org = s.get(m.Organization, v.org_id)
    criteria = s.scalars(
        select(m.Requirement).where(m.Requirement.version_id == v.active_requirement_version_id)
    ).all()
    return {
        "vacancy_id": v.id,
        "title": v.title,
        "company": (org.name if org else "") or "",
        "description": (v.description or "")[:5000],
        "questions": v.intro_questions or [],
        "department": v.department or "",
        "employment_type": v.employment_type or "",
        "location": v.location or "",
        "required_skills": [c.description for c in criteria if c.importance == "essential"],
        "preferred_skills": [c.description for c in criteria if c.importance == "preferred"],
    }


@router.post("/apply/{vacancy_id}/{token}/submit", status_code=201)
async def apply_submit(
    vacancy_id: str,
    token: str,
    request: Request,
    display_name: str = Form(...),
    email: str = Form(...),
    answers: str | None = Form(None),
    files: list[UploadFile] = File([]),
    s=Depends(get_db),
):
    auth.rate_limit(request, "apply", limit=10, window_seconds=3600, identity=token + ":")
    v = _vacancy(vacancy_id, token, s)
    name = " ".join((display_name or "").split())[:160]
    email = (email or "").strip().lower()[:254]
    if len(name) < 2 or not EMAIL.match(email):
        raise HTTPException(422, "A full name and a valid email are required")
    try:
        answer_payload = json.loads(answers) if answers else {}
    except ValueError:
        raise HTTPException(422, "Answers must be JSON") from None
    if not isinstance(answer_payload, dict) or len(answer_payload) > 12:
        raise HTTPException(422, "Up to 12 answers are accepted")
    cleaned: dict[str, str] = {}
    for key, value in answer_payload.items():
        text = " ".join(str(value).split())[:2000]
        if not text:
            continue
        cleaned[str(key)[:80]] = text
    if not cleaned:
        raise HTTPException(422, "Answer at least one question")

    existing = s.scalar(
        select(m.Candidate).where(
            m.Candidate.org_id == v.org_id, m.Candidate.email == email
        )
    )
    c = existing or m.Candidate(org_id=v.org_id, display_name=name, email=email)
    if not existing:
        s.add(c)
        s.flush()
    dup = s.scalar(
        select(m.Application).where(
            m.Application.candidate_id == c.id, m.Application.vacancy_id == v.id
        )
    )
    if dup:
        return {
            "application_id": dup.id,
            "duplicate": True,
            "message": "This email already has an application for this vacancy; "
            "your earlier submission stands.",
        }

    # Real Principal instance: svc.event and svc.store_upload expect the same
    # shape the recruiter/worker auth provides; nothing privileged is implied.
    p = auth.Principal(v.org_id, None, "worker", "apply")
    a = m.Application(
        org_id=v.org_id,
        candidate_id=c.id,
        vacancy_id=v.id,
        requirement_version_id=v.active_requirement_version_id,
    )
    a.intro_answers = cleaned
    s.add(a)
    s.flush()

    if not files:
        raise HTTPException(422, "Attach at least one CV document (PDF or DOCX)")
    if len(files) > 4:
        raise HTTPException(422, "Up to 4 documents are accepted")
    for file in files:
        data = await file.read(5 * 1024 * 1024 + 1)
        svc.store_upload(
            s, p, a, data,
            file.filename or "upload.pdf",
            file.content_type or "application/octet-stream",
        )
        s.flush()

    # Agent tidak berjalan otomatis: HR memicu analisis lewat tombol di
    # dashboard, supaya AI hanya aktif atas permintaan manusia.
    svc.event(
        s, p, "application.applied",
        "Public apply link submission received "
        "(self-declared contact details; verify before outreach).",
        v.id, a.id, details={"documents": len(files)},
    )
    s.commit()
    return {
        "application_id": a.id,
        "duplicate": False,
        "message": "Application received. The recruiter reviews every "
        "submission; you will be contacted if selected for the next step.",
    }
