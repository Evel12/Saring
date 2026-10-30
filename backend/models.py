"""Tenant keys and composite foreign keys prevent cross-organization references."""

from sqlalchemy import (
    String,
    Text,
    JSON,
    Integer,
    Float,
    Boolean,
    ForeignKey,
    ForeignKeyConstraint,
    UniqueConstraint,
    CheckConstraint,
    event,
    inspect,
)
from sqlalchemy.orm import Mapped, mapped_column, Session as ORMSession
from backend.db import Base, uid, now


def scoped(*constraints):
    return (UniqueConstraint("org_id", "id"), *constraints)


def ref(field, table):
    return ForeignKeyConstraint(["org_id", field], [table + ".org_id", table + ".id"])


class Row:
    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uid)
    created_at: Mapped[float] = mapped_column(Float, default=now, index=True)


class Tenant(Row):
    org_id: Mapped[str] = mapped_column(ForeignKey("organizations.id"), index=True)


class Organization(Row, Base):
    __tablename__ = "organizations"
    name: Mapped[str] = mapped_column(String(160))
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)


class User(Row, Base):
    __tablename__ = "users"
    email: Mapped[str] = mapped_column(String(254), unique=True)
    display_name: Mapped[str] = mapped_column(String(160))
    password_hash: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Membership(Tenant, Base):
    __tablename__ = "memberships"
    __table_args__ = scoped(
        UniqueConstraint("org_id", "user_id"),
        CheckConstraint("role IN ('admin','recruiter')"),
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String(20), default="recruiter")
    active: Mapped[bool] = mapped_column(Boolean, default=True)


class Vacancy(Tenant, Base):
    __tablename__ = "vacancies"
    __table_args__ = scoped(CheckConstraint("state IN ('draft','published','closed')"))
    title: Mapped[str] = mapped_column(String(160))
    is_sample: Mapped[bool] = mapped_column(Boolean, default=False, server_default="0")
    description: Mapped[str] = mapped_column(Text, default="")
    state: Mapped[str] = mapped_column(String(20), default="draft")
    active_requirement_version_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True
    )
    deleted_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class RequirementVersion(Tenant, Base):
    __tablename__ = "requirement_versions"
    __table_args__ = scoped(
        ref("vacancy_id", "vacancies"),
        UniqueConstraint("vacancy_id", "version"),
        CheckConstraint("state IN ('proposed','approved')"),
    )
    vacancy_id: Mapped[str] = mapped_column(String(36))
    version: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(20), default="proposed")
    proposed_by: Mapped[str] = mapped_column(ForeignKey("users.id"))
    approved_by: Mapped[str | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    approved_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    supersedes_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class Requirement(Tenant, Base):
    __tablename__ = "requirements"
    __table_args__ = scoped(
        ref("version_id", "requirement_versions"),
        UniqueConstraint("version_id", "stable_id"),
        CheckConstraint("importance IN ('essential','preferred')"),
    )
    version_id: Mapped[str] = mapped_column(String(36))
    stable_id: Mapped[str] = mapped_column(String(36), default=uid)
    description: Mapped[str] = mapped_column(Text)
    importance: Mapped[str] = mapped_column(String(20))
    acceptable_evidence_types: Mapped[list] = mapped_column(JSON)
    minimum_observable_expectation: Mapped[str] = mapped_column(Text)
    clarification_permitted: Mapped[bool] = mapped_column(Boolean, default=True)
    version: Mapped[int] = mapped_column(Integer)


class Candidate(Tenant, Base):
    __tablename__ = "candidates"
    __table_args__ = scoped()
    display_name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)


class Application(Tenant, Base):
    __tablename__ = "applications"
    __table_args__ = scoped(
        ref("candidate_id", "candidates"),
        ref("vacancy_id", "vacancies"),
        ref("requirement_version_id", "requirement_versions"),
        UniqueConstraint("candidate_id", "vacancy_id"),
    )
    candidate_id: Mapped[str] = mapped_column(String(36))
    vacancy_id: Mapped[str] = mapped_column(String(36))
    requirement_version_id: Mapped[str] = mapped_column(String(36))
    review_state: Mapped[str] = mapped_column(String(30), default="pending")
    reassessment_required: Mapped[bool] = mapped_column(Boolean, default=False)
    decision: Mapped[str] = mapped_column(String(20), default="undecided")
    withdrawn_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class Document(Tenant, Base):
    __tablename__ = "documents"
    __table_args__ = scoped(ref("application_id", "applications"))
    application_id: Mapped[str] = mapped_column(String(36))
    original_name: Mapped[str] = mapped_column(String(180))
    storage_key: Mapped[str] = mapped_column(String(100), unique=True)
    media_type: Mapped[str] = mapped_column(String(100))
    size_bytes: Mapped[int] = mapped_column(Integer)
    sha256: Mapped[str] = mapped_column(String(64))
    synthetic: Mapped[bool] = mapped_column(Boolean, default=False)
    excluded_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    exclusion_reason: Mapped[str] = mapped_column(Text, default="")


class ExtractionVersion(Tenant, Base):
    __tablename__ = "extraction_versions"
    __table_args__ = scoped(
        ref("document_id", "documents"),
        ref("supersedes_id", "extraction_versions"),
        UniqueConstraint("document_id", "version"),
    )
    document_id: Mapped[str] = mapped_column(String(36))
    version: Mapped[int] = mapped_column(Integer)
    engine: Mapped[str] = mapped_column(String(100))
    passages: Mapped[list] = mapped_column(JSON)
    limitations: Mapped[str] = mapped_column(Text)
    supersedes_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class ClarificationRound(Tenant, Base):
    __tablename__ = "clarification_rounds"
    __table_args__ = scoped(
        ref("application_id", "applications"),
        ref("requirement_version_id", "requirement_versions"),
        UniqueConstraint("application_id", "number"),
        CheckConstraint("number BETWEEN 1 AND 2"),
        CheckConstraint("state IN ('draft','approved','answered','closed')"),
    )
    application_id: Mapped[str] = mapped_column(String(36))
    requirement_version_id: Mapped[str] = mapped_column(String(36))
    number: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(20), default="draft")


class ClarificationQuestion(Tenant, Base):
    __tablename__ = "clarification_questions"
    __table_args__ = scoped(
        ref("round_id", "clarification_rounds"), ref("requirement_id", "requirements")
    )
    round_id: Mapped[str] = mapped_column(String(36))
    requirement_id: Mapped[str] = mapped_column(String(36))
    text: Mapped[str] = mapped_column(Text)


class ClarificationResponse(Tenant, Base):
    __tablename__ = "clarification_responses"
    __table_args__ = scoped(
        ref("application_id", "applications"),
        ref("question_id", "clarification_questions"),
        UniqueConstraint("question_id"),
    )
    application_id: Mapped[str] = mapped_column(String(36))
    question_id: Mapped[str] = mapped_column(String(36))
    text: Mapped[str] = mapped_column(Text)


class EvidenceItem(Tenant, Base):
    __tablename__ = "evidence_items"
    __table_args__ = scoped(
        ref("application_id", "applications"),
        ref("document_id", "documents"),
        ref("response_id", "clarification_responses"),
        ref("extraction_version_id", "extraction_versions"),
        ref("supersedes_id", "evidence_items"),
        CheckConstraint(
            "strength IN ('candidate_reported','artifact_backed','assessment_observed')"
        ),
    )
    application_id: Mapped[str] = mapped_column(String(36))
    document_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    response_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    source_kind: Mapped[str] = mapped_column(String(30))
    passage: Mapped[str] = mapped_column(Text)
    page: Mapped[int | None] = mapped_column(Integer, nullable=True)
    paragraph: Mapped[int | None] = mapped_column(Integer, nullable=True)
    artifact_location: Mapped[str] = mapped_column(Text, default="")
    strength: Mapped[str] = mapped_column(String(30))
    observed_at: Mapped[float] = mapped_column(Float, default=now)
    extraction_version_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    supersedes_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class Finding(Tenant, Base):
    __tablename__ = "findings"
    __table_args__ = scoped(
        ref("application_id", "applications"),
        ref("requirement_id", "requirements"),
        UniqueConstraint("application_id", "requirement_id"),
    )
    application_id: Mapped[str] = mapped_column(String(36))
    requirement_id: Mapped[str] = mapped_column(String(36))


class FindingRevision(Tenant, Base):
    __tablename__ = "finding_revisions"
    __table_args__ = scoped(
        ref("finding_id", "findings"),
        ref("supersedes_id", "finding_revisions"),
        UniqueConstraint("finding_id", "revision"),
        CheckConstraint("state IN ('supported','partial','unknown','conflicting')"),
    )
    finding_id: Mapped[str] = mapped_column(String(36))
    revision: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(20))
    explanation: Mapped[str] = mapped_column(Text)
    unresolved_question: Mapped[str] = mapped_column(Text, default="")
    author_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    provenance: Mapped[dict] = mapped_column(JSON, default=dict)
    supersedes_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class FindingEvidence(Tenant, Base):
    __tablename__ = "finding_evidence"
    __table_args__ = scoped(
        ref("revision_id", "finding_revisions"),
        ref("evidence_id", "evidence_items"),
        UniqueConstraint("revision_id", "evidence_id"),
    )
    revision_id: Mapped[str] = mapped_column(String(36))
    evidence_id: Mapped[str] = mapped_column(String(36))


class Approval(Tenant, Base):
    __tablename__ = "approvals"
    __table_args__ = scoped()
    target_type: Mapped[str] = mapped_column(String(30))
    target_id: Mapped[str] = mapped_column(String(36))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    rationale: Mapped[str] = mapped_column(Text, default="")


class RecruiterDecision(Tenant, Base):
    __tablename__ = "recruiter_decisions"
    __table_args__ = scoped(
        ref("application_id", "applications"),
        ref("requirement_version_id", "requirement_versions"),
        CheckConstraint("decision IN ('undecided','shortlist','reject','hire','request_more_information')"),
    )
    application_id: Mapped[str] = mapped_column(String(36))
    requirement_version_id: Mapped[str] = mapped_column(String(36))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    decision: Mapped[str] = mapped_column(String(20))
    rationale: Mapped[str] = mapped_column(Text)


class ProviderConnection(Tenant, Base):
    __tablename__ = "provider_connections"
    __table_args__ = scoped(UniqueConstraint("org_id", "provider"))
    provider: Mapped[str] = mapped_column(String(30))
    state: Mapped[str] = mapped_column(String(30), default="not_configured")
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    credential_ref: Mapped[str] = mapped_column(String(160), default="")


class Interview(Tenant, Base):
    __tablename__ = "interviews"
    __table_args__ = scoped(
        ref("application_id", "applications"),
        ref("provider_connection_id", "provider_connections"),
    )
    application_id: Mapped[str] = mapped_column(String(36))
    starts_at: Mapped[float] = mapped_column(Float)
    ends_at: Mapped[float] = mapped_column(Float)
    timezone: Mapped[str] = mapped_column(String(80))
    state: Mapped[str] = mapped_column(String(30), default="proposed")
    provider_connection_id: Mapped[str | None] = mapped_column(
        String(36), nullable=True
    )
    external_id: Mapped[str | None] = mapped_column(String(200), nullable=True)


class WorkflowRun(Tenant, Base):
    __tablename__ = "workflow_runs"
    __table_args__ = scoped(
        ref("vacancy_id", "vacancies"),
        ref("requirement_version_id", "requirement_versions"),
    )
    vacancy_id: Mapped[str] = mapped_column(String(36))
    requirement_version_id: Mapped[str] = mapped_column(String(36))
    state: Mapped[str] = mapped_column(String(30), default="queued")
    requested_by: Mapped[str] = mapped_column(ForeignKey("users.id"))


class WorkflowJob(Tenant, Base):
    __tablename__ = "workflow_jobs"
    __table_args__ = scoped(
        ref("run_id", "workflow_runs"), ref("application_id", "applications"),
        UniqueConstraint("org_id", "run_id", "application_id", "kind", name="uq_workflow_job_operation")
    )
    run_id: Mapped[str] = mapped_column(String(36))
    application_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    kind: Mapped[str] = mapped_column(String(30), default="review")
    state: Mapped[str] = mapped_column(String(30), default="queued")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    available_at: Mapped[float] = mapped_column(Float, default=now)
    lease_until: Mapped[float] = mapped_column(Float, default=0)
    lease_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")


class WorkflowEvent(Tenant, Base):
    __tablename__ = "workflow_events"
    __table_args__ = scoped(
        ref("run_id", "workflow_runs"),
        ref("vacancy_id", "vacancies"),
        ref("application_id", "applications"),
    )
    run_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    vacancy_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    application_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    actor_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(40))
    message: Mapped[str] = mapped_column(Text)
    details: Mapped[dict] = mapped_column(JSON, default=dict)


class ExecutionAttempt(Tenant, Base):
    __tablename__ = "execution_attempts"
    __table_args__ = scoped(UniqueConstraint("org_id", "target_kind", "target_id", "number"))
    target_kind: Mapped[str] = mapped_column(String(30))
    target_id: Mapped[str] = mapped_column(String(36))
    application_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    number: Mapped[int] = mapped_column(Integer)
    lease_token: Mapped[str] = mapped_column(String(64))
    started_at: Mapped[float] = mapped_column(Float, default=now)
    heartbeat_at: Mapped[float] = mapped_column(Float, default=now)
    finished_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    state: Mapped[str] = mapped_column(String(30), default="running")
    error_code: Mapped[str] = mapped_column(String(80), default="")


class ErasureGrant(Tenant, Base):
    __tablename__ = "erasure_grants"
    __table_args__ = scoped()
    expires_at: Mapped[float] = mapped_column(Float)


class FileErasure(Tenant, Base):
    __tablename__ = "file_erasures"
    __table_args__ = scoped()
    storage_key: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(30), default="queued")
    error_code: Mapped[str] = mapped_column(String(80), default="")
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    available_at: Mapped[float] = mapped_column(Float, default=now)


class OutboxAction(Tenant, Base):
    __tablename__ = "outbox_actions"
    __table_args__ = scoped(
        ref("application_id", "applications"),
        ref("interview_id", "interviews"),
        ref("round_id", "clarification_rounds"),
        UniqueConstraint("org_id", "idempotency_key"),
    )
    application_id: Mapped[str] = mapped_column(String(36))
    interview_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    round_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    kind: Mapped[str] = mapped_column(String(30))
    state: Mapped[str] = mapped_column(String(30), default="awaiting_approval")
    idempotency_key: Mapped[str] = mapped_column(String(160))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str] = mapped_column(Text, default="")
    available_at: Mapped[float] = mapped_column(Float, default=now)
    lease_until: Mapped[float] = mapped_column(Float, default=0)
    lease_token: Mapped[str | None] = mapped_column(String(64), nullable=True)


class Metric(Tenant, Base):
    __tablename__ = "metrics"
    __table_args__ = scoped()
    name: Mapped[str] = mapped_column(String(60))
    value: Mapped[float] = mapped_column(Float)
    labels: Mapped[dict] = mapped_column(JSON, default=dict)


class CandidateInvitation(Tenant, Base):
    __tablename__ = "candidate_invitations"
    __table_args__ = scoped(
        ref("application_id", "applications"), ref("round_id", "clarification_rounds")
    )
    application_id: Mapped[str] = mapped_column(String(36))
    round_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    scopes: Mapped[list] = mapped_column(JSON)
    expires_at: Mapped[float] = mapped_column(Float)
    revoked_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    redeemed_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class AuthSession(Tenant, Base):
    __tablename__ = "auth_sessions"
    __table_args__ = scoped(
        ref("application_id", "applications"),
        ref("invitation_id", "candidate_invitations"),
    )
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    user_id: Mapped[str | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    application_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    invitation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    scopes: Mapped[list] = mapped_column(JSON, default=list)
    expires_at: Mapped[float] = mapped_column(Float)
    revoked_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class CandidateDraft(Tenant, Base):
    __tablename__ = "candidate_drafts"
    __table_args__ = scoped(
        ref("application_id", "applications"),
        ref("round_id", "clarification_rounds"),
        UniqueConstraint("application_id", "round_id"),
    )
    application_id: Mapped[str] = mapped_column(String(36))
    round_id: Mapped[str] = mapped_column(String(36))
    responses: Mapped[list] = mapped_column(JSON, default=list)
    updated_at: Mapped[float] = mapped_column(Float, default=now)


class ProfileCorrection(Tenant, Base):
    __tablename__ = "profile_corrections"
    __table_args__ = scoped(ref("application_id", "applications"))
    application_id: Mapped[str] = mapped_column(String(36))
    display_name: Mapped[str] = mapped_column(String(160))
    email: Mapped[str | None] = mapped_column(String(254), nullable=True)
    state: Mapped[str] = mapped_column(String(20), default="pending")


class SourcePermission(Tenant, Base):
    __tablename__ = "source_permissions"
    __table_args__ = scoped(ref("application_id", "applications"))
    application_id: Mapped[str] = mapped_column(String(36))
    public_links: Mapped[bool] = mapped_column(Boolean)
    work_samples: Mapped[bool] = mapped_column(Boolean)
    followup: Mapped[bool] = mapped_column(Boolean)


class InterviewBrief(Tenant, Base):
    __tablename__ = "interview_briefs"
    __table_args__ = scoped(
        ref("application_id", "applications"),
        ref("requirement_version_id", "requirement_versions"),
        ref("supersedes_id", "interview_briefs"),
        UniqueConstraint("application_id", "revision"),
    )
    application_id: Mapped[str] = mapped_column(String(36))
    requirement_version_id: Mapped[str] = mapped_column(String(36))
    revision: Mapped[int] = mapped_column(Integer)
    content: Mapped[str] = mapped_column(Text)
    state: Mapped[str] = mapped_column(String(20), default="draft")
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    supersedes_id: Mapped[str | None] = mapped_column(String(36), nullable=True)


class ClarificationWorkflow(Tenant, Base):
    __tablename__ = "clarification_workflows"
    __table_args__ = scoped(ref("application_id", "applications"), ref("requirement_version_id", "requirement_versions"), ref("round_id", "clarification_rounds"), ref("invitation_id", "candidate_invitations"), UniqueConstraint("application_id", "requirement_version_id"))
    application_id: Mapped[str] = mapped_column(String(36))
    requirement_version_id: Mapped[str] = mapped_column(String(36))
    round_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    invitation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    state: Mapped[str] = mapped_column(String(30), default="draft")
    deadline: Mapped[float | None] = mapped_column(Float, nullable=True)
    reminder_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_reminders: Mapped[int] = mapped_column(Integer, default=0)
    reminders_sent: Mapped[int] = mapped_column(Integer, default=0)
    approved_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    completed_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    brief: Mapped[dict] = mapped_column(JSON, default=dict)
    policy: Mapped[dict] = mapped_column(JSON, default=dict)
    resume_seq: Mapped[int] = mapped_column(Integer, default=0)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    available_at: Mapped[float] = mapped_column(Float, default=now)
    lease_until: Mapped[float] = mapped_column(Float, default=0)
    lease_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")


class ClarificationAction(Tenant, Base):
    __tablename__ = "clarification_actions"
    __table_args__ = scoped(ref("workflow_id", "clarification_workflows"), UniqueConstraint("workflow_id", "action_key"))
    workflow_id: Mapped[str] = mapped_column(String(36))
    action_key: Mapped[str] = mapped_column(String(160))
    action: Mapped[str] = mapped_column(String(30))
    rationale: Mapped[str] = mapped_column(String(500))
    result: Mapped[dict] = mapped_column(JSON, default=dict)


class ClarificationSubmission(Tenant, Base):
    __tablename__ = "clarification_submissions"
    __table_args__ = scoped(ref("application_id", "applications"), ref("round_id", "clarification_rounds"), UniqueConstraint("round_id"))
    application_id: Mapped[str] = mapped_column(String(36))
    round_id: Mapped[str] = mapped_column(String(36))
    body_hash: Mapped[str] = mapped_column(String(64))


class ResponseCorrection(Tenant, Base):
    __tablename__ = "response_corrections"
    __table_args__ = scoped(ref("response_id", "clarification_responses"), ref("application_id", "applications"), UniqueConstraint("response_id"))
    application_id: Mapped[str] = mapped_column(String(36))
    response_id: Mapped[str] = mapped_column(String(36))
    text: Mapped[str] = mapped_column(Text)
    reason: Mapped[str] = mapped_column(String(500))


class OAuthCredential(Tenant, Base):
    __tablename__ = "oauth_credentials"
    __table_args__ = scoped(ref("connection_id", "provider_connections"), UniqueConstraint("connection_id"))
    connection_id: Mapped[str] = mapped_column(String(36))
    encrypted_tokens: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[float] = mapped_column(Float)
    revoked_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class OAuthAttempt(Tenant, Base):
    __tablename__ = "oauth_attempts"
    __table_args__ = scoped()
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    session_id: Mapped[str] = mapped_column(String(36))
    state_hash: Mapped[str] = mapped_column(String(64), unique=True)
    encrypted_verifier: Mapped[str] = mapped_column(Text)
    expires_at: Mapped[float] = mapped_column(Float)
    used_at: Mapped[float | None] = mapped_column(Float, nullable=True)


class InterviewPlan(Tenant, Base):
    __tablename__ = "interview_plans"
    __table_args__ = scoped(ref("application_id", "applications"), ref("requirement_version_id", "requirement_versions"), ref("brief_id", "interview_briefs"), UniqueConstraint("application_id", "version"), UniqueConstraint("org_id", "client_key"))
    application_id: Mapped[str] = mapped_column(String(36))
    requirement_version_id: Mapped[str] = mapped_column(String(36))
    brief_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    version: Mapped[int] = mapped_column(Integer)
    client_key: Mapped[str] = mapped_column(String(100))
    content: Mapped[dict] = mapped_column(JSON)
    content_hash: Mapped[str] = mapped_column(String(64))
    author_id: Mapped[str] = mapped_column(ForeignKey("users.id"))


class InterviewAuthorization(Tenant, Base):
    __tablename__ = "interview_authorizations"
    __table_args__ = scoped(ref("plan_id", "interview_plans"), UniqueConstraint("plan_id"))
    plan_id: Mapped[str] = mapped_column(String(36))
    actor_id: Mapped[str] = mapped_column(ForeignKey("users.id"))
    content_hash: Mapped[str] = mapped_column(String(64))
    snapshot: Mapped[dict] = mapped_column(JSON)
    rationale: Mapped[str] = mapped_column(Text)


class InterviewCoordination(Tenant, Base):
    __tablename__ = "interview_coordinations"
    __table_args__ = scoped(ref("application_id", "applications"), ref("plan_id", "interview_plans"), ref("invitation_id", "candidate_invitations"), UniqueConstraint("application_id"))
    application_id: Mapped[str] = mapped_column(String(36))
    plan_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    invitation_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    state: Mapped[str] = mapped_column(String(30), default="draft")
    provider_event_id: Mapped[str] = mapped_column(String(100), unique=True)
    calendar_id: Mapped[str] = mapped_column(String(250), default="primary")
    booked_slot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    selected_slot: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    candidate_windows: Mapped[list] = mapped_column(JSON, default=list)
    offered_slots: Mapped[list] = mapped_column(JSON, default=list)
    selection_version: Mapped[int] = mapped_column(Integer, default=0)
    deadline: Mapped[float | None] = mapped_column(Float, nullable=True)
    reminder_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    reminders_reserved: Mapped[int] = mapped_column(Integer, default=0)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    error: Mapped[str] = mapped_column(Text, default="")


class InterviewAction(Tenant, Base):
    __tablename__ = "interview_actions"
    __table_args__ = scoped(ref("coordination_id", "interview_coordinations"), ref("plan_id", "interview_plans"), UniqueConstraint("coordination_id", "idempotency_key"))
    coordination_id: Mapped[str] = mapped_column(String(36))
    plan_id: Mapped[str] = mapped_column(String(36))
    idempotency_key: Mapped[str] = mapped_column(String(160))
    kind: Mapped[str] = mapped_column(String(30))
    state: Mapped[str] = mapped_column(String(30), default="queued")
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    first_attempt_at: Mapped[float | None] = mapped_column(Float, nullable=True)
    available_at: Mapped[float] = mapped_column(Float, default=now)
    lease_until: Mapped[float] = mapped_column(Float, default=0)
    lease_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    provider_id: Mapped[str | None] = mapped_column(String(200), nullable=True)
    error: Mapped[str] = mapped_column(Text, default="")


class SchedulingResponse(Tenant, Base):
    __tablename__ = "scheduling_responses"
    __table_args__ = scoped(ref("coordination_id", "interview_coordinations"), ref("plan_id", "interview_plans"), UniqueConstraint("coordination_id", "client_key"))
    coordination_id: Mapped[str] = mapped_column(String(36))
    plan_id: Mapped[str] = mapped_column(String(36))
    client_key: Mapped[str] = mapped_column(String(100))
    content: Mapped[dict] = mapped_column(JSON)


class RateLimitBucket(Base):
    __tablename__ = "rate_limit_buckets"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    window: Mapped[int] = mapped_column(Integer, primary_key=True)
    count: Mapped[int] = mapped_column(Integer, default=0)


APPEND_ONLY = (
    InterviewPlan,
    InterviewAuthorization,
    SchedulingResponse,
    ClarificationAction,
    ClarificationSubmission,
    ResponseCorrection,
    SourcePermission,
    EvidenceItem,
    ExtractionVersion,
    Finding,
    FindingRevision,
    FindingEvidence,
    ClarificationResponse,
    Approval,
    RecruiterDecision,
    WorkflowEvent,
    Metric,
)


@event.listens_for(ORMSession, "before_flush")
def immutable_history(session, context, instances):
    for obj in session.dirty:
        if not session.is_modified(obj, include_collections=False):
            continue
        if isinstance(obj, APPEND_ONLY):
            raise ValueError(
                "Historical records are append-only; create a superseding version"
            )
        if isinstance(obj, Requirement):
            version = session.get(RequirementVersion, obj.version_id)
            if version and version.state == "approved":
                raise ValueError("Approved requirements are immutable")
        if isinstance(obj, RequirementVersion):
            state = inspect(obj).attrs.state.history
            if obj.state == "approved" and not (
                state.has_changes() and "proposed" in state.deleted
            ):
                raise ValueError("Approved requirement versions are immutable")
    for obj in session.deleted:
        if isinstance(obj, APPEND_ONLY + (Requirement, RequirementVersion)):
            raise ValueError("Historical records cannot be deleted through ORM")
