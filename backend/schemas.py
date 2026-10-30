"""Strict request schemas; versioned outputs are derived from explicit public columns."""

from typing import Literal, Generic, TypeVar, Any
from pydantic import BaseModel, Field, ConfigDict, create_model, field_validator
from sqlalchemy import JSON
from uuid import UUID
from backend import models as m


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Login(Input):
    email: str = Field(min_length=3, max_length=254)
    password: str = Field(min_length=1, max_length=256)


class MemberInput(Input):
    email: str = Field(min_length=3, max_length=254)
    display_name: str = Field(min_length=1, max_length=160)
    password: str | None = Field(default=None, min_length=12, max_length=256)
    role: Literal["admin", "recruiter"] = "recruiter"


class MemberPatch(Input):
    role: Literal["admin", "recruiter"] | None = None
    active: bool | None = None


class RequirementInput(Input):
    stable_id: str | None = None
    description: str = Field(min_length=1, max_length=2000)
    importance: Literal["essential", "preferred"]
    acceptable_evidence_types: list[
        Literal[
            "candidate_report",
            "document",
            "work_sample",
            "structured_assessment",
            "reference",
        ]
    ] = Field(min_length=1, max_length=5)
    minimum_observable_expectation: str = Field(min_length=1, max_length=2000)
    clarification_permitted: bool = True

    @field_validator("stable_id")
    @classmethod
    def valid_uuid(cls, v):
        return str(UUID(v)) if v else None


class RequirementProposal(Input):
    requirements: list[RequirementInput] = Field(min_length=1, max_length=30)


class VacancyInput(Input):
    title: str = Field(min_length=1, max_length=160)
    description: str = Field(default="", max_length=10000)
    requirements: list[RequirementInput] = Field(min_length=1, max_length=30)


class VacancyPatch(Input):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    description: str | None = Field(default=None, max_length=10000)
    state: Literal["draft", "published", "closed"] | None = None


class ApplicationInput(Input):
    vacancy_id: str
    display_name: str = Field(min_length=1, max_length=160)
    email: str | None = Field(default=None, max_length=254)
    candidate_id: str | None = None


class EvidenceInput(Input):
    document_id: str | None = None
    response_id: str | None = None
    extraction_version_id: str | None = None
    source_kind: Literal[
        "cv", "clarification", "work_sample", "assessment", "reference"
    ]
    passage: str = Field(min_length=1, max_length=10000)
    page: int | None = Field(default=None, ge=1)
    paragraph: int | None = Field(default=None, ge=1)
    artifact_location: str = Field(default="", max_length=2000)
    strength: Literal["candidate_reported", "artifact_backed", "assessment_observed"]
    observed_at: float | None = None
    supersedes_id: str | None = None


class FindingInput(Input):
    requirement_id: str
    state: Literal["supported", "partial", "unknown", "conflicting"]
    evidence_ids: list[str] = Field(default_factory=list, max_length=30)
    explanation: str = Field(min_length=1, max_length=2000)
    unresolved_question: str = Field(default="", max_length=1000)


class QuestionInput(Input):
    requirement_id: str
    text: str = Field(min_length=1, max_length=1000)


class RoundInput(Input):
    questions: list[QuestionInput] = Field(min_length=1, max_length=3)


class ResponseInput(Input):
    question_id: str
    text: str = Field(default="", max_length=2000)
    disposition: Literal["answer", "decline", "alternative"] = "answer"
    artifact_document_id: str | None = None


class ClarificationApprovalInput(Input):
    rationale: str = Field(default="", max_length=2000)
    response_hours: int = Field(default=72, ge=1, le=168)
    max_reminders: int = Field(default=1, ge=0, le=1)
    reminder_hours: int = Field(default=24, ge=1, le=120)


class ResponsesInput(Input):
    responses: list[ResponseInput] = Field(min_length=1, max_length=3)


class InvitationInput(Input):
    round_id: str | None = None
    scopes: list[
        Literal[
            "application:read",
            "clarification:respond",
            "document:upload",
            "document:read",
            "profile:correct",
            "permissions:write",
            "interview:schedule",
        ]
    ] = Field(default_factory=lambda: ["application:read", "clarification:respond"])
    expires_in_seconds: int = Field(default=3600, ge=60, le=86400)


class Exchange(Input):
    token: str = Field(min_length=32, max_length=200)


class DecisionInput(Input):
    decision: Literal["undecided", "shortlist", "reject", "hire", "request_more_information"]
    rationale: str = Field(min_length=1, max_length=2000)


class InterviewInput(Input):
    starts_at: float
    ends_at: float
    timezone: str = Field(default="Asia/Jakarta", max_length=80)
    provider_connection_id: str | None = None


class ApprovalInput(Input):
    rationale: str = Field(default="", max_length=2000)


class RunInput(Input):
    vacancy_id: str
    reextract_documents: bool = False


class ControlInput(Input):
    action: Literal["pause", "resume", "cancel", "retry"]


class ConnectionInput(Input):
    provider: Literal["google_calendar", "openai", "email"]
    config: dict = Field(default_factory=dict)


class OutboxInput(Input):
    kind: Literal["clarification", "interview", "followup"]
    round_id: str | None = None
    interview_id: str | None = None
    idempotency_key: str = Field(min_length=8, max_length=160)


T = TypeVar("T")


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int
    has_more: bool


PRIVATE = {
    "encrypted_tokens",
    "encrypted_verifier",
    "state_hash",
    "password_hash",
    "token_hash",
    "storage_key",
    "credential_ref",
    "lease_token",
}


def output(model):
    fields = {}
    for c in model.__table__.columns:
        if c.name in PRIVATE:
            continue
        try:
            t = c.type.python_type
        except NotImplementedError:
            t = Any
        if isinstance(c.type, JSON):
            t = (
                list[dict[str, Any]]
                if c.name == "passages"
                else (
                    list[str]
                    if c.name in ("scopes", "acceptable_evidence_types")
                    else dict[str, Any]
                )
            )
        fields[c.name] = (t | None if c.nullable else t, None if c.nullable else ...)
    return create_model(
        model.__name__ + "Out", __config__=ConfigDict(from_attributes=True), **fields
    )


VacancyOut = output(m.Vacancy)
ApplicationOut = output(m.Application)
DocumentOut = output(m.Document)
EvidenceOut = output(m.EvidenceItem)
VersionOut = output(m.RequirementVersion)
RequirementOut = output(m.Requirement)
FindingOut = output(m.Finding)
RevisionOut = output(m.FindingRevision)
RoundOut = output(m.ClarificationRound)
QuestionOut = output(m.ClarificationQuestion)
ResponseOut = output(m.ClarificationResponse)
ApprovalOut = output(m.Approval)
InterviewOut = output(m.Interview)
ConnectionOut = output(m.ProviderConnection)
RunOut = output(m.WorkflowRun)
JobOut = output(m.WorkflowJob)
EventOut = output(m.WorkflowEvent)
OutboxOut = output(m.OutboxAction)
MetricOut = output(m.Metric)
CandidateOut = output(m.Candidate)
MembershipOut = output(m.Membership)
DecisionOut = output(m.RecruiterDecision)
ExtractionOut = output(m.ExtractionVersion)


class VersionDetailOut(VersionOut):
    requirements: list[RequirementOut]


class RevisionDetailOut(RevisionOut):
    evidence_ids: list[str]


class FindingDetailOut(FindingOut):
    latest_revision: RevisionDetailOut | None


class RoundDetailOut(RoundOut):
    questions: list[QuestionOut]


class BriefOut(BaseModel):
    application_id: str
    vacancy_title: str
    requirement_version_id: str
    reassessment_required: bool
    requirements: list[RequirementOut]
    findings: list[FindingDetailOut]
    evidence: list[EvidenceOut]
    limitations: list[str]
