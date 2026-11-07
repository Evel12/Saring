"""Persisted UI operations. Candidate writes remain bound to invitation scopes."""

from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Request, Query
from pydantic import Field
from sqlalchemy import select, func, or_, and_, delete
from backend import api, auth, ai_config, models as m, schemas as d, services as svc
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


@router.get("/findings/{id}/suggest-evidence")
def suggest_evidence(id: str, p=Depends(auth.recruiter), s=Depends(get_db)):
    """Deterministic, model-free passage suggestions for a criterion.

    Pure keyword-overlap ranking (the same ranker the worker uses for its
    shortlist). Helps a recruiter finish a Revise judgment without another
    AI call; suggestions are candidate-reported passages for human review.
    """
    from backend import analysis
    finding = svc.own(s, m.Finding, id, p)
    a = svc.own(s, m.Application, finding.application_id, p)
    requirement = next((r for r in svc.requirements(s, a.requirement_version_id)
        if r.id == finding.requirement_id), None)
    if not requirement:
        raise HTTPException(404, "The finding's requirement version is not the active one")
    evidence = list(s.scalars(select(m.EvidenceItem).where(
        m.EvidenceItem.org_id == p.org_id, m.EvidenceItem.application_id == a.id)))
    ranked = analysis.relevance_rank(
        {"description": requirement.description,
         "minimum_observable_expectation": requirement.minimum_observable_expectation},
        [{"id": e.id, "passage": e.passage} for e in evidence])
    ids = [e["id"] for e, _ in ranked]
    by_id = {e.id: e for e in evidence}
    return {"suggestions": [
        {"id": e.id, "passage": e.passage, "overlap": score, "page": e.page,
         "paragraph": e.paragraph, "document_id": e.document_id}
        for (e, score), eid in zip(ranked, ids) if by_id.get(eid)]}


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


def suggestion(body, p, s):
    from backend.tools import suggest

    try:
        result = suggest(body.title)
    except ValueError as e:
        raise HTTPException(503, str(e))
    except Exception:
        raise HTTPException(502, "Model provider failed; no criteria generated")
    return {
        "adapter": "live_provider",
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
    return suggestion(body, p, s)


class AiConfigInput(d.Input):
    provider: Literal["openai", "ollama"]
    model: str = Field(min_length=1, max_length=200)
    base_url: str | None = Field(default=None, max_length=500)


@router.get("/ai/config")
def ai_config_read(p=Depends(auth.admin)):
    return ai_config.describe()


@router.get("/ai/models")
def ai_model_catalog(
    provider: str | None = None, base_url: str | None = None, p=Depends(auth.admin)
):
    """Live model names from the selected provider; read-only discovery."""
    effective = ai_config.config() or {}
    if provider is None:
        provider = effective.get("provider")
    if provider not in ai_config.DEFAULTS:
        raise HTTPException(422, "Provider must be openai or ollama")
    import os
    if provider == "openai" and not os.getenv("OPENAI_API_KEY") and effective.get("provider") == provider:
        raise HTTPException(409, "OPENAI_API_KEY is not configured in the server environment")
    target = {
        "provider": provider,
        # Ollama needs no extra settings; only its localhost default is used
        # unless this exact request carries an explicit base_url override.
        "base_url": base_url
        if base_url is not None
        else ("" if provider == "ollama" else effective.get("base_url", "")),
        "model": effective.get("model") or "placeholder",
    }
    try:
        models = ai_config.list_models(target)
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    except Exception:
        raise HTTPException(
            502,
            "Could not reach that provider endpoint; check Ollama is running and the base URL",
        )
    return {"provider": provider, "models": models, "current": effective.get("model", "")}


@router.post("/ai/config")
def ai_config_write(body: AiConfigInput, p=Depends(auth.admin), s=Depends(get_db)):
    try:
        row = ai_config.save(
            body.provider,
            body.model,
            body.base_url or "",
            updated_by=(s.get(m.User, p.user_id).email if p.user_id else "server"),
        )
    except ValueError as exc:
        raise HTTPException(422, str(exc))
    svc.event(s, p, "ai.configured",
        "A server administrator selected a model provider and model for this workspace; no credential is stored.")
    s.commit()
    return {**row, "openai_key_present": ai_config.describe()["openai_key_present"]}
