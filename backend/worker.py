"""Persisted leased review jobs and approved outbox actions. Safe to run without Docker."""

import os, secrets, time, re
import httpx
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy import select, update, or_, func
from backend.db import Session, now
from backend import models as m, services as svc, schemas as d
from backend.auth import Principal
from backend.tools import extract
from backend.analysis import professional_lines, analyze, AnalysisError
from backend.ingestion import IngestionError
from backend import execution


def finish_run(s, run):
    if run.state in ("paused", "cancelled"):
        return
    states = list(
        s.scalars(select(m.WorkflowJob.state).where(m.WorkflowJob.run_id == run.id))
    )
    if states and all(x == "done" for x in states):
        run.state = "done"
    elif states and not any(x in ("queued", "running") for x in states):
        run.state = "failed"


def review(s, job, run, p):
    a = svc.own(s, m.Application, job.application_id, p)
    if a.withdrawn_at:
        raise ValueError("Application withdrawn")
    v = svc.own(s, m.Vacancy, a.vacancy_id, p)
    a.requirement_version_id = run.requirement_version_id
    a.reassessment_required = (
        v.active_requirement_version_id != run.requirement_version_id
    )
    docs = list(
        s.scalars(
            select(m.Document).where(
                m.Document.org_id == p.org_id, m.Document.application_id == a.id, m.Document.excluded_at.is_(None)
            )
        )
    )
    evidence = []
    candidate = svc.own(s, m.Candidate, a.candidate_id, p)
    identities = [candidate.display_name, candidate.email]
    identities += candidate.display_name.split()
    uncertain = False
    new_extraction = False
    for doc in docs:
        ex = s.scalar(
            select(m.ExtractionVersion)
            .where(m.ExtractionVersion.document_id == doc.id)
            .order_by(m.ExtractionVersion.version.desc())
        )
        previous = ex
        if job.kind == "reextract" and doc.synthetic and ex:
            ex = m.ExtractionVersion(
                org_id=p.org_id,
                document_id=doc.id,
                version=ex.version + 1,
                engine="synthetic-v1",
                passages=ex.passages,
                limitations=ex.limitations,
                supersedes_id=ex.id,
            )
            s.add(ex)
            s.flush()
        elif not ex or job.kind == "reextract":
            if doc.synthetic:
                raise ValueError("Synthetic document missing extraction")
            extraction_started = now()
            pages = extract(
                Path(os.getenv("STORAGE_ROOT", "storage")) / doc.storage_key,
                Path(doc.original_name).suffix.lower(),
            )
            passages = pages
            ex = m.ExtractionVersion(
                org_id=p.org_id,
                document_id=doc.id,
                version=previous.version + 1 if previous else 1,
                supersedes_id=previous.id if previous else None,
                engine="pdf-docx-tesseract-v2",
                passages=passages,
                limitations="Extraction may omit relevant material. OCR is uncertain and requires source review. Correct via factual clarification or upload an accessible replacement and re-extract. Only minimized labelled professional lines enter analysis; filtering does not eliminate bias.",
            )
            s.add(ex)
            s.flush()
            svc.event(s, p, "extraction.completed", "Private original parsed into source-linked passages. OCR uncertainty is retained; no images were submitted to the model.", v.id, a.id, run.id,
                details={"tool": "pdf_docx_ocr", "result": "uncertain" if any(x.get("quality")=="uncertain" for x in pages) else "extracted", "duration_seconds": max(0, now()-extraction_started)})
        for passage in ex.passages:
            if passage.get("quality") == "uncertain":
                uncertain = True
                continue
            for line in professional_lines(passage["text"], identities):
                if line not in passage["text"]:
                    continue
                existing = s.scalar(
                    select(m.EvidenceItem).where(
                        m.EvidenceItem.org_id == p.org_id,
                        m.EvidenceItem.extraction_version_id == ex.id,
                        m.EvidenceItem.passage == line,
                    )
                )
                superseded = (
                    s.scalar(
                        select(m.EvidenceItem)
                        .where(
                            m.EvidenceItem.org_id == p.org_id,
                            m.EvidenceItem.document_id == doc.id,
                            m.EvidenceItem.passage == line,
                        )
                        .order_by(m.EvidenceItem.created_at.desc())
                    )
                    if previous and ex.id != previous.id
                    else None
                )
                e = existing or svc.add_evidence(
                    s,
                    p,
                    a,
                    d.EvidenceInput(
                        document_id=doc.id,
                        extraction_version_id=ex.id,
                        source_kind="cv",
                        strength="candidate_reported",
                        passage=line,
                        page=passage.get("page"),
                        paragraph=passage.get("paragraph"),
                        artifact_location="document:" + doc.id,
                        supersedes_id=superseded.id if superseded else None,
                    ),
                )
                evidence.append(e)
        if previous is None or ex.id != previous.id:
            new_extraction = True
    from backend import clarification as clarification_loop
    prior_loop = clarification_loop.workflow_for(s, a, False)
    prior_round = s.get(m.ClarificationRound, prior_loop.round_id) if prior_loop and prior_loop.round_id else None
    if prior_loop and prior_loop.completed_at and prior_round and prior_round.state == "answered" and not new_extraction and job.kind != "reextract":
        svc.event(s, p, "review.retained", "Existing completed clarification and source-linked findings retained; no repeated questions or email.", v.id, a.id, run.id)
        return
    requirements = svc.requirements(s, run.requirement_version_id)
    mode = "demo" if s.get(m.Organization, p.org_id).is_demo else "live"
    analyzed = []
    for r in requirements:
        eligible = [{"id": e.id, "passage": e.passage, "strength": e.strength,
                     "extraction_version_id": e.extraction_version_id}
                    for e in evidence if svc.admissible(r, e)]
        analyzed.extend(analyze([{"id": r.id, "description": r.description,
            "importance": r.importance, "acceptable_evidence_types": r.acceptable_evidence_types,
            "minimum_observable_expectation": r.minimum_observable_expectation}], eligible, mode))
    for item, provenance in analyzed:
        svc.model_usage(s, p.org_id, a.id, provenance["model"], provenance.get("usage"), job_id=job.id)
        svc.revise_finding(s, p, a, d.FindingInput(requirement_id=item.requirement_id,
            state=item.status, evidence_ids=item.evidence_ids,
            explanation=item.explanation, unresolved_question=item.unresolved_question),
            author=False, provenance=provenance)
    if uncertain:
        svc.event(s, p, "extraction.uncertain",
            "Low-quality or unavailable OCR: uncertain passages excluded. Review original, request factual correction, or upload an accessible replacement and re-extract.",
            v.id, a.id, run.id)
    a.review_state = "ready_for_review"
    from backend.clarification import plan
    if not a.reassessment_required:
        if prior_loop and prior_loop.completed_at and prior_round and prior_round.state == "answered":
            prior_loop.resume_seq += 1
            clarification_loop.resume(s, p, a, prior_loop)
        else:
            plan(s, p, a)
    svc.event(
        s,
        p,
        "review.completed",
        "Source-linked review completed; human decisions required.",
        v.id,
        a.id,
        run.id,
    )


def tick():
    from backend.retention import cleanup_files
    with Session() as cleanup_session:
        cleanup_files(cleanup_session)
    from backend.interview_workflow import tick as interview_tick
    if interview_tick():
        return True
    from backend.clarification import tick as clarification_tick
    if clarification_tick():
        return True
    with Session() as s:
        for withdrawn in s.scalars(select(m.WorkflowJob).join(m.Application, m.Application.id == m.WorkflowJob.application_id).where(
            m.Application.withdrawn_at.is_not(None), m.WorkflowJob.state.in_(["queued", "running"]))):
            execution.end(s, "analysis", withdrawn.id, withdrawn.lease_token, "interrupted", "application_withdrawn")
            withdrawn.state = "cancelled"
            withdrawn.lease_token = None
            withdrawn.lease_until = 0
        # Reconcile after commits from concurrent workers, including the final job.
        for pending in s.scalars(
            select(m.WorkflowRun).where(m.WorkflowRun.state.in_(["queued", "running"]))
        ):
            finish_run(s, pending)
        for old in s.scalars(
            select(m.WorkflowJob).where(
                m.WorkflowJob.state == "running",
                m.WorkflowJob.lease_until < now(),
                m.WorkflowJob.attempts >= 3,
            )
        ):
            execution.end(s, "analysis", old.id, old.lease_token, "interrupted", "lease_exhausted")
            old.state = "failed"
            old.error = "Lease expired after maximum attempts"
            old.lease_token = None
            finish_run(s, s.get(m.WorkflowRun, old.run_id))
        s.commit()
        eligible = or_(
            m.WorkflowJob.state == "queued",
            (m.WorkflowJob.state == "running") & (m.WorkflowJob.lease_until < now()),
        )
        job = s.scalar(
            select(m.WorkflowJob)
            .join(m.WorkflowRun, m.WorkflowRun.id == m.WorkflowJob.run_id)
            .where(
                eligible,
                m.WorkflowJob.available_at <= now(),
                m.WorkflowJob.attempts < 3,
                m.WorkflowRun.state.in_(["queued", "running"]),
            )
            .order_by(m.WorkflowJob.available_at)
            .limit(1)
        )
        if not job:
            return outbox_tick()
        id, attempt, token = job.id, job.attempts + 1, secrets.token_hex(24)
        claimed = s.execute(
            update(m.WorkflowJob)
            .where(
                m.WorkflowJob.id == id, eligible, m.WorkflowJob.attempts == attempt - 1
            )
            .values(
                state="running",
                attempts=attempt,
                lease_token=token,
                lease_until=now() + 600,
            )
            .execution_options(synchronize_session=False)
        ).rowcount
        if claimed:
            execution.begin(s, job, "analysis", token)
        s.commit()
        if not claimed:
            return False
    started = now()
    with Session() as s:
        job = s.get(m.WorkflowJob, id)
        run = s.get(m.WorkflowRun, job.run_id)
        p = Principal(job.org_id, None, "worker", "")
        try:
            if run.state not in ("queued", "running"):
                return True
            if job.kind in ("review", "reextract"):
                with execution.heartbeat(m.WorkflowJob, id, token):
                    review(s, job, run, p)
            elif job.kind == "followup":
                svc.event(
                    s,
                    p,
                    "followup.due",
                    "Recruiter follow-up due; no message sent.",
                    run.vacancy_id,
                    job.application_id,
                    run.id,
                )
            else:
                raise ValueError("Unsupported persisted job kind")
            # CAS fences stale workers. Run state is checked in the same final transaction.
            live_run = s.scalar(
                select(m.WorkflowRun.state)
                .where(m.WorkflowRun.id == run.id)
                .execution_options(populate_existing=True)
            )
            if live_run not in ("queued", "running"):
                s.rollback()
                return True
            if s.scalar(select(m.Application.withdrawn_at).where(m.Application.id == job.application_id)) is not None:
                s.rollback()
                return True
            changed = s.execute(
                update(m.WorkflowJob)
                .where(
                    m.WorkflowJob.id == id,
                    m.WorkflowJob.lease_token == token,
                    m.WorkflowJob.state == "running",
                )
                .values(state="done", lease_token=None, lease_until=0, error="")
                .execution_options(synchronize_session=False)
            ).rowcount
            if not changed:
                s.rollback()
                return True
            finish_run(s, run)
            execution.end(s, "analysis", id, token, "completed")
            svc.event(s, p, "execution.completed", "Application analysis committed; downstream approval and response waits remain independent.",
                run.vacancy_id, job.application_id, run.id,
                details={"tool": job.kind, "result": "completed", "duration_seconds": max(0, now() - started), "attempt": attempt})
            s.add(
                m.Metric(
                    org_id=p.org_id,
                    name="review_seconds",
                    value=now() - started,
                    labels={"run_id": run.id, "job_id": id},
                )
            )
            s.commit()
        except Exception as exc:
            s.rollback()
            s.expire_all()
            job = s.get(m.WorkflowJob, id)
            if job.lease_token != token or job.state != "running":
                return True
            job.state = "failed" if attempt >= 3 else "queued"
            job.error = (
                str(exc)[:240] if isinstance(exc, (AnalysisError, IngestionError)) else type(exc).__name__ + ": review failed; check document/configuration"
            )
            job.available_at = now() + 2**attempt
            job.lease_token = None
            job.lease_until = 0
            execution.end(s, "analysis", id, token, "needs_attention" if attempt >= 3 else "retry_scheduled", type(exc).__name__)
            run = s.get(m.WorkflowRun, job.run_id)
            svc.event(
                s,
                p,
                "review.failed",
                job.error,
                run.vacancy_id,
                job.application_id,
                run.id,
                details={"tool": job.kind, "result": "needs_attention" if attempt >= 3 else "retry_scheduled", "duration_seconds": max(0, now() - started), "attempt": attempt, "error_code": type(exc).__name__},
            )
            finish_run(s, run)
            s.commit()
    return True


def outbox_tick():
    with Session() as s:
        eligible = or_(
            m.OutboxAction.state == "queued",
            m.OutboxAction.state == "delivery_unknown",
            (m.OutboxAction.state == "running") & (m.OutboxAction.lease_until < now()),
        )
        for old in s.scalars(
            select(m.OutboxAction).where(
                m.OutboxAction.state == "running",
                m.OutboxAction.lease_until < now(),
                m.OutboxAction.attempts >= 3,
            )
        ):
            execution.end(s, "outbox", old.id, old.lease_token, "interrupted", "lease_exhausted")
            old.state = "delivery_unknown"
            old.error = "Lease expired after bounded attempts; provider acceptance requires reconciliation"
            old.lease_token = None
        s.commit()
        row = s.scalar(
            select(m.OutboxAction)
            .where(
                eligible,
                m.OutboxAction.attempts < 3,
                m.OutboxAction.available_at <= now(),
            )
            .order_by(m.OutboxAction.available_at)
            .limit(1)
        )
        if not row:
            return False
        if row.round_id and row.payload.get("invitation_id"):
            # Fill missing operational configuration before any provider request,
            # then persist the frozen payload in the claim transaction.
            payload = dict(row.payload)
            connection = s.scalar(select(m.ProviderConnection).where(m.ProviderConnection.org_id == row.org_id, m.ProviderConnection.provider == "email"))
            application = s.get(m.Application, row.application_id)
            candidate = s.get(m.Candidate, application.candidate_id)
            if not payload.get("from") and connection:
                payload["from"] = connection.config.get("from_email", "")
            if not payload.get("to"):
                payload["to"] = candidate.email or ""
            row.payload = payload
        id, token = row.id, secrets.token_hex(24)
        changed = s.execute(
            update(m.OutboxAction)
            .where(m.OutboxAction.id == id, eligible)
            .values(
                state="running",
                lease_token=token,
                lease_until=now() + 90,
                attempts=m.OutboxAction.attempts + 1,
            )
            .execution_options(synchronize_session=False)
        ).rowcount
        if changed:
            execution.begin(s, row, "outbox", token)
        s.commit()
        if not changed:
            return False
    with Session() as s:
        row = s.get(m.OutboxAction, id)
        started = now()
        a = s.get(m.Application, row.application_id)
        org = s.get(m.Organization, row.org_id)
        p = Principal(row.org_id, None, "worker", "")
        try:
            if a.withdrawn_at:
                row.state = "cancelled"
                row.lease_token = None
                row.lease_until = 0
                execution.end(s, "outbox", id, token, "cancelled", "application_withdrawn")
                s.commit()
                return True
            interview = (
                s.get(m.Interview, row.interview_id) if row.interview_id else None
            )
            if interview and (
                a.decision != "shortlist"
                or a.reassessment_required
                or interview.state != "approved"
            ):
                raise ValueError("Current recruiter interview approval required")
            if row.round_id and row.payload.get("invitation_id"):
                from backend.email_adapter import send
                with execution.heartbeat(m.OutboxAction,id,token,lease_seconds=90):
                    state, message = send(s, row, org)
                row.error = "" if state in ("completed", "simulated") else message
                workflow = s.scalar(select(m.ClarificationWorkflow).where(m.ClarificationWorkflow.round_id == row.round_id))
                if workflow and state in ("not_configured", "needs_attention", "failed"):
                    workflow.state = "needs_attention"
                    workflow.error = message
                if workflow:
                    from backend.clarification import record
                    record(s, workflow, "email:" + row.id, "await_response", message, {"outbox_id": row.id, "state": state})
            elif org.is_demo:
                state = "simulated"
                if interview:
                    interview.state = "simulated"
                    interview.external_id = "demo-" + interview.id
            elif row.kind == "interview" and interview:
                state = "not_configured"
                row.error = "Legacy booking lacks versioned interview invitation authorization; use the interview coordination workflow"
            else:
                state = "not_configured"
                row.error = "No messaging adapter configured; no message sent"
            changed = s.execute(
                update(m.OutboxAction)
                .where(m.OutboxAction.id == id, m.OutboxAction.lease_token == token)
                .values(state=state, lease_until=0, lease_token=None)
                .execution_options(synchronize_session=False)
            ).rowcount
            if not changed:
                s.rollback()
                return True
            execution.end(s, "outbox", id, token, state)
            svc.event(
                s,
                p,
                "outbox." + state,
                "Approved action "
                + state
                + (". Provider acceptance is not confirmed inbox delivery." if row.round_id and row.payload.get("invitation_id") else ". No candidate email delivery is claimed."),
                a.vacancy_id,
                a.id,
                details={"tool": row.kind, "result": state, "duration_seconds": max(0, now() - started), "attempt": row.attempts},
            )
            s.add(
                m.Metric(
                    org_id=p.org_id,
                    name="outbox_" + state,
                    value=1,
                    labels={"action_id": id},
                )
            )
            s.commit()
        except Exception as exc:
            s.rollback()
            s.expire_all()
            row = s.get(m.OutboxAction, id)
            if row.lease_token == token:
                uncertain = isinstance(exc, (httpx.TransportError, httpx.TimeoutException)) or (isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code >= 500)
                row.state = "delivery_unknown" if uncertain else "failed" if row.attempts >= 3 else "queued"
                row.error = type(exc).__name__ + ": action not confirmed"
                row.available_at = now() + 2**row.attempts
                row.lease_until = 0
                row.lease_token = None
                execution.end(s, "outbox", id, token, "delivery_unknown" if uncertain else "needs_attention" if row.attempts >= 3 else "retry_scheduled", type(exc).__name__)
                if row.round_id and row.payload.get("invitation_id"):
                    workflow = s.scalar(select(m.ClarificationWorkflow).where(m.ClarificationWorkflow.round_id == row.round_id))
                    if workflow and row.attempts >= 3:
                        workflow.state = "needs_attention"
                        workflow.error = "Email delivery could not be confirmed after bounded retries. Inspect the outbox before retrying."
                    svc.event(s, p, "clarification.delivery_retry", "Email acceptance not confirmed; persisted action " + row.state + ". Candidate ability is not evaluated from delivery state.", a.vacancy_id, a.id)
                s.commit()
    return True


if __name__ == "__main__":
    while True:
        if not tick():
            time.sleep(1)
