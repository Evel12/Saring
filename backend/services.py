"""Transactional domain operations used by v1 routes, the worker and dashboard adapter."""

from pathlib import Path
import os, hashlib, secrets, re, io
from zipfile import ZipFile, BadZipFile
from sqlalchemy import select, func, update, event as sqlalchemy_event
from sqlalchemy.orm import Session as ORMSession
from fastapi import HTTPException
from backend import models as m, schemas as dto
from backend.db import now, uid
from backend.auth import digest


def own(s, model, id, p):
    row = s.scalar(select(model).where(model.id == id, model.org_id == p.org_id))
    if not row or (isinstance(row, m.Vacancy) and row.deleted_at):
        raise HTTPException(404, "Resource not found")
    return row


def public(row):
    return {
        c.name: getattr(row, c.name)
        for c in row.__table__.columns
        if c.name not in dto.PRIVATE and c.name not in {"encrypted_tokens", "encrypted_verifier", "state_hash"}
    }


def page(s, model, p, limit=25, offset=0, **filters):
    query = select(model).where(model.org_id == p.org_id)
    for k, v in filters.items():
        query = query.where(getattr(model, k) == v)
    if model is m.Vacancy:
        query = query.where(m.Vacancy.deleted_at.is_(None))
    total = s.scalar(select(func.count()).select_from(query.subquery()))
    items = s.scalars(
        query.order_by(model.created_at, model.id).limit(limit).offset(offset)
    ).all()
    return {
        "items": [public(x) for x in items],
        "total": total,
        "limit": limit,
        "offset": offset,
        "has_more": offset + len(items) < total,
    }


def event(s, p, kind, message, vacancy_id=None, application_id=None, run_id=None, details=None):
    if not s.in_transaction():
        s.begin()
    # Routine metadata uses a closed vocabulary; never copy tool payloads/model responses.
    safe = {}
    for key, value in (details or {}).items():
        if key in {"tool", "result", "error_code"} and isinstance(value, str) and re.fullmatch(r"[A-Za-z0-9_.:-]{1,80}", value):
            safe[key] = value
        elif key in {"duration_seconds", "attempt"} and isinstance(value, (int, float)) and 0 <= value < 1e12:
            safe[key] = value
    s.info.setdefault("pending_activity", []).append(dict(
            org_id=p.org_id,
            actor_id=p.user_id,
            kind=kind,
            message=message,
            details=safe,
            vacancy_id=vacancy_id,
            application_id=application_id,
            run_id=run_id,
        ))


@sqlalchemy_event.listens_for(ORMSession, "before_commit")
def commit_activity(s):
    if s.in_nested_transaction():
        return
    pending = s.info.pop("pending_activity", [])
    if not pending:
        return
    # Allocate cursors at the commit boundary, after provider work. Serialize by
    # tenant so a late commit cannot appear behind a cursor already consumed.
    clocks = {}
    for org_id in sorted({x["org_id"] for x in pending}):
        if s.bind.dialect.name == "sqlite":
            s.execute(update(m.Organization).where(m.Organization.id == org_id).values(name=m.Organization.name))
        else:
            s.execute(select(m.Organization.id).where(m.Organization.id == org_id).with_for_update())
        clocks[org_id] = max(now(), (s.scalar(select(func.max(m.WorkflowEvent.created_at)).where(m.WorkflowEvent.org_id == org_id)) or 0) + .000001)
    for payload in pending:
        org_id = payload["org_id"]
        s.add(m.WorkflowEvent(**payload, created_at=clocks[org_id]))
        clocks[org_id] += .000001


@sqlalchemy_event.listens_for(ORMSession, "after_rollback")
def discard_activity(s):
    s.info.pop("pending_activity", None)


def approval(s, p, kind, id, rationale=""):
    row = m.Approval(
        org_id=p.org_id,
        target_type=kind,
        target_id=id,
        actor_id=p.user_id,
        rationale=rationale,
    )
    s.add(row)
    return row


def model_usage(s, org_id, application_id, model, usage, **labels):
    """Only provider-reported counters; pricing is explicit and model-specific."""
    if not usage or any(type(usage.get(k)) is not int or usage[k] < 0 for k in ("input_tokens", "output_tokens")):
        return
    labels = {**labels, "application_id": application_id, "model": model}
    for name in ("input_tokens", "output_tokens"):
        s.add(m.Metric(org_id=org_id, name="model_" + name, value=usage[name], labels=labels))
    try:
        from decimal import Decimal
        if os.environ["MODEL_PRICE_MODEL"] != model:
            return
        prices = [Decimal(os.environ[k]) for k in ("MODEL_INPUT_USD_PER_MILLION", "MODEL_OUTPUT_USD_PER_MILLION")]
        if all(x.is_finite() and x >= 0 for x in prices):
            cost = (prices[0] * usage["input_tokens"] + prices[1] * usage["output_tokens"]) / 1000000
            s.add(m.Metric(org_id=org_id, name="estimated_model_cost_usd", value=float(cost),
                labels={**labels, "estimated": True, "input_usd_per_million": str(prices[0]), "output_usd_per_million": str(prices[1])}))
    except (KeyError, ValueError, ArithmeticError):
        pass


def requirements(s, version_id):
    return list(
        s.scalars(
            select(m.Requirement)
            .where(m.Requirement.version_id == version_id)
            .order_by(m.Requirement.created_at, m.Requirement.id)
        )
    )


def propose(s, p, v, items):
    # All edits create new rows, including edits to an unapproved proposal.
    ids = [r.stable_id for r in items if r.stable_id]
    if len(set(ids)) != len(ids):
        raise HTTPException(422, "Duplicate stable requirement IDs")
    if len({r.description.lower() for r in items}) != len(items):
        raise HTTPException(422, "Duplicate requirement descriptions")
    for rid in ids:
        other = s.scalar(
            select(m.Requirement)
            .join(
                m.RequirementVersion,
                m.Requirement.version_id == m.RequirementVersion.id,
            )
            .where(
                m.Requirement.org_id == p.org_id,
                m.Requirement.stable_id == rid,
                m.RequirementVersion.vacancy_id != v.id,
            )
        )
        if other:
            raise HTTPException(422, "Stable requirement ID belongs to another vacancy")
    number = (
        s.scalar(
            select(func.max(m.RequirementVersion.version)).where(
                m.RequirementVersion.vacancy_id == v.id
            )
        )
        or 0
    ) + 1
    version = m.RequirementVersion(
        org_id=p.org_id,
        vacancy_id=v.id,
        version=number,
        proposed_by=p.user_id,
        supersedes_id=v.active_requirement_version_id,
    )
    s.add(version)
    s.flush()
    for item in items:
        values = item.model_dump()
        values["stable_id"] = values["stable_id"] or uid()
        s.add(
            m.Requirement(
                org_id=p.org_id, version_id=version.id, version=number, **values
            )
        )
    event(
        s,
        p,
        "requirements.proposed",
        f"Requirement version {number} proposed; approval required.",
        v.id,
    )
    s.flush()
    return version


def create_vacancy(s, p, body):
    v = m.Vacancy(org_id=p.org_id, title=body.title, description=body.description)
    s.add(v)
    s.flush()
    propose(s, p, v, body.requirements)
    return v


def approve_version(s, p, id, rationale=""):
    version = own(s, m.RequirementVersion, id, p)
    v = own(s, m.Vacancy, version.vacancy_id, p)
    v = s.scalar(
        select(m.Vacancy)
        .where(m.Vacancy.id == v.id, m.Vacancy.org_id == p.org_id)
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    s.refresh(version)
    if version.state == "approved":
        raise HTTPException(409, "Version is already approved")
    if not requirements(s, version.id):
        raise HTTPException(409, "A version must contain criteria")
    if v.active_requirement_version_id:
        current = s.get(m.RequirementVersion, v.active_requirement_version_id)
        if current.version >= version.version:
            raise HTTPException(409, "A newer version is already approved")
    version.state = "approved"
    version.approved_by = p.user_id
    version.approved_at = now()
    s.flush()  # Approved content becomes immutable after this transition.
    v.active_requirement_version_id = version.id
    for a in s.scalars(
        select(m.Application).where(
            m.Application.org_id == p.org_id,
            m.Application.vacancy_id == v.id,
            m.Application.requirement_version_id != version.id,
        )
    ):
        a.reassessment_required = True
        s.execute(
            update(m.CandidateInvitation)
            .where(
                m.CandidateInvitation.org_id == p.org_id,
                m.CandidateInvitation.application_id == a.id,
                m.CandidateInvitation.revoked_at.is_(None),
            )
            .values(revoked_at=now())
        )
    approval(s, p, "requirements", version.id, rationale)
    event(
        s,
        p,
        "requirements.approved",
        f"Approved version {version.version}; affected applications flagged for reassessment.",
        v.id,
    )
    return version


def change_vacancy(s, p, v, body):
    values = body.model_dump(exclude_none=True)
    if values.get("state") == "published":
        version = (
            s.get(m.RequirementVersion, v.active_requirement_version_id)
            if v.active_requirement_version_id
            else None
        )
        if not version or version.state != "approved":
            raise HTTPException(409, "Publication requires approved criteria")
    for k, value in values.items():
        setattr(v, k, value)
    event(s, p, "vacancy.updated", "Recruiter updated vacancy metadata/state.", v.id)
    return v


def create_application(s, p, body, synthetic=False):
    v = own(s, m.Vacancy, body.vacancy_id, p)
    if v.state != "published" or not v.active_requirement_version_id:
        raise HTTPException(
            409, "Applications require a published vacancy with approved criteria"
        )
    org = s.get(m.Organization, p.org_id)
    if org.is_demo and not synthetic:
        raise HTTPException(
            403, "Demo permits synthetic applicants only; use the seed endpoint"
        )
    c = (
        own(s, m.Candidate, body.candidate_id, p)
        if body.candidate_id
        else m.Candidate(
            org_id=p.org_id,
            display_name=body.display_name,
            email=body.email,
            synthetic=synthetic,
        )
    )
    s.add(c)
    s.flush()
    a = m.Application(
        org_id=p.org_id,
        candidate_id=c.id,
        vacancy_id=v.id,
        requirement_version_id=v.active_requirement_version_id,
    )
    s.add(a)
    s.flush()
    event(s, p, "application.created", "Application created.", v.id, a.id)
    return a


def add_evidence(s, p, a, body):
    values = body.model_dump(exclude_none=True)
    if body.document_id:
        d = own(s, m.Document, body.document_id, p)
        if d.application_id != a.id:
            raise HTTPException(422, "Document belongs to another application")
    if body.response_id:
        response = own(s, m.ClarificationResponse, body.response_id, p)
        if response.application_id != a.id or body.passage not in response.text:
            raise HTTPException(422, "Passage must match this application response")
    if body.extraction_version_id:
        ex = own(s, m.ExtractionVersion, body.extraction_version_id, p)
        if ex.document_id != body.document_id:
            raise HTTPException(422, "Extraction does not belong to the document")
        passages = [
            x
            for x in ex.passages
            if body.passage in x["text"]
            and (body.page is None or x.get("page") == body.page)
            and (body.paragraph is None or x.get("paragraph") == body.paragraph)
        ]
        if not passages:
            raise HTTPException(
                422, "Exact passage/location is absent from this extraction version"
            )
    if body.source_kind == "cv" and (
        not body.document_id or not body.extraction_version_id
    ):
        raise HTTPException(
            422, "CV evidence requires a document and extraction version"
        )
    if body.source_kind == "clarification" and not body.response_id:
        raise HTTPException(422, "Clarification evidence requires a response")
    if (
        body.source_kind in ("cv", "clarification")
        and body.strength != "candidate_reported"
    ):
        raise HTTPException(422, "CV and candidate answers remain candidate-reported")
    if body.strength == "assessment_observed" and body.source_kind != "assessment":
        raise HTTPException(422, "Observed evidence requires a structured assessment")
    if (
        body.source_kind in ("assessment", "work_sample", "reference")
        and not body.artifact_location
    ):
        raise HTTPException(422, "Artifact location is required")
    if (
        body.supersedes_id
        and own(s, m.EvidenceItem, body.supersedes_id, p).application_id != a.id
    ):
        raise HTTPException(422, "Superseded evidence belongs to another application")
    if body.observed_at is not None and not 0 < body.observed_at <= now() + 300:
        raise HTTPException(422, "Invalid observed timestamp")
    row = m.EvidenceItem(org_id=p.org_id, application_id=a.id, **values)
    s.add(row)
    s.flush()
    return row


def admissible(requirement, evidence):
    types = {
        "cv": "document",
        "clarification": "candidate_report",
        "work_sample": "work_sample",
        "assessment": "structured_assessment",
        "reference": "reference",
    }
    available = {types[evidence.source_kind]}
    if evidence.strength == "candidate_reported":
        available.add("candidate_report")
    return bool(available.intersection(requirement.acceptable_evidence_types))


def usable_evidence(s, evidence):
    if not evidence:
        return False
    document = s.get(m.Document, evidence.document_id) if evidence.document_id else None
    return not evidence.document_id or bool(document and document.org_id == evidence.org_id and not document.excluded_at)


def revise_finding(s, p, a, body, author=True, provenance=None):
    r = own(s, m.Requirement, body.requirement_id, p)
    if r.version_id != a.requirement_version_id:
        raise HTTPException(422, "Requirement is not in the application review version")
    ids = list(dict.fromkeys(body.evidence_ids))
    if body.state in ("supported", "partial") and not ids:
        raise HTTPException(422, "Supported/partial findings require evidence")
    if body.state == "conflicting" and len(ids) < 2:
        raise HTTPException(
            422, "Conflicting findings require at least two evidence items"
        )
    for id in ids:
        e = own(s, m.EvidenceItem, id, p)
        if e.application_id != a.id:
            raise HTTPException(422, "Evidence belongs to another application")
        if not usable_evidence(s, e):
            raise HTTPException(422, "Source was excluded; use active evidence or retain unknown")
        if body.state in ("supported", "partial") and not admissible(r, e):
            raise HTTPException(
                422, "Evidence type is not accepted by this approved requirement"
            )
    finding = s.scalar(
        select(m.Finding).where(
            m.Finding.org_id == p.org_id,
            m.Finding.application_id == a.id,
            m.Finding.requirement_id == r.id,
        )
    )
    if not finding:
        finding = m.Finding(org_id=p.org_id, application_id=a.id, requirement_id=r.id)
        s.add(finding)
        s.flush()
    previous = s.scalar(
        select(m.FindingRevision)
        .where(m.FindingRevision.finding_id == finding.id)
        .order_by(m.FindingRevision.revision.desc())
    )
    revision = m.FindingRevision(
        org_id=p.org_id,
        finding_id=finding.id,
        revision=previous.revision + 1 if previous else 1,
        state=body.state,
        explanation=body.explanation,
        unresolved_question=body.unresolved_question,
        author_id=p.user_id if author else None,
        provenance=provenance or {},
        supersedes_id=previous.id if previous else None,
    )
    s.add(revision)
    s.flush()
    if previous and previous.state != "supported" and body.state == "supported":
        s.add(m.Metric(org_id=p.org_id, name="evidence_gaps_resolved", value=1,
            labels={"application_id": a.id, "requirement_id": r.id, "revision_id": revision.id}))
    for id in ids:
        s.add(
            m.FindingEvidence(org_id=p.org_id, revision_id=revision.id, evidence_id=id)
        )
    return revision


def finding_view(s, f):
    result = public(f)
    revision = s.scalar(
        select(m.FindingRevision)
        .where(m.FindingRevision.finding_id == f.id)
        .order_by(m.FindingRevision.revision.desc())
    )
    result["latest_revision"] = revision_view(s, revision) if revision else None
    return result


def revision_view(s, r):
    return {
        **public(r),
        "evidence_ids": list(
            s.scalars(
                select(m.FindingEvidence.evidence_id).where(
                    m.FindingEvidence.revision_id == r.id
                )
            )
        ),
    }


def create_round(s, p, a, body):
    if a.reassessment_required:
        raise HTTPException(
            409, "Reassess this application against approved criteria first"
        )
    number = (
        s.scalar(
            select(func.max(m.ClarificationRound.number)).where(
                m.ClarificationRound.application_id == a.id
            )
        )
        or 0
    ) + 1
    from backend.clarification import validate_question, workflow_for
    workflow = workflow_for(s, a)
    if workflow.round_id or workflow.completed_at:
        raise HTTPException(409, "One clarification round per approved criteria version; use factual corrections")
    for q in body.questions:
        validate_question(q.text)
    if len({q.text.casefold().strip() for q in body.questions}) != len(body.questions):
        raise HTTPException(422, "Repeated clarification question")
    if number > 2:
        raise HTTPException(409, "Maximum two clarification rounds")
    if len({q.requirement_id for q in body.questions}) != len(body.questions):
        raise HTTPException(422, "Duplicate requirement question")
    for q in body.questions:
        r = own(s, m.Requirement, q.requirement_id, p)
        if r.version_id != a.requirement_version_id or not r.clarification_permitted:
            raise HTTPException(
                422, "Requirement does not permit clarification in this review version"
            )
    row = m.ClarificationRound(
        org_id=p.org_id,
        application_id=a.id,
        requirement_version_id=a.requirement_version_id,
        number=number,
    )
    s.add(row)
    s.flush()
    workflow.round_id = row.id
    a.review_state = "awaiting_approval"
    for q in body.questions:
        s.add(
            m.ClarificationQuestion(org_id=p.org_id, round_id=row.id, **q.model_dump())
        )
    event(
        s,
        p,
        "clarification.drafted",
        "Bounded clarification drafted; recruiter approval required.",
        a.vacancy_id,
        a.id,
    )
    return row


def approve_round(s, p, r, rationale="", policy=None):
    from backend.clarification import approve
    return approve(s, p, r, policy or {"rationale": rationale, "response_hours": 72, "max_reminders": 1, "reminder_hours": 24})


def issue_invitation(s, p, a, body):
    if a.withdrawn_at or a.reassessment_required:
        raise HTTPException(409, "Application requires current approved review scope")
    if not body.scopes:
        raise HTTPException(422, "At least one scope is required")
    if body.round_id:
        selected = own(s, m.ClarificationRound, body.round_id, p)
        if selected.application_id != a.id or selected.state != "approved":
            raise HTTPException(
                409,
                "Only an approved round in this application may be exposed to candidates",
            )
    if "clarification:respond" in body.scopes:
        r = own(s, m.ClarificationRound, body.round_id, p) if body.round_id else None
        if not r or r.application_id != a.id or r.state != "approved":
            raise HTTPException(
                409, "An approved clarification round in this application is required"
            )
    elif (
        body.round_id
        and own(s, m.ClarificationRound, body.round_id, p).application_id != a.id
    ):
        raise HTTPException(422, "Round belongs to another application")
    token = secrets.token_urlsafe(32)
    invitation = m.CandidateInvitation(
        org_id=p.org_id,
        application_id=a.id,
        round_id=body.round_id,
        token_hash=digest(token),
        scopes=list(dict.fromkeys(body.scopes)),
        expires_at=now() + body.expires_in_seconds,
    )
    s.add(invitation)
    s.flush()
    event(
        s,
        p,
        "invitation.created",
        "Scoped candidate invitation created; no message sent.",
        a.vacancy_id,
        a.id,
    )
    return invitation, token


def submit_responses(s, p, a, invitation, body):
    from backend.clarification import submit
    return submit(s, p, a, invitation, body)


def create_run(s, p, v, reextract=False):
    if not v.active_requirement_version_id:
        raise HTTPException(409, "Approve requirements first")
    if s.scalar(
        select(m.WorkflowRun).where(
            m.WorkflowRun.org_id == p.org_id,
            m.WorkflowRun.vacancy_id == v.id,
            m.WorkflowRun.state.in_(["queued", "running", "paused"]),
        )
    ):
        raise HTTPException(409, "A workflow is already active")
    applications = list(
        s.scalars(
            select(m.Application).where(
                m.Application.org_id == p.org_id,
                m.Application.vacancy_id == v.id,
                m.Application.withdrawn_at.is_(None),
            )
        )
    )
    if not applications:
        raise HTTPException(409, "No applications to review")
    run = m.WorkflowRun(
        org_id=p.org_id,
        vacancy_id=v.id,
        requirement_version_id=v.active_requirement_version_id,
        requested_by=p.user_id,
    )
    s.add(run)
    s.flush()
    for a in applications:
        s.add(
            m.WorkflowJob(
                org_id=p.org_id,
                run_id=run.id,
                application_id=a.id,
                kind="reextract" if reextract else "review",
            )
        )
    event(
        s,
        p,
        "workflow.queued",
        "Review jobs persisted for the approved requirement version.",
        v.id,
        run_id=run.id,
    )
    return run


def store_upload(s, p, a, data, filename, content_type):
    org = s.get(m.Organization, p.org_id)
    if org.is_demo:
        raise HTTPException(
            403, "Demo accepts only synthetic documents from the seed endpoint"
        )
    if not data or len(data) > 5 * 1024 * 1024:
        raise HTTPException(413, "Upload must be 1 byte to 5 MB")
    name = re.split(r"[/\\]", filename or "")[-1][:180]
    suffix = Path(name).suffix.lower()
    allowed = {
        ".pdf": ("application/pdf", b"%PDF-"),
        ".docx": (
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            b"PK",
        ),
    }
    if suffix not in allowed:
        raise HTTPException(422, "Only PDF and DOCX are accepted")
    media, magic = allowed[suffix]
    if content_type not in (media, "application/octet-stream") or not data.startswith(
        magic
    ):
        raise HTTPException(422, "File extension, media type or signature mismatch")
    if suffix == ".docx":
        try:
            with ZipFile(io.BytesIO(data)) as z:
                entries = z.infolist()
                if (
                    len(entries) > 1000
                    or sum(x.file_size for x in entries) > 20 * 1024 * 1024
                    or "[Content_Types].xml" not in z.namelist()
                    or "word/document.xml" not in z.namelist()
                    or any(
                        "vbaproject" in x.filename.lower() or x.flag_bits & 1
                        for x in entries
                    )
                ):
                    raise HTTPException(422, "Unsafe or unsupported DOCX archive")
        except BadZipFile:
            raise HTTPException(422, "Invalid DOCX archive")
    key = secrets.token_hex(24) + suffix
    root = Path(os.getenv("STORAGE_ROOT", "storage")).resolve()
    root.mkdir(exist_ok=True, parents=True)
    path = root / key
    with path.open("xb") as f:
        f.write(data)
    row = m.Document(
        org_id=p.org_id,
        application_id=a.id,
        original_name=name,
        storage_key=key,
        media_type=media,
        size_bytes=len(data),
        sha256=hashlib.sha256(data).hexdigest(),
    )
    s.add(row)
    s.flush()
    return row


def seed_applicants(s, p, v):
    org = s.get(m.Organization, p.org_id)
    if not org.is_demo:
        raise HTTPException(403, "Synthetic seed is demo-only")
    if s.scalar(select(m.Application).where(m.Application.vacancy_id == v.id)):
        raise HTTPException(409, "Vacancy already has applicants")
    for i, name in enumerate(
        [
            "Rina Kartika",
            "Dimas Pratama",
            "Ayu Lestari",
            "Bagas Nugroho",
            "Sari Wulandari",
        ]
    ):
        a = create_application(
            s,
            p,
            dto.ApplicationInput(vacancy_id=v.id, display_name=name, email="demo-"+str(i)+"@example.test"),
            synthetic=True,
        )
        text = "\n".join(
            "Skills: " + r.description + ". Experience: synthetic project contribution."
            for n, r in enumerate(requirements(s, v.active_requirement_version_id))
            if (i + n) % 3 != 1
        )
        d = m.Document(
            org_id=p.org_id,
            application_id=a.id,
            original_name="cv_" + name.lower().replace(" ", "_") + ".pdf",
            storage_key="synthetic-" + uid(),
            media_type="application/pdf",
            size_bytes=0,
            sha256=hashlib.sha256(text.encode()).hexdigest(),
            synthetic=True,
        )
        s.add(d)
        s.flush()
        s.add(
            m.ExtractionVersion(
                org_id=p.org_id,
                document_id=d.id,
                version=1,
                engine="synthetic-v1",
                passages=[{"page": 1, "paragraph": None, "text": text}],
                limitations="Deterministic synthetic data. Not a real applicant document.",
            )
        )
    event(
        s,
        p,
        "demo.seeded",
        "Five synthetic applications created. No real documents, emails or calendar calls.",
        v.id,
    )


def brief(s, p, a):
    v = own(s, m.Vacancy, a.vacancy_id, p)
    fs = list(
        s.scalars(
            select(m.Finding).where(
                m.Finding.org_id == p.org_id,
                m.Finding.application_id == a.id,
                m.Finding.requirement_id.in_(
                    [r.id for r in requirements(s, a.requirement_version_id)]
                ),
            )
        )
    )
    return {
        "application_id": a.id,
        "vacancy_title": v.title,
        "requirement_version_id": a.requirement_version_id,
        "reassessment_required": a.reassessment_required,
        "requirements": [public(r) for r in requirements(s, a.requirement_version_id)],
        "findings": [finding_view(s, f) for f in fs],
        "evidence": [
            public(e)
            for e in s.scalars(
                select(m.EvidenceItem).where(
                    m.EvidenceItem.org_id == p.org_id,
                    m.EvidenceItem.application_id == a.id,
                )
            )
        ],
        "limitations": [
            "Unknown evidence is not inability.",
            "Self-report and artifacts do not automatically establish expertise or authorship.",
            "Humans make selection and hiring decisions.",
        ],
    }
