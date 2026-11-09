"""Persisted leased review jobs and approved outbox actions. Safe to run without Docker."""

import os, secrets, time, re
import threading
import difflib
import httpx
from pathlib import Path
from datetime import datetime, timezone
from sqlalchemy import select, update, or_, func
from backend.db import Session, now
from backend import models as m, services as svc, schemas as d
from backend.auth import Principal
from backend.tools import extract
from backend.analysis import (professional_lines, analyze, summarize, highlights,
    AnalysisError, Result, relevance_rank, PROMPT_VERSION as AI_PROMPT_VERSION,
    PROFILE_VERSION as AI_PROFILE_VERSION)
from backend.ingestion import IngestionError
from backend import execution, linkcheck


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


class ReviewCancelled(Exception):
    """The recruiter cancelled or paused the run; abort the review promptly."""


def job_cancelled(job_id, token):
    """Fresh-session probe of the working row.

    The worker's own session caches the pre-cancellation state, so the
    polling check reads the row through a separate short session: the job
    must still be leased and running, and its run still active.
    """
    with Session() as probe:
        row = probe.get(m.WorkflowJob, job_id)
        if row is None or row.state != "running" or row.lease_token != token:
            return True
        run = probe.get(m.WorkflowRun, row.run_id)
        return run is None or run.state not in ("queued", "running")


def cancellable(fn, job_id, token, poll=3.0):
    """Run a long model call in a daemon thread, aborting on cancel.

    Polls the persisted job row for recruiter cancellation/pause; when one
    is detected this raises ReviewCancelled without waiting for the call —
    the daemon thread is left to finish in the background and its result is
    discarded, so the worker loop returns control immediately and the
    process can be shut down cleanly.
    """
    box: dict = {}

    def work():
        try:
            box["result"] = fn()
        except BaseException as exc:  # re-raised on this side
            box["error"] = exc

    thread = threading.Thread(target=work, daemon=True)
    thread.start()
    while thread.is_alive():
        thread.join(poll)
        if job_cancelled(job_id, token):
            raise ReviewCancelled
    if "error" in box:
        raise box["error"]
    return box["result"]


URL = re.compile(r"https://[A-Za-z0-9._%~:/?#[\]@!$&'()*+,;=-]+")


def write_insights(s, p, v, a, run, evidence, source_texts, job_id=None, token=None):
    """Persist the Findings-page outputs of one review run.

    - summary and highlights come from the filtered evidence passages;
    - link discovery scans the raw document text (urls are deliberately
      stripped from evidence passages by professional_lines, so scanning
      evidence alone would find none).

    Every step fails closed without blocking the rest of the review. When
    job_id/token are supplied, each long model call is cancellable by a
    recruiter action; ReviewCancelled propagates without partial writes.
    """
    if job_id and job_cancelled(job_id, token):
        raise ReviewCancelled

    def run_model(fn):
        if job_id is None:
            return fn()
        return cancellable(fn, job_id, token)

    # Neutral background summary; when the model cannot produce one, fall
    # back to a bounded, clearly-labelled quote from the linked evidence so
    # the Findings page is never empty after a completed review.
    try:
        summary_text = run_model(lambda: summarize([e.passage for e in evidence]))
    except AnalysisError as e:
        svc.event(s, p, "analysis.summary_failed", str(e), v.id, a.id, run.id)
        summary_text = None
    if not summary_text:
        joined = " ".join(item.passage for item in evidence[:8])
        trimmed = " ".join(joined.split())
        if trimmed:
            summary_text = ("Neutral source-grounded background (model summary unavailable, "
                "first evidence passages quoted): " + trimmed[:900])
    if summary_text:
        svc.event(s, p, "analysis.summary", summary_text, v.id, a.id, run.id,
            details={"summary": summary_text})
        s.add(m.AnalysisInsight(org_id=p.org_id, application_id=a.id, run_id=run.id,
            kind="summary", text=summary_text))
        s.flush()
    else:
        svc.event(s, p, "analysis.summary_failed", "No linked evidence available for a summary.", v.id, a.id, run.id)

    # Notable strengths and job-relevant details, each an exact source quote.
    try:
        found = run_model(lambda: highlights([e.passage for e in evidence]))
        for text in found["strengths"]:
            s.add(m.AnalysisInsight(org_id=p.org_id, application_id=a.id, run_id=run.id,
                kind="strength", text=text))
        if found["strengths"]:
            svc.event(s, p, "analysis.highlights",
                "Notable strong points extracted from linked evidence; every item is an exact source quote.",
                v.id, a.id, run.id, details={"count": len(found["strengths"])})
        for text in found["relevant_details"]:
            s.add(m.AnalysisInsight(org_id=p.org_id, application_id=a.id, run_id=run.id,
                kind="detail", text=text))
        if found["relevant_details"]:
            svc.event(s, p, "analysis.details",
                "Job-relevant details extracted from linked evidence; every item is an exact source quote.",
                v.id, a.id, run.id, details={"count": len(found["relevant_details"])})
        s.flush()
    except AnalysisError as e:
        svc.event(s, p, "analysis.highlights_failed", str(e), v.id, a.id, run.id)

    # Verify public links found in the raw document text. Bare domain links
    # (e.g. "linkedin.com/in/name" without a scheme) are normalised; useless
    # root-domain links (e.g. just "https://www.linkedin.com/") are skipped
    # with a stated reason instead of an error.
    seen = set()
    for text in source_texts:
        urls = URL.findall(text) + [
            ("https://" + u.rstrip(".,;:!?)")) if not u.lower().startswith(("http://", "https://"))
            else u.rstrip(".,;:!?)")
            for u in re.findall(r"(?:https?://)?(?:www\.)?(?:github\.com|linkedin\.com)/[^\s\"'<>)\]]+", text, re.I)]
        for url in urls:
            url = url.rstrip(".,;:!?)")
            if not url.startswith("https://"):
                url = "https://" + url.split("://", 1)[-1]
            if url in seen or len(url) > 500:
                continue
            seen.add(url)
            path = url.split("/", 3)[3] if url.count("/") > 2 else ""
            if not path:
                # Root-only links (e.g. the demo CV's "https://www.linkedin.com/")
                # carry no profile page, but a recruiter benefits from seeing
                # them flagged on the Findings page instead of vanishing.
                message = ("The document contains only the site root, not a full profile or page URL; "
                    "no AI description is possible. Ask the candidate for the complete link or check manually.")
                svc.event(s, p, "link.observed", "Root-domain link needs the full web address; recorded as manual: " + url,
                    v.id, a.id, run.id,
                    details={"tool": "link_check", "result": "manual", "url": url})
                s.add(m.AnalysisInsight(org_id=p.org_id, application_id=a.id, run_id=run.id,
                    kind="link", text=url,
                    payload={"url": url, "state": "manual", "message": message}))
                s.flush()
                continue
            if sum(1 for u in seen if True) > 8:
                svc.event(s, p, "link.observed", "Additional links beyond the first 8 were not verified automatically; use the Findings tab.",
                    v.id, a.id, run.id, details={"tool": "link_check", "result": "skipped_limit"})
                return
            try:
                observation = linkcheck.observe(url, allow_generic=True)
                svc.event(s, p, "link.observed", "Public link observed from linked evidence; never an automated judgment: " + url,
                    v.id, a.id, run.id,
                    details={"tool": "link_check", "result": observation.get("state", "")[:80], "url": url})
                s.add(m.AnalysisInsight(org_id=p.org_id, application_id=a.id, run_id=run.id,
                    kind="link", text=url, payload=dict(observation)))
                s.flush()
            except ValueError:
                svc.event(s, p, "link.observed", "Public link skipped from source text; unsupported format: " + url,
                    v.id, a.id, run.id,
                    details={"tool": "link_check", "result": "unsupported", "url": url})
            except Exception as exc:
                svc.event(s, p, "link.observed", "Public link could not be verified from linked evidence: " + url,
                    v.id, a.id, run.id,
                    details={"tool": "link_check", "result": "error", "url": url, "error": str(exc)[:120]})


def provider_diagnosis(exc):
    """Provider failures, not the document, most often stall review."""
    from openai import APIStatusError, APIConnectionError, APITimeoutError
    if isinstance(exc, APIStatusError):
        status = getattr(exc, "status_code", 500)
        detail = (getattr(exc, "message", "") or "").strip()
        if status >= 500:
            return ("Model provider returned " + str(status) + "; the model server may lack memory to load the "
                "model, be overloaded, or restarting. Try a smaller local model in Settings." + (" Detail: " + detail[:120] if detail else ""))
        return "Model provider rejected the request (" + str(status) + ")." + (" Detail: " + detail[:160] if detail else "")
    if isinstance(exc, (APIConnectionError, APITimeoutError)):
        return "Model server unreachable or timed out; confirm the local model server/OLLAMA base URL is running."
    return type(exc).__name__ + ": review failed; check document/configuration"


STOPWORDS = set("the and with for of to using developed experience built "
    "dan yang dengan untuk di dari pada sebagai pengalaman menggunakan membuat tim".split())


def readable_language(texts):
    """True when the CV looks like Indonesian or English (the languages the agent reviews)."""
    text = " ".join(texts)
    letters = [ch for ch in text if ch.isalpha()]
    if len(letters) < 80:
        return True  # too little text to judge; OCR/extraction checks handle empty CVs
    if sum(ch.isascii() for ch in letters) / len(letters) < 0.6:
        return False  # mostly non-Latin script
    words = re.findall(r"[^\W\d_]+", text.lower())
    if len(words) < 60:
        return True  # skill lists are short and stopword-free; do not flag them
    # Latin script with almost no Indonesian/English function words: another language.
    return sum(w in STOPWORDS for w in words) / len(words) >= 0.005


def association_provenance(evidence, p, mode):
    """Provenance for a deterministic (model-free) criterion association."""
    from backend import ai_config
    cfg = ai_config.config() or {"provider": "none", "model": ""}
    return {"provider": cfg["provider"], "model": cfg["model"],
        "prompt_version": AI_PROMPT_VERSION, "profile_version": AI_PROFILE_VERSION,
        "usage": None,
        # evidence holds EvidenceItem rows here, not dicts (was an AttributeError).
        "extraction_version_ids": sorted({e.extraction_version_id for e in evidence if e.extraction_version_id}),
        "citations": [], "citations_mode": mode,
        "association_mode": mode,
        "citation_validation": "no eligible overlap; deterministic skip without a model call"}


def review(s, job, run, p, token):
    a = svc.own(s, m.Application, job.application_id, p)
    if a.withdrawn_at:
        raise ValueError("Application withdrawn")
    if job_cancelled(job.id, token):
        raise ReviewCancelled
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
    source_texts = []

    def progress(step, message, **details):
        # Operational metadata only (counts and steps, never passages): each
        # stage commits independently so progression is visible while the
        # remaining work runs, and retries reuse the persisted stages.
        details["step"] = step
        svc.event(s, p, "analysis.progress", message, v.id, a.id, run.id,
            details=details)
        s.commit()

    progress("ingest", "Review started: "
        + str(len(docs)) + " unexcluded source document(s) in scope.",
        documents=len(docs))
    extracted = 0
    for doc in docs:
        ex = s.scalar(
            select(m.ExtractionVersion)
            .where(m.ExtractionVersion.document_id == doc.id)
            .order_by(m.ExtractionVersion.version.desc())
        )
        previous = ex
        doc_seen: list[str] = []
        if not ex or job.kind == "reextract":
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
            extracted += 1
            svc.event(s, p, "extraction.completed", "Private original parsed into source-linked passages. OCR uncertainty is retained; no images were submitted to the model.", v.id, a.id, run.id,
                details={"tool": "pdf_docx_ocr", "result": "uncertain" if any(x.get("quality")=="uncertain" for x in pages) else "extracted", "duration_seconds": max(0, now()-extraction_started)})
            progress("extraction", "Extracted source "
                + str(extracted) + " of " + str(len(docs)) + ".",
                index=extracted, total=len(docs))
        for passage in ex.passages:
            source_texts.append(passage.get("text", ""))
            if passage.get("quality") == "uncertain":
                uncertain = True
                continue
            for line in professional_lines(passage["text"], identities):
                if line not in passage["text"]:
                    continue
                # Near-duplicate suppression within the same document: CV
                # extraction re-emits the same fact with small wording/topology
                # differences; near-identical lines add review noise without
                # new evidence. Exact extraction duplicates are already
                # de-duplicated by the existing lookup below.
                norm_line = " ".join(line.split()).casefold()
                if any(difflib.SequenceMatcher(None, norm_line, prior).ratio() >= 0.92
                    for prior in doc_seen[-80:]):
                    continue
                doc_seen.append(norm_line)
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
    progress("evidence", "Linked " + str(len(evidence))
        + " labelled professional lines to sources and criteria.",
        evidence=len(evidence), documents=len(docs))
    if not readable_language(source_texts):
        svc.event(s, p, "extraction.unsupported_language",
            "CV tidak berbahasa Indonesia atau Inggris, jadi agent tidak menilainya. HR perlu membaca CV ini secara manual.",
            v.id, a.id, run.id, details={"tool": "language_check", "result": "unsupported"})
        a.review_state = "ready_for_review"
        s.commit()
        return
    from backend import clarification as clarification_loop
    prior_loop = clarification_loop.workflow_for(s, a, False)
    prior_round = s.get(m.ClarificationRound, prior_loop.round_id) if prior_loop and prior_loop.round_id else None

    # Summary, strong points, job-relevant details and link verification for
    # the Findings page; each step fails closed without blocking the review.
    write_insights(s, p, v, a, run, evidence, source_texts, job_id=job.id, token=token)
    s.commit()

    if prior_loop and prior_loop.completed_at and prior_round and prior_round.state == "answered" and not new_extraction and job.kind != "reextract":
        # Retain existing findings, but backfill the Findings page when this
        # application has no persisted insights yet (runs before that table
        # existed). Insight generation already ran and committed above.
        svc.event(s, p, "review.retained", "Existing completed clarification and source-linked findings retained; no repeated questions or email.", v.id, a.id, run.id)
        return

    requirements = svc.requirements(s, run.requirement_version_id)
    progress("analysis", "AI analysis starting for " + str(len(requirements)) + " approved criteria; one bounded call each.", total=len(requirements))
    analyzed = []
    skipped_count = 0
    for requirement_number, r in enumerate(requirements, 1):
        if job_cancelled(job.id, token):
            raise ReviewCancelled
        eligible = [{"id": e.id, "passage": e.passage, "strength": e.strength,
                     "extraction_version_id": e.extraction_version_id}
                    for e in evidence if svc.admissible(r, e)]
        # Deterministic pre-scoring keeps the model leg cheap and honest:
        # only passages sharing criterion wording are offered, and when none
        # share wording the requirement is recorded as unknown with no model
        # call at all (no fabricable association exists to verify).
        ranked = relevance_rank({"description": r.description,
            "minimum_observable_expectation": r.minimum_observable_expectation},
            eligible)
        if not eligible:
            skipped_count += 1
            progress("analysis", "No admissible CV passage for criterion "
                + str(requirement_number) + " (" + (r.description or "") + "); recorded as unknown without a model call.",
                index=requirement_number, total=len(requirements), result="no-overlap")
            analyzed.append((Result(requirement_id=r.id, status="unknown", evidence_ids=[],
                citations=[],
                explanation="Tidak ada bagian CV yang bisa dinilai untuk kriteria ini. Belum ada bukti bukan berarti tidak mampu.",
                unresolved_question="Minta contoh pengalaman lain atau dokumen pendukung untuk kriteria ini."),
                association_provenance(evidence, p, "no-overlap-skip")))
            continue
        if ranked:
            shortlist = [src for src, _ in ranked[:12]]
        else:
            # No shared wording (e.g. criterion "empati", CV says "empathy"): let the
            # model judge meaning across languages over the most substantial lines.
            shortlist = sorted(eligible, key=lambda e: -len(e["passage"]))[:8]
            progress("analysis", "No shared wording with criterion " + str(requirement_number)
                + " (" + (r.description or "") + "); the model checks meaning across languages.",
                index=requirement_number, total=len(requirements), result="semantic-fallback")
        progress("analysis", "Analyzing requirement " + str(requirement_number) + " of "
            + str(len(requirements)) + " (" + (r.description or "") + ") with " + str(len(shortlist))
            + " shortlisted passage(s); one large model call, minutes on local models.",
            index=requirement_number, total=len(requirements))
        outcome = cancellable(lambda req=r, ev=shortlist: analyze(
            [{"id": req.id, "description": req.description,
              "importance": req.importance, "acceptable_evidence_types": req.acceptable_evidence_types,
              "minimum_observable_expectation": req.minimum_observable_expectation}], ev),
            job.id, token)
        analyzed.extend(outcome)
        progress("analysis", "Analyzed requirement " + str(requirement_number) + " of "
            + str(len(requirements)) + ": " + outcome[0][0].status + ".",
            index=requirement_number, total=len(requirements), result=outcome[0][0].status)
    cited = sum(1 for item, _ in analyzed if item.evidence_ids)
    for item, provenance in analyzed:
        svc.model_usage(s, p.org_id, a.id, provenance["model"], provenance.get("usage"), job_id=job.id)
        svc.revise_finding(s, p, a, d.FindingInput(requirement_id=item.requirement_id,
            state=item.status, evidence_ids=item.evidence_ids,
            explanation=item.explanation, unresolved_question=item.unresolved_question),
            author=False, provenance=provenance)
    progress("review", "AI analysis committed " + str(len(analyzed)) + " finding revision(s); awaiting human decisions.",
        index=len(analyzed), total=len(requirements), evidence=len(evidence),
        cited=cited, without_citations=len(analyzed) - cited, skipped=skipped_count)
    if uncertain:
        svc.event(s, p, "extraction.uncertain",
            "Low-quality or unavailable OCR: uncertain passages excluded. Review original, request factual correction, or upload an accessible replacement and re-extract.",
            v.id, a.id, run.id)
    a.review_state = "ready_for_review"
    from backend.clarification import plan
    if not a.reassessment_required:
        try:
            if prior_loop and prior_loop.completed_at and prior_round and prior_round.state == "answered":
                prior_loop.resume_seq += 1
                clarification_loop.resume(s, p, a, prior_loop)
            else:
                plan(s, p, a)
        except AnalysisError as exc:
            # Analysis outcomes are already committed above; bounded modeling
            # of an optional clarification question must never invalidate them.
            drafting = clarification_loop.workflow_for(s, a, False)
            if drafting:
                drafting.state = "needs_attention"
                drafting.error = "Question drafting unavailable: " + str(exc)[:200]
            svc.event(
                s, p, "clarification.needs_attention",
                "Automated question drafting failed; findings remain and a human recruiter decides next.",
                v.id, a.id, run.id)
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
                    review(s, job, run, p, token)
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
        except ReviewCancelled:
            # Recruiter cancellation/pause: no retry, no findings commit; the
            # row is already cancelled via the API-side lease clearing, and
            # only the informational event is recorded here.
            s.rollback()
            s.expire_all()
            job = s.get(m.WorkflowJob, id)
            if job and job.lease_token == token and job.state == "running":
                job.state = "cancelled"
                job.lease_token = None
                job.lease_until = 0
                s.commit()
            run = s.get(m.WorkflowRun, run_id)
            job = s.get(m.WorkflowJob, id)
            if run and job:
                svc.event(s, p, "review.cancelled",
                    "Review stopped by cancellation; no further model calls for this run.",
                    run.vacancy_id, job.application_id, run_id)
            s.commit()
            return True
        except Exception as exc:
            s.rollback()
            s.expire_all()
            job = s.get(m.WorkflowJob, id)
            if job.lease_token != token or job.state != "running":
                return True
            job.state = "failed" if attempt >= 3 else "queued"
            job.error = str(exc)[:240] if isinstance(exc, (AnalysisError, IngestionError)) else provider_diagnosis(exc)
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
    try:
        while True:
            if not tick():
                time.sleep(1)
    except KeyboardInterrupt:
        # Ctrl+C (possibly mid provider call): sessions release via their context
        # managers, and leased jobs recover automatically once their lease expires.
        print("Saring worker stopped cleanly; leased work requeues after lease expiry.", flush=True)
        raise SystemExit(0)
