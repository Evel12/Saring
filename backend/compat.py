"""Dashboard transport adapter. Domain writes go through the same v1 services."""

import secrets
from datetime import datetime
from fastapi import APIRouter, Depends, Request, HTTPException, File, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select, update, delete
from backend import models as m, schemas as d, services as svc, auth, api
from backend.db import get_db, now, Base

router = APIRouter(prefix="/api", dependencies=[Depends(api.mutations)])
portal_router = APIRouter(prefix="/api/portal")


class LegacyRequirement(BaseModel):
    name: str
    evidence: str
    required: bool = True


class LegacyVacancy(BaseModel):
    title: str
    requirements: list[LegacyRequirement] = Field(min_length=1, max_length=30)


class LegacyDecision(BaseModel):
    decision: str


class LegacyAnswers(BaseModel):
    answers: list[str] = Field(min_length=1, max_length=3)


class LegacyBooking(BaseModel):
    start: str
    end: str


class Title(BaseModel):
    title: str = Field(min_length=1, max_length=160)


def demo_session(s, request):
    org = m.Organization(name="Synthetic demo workspace", is_demo=True)
    s.add(org)
    s.flush()
    user = m.User(
        email=secrets.token_hex(16) + "@demo.invalid",
        display_name="Demo recruiter",
        password_hash=auth.passwords.hash(secrets.token_urlsafe(32)),
    )
    s.add(user)
    s.flush()
    s.add(m.Membership(org_id=org.id, user_id=user.id, role="admin"))
    s.flush()
    auth.login_session(s, request, org.id, user.id)
    s.commit()
    return org


@router.post("/demo-session")
def open_demo(request: Request, s=Depends(get_db)):
    if auth.MODE != "demo":
        raise HTTPException(404)
    auth.rate_limit(request, "demo-create", 30)
    try:
        p = auth.principal(request, s)
        if s.get(m.Organization, p.org_id).is_demo:
            return {"mode": "demo", "csrf_token": request.session["csrf"]}
    except HTTPException:
        pass
    org = demo_session(s, request)
    return {
        "mode": "demo",
        "organization_id": org.id,
        "csrf_token": request.session["csrf"],
    }


@router.post("/demo-reset")
@router.post("/v1/demo/reset")
def reset_demo(request: Request, p=Depends(auth.admin), s=Depends(get_db)):
    if auth.MODE != "demo" or not s.get(m.Organization, p.org_id).is_demo:
        raise HTTPException(403, "Only an isolated demo workspace can be reset")
    auth.rate_limit(request, "demo-reset", 10, identity=p.org_id)
    old_org, old_user = p.org_id, p.user_id
    private_files = list(s.scalars(select(m.Document.storage_key).where(m.Document.org_id == old_org, m.Document.synthetic == False)))
    # Direct, scoped deletion is restricted to synthetic demo organizations.
    for table in reversed(Base.metadata.sorted_tables):
        if "org_id" in table.c:
            s.execute(delete(table).where(table.c.org_id == old_org))
    s.execute(delete(m.Organization).where(m.Organization.id == old_org))
    s.execute(delete(m.User).where(m.User.id == old_user))
    request.session.clear()
    org = demo_session(s, request)
    for key in private_files:
        s.add(m.FileErasure(org_id=org.id, storage_key=key))
    s.commit()
    return {"organization_id": org.id, "csrf_token": request.session["csrf"]}


def legacy_requirements(s, v):
    version = (
        s.get(m.RequirementVersion, v.active_requirement_version_id)
        if v.active_requirement_version_id
        else s.scalar(
            select(m.RequirementVersion)
            .where(m.RequirementVersion.vacancy_id == v.id)
            .order_by(m.RequirementVersion.version.desc())
        )
    )
    return svc.requirements(s, version.id) if version else []


def vjson(s, v):
    return {
        "id": v.id,
        "title": v.title,
        "state": v.state,
        "requirements": [
            {
                "name": r.description,
                "evidence": r.minimum_observable_expectation,
                "required": r.importance == "essential",
            }
            for r in legacy_requirements(s, v)
        ],
        "approved": int(bool(v.active_requirement_version_id)),
        "stage": (
            4
            if s.scalar(
                select(m.WorkflowRun).where(
                    m.WorkflowRun.vacancy_id == v.id, m.WorkflowRun.state == "done"
                )
            )
            else 0
        ),
    }


def questions(s, a):
    row = s.scalar(
        select(m.ClarificationRound)
        .where(
            m.ClarificationRound.application_id == a.id,
            m.ClarificationRound.state.in_(["draft", "approved"]),
        )
        .order_by(m.ClarificationRound.number.desc())
    )
    if row:
        return [
            {
                "requirement": s.get(m.Requirement, q.requirement_id).description,
                "requirement_id": q.requirement_id,
                "text": q.text,
            }
            for q in s.scalars(
                select(m.ClarificationQuestion)
                .where(m.ClarificationQuestion.round_id == row.id)
                .order_by(
                    m.ClarificationQuestion.created_at, m.ClarificationQuestion.id
                )
            )
        ]
    result = []
    for r in svc.requirements(s, a.requirement_version_id):
        f = s.scalar(
            select(m.Finding).where(
                m.Finding.application_id == a.id, m.Finding.requirement_id == r.id
            )
        )
        latest = svc.finding_view(s, f)["latest_revision"] if f else None
        if latest and latest["state"] == "unknown" and r.clarification_permitted:
            result.append(
                {
                    "requirement": r.description,
                    "requirement_id": r.id,
                    "text": f"Describe an example of {r.description} and your own contribution. You may say no example is available.",
                }
            )
    return result[:3]


def cjson(s, a):
    c = s.get(m.Candidate, a.candidate_id)
    docs = list(
        s.scalars(
            select(m.Document)
            .where(m.Document.application_id == a.id)
            .order_by(m.Document.created_at)
        )
    )
    evidence = []
    for r in svc.requirements(s, a.requirement_version_id):
        f = s.scalar(
            select(m.Finding).where(
                m.Finding.application_id == a.id, m.Finding.requirement_id == r.id
            )
        )
        latest = svc.finding_view(s, f)["latest_revision"] if f else None
        if not latest:
            continue
        e = (
            s.get(m.EvidenceItem, latest["evidence_ids"][0])
            if latest["evidence_ids"]
            else None
        )
        evidence.append(
            {
                "requirement": r.description,
                "finding": latest["state"],
                "source": (
                    f"{e.source_kind} · "
                    + (
                        f"page {e.page}"
                        if e.page
                        else (
                            f"paragraph {e.paragraph}"
                            if e.paragraph
                            else e.artifact_location
                        )
                    )
                    if e
                    else None
                ),
                "excerpt": e.passage if e else "",
                "limitation": latest["explanation"]
                + (
                    " Strength: " + e.strength + "."
                    if e
                    else " Unknown is not inability."
                ),
            }
        )
    interview = s.scalar(
        select(m.Interview)
        .where(m.Interview.application_id == a.id)
        .order_by(m.Interview.created_at.desc())
    )
    rounds = s.scalar(
        select(__import__("sqlalchemy").func.count())
        .select_from(m.ClarificationRound)
        .where(m.ClarificationRound.application_id == a.id)
    )
    return {
        "id": a.id,
        "name": c.display_name,
        "file": docs[0].original_name if docs else "No document",
        "has_document": bool(docs and not docs[0].synthetic),
        "evidence": evidence,
        "questions": questions(s, a),
        "status": (
            "reassessment required"
            if a.reassessment_required
            else (
                "interview booked"
                if interview and interview.state in ("booked", "simulated")
                else a.review_state.replace("_", " ")
            )
        ),
        "decision": a.decision,
        "rounds": rounds,
        "booking": svc.public(interview) if interview else {},
    }


@router.get("/vacancies")
def vacancies(p=Depends(auth.recruiter), s=Depends(get_db)):
    return [
        vjson(s, v)
        for v in s.scalars(
            select(m.Vacancy)
            .where(m.Vacancy.org_id == p.org_id, m.Vacancy.deleted_at.is_(None))
            .limit(100)
        )
    ]


@router.post("/vacancies")
def create(body: LegacyVacancy, p=Depends(auth.recruiter), s=Depends(get_db)):
    reqs = [
        d.RequirementInput(
            description=r.name,
            importance="essential" if r.required else "preferred",
            acceptable_evidence_types=[
                "candidate_report",
                "document",
                "work_sample",
                "structured_assessment",
            ],
            minimum_observable_expectation=r.evidence,
        )
        for r in body.requirements
    ]
    v = svc.create_vacancy(s, p, d.VacancyInput(title=body.title, requirements=reqs))
    s.commit()
    return vjson(s, v)


@router.post("/vacancies/{id}/approve")
def approve(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    v = svc.own(s, m.Vacancy, id, p)
    version = s.scalar(
        select(m.RequirementVersion)
        .where(m.RequirementVersion.vacancy_id == id)
        .order_by(m.RequirementVersion.version.desc())
    )
    svc.approve_version(s, p, version.id, "Approved in recruiter dashboard")
    svc.change_vacancy(s, p, v, d.VacancyPatch(state="published"))
    s.commit()
    return vjson(s, v)


@router.get("/vacancies/{id}")
def state(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    v = svc.own(s, m.Vacancy, id, p)
    applications = list(
        s.scalars(
            select(m.Application)
            .where(
                m.Application.org_id == p.org_id,
                m.Application.vacancy_id == id,
                m.Application.withdrawn_at.is_(None),
            )
            .order_by(m.Application.created_at)
        )
    )
    cs = [cjson(s, a) for a in applications]
    runs = list(
        s.scalars(
            select(m.WorkflowRun).where(
                m.WorkflowRun.org_id == p.org_id, m.WorkflowRun.vacancy_id == id
            )
        )
    )
    jobs = list(
        s.scalars(
            select(m.WorkflowJob).where(
                m.WorkflowJob.org_id == p.org_id,
                m.WorkflowJob.run_id.in_([r.id for r in runs]),
            )
        )
    )
    events = list(
        s.scalars(
            select(m.WorkflowEvent)
            .where(m.WorkflowEvent.org_id == p.org_id, m.WorkflowEvent.vacancy_id == id)
            .order_by(m.WorkflowEvent.created_at)
        )
    )
    return {
        "vacancy": vjson(s, v),
        "candidates": cs,
        "jobs": [
            {
                "id": j.id,
                "kind": j.kind,
                "status": j.state,
                "attempts": j.attempts,
                "error": j.error,
            }
            for j in jobs
        ],
        "activities": [
            {
                "kind": (
                    "err"
                    if "fail" in e.kind
                    else (
                        "tool"
                        if "queued" in e.kind
                        else "warn" if "approved" in e.kind else "ok"
                    )
                ),
                "message": e.message,
                "created": e.created_at,
            }
            for e in events
        ],
        "metrics": {
            "processed": sum(bool(c["evidence"]) for c in cs),
            "unknowns": sum(
                e["finding"] == "unknown" for c in cs for e in c["evidence"]
            ),
            "failed": sum(j.state == "failed" for j in jobs),
            "booked": sum(
                bool(c["booking"]) and c["booking"]["state"] in ("booked", "simulated")
                for c in cs
            ),
        },
    }


@router.post("/vacancies/{id}/seed")
def seed(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    svc.seed_applicants(s, p, svc.own(s, m.Vacancy, id, p))
    s.commit()
    return {"ok": True}


@router.post("/vacancies/{id}/run")
def run(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    row = svc.create_run(s, p, svc.own(s, m.Vacancy, id, p))
    s.commit()
    return {"id": row.id, "status": "queued"}


@router.post("/vacancies/{id}/upload")
async def upload(
    id: str, file: UploadFile = File(...), p=Depends(auth.recruiter), s=Depends(get_db)
):
    a = svc.create_application(
        s,
        p,
        d.ApplicationInput(
            vacancy_id=id, display_name="Applicant " + secrets.token_hex(3)
        ),
    )
    doc = svc.store_upload(
        s, p, a, await file.read(5 * 1024 * 1024 + 1), file.filename, file.content_type
    )
    s.commit()
    return cjson(s, a)


@router.get("/candidates/{id}/document")
def document(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    svc.own(s, m.Application, id, p)
    doc = s.scalar(
        select(m.Document)
        .where(m.Document.org_id == p.org_id, m.Document.application_id == id)
        .order_by(m.Document.created_at)
    )
    if not doc:
        raise HTTPException(404)
    return api.download(s, p, doc.id, id)


@router.post("/candidates/{id}/decision")
def decision(
    id: str, body: LegacyDecision, p=Depends(auth.recruiter), s=Depends(get_db)
):
    api.decision_create(
        id,
        d.DecisionInput(
            decision=body.decision,
            rationale="Human decision recorded in recruiter dashboard.",
        ),
        p,
        s,
    )
    return cjson(s, svc.own(s, m.Application, id, p))


@router.post("/candidates/{id}/portal")
def issue_portal(
    id: str, request: Request, p=Depends(auth.recruiter), s=Depends(get_db)
):
    auth.rate_limit(request, "portal-issue", 30, identity=p.user_id)
    a = svc.own(s, m.Application, id, p)
    row = s.scalar(
        select(m.ClarificationRound)
        .where(
            m.ClarificationRound.application_id == id,
            m.ClarificationRound.state.in_(["draft", "approved"]),
        )
        .order_by(m.ClarificationRound.number.desc())
    )
    if not row:
        qs = questions(s, a)
        if not qs:
            raise HTTPException(409, "No unresolved permitted questions")
        row = svc.create_round(
            s,
            p,
            a,
            d.RoundInput(
                questions=[
                    d.QuestionInput(requirement_id=q["requirement_id"], text=q["text"])
                    for q in qs
                ]
            ),
        )
    if row.state == "draft":
        svc.approve_round(s, p, row)
    inv, token = svc.issue_invitation(s, p, a, d.InvitationInput(round_id=row.id))
    s.commit()
    return {"token": token, "expires_at": inv.expires_at}


@portal_router.get("/{token}")
def portal(token: str, request: Request, s=Depends(get_db)):
    auth.rate_limit(request, "portal-read", 120)
    inv = auth.invitation_for(s, token)
    a = s.get(m.Application, inv.application_id)
    v = s.get(m.Vacancy, a.vacancy_id)
    row = s.get(m.ClarificationRound, inv.round_id)
    if not row or row.state != "approved":
        raise HTTPException(404, "Portal unavailable")
    qs = list(
        s.scalars(
            select(m.ClarificationQuestion)
            .where(
                m.ClarificationQuestion.org_id == inv.org_id,
                m.ClarificationQuestion.round_id == inv.round_id,
            )
            .order_by(m.ClarificationQuestion.created_at, m.ClarificationQuestion.id)
        )
    )
    return {
        "title": v.title,
        "questions": [
            {
                "requirement": s.get(m.Requirement, q.requirement_id).description,
                "text": q.text,
            }
            for q in qs
        ],
        "mode": auth.MODE,
    }


@portal_router.post("/{token}")
def answer(token: str, body: LegacyAnswers, request: Request, s=Depends(get_db)):
    # Capability authorization does not use ambient cookies; no cookie-based CSRF exemption is granted elsewhere.
    auth.rate_limit(request, "portal-answer", 20)
    inv = auth.invitation_for(s, token)
    if "clarification:respond" not in inv.scopes:
        raise HTTPException(403, "Invitation does not permit responses")
    a = s.get(m.Application, inv.application_id)
    qs = list(
        s.scalars(
            select(m.ClarificationQuestion)
            .where(
                m.ClarificationQuestion.org_id == inv.org_id,
                m.ClarificationQuestion.round_id == inv.round_id,
            )
            .order_by(m.ClarificationQuestion.created_at, m.ClarificationQuestion.id)
        )
    )
    if len(body.answers) != len(qs):
        raise HTTPException(422, "Respond to every permitted question")
    changed = s.execute(
        update(m.CandidateInvitation)
        .where(
            m.CandidateInvitation.id == inv.id,
            m.CandidateInvitation.redeemed_at.is_(None),
        )
        .values(redeemed_at=now())
    ).rowcount
    if not changed:
        raise HTTPException(404, "Invitation already used")
    p = auth.Principal(
        inv.org_id, None, "candidate", "", a.id, inv.id, tuple(inv.scopes)
    )
    svc.submit_responses(
        s,
        p,
        a,
        inv,
        d.ResponsesInput(
            responses=[
                d.ResponseInput(question_id=q.id, text=text)
                for q, text in zip(qs, body.answers)
            ]
        ),
    )
    s.commit()
    return {"ok": True}


@router.post("/candidates/{id}/book")
def book(id: str, body: LegacyBooking, p=Depends(auth.recruiter), s=Depends(get_db)):
    svc.own(s, m.Application, id, p)
    raise HTTPException(409, "Legacy direct booking is retired; approve an interview plan and obtain an explicit candidate slot selection")



@router.delete("/candidates/{id}")
def withdraw(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    a = svc.own(s, m.Application, id, p)
    a.withdrawn_at = now()
    s.execute(
        update(m.CandidateInvitation)
        .where(
            m.CandidateInvitation.org_id == p.org_id,
            m.CandidateInvitation.application_id == id,
        )
        .values(revoked_at=now())
    )
    svc.event(
        s,
        p,
        "application.withdrawn",
        "Application archived and portal access revoked; evidence history retained.",
        a.vacancy_id,
        id,
    )
    s.commit()
    return {"ok": True}


@router.post("/requirements/suggest")
def suggest(body: Title, p=Depends(auth.recruiter)):
    from backend.tools import suggest

    try:
        return suggest(body.title)
    except ValueError as e:
        raise HTTPException(503, str(e))
    except Exception:
        raise HTTPException(502, "Model request failed; no suggestions generated")
