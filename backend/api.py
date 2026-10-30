"""Versioned, organization-scoped HTTP contract. No provider credentials are returned."""

import os, secrets
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import APIRouter, Depends, Request, HTTPException, Query, File, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select, update, func, delete
from backend.db import get_db, now, Base
from backend import models as m, schemas as d, services as svc, auth


def mutations(request: Request):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        auth.csrf(request)


router = APIRouter(prefix="/api/v1", dependencies=[Depends(mutations)])


def pagination(
    limit: int = Query(25, ge=1, le=100), offset: int = Query(0, ge=0, le=100000)
):
    return {"limit": limit, "offset": offset}


def current_application(s, p, id, scope):
    auth.require_scope(p, scope)
    if id != p.application_id:
        raise HTTPException(404, "Application not found")
    return svc.own(s, m.Application, id, p)


@router.get("/auth/csrf")
def csrf_token(request: Request):
    return {"csrf_token": auth.csrf_value(request)}


@router.post("/auth/login")
def login(body: d.Login, request: Request, s=Depends(get_db)):
    auth.rate_limit(request, "login-ip", 30)
    auth.rate_limit(request, "login-account", 10, identity=body.email.lower())
    user = s.scalar(select(m.User).where(m.User.email == body.email.lower()))
    valid = auth.passwords.verify(
        body.password, user.password_hash if user else auth.DUMMY_HASH
    )
    member = (
        s.scalar(
            select(m.Membership)
            .where(m.Membership.user_id == user.id, m.Membership.active == True)
            .order_by(m.Membership.created_at)
        )
        if user
        else None
    )
    if not valid or not user or not user.active or not member:
        raise HTTPException(401, "Invalid credentials")
    auth.login_session(s, request, member.org_id, user.id)
    s.commit()
    return {
        "csrf_token": request.session["csrf"],
        "organization_id": member.org_id,
        "role": member.role,
    }


@router.post("/auth/logout")
def logout(request: Request, p=Depends(auth.principal), s=Depends(get_db)):
    s.execute(
        update(m.AuthSession)
        .where(m.AuthSession.id == p.session_id)
        .values(revoked_at=now())
    )
    s.commit()
    request.session.clear()
    return {"ok": True}


@router.get("/auth/me")
def me(p=Depends(auth.principal), s=Depends(get_db)):
    memberships = []
    if p.user_id:
        for member in s.scalars(
            select(m.Membership).where(
                m.Membership.user_id == p.user_id, m.Membership.active == True
            )
        ):
            memberships.append(
                {
                    **svc.public(member),
                    "organization_name": s.get(m.Organization, member.org_id).name,
                }
            )
    return {
        "organization_id": p.org_id,
        "user_id": p.user_id,
        "role": p.role,
        "application_id": p.application_id,
        "scopes": p.scopes,
        "memberships": memberships,
    }


@router.post("/auth/invitations/exchange")
def exchange(body: d.Exchange, request: Request, s=Depends(get_db)):
    auth.rate_limit(request, "invitation-exchange", 20)
    inv = auth.invitation_for(s, body.token)
    changed = s.execute(
        update(m.CandidateInvitation)
        .where(
            m.CandidateInvitation.id == inv.id,
            m.CandidateInvitation.redeemed_at.is_(None),
            m.CandidateInvitation.revoked_at.is_(None),
        )
        .values(redeemed_at=now())
    ).rowcount
    if not changed:
        raise HTTPException(404, "Invitation already used")
    auth.login_session(s, request, inv.org_id, invitation=inv)
    s.commit()
    return {
        "csrf_token": request.session["csrf"],
        "application_id": inv.application_id,
        "expires_at": inv.expires_at,
    }


@router.get("/organization")
def organization(p=Depends(auth.recruiter), s=Depends(get_db)):
    return svc.public(s.get(m.Organization, p.org_id))


@router.get("/memberships", response_model=d.Page[d.MembershipOut])
def memberships(pg=Depends(pagination), p=Depends(auth.admin), s=Depends(get_db)):
    return svc.page(s, m.Membership, p, **pg)


@router.post("/memberships", response_model=d.MembershipOut, status_code=201)
def member_create(body: d.MemberInput, p=Depends(auth.admin), s=Depends(get_db)):
    if s.get(m.Organization, p.org_id).is_demo:
        raise HTTPException(403, "Demo membership changes are disabled")
    user = s.scalar(select(m.User).where(m.User.email == body.email.lower()))
    if not user:
        if not body.password:
            raise HTTPException(
                422, "New users require a password of at least 12 characters"
            )
        user = m.User(
            email=body.email.lower(),
            display_name=body.display_name,
            password_hash=auth.passwords.hash(body.password),
        )
        s.add(user)
        s.flush()
    elif body.password:
        raise HTTPException(
            409, "Cannot reset an existing user password through membership creation"
        )
    member = m.Membership(org_id=p.org_id, user_id=user.id, role=body.role)
    s.add(member)
    s.commit()
    return svc.public(member)


@router.patch("/memberships/{id}", response_model=d.MembershipOut)
def member_update(
    id: str, body: d.MemberPatch, p=Depends(auth.admin), s=Depends(get_db)
):
    member = svc.own(s, m.Membership, id, p)
    if s.get(m.Organization, p.org_id).is_demo:
        raise HTTPException(403, "Demo membership changes are disabled")
    if (
        member.role == "admin"
        and member.active
        and (body.role == "recruiter" or body.active is False)
    ):
        count = s.scalar(
            select(func.count())
            .select_from(m.Membership)
            .where(
                m.Membership.org_id == p.org_id,
                m.Membership.role == "admin",
                m.Membership.active == True,
            )
        )
        if count <= 1:
            raise HTTPException(
                409, "An organization must retain an active administrator"
            )
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(member, k, v)
    svc.event(
        s, p, "membership.updated", "Administrator updated membership role/access."
    )
    s.commit()
    return svc.public(member)


@router.get("/vacancies", response_model=d.Page[d.VacancyOut])
def vacancies(pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)):
    return svc.page(s, m.Vacancy, p, **pg)


@router.post("/vacancies", response_model=d.VacancyOut, status_code=201)
def vacancy_create(body: d.VacancyInput, p=Depends(auth.recruiter), s=Depends(get_db)):
    v = svc.create_vacancy(s, p, body)
    s.commit()
    return svc.public(v)


@router.get("/vacancies/{id}", response_model=d.VacancyOut)
def vacancy_read(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    return svc.public(svc.own(s, m.Vacancy, id, p))


@router.patch("/vacancies/{id}", response_model=d.VacancyOut)
def vacancy_update(
    id: str, body: d.VacancyPatch, p=Depends(auth.recruiter), s=Depends(get_db)
):
    v = svc.change_vacancy(s, p, svc.own(s, m.Vacancy, id, p), body)
    s.commit()
    return svc.public(v)


@router.delete("/vacancies/{id}")
def vacancy_delete(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    v = svc.own(s, m.Vacancy, id, p)
    v.state = "closed"
    v.deleted_at = now()
    svc.event(
        s, p, "vacancy.archived", "Vacancy archived; review history retained.", id
    )
    s.commit()
    return {"ok": True}


@router.post(
    "/vacancies/{id}/requirement-versions", response_model=d.VersionOut, status_code=201
)
def requirement_proposal(
    id: str, body: d.RequirementProposal, p=Depends(auth.recruiter), s=Depends(get_db)
):
    version = svc.propose(s, p, svc.own(s, m.Vacancy, id, p), body.requirements)
    s.commit()
    return svc.public(version)


@router.get("/vacancies/{id}/requirement-versions", response_model=d.Page[d.VersionOut])
def versions(
    id: str, pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Vacancy, id, p)
    return svc.page(s, m.RequirementVersion, p, vacancy_id=id, **pg)


@router.get("/requirement-versions/{id}", response_model=d.VersionDetailOut)
def version_read(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    version = svc.own(s, m.RequirementVersion, id, p)
    return {
        **svc.public(version),
        "requirements": [svc.public(r) for r in svc.requirements(s, id)],
    }


@router.post("/requirement-versions/{id}/approve", response_model=d.VersionOut)
def version_approve(
    id: str, body: d.ApprovalInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    v = svc.approve_version(s, p, id, body.rationale)
    s.commit()
    return svc.public(v)


@router.get("/candidates", response_model=d.Page[d.CandidateOut])
def candidate_list(
    pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    return svc.page(s, m.Candidate, p, **pg)


@router.get("/applications", response_model=d.Page[d.ApplicationOut])
def applications(
    vacancy_id: str | None = None,
    pg=Depends(pagination),
    p=Depends(auth.recruiter),
    s=Depends(get_db),
):
    if vacancy_id:
        svc.own(s, m.Vacancy, vacancy_id, p)
    return svc.page(
        s, m.Application, p, **pg, **({"vacancy_id": vacancy_id} if vacancy_id else {})
    )


@router.post("/applications", response_model=d.ApplicationOut, status_code=201)
def application_create(
    body: d.ApplicationInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    a = svc.create_application(s, p, body)
    s.commit()
    return svc.public(a)


@router.get("/applications/{id}", response_model=d.ApplicationOut)
def application_read(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    return svc.public(svc.own(s, m.Application, id, p))


@router.get("/applications/{id}/documents", response_model=d.Page[d.DocumentOut])
def documents(
    id: str, pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Application, id, p)
    return svc.page(s, m.Document, p, application_id=id, **pg)


@router.post(
    "/applications/{id}/documents", response_model=d.DocumentOut, status_code=201
)
async def document_upload(
    id: str, file: UploadFile = File(...), p=Depends(auth.recruiter), s=Depends(get_db)
):
    a = svc.own(s, m.Application, id, p)
    data = await file.read(5 * 1024 * 1024 + 1)
    doc = svc.store_upload(s, p, a, data, file.filename, file.content_type)
    s.commit()
    return svc.public(doc)


def download(s, p, id, application_id=None):
    doc = svc.own(s, m.Document, id, p)
    if application_id and doc.application_id != application_id:
        raise HTTPException(404, "Document not found")
    if doc.synthetic:
        raise HTTPException(404, "Synthetic document has no original file")
    root = Path(os.getenv("STORAGE_ROOT", "storage")).resolve()
    path = (root / doc.storage_key).resolve()
    if path.parent != root or not path.is_file():
        raise HTTPException(404, "Document not found")
    return FileResponse(path, media_type=doc.media_type, filename=doc.original_name)


@router.get("/documents/{id}/download")
def document_download(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    return download(s, p, id)


@router.get("/documents/{id}/extractions", response_model=d.Page[d.ExtractionOut])
def extractions(
    id: str, pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Document, id, p)
    return svc.page(s, m.ExtractionVersion, p, document_id=id, **pg)


@router.get("/applications/{id}/evidence", response_model=d.Page[d.EvidenceOut])
def evidence(
    id: str, pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Application, id, p)
    return svc.page(s, m.EvidenceItem, p, application_id=id, **pg)


@router.post(
    "/applications/{id}/evidence", response_model=d.EvidenceOut, status_code=201
)
def evidence_create(
    id: str, body: d.EvidenceInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    row = svc.add_evidence(s, p, svc.own(s, m.Application, id, p), body)
    s.commit()
    return svc.public(row)


@router.get("/applications/{id}/findings", response_model=d.Page[d.FindingDetailOut])
def findings(
    id: str, pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Application, id, p)
    result = svc.page(s, m.Finding, p, application_id=id, **pg)
    result["items"] = [
        svc.finding_view(s, svc.own(s, m.Finding, x["id"], p)) for x in result["items"]
    ]
    return result


@router.post(
    "/applications/{id}/findings", response_model=d.RevisionOut, status_code=201
)
def finding_revise(
    id: str, body: d.FindingInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    revision = svc.revise_finding(s, p, svc.own(s, m.Application, id, p), body)
    s.commit()
    return svc.public(revision)


@router.get("/findings/{id}/revisions", response_model=d.Page[d.RevisionDetailOut])
def revisions(
    id: str, pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Finding, id, p)
    result = svc.page(s, m.FindingRevision, p, finding_id=id, **pg)
    result["items"] = [
        svc.revision_view(s, svc.own(s, m.FindingRevision, x["id"], p))
        for x in result["items"]
    ]
    return result


@router.get(
    "/applications/{id}/clarification-rounds", response_model=d.Page[d.RoundOut]
)
def rounds(
    id: str, pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Application, id, p)
    return svc.page(s, m.ClarificationRound, p, application_id=id, **pg)


@router.post(
    "/applications/{id}/clarification-rounds",
    response_model=d.RoundOut,
    status_code=201,
)
def round_create(
    id: str, body: d.RoundInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    row = svc.create_round(s, p, svc.own(s, m.Application, id, p), body)
    s.commit()
    return svc.public(row)


@router.get("/clarification-rounds/{id}", response_model=d.RoundDetailOut)
def round_read(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    row = svc.own(s, m.ClarificationRound, id, p)
    return {
        **svc.public(row),
        "questions": [
            svc.public(x)
            for x in s.scalars(
                select(m.ClarificationQuestion).where(
                    m.ClarificationQuestion.org_id == p.org_id,
                    m.ClarificationQuestion.round_id == id,
                )
            )
        ],
    }


@router.post("/clarification-rounds/{id}/approve", response_model=d.RoundOut)
def round_approve(
    id: str, body: d.ClarificationApprovalInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    row = svc.approve_round(
        s, p, svc.own(s, m.ClarificationRound, id, p), body.rationale, policy=body.model_dump()
    )
    s.commit()
    return svc.public(row)


@router.get("/applications/{id}/responses", response_model=d.Page[d.ResponseOut])
def responses(
    id: str, pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Application, id, p)
    return svc.page(s, m.ClarificationResponse, p, application_id=id, **pg)


@router.post("/applications/{id}/invitations", status_code=201)
def invitation_create(
    id: str,
    body: d.InvitationInput,
    request: Request,
    p=Depends(auth.recruiter),
    s=Depends(get_db),
):
    auth.rate_limit(request, "invitation-issue", 30, identity=p.user_id)
    row, token = svc.issue_invitation(s, p, svc.own(s, m.Application, id, p), body)
    s.commit()
    return {
        "id": row.id,
        "token": token,
        "expires_at": row.expires_at,
        "scopes": row.scopes,
    }


@router.post("/invitations/{id}/revoke")
def invitation_revoke(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    inv = svc.own(s, m.CandidateInvitation, id, p)
    inv.revoked_at = now()
    s.commit()
    return {"ok": True}


@router.get("/candidate/applications/{id}")
def candidate_application(id: str, p=Depends(auth.candidate), s=Depends(get_db)):
    a = current_application(s, p, id, "application:read")
    v = svc.own(s, m.Vacancy, a.vacancy_id, p)
    inv = svc.own(s, m.CandidateInvitation, p.invitation_id, p)
    round = svc.own(s, m.ClarificationRound, inv.round_id, p) if inv.round_id else None
    clarification_workflow = s.scalar(select(m.ClarificationWorkflow).where(m.ClarificationWorkflow.round_id == round.id)) if round else None
    return {
        "id": a.id,
        "vacancy_title": v.title,
        "application_status": (
            "awaiting_clarification"
            if round and round.state == "approved"
            else "received" if a.review_state == "pending" else "in_recruiter_review"
        ),
        "demo": s.get(m.Organization, p.org_id).is_demo,
        "profile": {
            "display_name": s.get(m.Candidate, a.candidate_id).display_name,
            "email": s.get(m.Candidate, a.candidate_id).email,
        },
        "clarification": (
            {
                "id": round.id,
                "state": round.state,
                "deadline": clarification_workflow.deadline if clarification_workflow else None,
                "invitation_expires_at": inv.expires_at,
                "questions": [
                    {"id": q.id, "text": q.text}
                    for q in s.scalars(
                        select(m.ClarificationQuestion).where(
                            m.ClarificationQuestion.org_id == p.org_id,
                            m.ClarificationQuestion.round_id == round.id,
                        )
                    )
                ],
            }
            if round
            else None
        ),
    }


@router.post("/candidate/applications/{id}/responses")
def candidate_responses(
    id: str, body: d.ResponsesInput, p=Depends(auth.submission_candidate), s=Depends(get_db)
):
    a = current_application(s, p, id, "clarification:respond")
    inv = svc.own(s, m.CandidateInvitation, p.invitation_id, p)
    result = svc.submit_responses(s, p, a, inv, body)
    s.commit()
    return result



@router.post(
    "/candidate/applications/{id}/documents",
    response_model=d.DocumentOut,
    status_code=201,
)
async def candidate_upload(
    id: str, file: UploadFile = File(...), p=Depends(auth.candidate), s=Depends(get_db)
):
    a = current_application(s, p, id, "document:upload")
    data = await file.read(5 * 1024 * 1024 + 1)
    doc = svc.store_upload(s, p, a, data, file.filename, file.content_type)
    s.commit()
    return svc.public(doc)


@router.get("/candidate/applications/{id}/documents/{document_id}/download")
def candidate_download(
    id: str, document_id: str, p=Depends(auth.candidate), s=Depends(get_db)
):
    current_application(s, p, id, "document:read")
    return download(s, p, document_id, id)


@router.post(
    "/applications/{id}/decisions", response_model=d.DecisionOut, status_code=201
)
def decision_create(
    id: str, body: d.DecisionInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    a = svc.own(s, m.Application, id, p)
    if a.reassessment_required:
        raise HTTPException(409, "Reassessment required before a new decision")
    row = m.RecruiterDecision(
        org_id=p.org_id,
        application_id=id,
        requirement_version_id=a.requirement_version_id,
        actor_id=p.user_id,
        **body.model_dump()
    )
    s.add(row)
    a.decision = body.decision
    svc.event(
        s,
        p,
        "decision.recorded",
        "Human recruiter recorded " + body.decision + "; no message sent.",
        a.vacancy_id,
        id,
    )
    s.commit()
    return svc.public(row)


@router.get("/applications/{id}/decisions", response_model=d.Page[d.DecisionOut])
def decisions(
    id: str, pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Application, id, p)
    return svc.page(s, m.RecruiterDecision, p, application_id=id, **pg)


@router.get("/applications/{id}/interview-brief", response_model=d.BriefOut)
def interview_brief(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    return svc.brief(s, p, svc.own(s, m.Application, id, p))


@router.post(
    "/applications/{id}/interviews", response_model=d.InterviewOut, status_code=201
)
def interview_create(
    id: str, body: d.InterviewInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    a = svc.own(s, m.Application, id, p)
    if a.decision != "shortlist" or a.reassessment_required:
        raise HTTPException(409, "Current recruiter shortlist required")
    if not now() < body.starts_at < body.ends_at <= body.starts_at + 7200:
        raise HTTPException(422, "Select a future interview lasting at most two hours")
    try:
        ZoneInfo(body.timezone)
    except ZoneInfoNotFoundError:
        raise HTTPException(422, "Unknown IANA timezone")
    if body.provider_connection_id:
        svc.own(s, m.ProviderConnection, body.provider_connection_id, p)
    row = m.Interview(org_id=p.org_id, application_id=id, **body.model_dump())
    s.add(row)
    s.commit()
    return svc.public(row)


@router.get("/applications/{id}/interviews", response_model=d.Page[d.InterviewOut])
def interviews(
    id: str, pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Application, id, p)
    return svc.page(s, m.Interview, p, application_id=id, **pg)


@router.post("/interviews/{id}/approve", response_model=d.InterviewOut)
def interview_approve(
    id: str, body: d.ApprovalInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Interview, id, p)
    raise HTTPException(409, "Use versioned interview-plan approval and explicit candidate selection; legacy slot-only approval cannot authorize booking")


@router.get("/provider-connections", response_model=d.Page[d.ConnectionOut])
def connections(pg=Depends(pagination), p=Depends(auth.admin), s=Depends(get_db)):
    return svc.page(s, m.ProviderConnection, p, **pg)


@router.post("/provider-connections", response_model=d.ConnectionOut, status_code=201)
def connection_create(
    body: d.ConnectionInput, p=Depends(auth.admin), s=Depends(get_db)
):
    allowed = {
        "google_calendar": {"calendar_id"},
        "openai": {"model", "base_url"},
        "email": {"from_email"},
    }[body.provider]
    if set(body.config) - allowed or any(
        not isinstance(x, str) or len(x) > 500 for x in body.config.values()
    ):
        raise HTTPException(
            422, "Only documented non-secret configuration fields are accepted"
        )
    ref = (
        "SARING_PROVIDER_"
        + p.org_id.replace("-", "").upper()
        + "_"
        + body.provider.upper()
    )
    row = s.scalar(
        select(m.ProviderConnection).where(
            m.ProviderConnection.org_id == p.org_id,
            m.ProviderConnection.provider == body.provider,
        )
    )
    if not row:
        row = m.ProviderConnection(org_id=p.org_id, provider=body.provider)
        s.add(row)
    binding={k:v for k,v in (row.config or {}).items() if k in ("_google_sub","_google_email")}
    row.config = {**body.config,**binding}
    row.credential_ref = ref
    row.state = (
        "demo"
        if s.get(m.Organization, p.org_id).is_demo
        else "configured" if os.getenv(ref) else "not_configured"
    )
    if body.provider=="google_calendar" and not s.get(m.Organization,p.org_id).is_demo:
        saved=s.scalar(select(m.OAuthCredential).where(m.OAuthCredential.connection_id==row.id)) if row.id else None
        row.state="connected" if saved and not saved.revoked_at else "disconnected"
    s.commit()
    return svc.public(row)


@router.get("/workflow-runs", response_model=d.Page[d.RunOut])
def runs(pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)):
    return svc.page(s, m.WorkflowRun, p, **pg)


@router.post("/workflow-runs", response_model=d.RunOut, status_code=201)
def run_create(body: d.RunInput, p=Depends(auth.recruiter), s=Depends(get_db)):
    row = svc.create_run(
        s,
        p,
        svc.own(s, m.Vacancy, body.vacancy_id, p),
        reextract=body.reextract_documents,
    )
    s.commit()
    return svc.public(row)


@router.get("/workflow-runs/{id}", response_model=d.RunOut)
def run_read(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    return svc.public(svc.own(s, m.WorkflowRun, id, p))


@router.get("/workflow-runs/{id}/jobs", response_model=d.Page[d.JobOut])
def jobs(id: str, pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)):
    svc.own(s, m.WorkflowRun, id, p)
    return svc.page(s, m.WorkflowJob, p, run_id=id, **pg)


@router.post("/workflow-runs/{id}/control", response_model=d.RunOut)
def run_control(
    id: str, body: d.ControlInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    row = svc.own(s, m.WorkflowRun, id, p)
    transitions = {
        "pause": ({"queued", "running"}, "paused"),
        "resume": ({"paused"}, "queued"),
        "cancel": ({"queued", "running", "paused"}, "cancelled"),
        "retry": ({"failed"}, "queued"),
    }
    permitted, target = transitions[body.action]
    if row.state not in permitted:
        raise HTTPException(409, "Invalid workflow transition")
    row.state = target
    for job in s.scalars(
        select(m.WorkflowJob).where(
            m.WorkflowJob.org_id == p.org_id,
            m.WorkflowJob.run_id == id,
            m.WorkflowJob.state != "done",
        )
    ):
        if body.action in ("pause", "cancel") and job.lease_token:
            from backend import execution
            execution.end(s, "analysis", job.id, job.lease_token, "interrupted", "recruiter_" + body.action)
        if body.action == "cancel":
            job.state = "cancelled"
            job.lease_token = None
            job.lease_until = 0
        if body.action == "pause" and job.state == "running":
            job.state = "queued"
            job.lease_token = None
            job.lease_until = 0
        if body.action == "retry":
            job.state = "queued"
            job.attempts = 0
            job.error = ""
            job.available_at = now()
            job.lease_token = None
            job.lease_until = 0
    svc.event(
        s,
        p,
        "workflow." + body.action,
        "Recruiter changed workflow state.",
        row.vacancy_id,
        run_id=id,
    )
    s.commit()
    return svc.public(row)


@router.get("/events", response_model=d.Page[d.EventOut])
def events(
    vacancy_id: str | None = None,
    run_id: str | None = None,
    pg=Depends(pagination),
    p=Depends(auth.recruiter),
    s=Depends(get_db),
):
    filters = {}
    if vacancy_id:
        svc.own(s, m.Vacancy, vacancy_id, p)
        filters["vacancy_id"] = vacancy_id
    if run_id:
        svc.own(s, m.WorkflowRun, run_id, p)
        filters["run_id"] = run_id
    return svc.page(s, m.WorkflowEvent, p, **pg, **filters)


@router.get("/approvals", response_model=d.Page[d.ApprovalOut])
def approvals(pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)):
    return svc.page(s, m.Approval, p, **pg)


@router.get("/outbox", response_model=d.Page[d.OutboxOut])
def outbox(pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)):
    return svc.page(s, m.OutboxAction, p, **pg)


@router.post("/applications/{id}/outbox", response_model=d.OutboxOut, status_code=201)
def outbox_create(
    id: str, body: d.OutboxInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    a = svc.own(s, m.Application, id, p)
    if (
        body.round_id
        and svc.own(s, m.ClarificationRound, body.round_id, p).application_id != id
    ):
        raise HTTPException(422, "Round belongs to another application")
    if (
        body.interview_id
        and svc.own(s, m.Interview, body.interview_id, p).application_id != id
    ):
        raise HTTPException(422, "Interview belongs to another application")
    row = m.OutboxAction(org_id=p.org_id, application_id=a.id, **body.model_dump())
    s.add(row)
    s.commit()
    return svc.public(row)


@router.post("/outbox/{id}/approve", response_model=d.OutboxOut)
def outbox_approve(
    id: str, body: d.ApprovalInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    row = svc.own(s, m.OutboxAction, id, p)
    if row.state != "awaiting_approval":
        raise HTTPException(409, "Action is not awaiting approval")
    if row.interview_id and svc.own(s, m.Interview, row.interview_id, p).state not in (
        "approved",
        "booked",
        "simulated",
    ):
        raise HTTPException(409, "Approve interview first")
    if (
        row.round_id
        and svc.own(s, m.ClarificationRound, row.round_id, p).state != "approved"
    ):
        raise HTTPException(409, "Approve clarification first")
    row.state = "queued"
    svc.approval(s, p, "outbox", id, body.rationale)
    s.commit()
    return svc.public(row)


@router.get("/metrics")
def metrics(p=Depends(auth.recruiter), s=Depends(get_db)):
    def count(model, *where):
        return s.scalar(
            select(func.count())
            .select_from(model)
            .where(model.org_id == p.org_id, *where)
        )

    attempts = list(s.scalars(select(m.ExecutionAttempt).where(m.ExecutionAttempt.org_id == p.org_id)))
    finished = [x for x in attempts if x.finished_at is not None and x.state != "interrupted"]
    states = {}
    for finding in s.scalars(select(m.Finding).where(m.Finding.org_id == p.org_id)):
        state = s.scalar(select(m.FindingRevision.state).where(m.FindingRevision.org_id == p.org_id,
            m.FindingRevision.finding_id == finding.id).order_by(m.FindingRevision.revision.desc()).limit(1))
        if state:
            states[state] = states.get(state, 0) + 1
    def total(name):
        return s.scalar(select(func.sum(m.Metric.value)).where(m.Metric.org_id == p.org_id, m.Metric.name == name))
    return {
        "processing_seconds": sum(max(0, x.finished_at - x.started_at) for x in finished),
        "processing_seconds_note": "Observed worker wall time for finished attempts; excludes approval/candidate waits and interrupted attempts of unknown duration. Not CPU time.",
        "interrupted_attempts": sum(x.state == "interrupted" for x in attempts),
        "active_processing_attempts": sum(x.state == "running" for x in attempts),
        "retries": sum(x.number > 1 for x in attempts),
        "attention_attempts": sum(x.state in ("needs_attention", "failed", "not_configured", "expired_credential", "delivery_unknown") for x in attempts),
        "application_workflows_needing_attention": count(m.ClarificationWorkflow, m.ClarificationWorkflow.state == "needs_attention") + count(m.InterviewCoordination, m.InterviewCoordination.state.in_(["needs_attention", "delivery_unknown"])),
        "completed_analysis_runs": count(m.WorkflowRun, m.WorkflowRun.state == "done"),
        "completed_review_workflows": count(m.ClarificationWorkflow, m.ClarificationWorkflow.completed_at.is_not(None)),
        "waiting_for_hr": count(m.ClarificationWorkflow, m.ClarificationWorkflow.state == "draft"),
        "waiting_for_candidate": count(m.ClarificationWorkflow, m.ClarificationWorkflow.state == "waiting"),
        "clarification_rounds": count(m.ClarificationRound),
        "clarification_responses": count(m.ClarificationResponse),
        "findings_by_status": states,
        "remaining_evidence_gaps": sum(states.get(x, 0) for x in ("unknown", "partial", "conflicting")),
        "supported_requirements": states.get("supported", 0),
        "evidence_gap_resolution_transitions": total("evidence_gaps_resolved") or 0,
        "model_input_tokens": total("model_input_tokens"),
        "model_output_tokens": total("model_output_tokens"),
        "estimated_model_cost_usd": total("estimated_model_cost_usd"),
        "model_usage_note": "Provider-reported usage from committed analysis/clarification only; unavailable usage/prices are null. Failed/rolled-back calls may still be billed. Not a provider billing ledger.",
        "hr_active_review_seconds": None,
        "manual_baseline_estimate": None,
        "applications": count(m.Application),
        "reassessment_required": count(
            m.Application, m.Application.reassessment_required == True
        ),
        "jobs_queued": count(m.WorkflowJob, m.WorkflowJob.state == "queued"),
        "jobs_failed": count(m.WorkflowJob, m.WorkflowJob.state == "failed"),
        "outbox_blocked": count(
            m.OutboxAction, m.OutboxAction.state == "not_configured"
        ),
        "interviews_booked": count(
            m.Interview, m.Interview.state.in_(["booked", "simulated"])
        ),
    }


@router.get("/execution-attempts")
def execution_attempts(application_id: str | None = None, pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)):
    filters = {}
    if application_id:
        svc.own(s, m.Application, application_id, p)
        filters["application_id"] = application_id
    result = svc.page(s, m.ExecutionAttempt, p, **pg, **filters)
    for item in result["items"]:
        item.pop("lease_token", None)
    return result


@router.post("/outbox/{id}/retry", response_model=d.OutboxOut)
def outbox_retry(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    row = svc.own(s, m.OutboxAction, id, p)
    if row.state not in ("failed", "not_configured", "delivery_unknown"):
        raise HTTPException(
            409, "Only failed, unconfigured or uncertain approved actions can be reconciled/retried"
        )
    if row.state == "delivery_unknown" and now() - row.created_at >= 23 * 3600:
        raise HTTPException(409, "Safe provider idempotency window expired; manual provider reconciliation is required")
    row.state = "queued"
    row.attempts = 0
    row.error = ""
    row.available_at = now()
    s.commit()
    return svc.public(row)


@router.get("/metrics/history", response_model=d.Page[d.MetricOut])
def metric_history(
    pg=Depends(pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    return svc.page(s, m.Metric, p, **pg)


@router.post("/demo/vacancies/{id}/seed")
def seed(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    svc.seed_applicants(s, p, svc.own(s, m.Vacancy, id, p))
    s.commit()
    return {"ok": True}
