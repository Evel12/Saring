export type Page<T> = {
  items: T[];
  total: number;
  limit: number;
  offset: number;
  has_more: boolean;
};
export type Health = {
  mode: "demo" | "live";
  model: string;
  calendar: string;
  schema: string;
};
export type Me = {
  organization_id: string;
  user_id: string | null;
  role: "admin" | "recruiter" | "candidate";
  application_id: string | null;
  scopes: string[];
  memberships: { org_id: string; organization_name: string; role: string }[];
};
export type Org = { id: string; name: string; is_demo: boolean };
export type Vacancy = {
  id: string;
  title: string;
  description: string;
  state: "draft" | "published" | "closed";
  is_sample: boolean;
  active_requirement_version_id: string | null;
  created_at: number;
};
export type CriterionInput = {
  stable_id?: string | null;
  description: string;
  importance: "essential" | "preferred";
  acceptable_evidence_types: string[];
  minimum_observable_expectation: string;
  clarification_permitted: boolean;
};
export type Criterion = CriterionInput & {
  id: string;
  stable_id: string;
  version_id: string;
  version: number;
};
export type Version = {
  id: string;
  vacancy_id: string;
  version: number;
  state: "proposed" | "approved";
  requirements: Criterion[];
  approved_at: number | null;
};
export type Application = {
  id: string;
  candidate_id: string;
  vacancy_id: string;
  requirement_version_id: string;
  review_state: string;
  reassessment_required: boolean;
  decision: string;
  created_at: number;
  withdrawn_at: number | null;
};
export type Candidate = {
  id: string;
  display_name: string;
  email: string | null;
  synthetic: boolean;
};
export type Document = {
  id: string;
  application_id: string;
  original_name: string;
  media_type: string;
  size_bytes: number;
  synthetic: boolean;
  excluded_at?: number | null;
  exclusion_reason?: string;
  created_at: number;
};
export type Evidence = {
  id: string;
  application_id: string;
  document_id: string | null;
  response_id: string | null;
  source_kind: string;
  passage: string;
  page: number | null;
  paragraph: number | null;
  artifact_location: string;
  strength: string;
  observed_at: number;
  extraction_version_id: string | null;
  supersedes_id: string | null;
};
export type FindingState = "supported" | "partial" | "unknown" | "conflicting";
export type Revision = {
  provenance?: { provider?: string; model?: string; prompt_version?: string; extraction_version_ids?: string[]; citation_validation?: string };
  id: string;
  finding_id: string;
  revision: number;
  state: FindingState;
  explanation: string;
  unresolved_question: string;
  evidence_ids: string[];
  created_at: number;
  supersedes_id: string | null;
};
export type Finding = {
  id: string;
  requirement_id: string;
  latest_revision: Revision | null;
};
export type Brief = {
  application_id: string;
  vacancy_title: string;
  requirement_version_id: string;
  reassessment_required: boolean;
  requirements: Criterion[];
  findings: Finding[];
  evidence: Evidence[];
  limitations: string[];
};
export type Round = {
  id: string;
  number: number;
  state: "draft" | "approved" | "answered" | "closed";
  application_id: string;
  questions?: Question[];
};
export type Question = { id: string; requirement_id: string; text: string };
export type Interview = {
  id: string;
  application_id: string;
  starts_at: number;
  ends_at: number;
  timezone: string;
  state: string;
  external_id: string | null;
};
export type Run = {
  id: string;
  vacancy_id: string;
  state: string;
  created_at: number;
  requirement_version_id: string;
};
export type Job = {
  id: string;
  run_id: string;
  application_id: string;
  kind: string;
  state: string;
  attempts: number;
  error: string;
  created_at: number;
};
export type Activity = {
  id: string;
  created_at: number;
  kind: string;
  message: string;
  run_id?: string | null;
  details?: { tool?: string; result?: string; duration_seconds?: number; attempt?: number; error_code?: string };
  application_id: string | null;
  vacancy_id: string | null;
};
export type Connection = {
  id: string;
  provider: string;
  state: string;
  config: Record<string, string>;
};
export type Outbox = {
  id: string;
  application_id: string;
  kind: string;
  state: string;
  error: string;
  interview_id: string | null;
  created_at: number;
};
export type BriefDraft = {
  id: string;
  content: string;
  revision: number;
  state: string;
  created_at: number;
  requirement_version_id: string;
};
export type Correction = {
  id: string;
  display_name: string;
  email: string | null;
  state: string;
  created_at: number;
};
export type Permissions = {
  public_links: boolean;
  work_samples: boolean;
  followup: boolean;
};
export type Snapshot = {
  extractions: { id: string; document_id: string; version: number; engine: string; limitations: string; passages: {page: number | null; paragraph: number | null; method?: string; quality?: string; ocr_confidence?: number | null}[] }[];
  application: Application;
  candidate?: Candidate;
  brief: Brief;
  documents: Document[];
  rounds: Round[];
  interviews: Interview[];
};
