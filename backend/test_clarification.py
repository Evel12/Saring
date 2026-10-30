"""Executable clarification workflow using isolated synthetic records and real HTTP contracts."""
import json
import os
import subprocess
import sys
from urllib.parse import urlsplit
import httpx
import pytest
from sqlalchemy import select, update, func
from fastapi.testclient import TestClient
from backend.test_workflow import limits, account, csrf, vacancy, application, upload, run, clarification, invitation, candidate_session
from backend import models as m, clarification as loop
from backend.db import Session, now
from backend.main import app
from backend.worker import tick, outbox_tick

EXAMPLE = "I handled a complaint from an online shop customer whose parcel arrived damaged. I checked the order and photos, contacted the courier, offered a replacement or refund, and confirmed that the customer received the replacement two days later."


def example():
    c = TestClient(app)
    csrf(c)
    assert c.post("/api/demo-session").status_code == 200
    csrf(c)
    response = c.post("/api/v1/demo/clarification-example")
    assert response.status_code == 201, response.text
    data = response.json()
    run(c, data["vacancy_id"])
    a = data["application_id"]
    workflow = state(c, a)["workflow"]
    rid = workflow["round_id"]
    questions = c.get(f"/api/v1/clarification-rounds/{rid}").json()["questions"]
    return c, a, rid, questions


def state(c, a):
    result = c.get(f"/api/v1/applications/{a}/clarification-workflow")
    assert result.status_code == 200, result.text
    return result.json()


def approve(c, rid, **policy):
    result = c.post(f"/api/v1/clarification-rounds/{rid}/approve", json=policy)
    assert result.status_code == 200, result.text


def portal(c, a):
    inbox = c.get(f"/api/v1/demo/clarification-mailbox?application_id={a}").json()["items"]
    assert inbox
    token = urlsplit(inbox[-1]["portal_url"]).fragment.split("=", 1)[1]
    return candidate_session({"token": token})


def answer(candidate, a, questions, text=EXAMPLE, **extra):
    body = {"responses": [{"question_id": q["id"], "text": text, **extra} for q in questions]}
    return candidate.post(f"/api/v1/candidate/applications/{a}/responses", json=body), body


def test_support_loop_idempotent_approval_mail_restart_submission_and_provenance():
    c, a, rid, questions = example()
    assert len(questions) == 1 and "complaint" in questions[0]["text"]
    assert state(c, a)["workflow"]["state"] == "draft"
    assert not c.get("/api/v1/outbox").json()["items"]
    approve(c, rid)
    approve(c, rid)
    assert len(c.get("/api/v1/outbox").json()["items"]) == 1
    assert outbox_tick() and not outbox_tick()
    assert state(c, a)["workflow"]["state"] == "waiting"
    code = "from backend.worker import tick; from backend.db import Session; from backend import models as m; s=Session(); w=s.get(m.ClarificationWorkflow,'"+state(c,a)["workflow"]["id"]+"'); assert w.state=='waiting'; assert not tick()"
    restart = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True)
    assert restart.returncode == 0, restart.stderr
    candidate = portal(c, a)
    public = candidate.get(f"/api/v1/candidate/applications/{a}").json()
    assert "findings" not in public and "brief" not in public
    result, body = answer(candidate, a, questions)
    assert result.status_code == 200, result.text
    repeated = candidate.post(f"/api/v1/candidate/applications/{a}/responses", json=body)
    assert repeated.status_code == 200 and repeated.json() == result.json()
    changed = {"responses": [{"question_id": questions[0]["id"], "text": "changed"}]}
    assert candidate.post(f"/api/v1/candidate/applications/{a}/responses", json=changed).status_code == 409
    assert state(c, a)["workflow"]["state"] == "resume_queued"
    assert tick()
    done = state(c, a)
    assert done["workflow"]["state"] == "review_ready"
    finding = c.get(f"/api/v1/applications/{a}/findings").json()["items"][0]["latest_revision"]
    assert finding["state"] == "partial"
    assert finding["provenance"]["before_status"] == "unknown" and finding["provenance"]["after_status"] == "partial"
    evidence = c.get(f"/api/v1/applications/{a}/evidence").json()["items"]
    response = next(e for e in evidence if e["response_id"])
    assert response["passage"] == EXAMPLE and response["strength"] == "candidate_reported"
    assert response["id"] in finding["provenance"]["new_evidence_ids"]
    assert len(done["responses"]) == 1 and done["workflow"]["brief"]["requirements"][0]["interview_followup"]
    assert c.get(f"/api/v1/applications/{a}").json()["decision"] == "undecided"
    # Re-running analysis must neither ask the same question nor send another invite.
    v = c.get(f"/api/v1/applications/{a}").json()["vacancy_id"]
    run(c, v)
    assert c.get(f"/api/v1/applications/{a}/findings").json()["items"][0]["latest_revision"]["state"] == "partial"
    assert c.get(f"/api/v1/applications/{a}/clarification-rounds").json()["total"] == 1
    assert len(c.get("/api/v1/outbox").json()["items"]) == 1


@pytest.mark.parametrize("text,disposition", [("Yes, I can", "answer"), ("", "decline"), (EXAMPLE, "decline")])
def test_weak_or_declined_answers_do_not_resolve_gap(text, disposition):
    c, a, rid, questions = example()
    approve(c, rid, max_reminders=0)
    assert outbox_tick()
    result, _ = answer(portal(c, a), a, questions, text, disposition=disposition)
    assert result.status_code == 200
    assert tick()
    revision = c.get(f"/api/v1/applications/{a}/findings").json()["items"][0]["latest_revision"]
    assert revision["state"] == "unknown" and revision["unresolved_question"]
    assert revision["provenance"]["before_status"] == revision["provenance"]["after_status"]


def test_factual_correction_retains_original_and_resumes_once():
    c, a, rid, questions = example()
    approve(c, rid, max_reminders=0)
    outbox_tick()
    candidate = portal(c, a)
    result, _ = answer(candidate, a, questions, "Yes, I can")
    assert result.status_code == 200
    tick()
    own = candidate.get(f"/api/v1/candidate/applications/{a}/submission")
    assert own.status_code == 200
    original = own.json()["responses"][0]
    correction = {"response_id": original["id"], "text": EXAMPLE, "reason": "I replaced a generic assertion with my actual example."}
    path = f"/api/v1/candidate/applications/{a}/answer-corrections"
    saved = candidate.post(path, json=correction)
    assert saved.status_code == 201, saved.text
    assert candidate.post(path, json=correction).json()["id"] == saved.json()["id"]
    # Simulate a worker dying with a leased continuation before committing its result.
    with Session() as s:
        row = s.get(m.ClarificationWorkflow, state(c, a)["workflow"]["id"])
        row.state = "processing"; row.lease_token = "dead-worker"; row.lease_until = now()-1
        s.commit()
    assert tick()
    revision = c.get(f"/api/v1/applications/{a}/findings").json()["items"][0]["latest_revision"]
    assert revision["state"] == "partial" and revision["provenance"]["correction_id"] == saved.json()["id"]
    evidence = c.get(f"/api/v1/applications/{a}/evidence").json()["items"]
    new = next(e for e in evidence if e["artifact_location"].startswith("correction:"))
    old = next(e for e in evidence if e["id"] == new["supersedes_id"])
    assert old["passage"] == "Yes, I can" and new["passage"] == EXAMPLE
    assert new["strength"] == old["strength"] == "candidate_reported"
    assert candidate.get(f"/api/v1/candidate/applications/{a}").status_code == 401


def test_timeout_expiry_and_bounded_reminders_are_not_negative_evidence():
    c, a, rid, questions = example()
    approve(c, rid)
    outbox_tick()
    workflow = state(c, a)["workflow"]
    with Session() as s:
        row = s.get(m.ClarificationWorkflow, workflow["id"])
        row.reminder_at = now()-1
        s.commit()
    assert tick()  # reserves exactly one reminder with a fresh short-lived invitation
    assert tick()  # simulated delivery
    assert not tick()
    assert len(c.get("/api/v1/outbox").json()["items"]) == 2
    assert state(c, a)["workflow"]["reminders_sent"] == 1
    inbox = c.get(f"/api/v1/demo/clarification-mailbox?application_id={a}").json()["items"]
    token = urlsplit(inbox[-1]["portal_url"]).fragment.split("=", 1)[1]
    with Session() as s:
        row = s.get(m.ClarificationWorkflow, workflow["id"])
        row.deadline = now()-1
        s.get(m.CandidateInvitation, row.invitation_id).expires_at = now()-1
        s.commit()
    other = TestClient(app); csrf(other)
    assert other.post("/api/v1/auth/invitations/exchange", json={"token": token}).status_code == 404
    assert tick()
    assert state(c, a)["workflow"]["state"] == "review_ready"
    assert "without a response" in state(c, a)["workflow"]["brief"]["reason"]
    assert c.get(f"/api/v1/applications/{a}/findings").json()["items"][0]["latest_revision"]["state"] == "unknown"
    assert not tick()


def test_artifact_presence_is_artifact_backed_not_authorship_and_cross_candidate_denied():
    c, _, _ = account()
    v, version = vacancy(c)
    a, other = application(c, v), application(c, v)
    doc, foreign = upload(c, a), upload(c, other)
    rid = clarification(c, a, version)
    inv = invitation(c, a, rid, ["application:read", "clarification:respond", "document:upload"])
    candidate = candidate_session(inv)
    questions = candidate.get(f"/api/v1/candidate/applications/{a}").json()["clarification"]["questions"]
    denied, _ = answer(candidate, a, questions, artifact_document_id=foreign["id"])
    assert denied.status_code == 422
    result, _ = answer(candidate, a, questions, artifact_document_id=doc["id"])
    assert result.status_code == 200, result.text
    assert tick()
    artifact = next(e for e in c.get(f"/api/v1/applications/{a}/evidence").json()["items"] if e["source_kind"] == "work_sample")
    assert artifact["strength"] == "artifact_backed" and "authorship" in artifact["passage"]


def test_unpermitted_or_protected_questions_and_unauthorized_model_actions(monkeypatch):
    c, a, rid, questions = example()
    req = questions[0]["requirement_id"]
    assert c.patch(f"/api/v1/clarification-rounds/{rid}", json={"questions": [{"requirement_id": req, "text": "What is your religion and age?"}]}).status_code == 422
    assert c.post(f"/api/v1/applications/{a}/clarification-rounds", json={"questions": [{"requirement_id": req, "text": "Describe another complaint."}]}).status_code == 409
    from backend.clarification import NextAction, checked_action
    with Session() as s:
        workflow = s.get(m.ClarificationWorkflow, state(c, a)["workflow"]["id"])
        monkeypatch.setattr(loop, "proposal", lambda *_: NextAction(action="retrieve_evidence", requirement_id=None, evidence_ids=["foreign-candidate-source"], question="", rationale="Get source"))
        with pytest.raises(ValueError, match="unauthorized"):
            checked_action(s, workflow, "bad", {"allowed_action": "retrieve_evidence", "evidence": []}, "demo")


def test_live_email_adapter_retries_same_payload_and_key_without_duplicate(monkeypatch):
    c, org, _ = account()
    v, version = vacancy(c); a = application(c, v)
    with Session() as s:
        candidate = s.get(m.Candidate, s.get(m.Application, a).candidate_id)
        candidate.email = "synthetic@example.test"
        s.add(m.ProviderConnection(org_id=org, provider="email", state="configured", credential_ref="SARING_SYNTHETIC_EMAIL", config={"from_email": "hr@example.test"}))
        s.commit()
    monkeypatch.setenv("SARING_SYNTHETIC_EMAIL", "synthetic-not-real-key")
    monkeypatch.setenv("PUBLIC_APP_URL", "https://saring.example.test")
    rid = clarification(c, a, version)
    requests = []
    original = httpx.Client
    def transport(request):
        assert str(request.url) == "https://api.resend.com/emails"
        requests.append((request.headers["Idempotency-Key"], request.content))
        if len(requests) == 1:
            raise httpx.ReadTimeout("Synthetic ambiguous acceptance", request=request)
        return httpx.Response(200, json={"id": "provider-idempotent-id"})
    monkeypatch.setattr("backend.email_adapter.httpx.Client", lambda **kwargs: original(**kwargs, transport=httpx.MockTransport(transport)))
    assert outbox_tick()
    with Session() as s:
        row = s.scalar(select(m.OutboxAction).where(m.OutboxAction.round_id == rid, m.OutboxAction.kind == "clarification"))
        row.available_at = now()-1
        s.commit()
    assert outbox_tick() and not outbox_tick()
    assert len(requests) == 2 and requests[0] == requests[1]
    assert state(c, a)["workflow"]["state"] == "waiting"
    row = c.get("/api/v1/outbox").json()["items"][0]
    assert row["state"] == "completed" and "invite=" not in json.dumps(row)
    with Session() as s:
        old = s.get(m.OutboxAction, row["id"])
        old.state = "running"; old.lease_until = now()-1; old.created_at = now()-24*3600
        s.commit()
    assert outbox_tick()
    assert len(requests) == 2  # no replay beyond the provider's idempotency retention
    assert c.get("/api/v1/outbox").json()["items"][0]["state"] == "needs_attention"


def test_prioritizes_essential_gaps_and_goes_direct_to_review_if_no_useful_question():
    c, _, _ = account()
    criteria = [{"description": name, "importance": "essential" if i < 3 else "preferred", "acceptable_evidence_types": ["candidate_report"], "minimum_observable_expectation": "Describe a personally handled example and outcome.", "clarification_permitted": True} for i, name in enumerate(["handle complaints", "document resolutions", "triage incidents", "use spreadsheets"])]
    v = c.post("/api/v1/vacancies", json={"title": "Custom Support", "requirements": criteria}).json()["id"]
    version = c.get(f"/api/v1/vacancies/{v}/requirement-versions").json()["items"][0]["id"]
    c.post(f"/api/v1/requirement-versions/{version}/approve", json={})
    c.patch(f"/api/v1/vacancies/{v}", json={"state": "published"})
    a = application(c, v)
    run(c, v)
    rid = state(c, a)["workflow"]["round_id"]
    questions = c.get(f"/api/v1/clarification-rounds/{rid}").json()["questions"]
    reqs = c.get(f"/api/v1/requirement-versions/{version}").json()["requirements"]
    essential = {r["id"] for r in reqs if r["importance"] == "essential"}
    assert len(questions) == 3 and {q["requirement_id"] for q in questions} == essential
    # A structured assessment-only requirement cannot be usefully resolved by a portal answer.
    v2 = c.post("/api/v1/vacancies", json={"title": "Observed assessment", "requirements": [{**criteria[0], "acceptable_evidence_types": ["structured_assessment"]}]}).json()["id"]
    version2 = c.get(f"/api/v1/vacancies/{v2}/requirement-versions").json()["items"][0]["id"]
    c.post(f"/api/v1/requirement-versions/{version2}/approve", json={})
    c.patch(f"/api/v1/vacancies/{v2}", json={"state": "published"})
    a2 = application(c, v2)
    run(c, v2)
    assert state(c, a2)["workflow"]["state"] == "review_ready"
    assert state(c, a2)["workflow"]["round_id"] is None


def test_explicit_revocation_closes_submission_receipts_and_corrections():
    c, a, rid, questions = example()
    approve(c, rid, max_reminders=0)
    outbox_tick()
    candidate = portal(c, a)
    result, _ = answer(candidate, a, questions)
    assert result.status_code == 200
    inv = state(c, a)["workflow"]["invitation_id"]
    assert c.post(f"/api/v1/invitations/{inv}/revoke").status_code == 200
    assert candidate.get(f"/api/v1/candidate/applications/{a}/submission").status_code == 401


def test_existing_detailed_source_avoids_redundant_question():
    c = TestClient(app); csrf(c); c.post("/api/demo-session"); csrf(c)
    data = c.post("/api/v1/demo/clarification-example").json()
    a = data["application_id"]
    with Session() as s:
        doc = s.scalar(select(m.Document).where(m.Document.application_id == a))
        old = s.scalar(select(m.ExtractionVersion).where(m.ExtractionVersion.document_id == doc.id))
        s.add(m.ExtractionVersion(org_id=doc.org_id, document_id=doc.id, version=2, engine="synthetic-v1", passages=[{"page": 1,"paragraph": None,"text": "Experience: "+EXAMPLE}], limitations="Explicit synthetic detailed source.", supersedes_id=old.id))
        s.commit()
    run(c, data["vacancy_id"])
    result = state(c, a)
    assert result["workflow"]["state"] == "review_ready" and result["workflow"]["round_id"] is None
    assert any("already provides" in action["rationale"] for action in result["actions"])


def test_received_answers_are_not_mislabeled_timeout_when_update_fails(monkeypatch):
    c, a, rid, questions = example(); approve(c, rid, max_reminders=0); outbox_tick()
    candidate = portal(c, a)
    result, _ = answer(candidate, a, questions)
    assert result.status_code == 200
    actual_resume = loop.resume
    def fail(*args):
        raise loop.AnalysisError("Synthetic provider unavailable")
    monkeypatch.setattr(loop, "resume", fail)
    for _ in range(3):
        assert loop.tick()
        with Session() as s:
            workflow = s.get(m.ClarificationWorkflow, state(c,a)["workflow"]["id"])
            workflow.available_at = now()-1
            s.commit()
    assert state(c,a)["workflow"]["state"] == "needs_attention"
    with Session() as s:
        s.get(m.ClarificationWorkflow, state(c,a)["workflow"]["id"]).deadline = now()-1
        s.commit()
    assert not loop.tick()  # answered round is not a no-response timeout
    assert state(c,a)["workflow"]["state"] == "needs_attention"
    monkeypatch.setattr(loop, "resume", actual_resume)
    assert c.post(f"/api/v1/applications/{a}/clarification-workflow/retry").status_code == 200
    assert loop.tick()
    assert state(c,a)["workflow"]["state"] == "review_ready"
    assert len(state(c,a)["responses"]) == 1


def test_changed_criteria_close_old_authorization_before_reminders():
    c, a, rid, questions = example(); approve(c, rid); outbox_tick()
    application_data = c.get(f"/api/v1/applications/{a}").json()
    v, version = application_data["vacancy_id"], application_data["requirement_version_id"]
    old = c.get(f"/api/v1/requirement-versions/{version}").json()["requirements"][0]
    values = {key: old[key] for key in ["stable_id", "description", "importance", "acceptable_evidence_types", "minimum_observable_expectation", "clarification_permitted"]}
    values["minimum_observable_expectation"] = "Describe two complaint examples and their outcomes."
    new = c.post(f"/api/v1/vacancies/{v}/requirement-versions", json={"requirements": [values]}).json()["id"]
    assert c.post(f"/api/v1/requirement-versions/{new}/approve", json={}).status_code == 200
    assert loop.tick()
    assert state(c,a)["workflow"]["state"] == "superseded"
    assert len(c.get("/api/v1/outbox").json()["items"]) == 1
    assert c.post(f"/api/v1/applications/{a}/invitations", json={"round_id":rid}).status_code == 409
