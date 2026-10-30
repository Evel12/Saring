"""Persisted UI operations. Candidate writes remain bound to invitation scopes."""

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from sqlalchemy import select, func, or_, and_, delete
from pydantic import Field
from typing import Literal
from backend import api, auth, models as m, schemas as d, services as svc
from backend.db import get_db, now

router = APIRouter(prefix="/api/v1", dependencies=[Depends(api.mutations)])


class ProfileInput(d.Input):
    display_name: str = Field(min_length=1, max_length=160)
    email: str | None = Field(default=None, max_length=254)


class PermissionsInput(d.Input):
    public_links: bool
    work_samples: bool
    followup: bool


class BriefInput(d.Input):
    content: str = Field(min_length=1, max_length=20000)


class SuggestInput(d.Input):
    title: str = Field(min_length=1, max_length=160)


class FixtureInput(d.Input):
    variant: Literal["support", "developer", "scan", "unreadable", "hostile"]


@router.post("/demo/vacancies/{id}/synthetic-file", status_code=201)
def synthetic_file(id: str, body: FixtureInput, p=Depends(auth.recruiter), s=Depends(get_db)):
    from backend.demo_files import applicant, attach
    if not s.get(m.Organization, p.org_id).is_demo:
        raise HTTPException(403, "Synthetic fixtures are demo-only")
    v = svc.own(s, m.Vacancy, id, p)
    index = ["support", "developer", "scan", "unreadable", "hostile"].index(body.variant)
    email = f"synthetic-{index}@example.test"
    existing = s.scalar(select(m.Application).join(m.Candidate, m.Candidate.id == m.Application.candidate_id).where(
        m.Application.org_id == p.org_id, m.Application.vacancy_id == id, m.Candidate.email == email, m.Candidate.synthetic == True))
    a = existing or applicant(s, p, v, body.variant, index)
    if existing:
        attach(s, p, a, body.variant)
    s.commit()
    return {"application_id": a.id, "variant": body.variant, "parsing": "real", "analysis": "deterministic_demo"}


@router.post("/demo/applications/{id}/replacement-file", status_code=201)
def replacement_file(id: str, body: FixtureInput, p=Depends(auth.recruiter), s=Depends(get_db)):
    from backend.demo_files import attach
    a = svc.own(s, m.Application, id, p)
    row = attach(s, p, a, body.variant)
    s.commit()
    return svc.public(row)


class ExcludeInput(d.Input):
    reason: str = Field(min_length=5, max_length=500)


@router.post("/documents/{id}/exclude")
def exclude_document(id: str, body: ExcludeInput, p=Depends(auth.recruiter), s=Depends(get_db)):
    document = svc.own(s, m.Document, id, p)
    a = svc.own(s, m.Application, document.application_id, p)
    if not document.excluded_at:
        document.excluded_at = now()
        document.exclusion_reason = body.reason
        a.reassessment_required = True
        svc.event(s, p, "document.excluded", "Recruiter excluded an original from future analysis; original/history retained. Reanalysis is required.", a.vacancy_id, a.id)
    s.commit()
    return svc.public(document)


@router.post("/demo/workspace", status_code=201)
def exploration_workspace(p=Depends(auth.recruiter), s=Depends(get_db)):
    from backend.demo_files import applicant
    if not s.get(m.Organization, p.org_id).is_demo:
        raise HTTPException(403, "Synthetic workspace is demo-only")
    created = []
    for title, criteria, variant in [
        ("Customer Support · sample", ["handle complaints", "customer communication", "support documentation"], "support"),
        ("Software Developer · sample", ["Go backend development", "Provide a code sample or alternative walkthrough", "service testing"], "developer")]:
        v = s.scalar(select(m.Vacancy).where(m.Vacancy.org_id == p.org_id, m.Vacancy.title == title, m.Vacancy.is_sample == True, m.Vacancy.deleted_at.is_(None)))
        if not v:
            v = svc.create_vacancy(s, p, d.VacancyInput(title=title, description="Isolated synthetic exploration. Real DOCX/PDF extraction; deterministic model and communication adapters.", requirements=[d.RequirementInput(description=name, importance="essential" if i<2 else "preferred", acceptable_evidence_types=["document", "candidate_report", "work_sample"] if i != 1 or variant != "developer" else ["work_sample"], minimum_observable_expectation="Describe a personally handled example, contribution and outcome; alternatives are welcome.", clarification_permitted=True) for i,name in enumerate(criteria)]))
            v.is_sample = True
            version = s.scalar(select(m.RequirementVersion).where(m.RequirementVersion.vacancy_id == v.id))
            svc.approve_version(s, p, version.id, "Explicit synthetic sample criteria; humans still approve clarification and interview contact.")
            svc.change_vacancy(s, p, v, d.VacancyPatch(state="published"))
            for i in range(5):
                applicant(s, p, v, "hostile" if i == 3 else variant, i)
        created.append(v.id)
    s.commit()
    return {"vacancy_ids": created, "synthetic_candidates": 5, "applications_per_vacancy": 5}


class CorrectionAnswerInput(d.Input):
    response_id: str
    text: str = Field(min_length=1, max_length=2000)
    reason: str = Field(min_length=1, max_length=500)


@router.get("/applications/{id}/clarification-workflow")
def clarification_workflow(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    from backend.clarification import workflow_for
    a = svc.own(s, m.Application, id, p)
    row = workflow_for(s, a, False)
    if not row:
        return {"workflow": None, "actions": [], "responses": []}
    return {"workflow": svc.public(row), "actions": [svc.public(x) for x in s.scalars(select(m.ClarificationAction).where(m.ClarificationAction.workflow_id == row.id).order_by(m.ClarificationAction.created_at))],
        "delivery_actions": [svc.public(x) for x in s.scalars(select(m.OutboxAction).where(m.OutboxAction.org_id == p.org_id, m.OutboxAction.round_id == row.round_id).order_by(m.OutboxAction.created_at))],
        "responses": [svc.public(x) for x in s.scalars(select(m.ClarificationResponse).join(m.ClarificationQuestion, m.ClarificationQuestion.id == m.ClarificationResponse.question_id).where(m.ClarificationResponse.application_id == id, m.ClarificationQuestion.round_id == row.round_id))]}


@router.get("/demo/clarification-mailbox")
def clarification_mailbox(application_id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    from backend.clarification import portal_link
    if not s.get(m.Organization, p.org_id).is_demo:
        raise HTTPException(403, "Synthetic mailbox is demo-only")
    svc.own(s, m.Application, application_id, p)
    rows = s.scalars(select(m.OutboxAction).where(m.OutboxAction.org_id == p.org_id, m.OutboxAction.application_id == application_id, m.OutboxAction.state == "simulated").order_by(m.OutboxAction.created_at))
    return {"items": [{"id": r.id, "kind": r.kind, "created_at": r.created_at, "portal_url": portal_link(r.payload["invitation_id"]), "questions": r.payload.get("questions", [])} for r in rows if r.payload.get("invitation_id")]}


@router.post("/applications/{id}/clarification-workflow/retry")
def retry_clarification_update(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    from backend.clarification import workflow_for
    a = svc.own(s, m.Application, id, p)
    workflow = workflow_for(s, a, False)
    round = s.get(m.ClarificationRound, workflow.round_id) if workflow else None
    if not workflow or workflow.state != "needs_attention" or not round or round.state != "answered" or a.reassessment_required:
        raise HTTPException(409, "Only a failed current evidence update may be retried; inspect delivery actions separately")
    workflow.state = "resume_queued"
    workflow.attempts = 0
    workflow.available_at = now()
    workflow.error = ""
    svc.event(s, p, "clarification.retry", "Recruiter retried the persisted evidence update; no new questions or email authorized.", a.vacancy_id, a.id)
    s.commit()
    return {"ok": True}


@router.post("/candidate/applications/{id}/answer-corrections", status_code=201)
def correct_answer(id: str, body: CorrectionAnswerInput, p=Depends(auth.submission_candidate), s=Depends(get_db)):
    from backend import clarification as loop
    a = api.current_application(s, p, id, "clarification:respond")
    inv = svc.own(s, m.CandidateInvitation, p.invitation_id, p)
    response = svc.own(s, m.ClarificationResponse, body.response_id, p)
    question = svc.own(s, m.ClarificationQuestion, response.question_id, p)
    workflow = loop.workflow_for(s, a, False)
    if response.application_id != id or question.round_id != inv.round_id:
        raise HTTPException(404, "Response not found")
    if not workflow or a.reassessment_required or a.withdrawn_at or (workflow.deadline and workflow.deadline <= now()) or workflow.state not in ("review_ready", "resume_queued"):
        raise HTTPException(409, "Correction window is closed or an update is processing")
    old = s.scalar(select(m.ResponseCorrection).where(m.ResponseCorrection.response_id == response.id))
    if old:
        if old.text != body.text or old.reason != body.reason:
            raise HTTPException(409, "One factual correction per answer; contact your recruiter for further changes")
        return svc.public(old)
    previous = s.scalar(select(m.EvidenceItem).where(m.EvidenceItem.response_id == response.id))
    row = m.ResponseCorrection(org_id=p.org_id, application_id=id, **body.model_dump())
    s.add(row)
    s.flush()
    s.add(m.EvidenceItem(org_id=p.org_id, application_id=id, source_kind="clarification", response_id=response.id,
        passage=body.text, strength="candidate_reported", artifact_location="correction:" + row.id, supersedes_id=previous.id if previous else None))
    workflow.state = "resume_queued"
    workflow.resume_seq += 1
    workflow.attempts = 0
    workflow.available_at = now()
    a.review_state = "updating_findings"
    svc.event(s, p, "clarification.corrected", "Candidate factual correction appended; original retained and evidence update queued.", a.vacancy_id, a.id)
    s.commit()
    return svc.public(row)


@router.get("/candidate/applications/{id}/submission")
def submission_receipt(id: str, p=Depends(auth.submission_candidate), s=Depends(get_db)):
    a = api.current_application(s, p, id, "clarification:respond")
    inv = svc.own(s, m.CandidateInvitation, p.invitation_id, p)
    submission = s.scalar(select(m.ClarificationSubmission).where(m.ClarificationSubmission.application_id == id, m.ClarificationSubmission.round_id == inv.round_id))
    if not submission:
        raise HTTPException(404, "No submitted answers")
    return {"application_id": id, "submitted_at": submission.created_at, "responses": [{"id": r.id, "question_id": r.question_id, "text": r.text} for r in s.scalars(select(m.ClarificationResponse).join(m.ClarificationQuestion, m.ClarificationQuestion.id == m.ClarificationResponse.question_id).where(m.ClarificationResponse.application_id == id, m.ClarificationQuestion.round_id == inv.round_id))]}


@router.post("/demo/clarification-example", status_code=201)
def clarification_example(p=Depends(auth.recruiter), s=Depends(get_db)):
    if not s.get(m.Organization, p.org_id).is_demo:
        raise HTTPException(403, "Synthetic example is demo-only")
    v = svc.create_vacancy(s, p, d.VacancyInput(title="Customer Support", description="Synthetic clarification example: a complaint-handling gap.", requirements=[d.RequirementInput(description="handle complaints", importance="essential", acceptable_evidence_types=["document", "candidate_report", "work_sample"], minimum_observable_expectation="Describe one personally handled complaint, actions and outcome.", clarification_permitted=True)]))
    v.is_sample = True
    version = s.scalar(select(m.RequirementVersion).where(m.RequirementVersion.vacancy_id == v.id))
    svc.approve_version(s, p, version.id, "Recruiter loaded the explicitly synthetic demonstration criteria.")
    svc.change_vacancy(s, p, v, d.VacancyPatch(state="published"))
    a = svc.create_application(s, p, d.ApplicationInput(vacancy_id=v.id, display_name="Synthetic Support Applicant", email="support-applicant@example.test"), synthetic=True)
    document = m.Document(org_id=p.org_id, application_id=a.id, original_name="synthetic_support_cv.pdf", storage_key="synthetic-" + a.id, media_type="application/pdf", size_bytes=0, sha256="0"*64, synthetic=True)
    s.add(document)
    s.flush()
    s.add(m.ExtractionVersion(org_id=p.org_id, document_id=document.id, version=1, engine="synthetic-v1", passages=[{"page": 1, "paragraph": None, "text": "Experience: online shop administrator"}], limitations="Explicit synthetic demonstration; no real applicant file."))
    s.commit()
    return {"vacancy_id": v.id, "application_id": a.id}


@router.get("/events/changes")
def changes(
    after: str | None = None,
    vacancy_id: str | None = None,
    application_id: str | None = None,
    tail: bool = False,
    limit: int = Query(50, ge=1, le=100),
    p=Depends(auth.recruiter),
    s=Depends(get_db),
):
    query = select(m.WorkflowEvent).where(m.WorkflowEvent.org_id == p.org_id)
    if vacancy_id:
        svc.own(s, m.Vacancy, vacancy_id, p)
        query = query.where(m.WorkflowEvent.vacancy_id == vacancy_id)
    if application_id:
        svc.own(s, m.Application, application_id, p)
        query = query.where(m.WorkflowEvent.application_id == application_id)
    if after:
        cursor = svc.own(s, m.WorkflowEvent, after, p)
        query = query.where(
            or_(
                m.WorkflowEvent.created_at > cursor.created_at,
                and_(
                    m.WorkflowEvent.created_at == cursor.created_at,
                    m.WorkflowEvent.id > cursor.id,
                ),
            )
        )
    if tail and not after:
        rows = list(
            s.scalars(
                query.order_by(
                    m.WorkflowEvent.created_at.desc(), m.WorkflowEvent.id.desc()
                ).limit(limit)
            )
        )
        rows.reverse()
        return {
            "items": [svc.public(e) for e in rows],
            "next_cursor": rows[-1].id if rows else None,
            "has_more": False,
        }
    rows = list(
        s.scalars(
            query.order_by(m.WorkflowEvent.created_at, m.WorkflowEvent.id).limit(
                limit + 1
            )
        )
    )
    items = rows[:limit]
    return {
        "items": [svc.public(e) for e in items],
        "next_cursor": items[-1].id if items else after,
        "has_more": len(rows) > limit,
    }


@router.patch("/clarification-rounds/{id}")
def revise_questions(
    id: str, body: d.RoundInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    row = svc.own(s, m.ClarificationRound, id, p)
    a = svc.own(s, m.Application, row.application_id, p)
    if row.state != "draft" or a.reassessment_required:
        raise HTTPException(409, "Only an unapproved draft may be revised")
    from backend.clarification import validate_question
    for question in body.questions:
        validate_question(question.text)
    if len({q.requirement_id for q in body.questions}) != len(body.questions):
        raise HTTPException(422, "Duplicate criterion question")
    for q in body.questions:
        r = svc.own(s, m.Requirement, q.requirement_id, p)
        if r.version_id != row.requirement_version_id or not r.clarification_permitted:
            raise HTTPException(
                422, "Criterion does not permit clarification in this version"
            )
    s.execute(
        delete(m.ClarificationQuestion).where(
            m.ClarificationQuestion.org_id == p.org_id,
            m.ClarificationQuestion.round_id == id,
        )
    )
    for q in body.questions:
        s.add(m.ClarificationQuestion(org_id=p.org_id, round_id=id, **q.model_dump()))
    svc.event(
        s,
        p,
        "clarification.revised",
        "Recruiter revised an unapproved question draft.",
        a.vacancy_id,
        a.id,
    )
    s.commit()
    return {"ok": True}


@router.get("/applications/{id}/brief-drafts")
def briefs(
    id: str, pg=Depends(api.pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Application, id, p)
    return svc.page(s, m.InterviewBrief, p, application_id=id, **pg)


@router.post("/applications/{id}/brief-drafts", status_code=201)
def save_brief(id: str, body: BriefInput, p=Depends(auth.recruiter), s=Depends(get_db)):
    a = svc.own(s, m.Application, id, p)
    previous = s.scalar(
        select(m.InterviewBrief)
        .where(m.InterviewBrief.application_id == id)
        .order_by(m.InterviewBrief.revision.desc())
    )
    row = m.InterviewBrief(
        org_id=p.org_id,
        application_id=id,
        requirement_version_id=a.requirement_version_id,
        revision=previous.revision + 1 if previous else 1,
        content=body.content,
        author_id=p.user_id,
        supersedes_id=previous.id if previous else None,
    )
    s.add(row)
    svc.event(
        s,
        p,
        "brief.saved",
        "Interview brief revision saved; not approved.",
        a.vacancy_id,
        id,
    )
    s.commit()
    return svc.public(row)


@router.post("/brief-drafts/{id}/approve")
def approve_brief(
    id: str, body: d.ApprovalInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    row = svc.own(s, m.InterviewBrief, id, p)
    a = svc.own(s, m.Application, row.application_id, p)
    if (
        row.state != "draft"
        or a.reassessment_required
        or row.requirement_version_id != a.requirement_version_id
    ):
        raise HTTPException(
            409, "Only a draft against current reviewed criteria can be approved"
        )
    row.state = "approved"
    svc.approval(s, p, "interview_brief", id, body.rationale)
    svc.event(
        s,
        p,
        "brief.approved",
        "Recruiter approved interview brief.",
        a.vacancy_id,
        a.id,
    )
    s.commit()
    return svc.public(row)


def invitation_round(s, p, a):
    inv = svc.own(s, m.CandidateInvitation, p.invitation_id, p)
    if not inv.round_id:
        raise HTTPException(409, "This invitation has no clarification round")
    row = svc.own(s, m.ClarificationRound, inv.round_id, p)
    if row.application_id != a.id or row.state != "approved":
        raise HTTPException(409, "This round is not accepting drafts")
    workflow = s.scalar(select(m.ClarificationWorkflow).where(m.ClarificationWorkflow.round_id == row.id))
    if a.reassessment_required or a.withdrawn_at or (workflow and workflow.deadline and workflow.deadline <= now()):
        raise HTTPException(409, "The clarification scope or deadline has closed")
    return row


@router.get("/candidate/applications/{id}/draft")
def read_draft(id: str, p=Depends(auth.candidate), s=Depends(get_db)):
    a = api.current_application(s, p, id, "clarification:respond")
    r = invitation_round(s, p, a)
    draft = s.scalar(
        select(m.CandidateDraft).where(
            m.CandidateDraft.org_id == p.org_id,
            m.CandidateDraft.application_id == id,
            m.CandidateDraft.round_id == r.id,
        )
    )
    return {
        "responses": draft.responses if draft else [],
        "updated_at": draft.updated_at if draft else None,
    }


@router.post("/candidate/applications/{id}/draft")
def save_draft(
    id: str, body: d.ResponsesInput, p=Depends(auth.candidate), s=Depends(get_db)
):
    a = api.current_application(s, p, id, "clarification:respond")
    r = invitation_round(s, p, a)
    allowed = set(
        s.scalars(
            select(m.ClarificationQuestion.id).where(
                m.ClarificationQuestion.org_id == p.org_id,
                m.ClarificationQuestion.round_id == r.id,
            )
        )
    )
    ids = [x.question_id for x in body.responses]
    if len(set(ids)) != len(ids) or not set(ids) <= allowed:
        raise HTTPException(422, "Draft contains a question outside this invitation")
    row = s.scalar(
        select(m.CandidateDraft).where(
            m.CandidateDraft.org_id == p.org_id,
            m.CandidateDraft.application_id == id,
            m.CandidateDraft.round_id == r.id,
        )
    )
    if not row:
        row = m.CandidateDraft(org_id=p.org_id, application_id=id, round_id=r.id)
        s.add(row)
    row.responses = [x.model_dump(exclude_defaults=True) for x in body.responses]
    row.updated_at = now()
    s.commit()
    return {"updated_at": row.updated_at, "responses": row.responses}


@router.post("/candidate/applications/{id}/profile-corrections", status_code=201)
def correct_profile(
    id: str, body: ProfileInput, p=Depends(auth.candidate), s=Depends(get_db)
):
    a = api.current_application(s, p, id, "profile:correct")
    row = m.ProfileCorrection(org_id=p.org_id, application_id=id, **body.model_dump())
    s.add(row)
    svc.event(
        s,
        p,
        "profile.correction",
        "Candidate requested a factual profile correction.",
        a.vacancy_id,
        id,
    )
    s.commit()
    return svc.public(row)


@router.get("/applications/{id}/profile-corrections")
def corrections(
    id: str, pg=Depends(api.pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Application, id, p)
    return svc.page(s, m.ProfileCorrection, p, application_id=id, **pg)


@router.post("/profile-corrections/{id}/approve")
def accept_correction(
    id: str, body: d.ApprovalInput, p=Depends(auth.recruiter), s=Depends(get_db)
):
    row = svc.own(s, m.ProfileCorrection, id, p)
    a = svc.own(s, m.Application, row.application_id, p)
    c = svc.own(s, m.Candidate, a.candidate_id, p)
    if row.state != "pending":
        raise HTTPException(409, "Correction has already been reviewed")
    c.display_name = row.display_name
    c.email = row.email
    row.state = "approved"
    svc.approval(s, p, "profile_correction", id, body.rationale)
    svc.event(
        s,
        p,
        "profile.corrected",
        "Recruiter approved factual identity correction.",
        a.vacancy_id,
        a.id,
    )
    s.commit()
    return svc.public(row)


@router.get("/candidate/applications/{id}/source-permissions")
def read_permissions(id: str, p=Depends(auth.candidate), s=Depends(get_db)):
    api.current_application(s, p, id, "application:read")
    row = s.scalar(
        select(m.SourcePermission)
        .where(
            m.SourcePermission.org_id == p.org_id,
            m.SourcePermission.application_id == id,
        )
        .order_by(m.SourcePermission.created_at.desc())
    )
    return (
        svc.public(row)
        if row
        else {"public_links": False, "work_samples": False, "followup": False}
    )


@router.post("/candidate/applications/{id}/source-permissions", status_code=201)
def permissions(
    id: str, body: PermissionsInput, p=Depends(auth.candidate), s=Depends(get_db)
):
    a = api.current_application(s, p, id, "permissions:write")
    row = m.SourcePermission(org_id=p.org_id, application_id=id, **body.model_dump())
    s.add(row)
    svc.event(
        s,
        p,
        "permissions.updated",
        "Candidate recorded optional source and follow-up permissions.",
        a.vacancy_id,
        id,
    )
    s.commit()
    return svc.public(row)


@router.get("/applications/{id}/source-permissions")
def recruiter_permissions(
    id: str, pg=Depends(api.pagination), p=Depends(auth.recruiter), s=Depends(get_db)
):
    svc.own(s, m.Application, id, p)
    return svc.page(s, m.SourcePermission, p, application_id=id, **pg)


def suggestion(body, p, s, demo):
    org = s.get(m.Organization, p.org_id)
    if demo and not org.is_demo:
        raise HTTPException(403, "Demo adapter is synthetic-only")
    from backend.tools import suggest

    try:
        result = suggest(body.title, mode="demo" if demo else "live")
    except ValueError as e:
        raise HTTPException(503, str(e))
    except Exception:
        raise HTTPException(502, "Model provider failed; no criteria generated")
    return {
        "adapter": "deterministic_demo" if demo else "live_provider",
        "requirements": [
            {
                "description": r["name"],
                "importance": "essential" if r["required"] else "preferred",
                "acceptable_evidence_types": [
                    "candidate_report",
                    "document",
                    "work_sample",
                ],
                "minimum_observable_expectation": r["evidence"],
                "clarification_permitted": True,
            }
            for r in result
        ],
    }


@router.post("/requirements/suggest")
def suggest(body: SuggestInput, p=Depends(auth.recruiter), s=Depends(get_db)):
    return suggestion(body, p, s, False)


@router.post("/demo/requirements/suggest")
def demo_suggest(body: SuggestInput, p=Depends(auth.recruiter), s=Depends(get_db)):
    return suggestion(body, p, s, True)


@router.post("/demo/sample-vacancies", status_code=201)
def samples(p=Depends(auth.recruiter), s=Depends(get_db)):
    if not s.get(m.Organization, p.org_id).is_demo:
        raise HTTPException(403, "Sample adapter is synthetic-only")
    titles = {
        "Software Developer": ["Software development", "Testing", "Version control"],
        "Customer Support": [
            "Customer communication",
            "Issue resolution",
            "Support documentation",
        ],
        "Administrative Assistant": [
            "Scheduling",
            "Document preparation",
            "Record management",
        ],
    }
    created = []
    for title, names in titles.items():
        if s.scalar(
            select(m.Vacancy).where(
                m.Vacancy.org_id == p.org_id,
                m.Vacancy.title == title,
                m.Vacancy.is_sample == True,
                m.Vacancy.deleted_at.is_(None),
            )
        ):
            continue
        v = svc.create_vacancy(
            s,
            p,
            d.VacancyInput(
                title=title,
                description="Synthetic sample vacancy. Edit and approve criteria before publishing.",
                requirements=[
                    d.RequirementInput(
                        description=name,
                        importance="essential" if i < 2 else "preferred",
                        acceptable_evidence_types=[
                            "candidate_report",
                            "document",
                            "work_sample",
                        ],
                        minimum_observable_expectation="Describe one relevant example and your own contribution.",
                        clarification_permitted=True,
                    )
                    for i, name in enumerate(names)
                ],
            ),
        )
        v.is_sample = True
        created.append(v)
    s.commit()
    return {"items": [svc.public(v) for v in created]}
