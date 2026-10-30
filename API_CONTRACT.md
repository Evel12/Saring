# Saring backend contract · v1

Base URL: `http://127.0.0.1:8000/api/v1`. Vite proxies `/api` from port 5173. OpenAPI/Swagger: `/openapi.json` and `/docs`. All examples contain synthetic values. JSON requests reject unknown fields. IDs are opaque UUID strings; timestamps are UTC Unix seconds. No caller supplies `org_id`, actor IDs, verification flags, session IDs or provider secrets in resource bodies.

## Authentication and CSRF

1. `GET /auth/csrf` with cookies enabled returns `{ "csrf_token": "..." }` and an HttpOnly `saring_session` signed cookie.
2. `POST /auth/login` with `{ "email": "hr@example.test", "password": "..." }`, that cookie, and `X-CSRF-Token`. Successful login rotates the session and CSRF token; response includes `csrf_token`, `organization_id`, `role`.
3. Send cookies with subsequent requests. Fetch `/auth/csrf` after login/exchange/reset or use the rotated response token before another mutation. Every cookie-based POST/PATCH/DELETE requires `X-CSRF-Token`, including login and invitation exchange. Origin, when present, must be in `ALLOWED_ORIGINS`; CORS allows only explicit origins/headers/methods.
4. `GET /auth/me` returns role, selected organization, own memberships, and candidate scope where applicable. Recruiter sessions expire after eight hours and are checked against current user/membership state on every request.
5. `POST /auth/logout` revokes the server session. No bearer credentials or localStorage credentials are used.

For a user with multiple memberships, `X-Organization-ID` selects an authorized organization per request. Omit it to use the login organization. An unauthorized organization returns 403; object IDs outside the selected organization return 404. Candidate sessions cannot change organizations.

Password hashing uses [pwdlib Argon2](https://frankie567.github.io/pwdlib/reference/pwdlib/); signed cookie transport uses [Starlette SessionMiddleware](https://starlette.dev/middleware/#sessionmiddleware) with itsdangerous, backed by hashed, revocable database session handles. HttpOnly/SameSite=Strict are always enabled. Secure defaults to enabled in LIVE; disable only for local HTTP development. Session signing secrets and password hashes are never returned.

Login, invitation exchange/issuance and demo initialization/reset have database-backed fixed-window rate limits. Exceeded limits return 429 and `Retry-After`. Do not trust arbitrary forwarded IP headers; the application uses the ASGI client address. Configure proxy trust explicitly for deployment.

## Lists and errors

List endpoints accept `?limit=25&offset=0`, with `1 <= limit <= 100` and `0 <= offset <= 100000`. Responses:

```json
{ "items": [], "total": 0, "limit": 25, "offset": 0, "has_more": false }
```

Ordering is `(created_at, id)` ascending. Use `offset + items.length` for the next page. Summary metrics and nested single-resource views are not lists. Errors use `{ "detail": "..." }`; input validation errors use FastAPI's field-error array. Typical statuses: 401 no/expired session, 403 role/scope/CSRF/origin denied, 404 resource outside scope or invalid invitation, 409 state/conflict/relational reference, 413 size exceeded, 422 invalid schema/evidence, 429 limited. Responses are `Cache-Control: no-store`.

## Organization and membership

- `GET /organization`: selected organization.
- `GET /memberships` (admin, paginated).
- `POST /memberships` (admin): `{email, display_name, role: "admin"|"recruiter", password?}`. New users require 12+ characters; an existing user's password cannot be reset here. Password is omitted when adding an existing user to another organization.
- `PATCH /memberships/{id}`: `{role?, active?}`. The final active admin cannot be demoted/revoked. Demo membership mutation is disabled.
- Provision the first admin using `python -m backend.cli create-admin --organization NAME --email EMAIL`; password is prompted privately.

## Vacancies and immutable criteria

`POST /vacancies`:

```json
{
  "title": "Backend Engineer",
  "description": "Develop internal services.",
  "requirements": [{
    "stable_id": null,
    "description": "Go",
    "importance": "essential",
    "acceptable_evidence_types": ["candidate_report", "document", "work_sample"],
    "minimum_observable_expectation": "Describe one project and your own contribution.",
    "clarification_permitted": true
  }]
}
```

Importance is `essential|preferred`. Evidence types are `candidate_report|document|work_sample|structured_assessment|reference`. There are 1–30 criteria. Missing stable IDs are generated; carry them forward when revising the same criterion. A requirement row also has its own ID, parent `version_id` and integer `version`. Use the **row ID** for findings/questions and the **stable ID** to maintain identity across versions.

- `GET /vacancies` (paginated), `GET /vacancies/{id}`.
- `PATCH /vacancies/{id}`: `{title?, description?, state?: "draft"|"published"|"closed"}`. Publication requires approved criteria.
- `DELETE /vacancies/{id}` archives/closes it; no historical erasure.
- `POST /vacancies/{id}/requirement-versions`: `{requirements:[...]}` creates a proposed version; it never mutates approved rows.
- `GET /vacancies/{id}/requirement-versions` (paginated).
- `GET /requirement-versions/{id}` includes typed requirement rows.
- `POST /requirement-versions/{id}/approve`: `{rationale?: "..."}` creates approval history and changes the active version. Older proposals cannot replace a newer approval.

Approving changed criteria sets `reassessment_required=true` on affected applications without replacing their prior review-version pointer or finding history. Outstanding candidate invitations for those applications are revoked so stale questions cannot remain active. Run a new review to reassess against the new version. A workflow snapshots the approved version at queue time. Old findings, revisions, decisions, sources and approval records remain available. Approved requirements/version rows cannot be updated via ORM or SQL; new versions are mandatory.

## Applications, candidates and private documents

- `POST /applications`: `{vacancy_id, display_name, email?, candidate_id?}`. A supplied candidate ID must belong to the organization. Vacancy must be published. Demo records are created only by synthetic seed endpoints.
- `GET /applications?vacancy_id=...` (paginated), `GET /applications/{id}`.
- `GET /candidates` (paginated recruiter-only identity/contact records).
- `GET /applications/{id}/documents` (paginated).
- `POST /applications/{id}/documents`: multipart `file`, cookie and `X-CSRF-Token`. PDF/DOCX only; 5 MB maximum, matching extension/media/signature. DOCX XML members/expansion/macro checks are applied. Storage keys are generated, never derived from original names.
- `GET /documents/{id}/download`: authorized attachment; a synthetic document has no real binary and returns 404. Do not link to a storage directory.
- `GET /documents/{id}/extractions` (paginated): version, engine, exact passages with page/paragraph, limitations and supersedes ID. Raw extraction content is recruiter-only.

Worker extraction does not execute files. Real OCR needs Tesseract; parser/OCR errors are recorded as failures/retries, not fake success. Re-extraction is requested using a workflow run with `reextract_documents=true` and creates new immutable extraction rows.

## Evidence and finding revisions

- `GET /applications/{id}/evidence` (paginated).
- `POST /applications/{id}/evidence` creates an append-only evidence item:

```json
{
  "document_id": "DOCUMENT_ID",
  "response_id": null,
  "extraction_version_id": "EXTRACTION_ID",
  "source_kind": "cv",
  "passage": "Skills: Go",
  "page": null,
  "paragraph": 1,
  "artifact_location": "document:DOCUMENT_ID",
  "strength": "candidate_reported",
  "observed_at": 1790000000,
  "supersedes_id": null
}
```

Source kinds: `cv|clarification|work_sample|assessment|reference`. Strength: `candidate_reported|artifact_backed|assessment_observed`. CV and candidate responses must remain candidate-reported. CV evidence requires the document and extraction; its exact passage/location must exist in that extraction. Clarification evidence must quote the linked response. Document/response/extraction/supersedes references must belong to the same application. Artifact/assessment/reference evidence requires a source location. Locations are metadata, not fetched/executed URLs; frontend code must not render arbitrary locations as trusted HTML.

- `GET /applications/{id}/findings` (paginated, includes latest revision and evidence IDs).
- `POST /applications/{id}/findings`: `{requirement_id, state, evidence_ids:[], explanation, unresolved_question?}` creates a finding/revision or appends a revision to an existing finding. Requirement must be in the application review version; every evidence ID must be in that application.
- `GET /findings/{id}/revisions` (paginated, includes evidence IDs).

Finding state is **only** `supported|partial|unknown|conflicting`; it never encodes verification strength. Supported/partial require evidence; conflicting requires two or more evidence items. A finding with self-report can remain partial or be judged supported by a human against the approved expectation, while its source strength stays candidate-reported. The automatic foundation reviewer creates only partial/unknown associations. Unknown is not inability. No score or automated shortlist is produced.

## Clarification and candidate sessions

- `POST /applications/{id}/clarification-rounds`: `{questions:[{requirement_id,text}]}`. At most three questions, only criteria with clarification permitted, one round per approved criteria version and a hard cap of two historical rounds per application. Cannot start a round while reassessment is outstanding.
- `GET /applications/{id}/clarification-rounds` (paginated).
- `GET /clarification-rounds/{id}` includes questions.
- `POST /clarification-rounds/{id}/approve`: `{rationale?,response_hours?,max_reminders?,reminder_hours?}`; authorizes the exact questions and bounded email reminder policy (details below).
- `POST /applications/{id}/invitations`: `{round_id?, scopes:[...], expires_in_seconds?:3600}`. Lifetime 60–86400 seconds. Scopes: `application:read`, `clarification:respond`, `document:upload`, `document:read`, `profile:correct`, `permissions:write`. Response permission requires an approved round in that application. The random token is returned **once**, stored only as a hash. No email is sent.
- `POST /invitations/{id}/revoke` immediately revokes invitation-derived sessions.
- Candidate calls `GET /auth/csrf`, then `POST /auth/invitations/exchange` with `{token}` + CSRF/cookie. Exchange is single-use and rotates the browser session. Response: `{csrf_token, application_id, expires_at}`. Put invitation tokens in URL fragments or exchange them directly, not in localStorage or query strings.
- `GET /candidate/applications/{id}`: own application ID/title, factual profile, public application status, demo flag, and permitted round's question IDs/text/state. No other applicants, internal findings, decisions or reviewer notes.
- `POST /candidate/applications/{id}/responses`: `{responses:[{question_id,text}]}`. Respond once to each approved question; blanks are allowed. Answers are limited to 2000 characters, remain candidate-reported, and create new evidence/finding revisions without rewriting old revisions. Submission revokes that invitation/session and returns `{ok,application_id,application_status,submitted_at}` as the confirmation receipt.
- `POST /candidate/applications/{id}/documents` needs document-upload scope and the same upload checks; DEMO rejects real uploads.
- `GET /candidate/applications/{id}/documents/{document_id}/download` needs document-read scope and checks both application and document identity.
- `GET /applications/{id}/responses` (recruiter, paginated).

Candidate sessions expire no later than one hour or the invitation expiry. Exchanged tokens cannot be reused; revoked/expired invitations cannot create or retain sessions. Candidate access to recruiter endpoints returns 403; other application/document IDs return 404 within an otherwise permitted candidate route.

## Decisions, approvals and interviews

- `POST /applications/{id}/decisions`: `{decision:"undecided"|"shortlist"|"reject"|"hire"|"request_more_information", rationale}`. Recruiter-only, appends history with the exact criteria version. Outstanding reassessment blocks a new decision.
- `GET /applications/{id}/decisions` (paginated).
- `GET /applications/{id}/interview-brief`: application/version/reassessment, approved criteria, finding/evidence snapshots and explicit limitations.
- `POST /applications/{id}/interviews`: `{starts_at,ends_at,timezone,provider_connection_id?}`. Requires current human shortlist; future duration ≤2 hours, IANA timezone.
- `GET /applications/{id}/interviews` (paginated).
- `POST /interviews/{id}/approve` is retired for new coordination and returns 409: a slot-only approval cannot authorize an interview invitation or booking. Use the versioned interview-plan flow below. Existing interview records remain readable.
- `GET /approvals` (paginated).

## Providers, workflows, outbox and metrics

- `GET/POST /provider-connections` (admin; list paginated). POST: `{provider:"google_calendar"|"openai"|"email", config:{...}}`. Allowed non-secret config: calendar `calendar_id`; model `model,base_url`; email `from_email`. Secrets are read from organization-specific server environment references, never returned/accepted in this API. Approved clarification uses the Resend adapter; DEMO is isolated and live requires server credentials.
- `POST /workflow-runs`: `{vacancy_id,reextract_documents?:false}` queues one review job per application with a requirement-version snapshot.
- `GET /workflow-runs` (paginated), `GET /workflow-runs/{id}`, `GET /workflow-runs/{id}/jobs` (paginated).
- `POST /workflow-runs/{id}/control`: `{action:"pause"|"resume"|"cancel"|"retry"}`. Invalid transitions return 409. Pausing/cancelling invalidates running job leases; retry requeues failed jobs with a fresh bounded attempt budget. Completed evidence/history remains immutable.
- `GET /events?vacancy_id=...&run_id=...` (paginated). Each event carries organization, scoped resource links, timestamp, kind, actor where applicable and a brief message.
- `GET /outbox` (paginated).
- `POST /applications/{id}/outbox`: `{kind:"clarification"|"interview"|"followup", round_id?, interview_id?, idempotency_key}` creates an action awaiting approval. Linked resources must be in that application.
- `POST /outbox/{id}/approve`: `{rationale?}` validates linked approval state and queues it.
- `POST /outbox/{id}/retry` requeues an already-approved failed/unconfigured action after configuration is fixed.
- `GET /metrics`: tenant-scoped application/reassessment/job/outbox/interview counts.
- `GET /metrics/history` (paginated): persisted worker duration/outbox-result metrics.

Jobs use persisted leases/fencing, at most three attempts and exponential retry delay. Run states: queued/running/paused/done/failed/cancelled; job states: queued/running/done/failed/cancelled. Outbox states: awaiting_approval/queued/running/simulated/completed/not_configured/failed. Simulated is explicitly synthetic. Live missing credentials never become completed. Availability checking and calendar insertion are not atomic; stable event IDs reconcile retries, and Google Calendar remains authoritative. Clarification retains its outbox contract; interview coordination uses the separate explicit action ledger below with queued/provider_accepted/delivery_unknown states.

## Demo and dashboard compatibility

The current frontend uses v1 resources and these additional persisted contracts (migration 005):

- `GET /events/changes?tail=true&limit=50&vacancy_id=...&application_id=...`: latest scoped events for first connection. `tail` is optional; filters may be omitted for the organization feed. Response `{items,next_cursor,has_more}`. Continue with `after=EVENT_ID`, ordered by `(created_at,id)`. The cursor must belong to the selected organization. Cursor polling never creates workflow progress. The client retains its cursor during automatic and manual reconnection, deduplicates IDs and re-reads resource state when events arrive.
- `POST /demo/sample-vacancies`: synthetic-only, idempotent creation of Software Developer, Customer Support and Administrative Assistant sample drafts; returns `{items}`. They carry `is_sample=true`, unlike custom/template-derived user vacancies. Existing v1 vacancy responses now include `is_sample`.
- `POST /demo/requirements/suggest` with `{title}`: deterministic synthetic adapter, demo organizations only. `POST /requirements/suggest` with the same body uses the configured live provider and returns 503 when configuration is missing. Both return `{adapter,requirements}` using the editable criterion input schema. Suggestions are never automatically approved.
- `PATCH /clarification-rounds/{id}` with `{questions:[{requirement_id,text}]}`: recruiter revision of an unapproved draft only. Validates the approved review-version scope, clarification permission and the three-question bound. Approved questions cannot be rewritten.
- `GET/POST /applications/{id}/brief-drafts`: paginated recruiter brief history / new revision `{content}` (1–20,000 characters). Responses include `revision`, `state`, exact `requirement_version_id`, `author_id`, `supersedes_id` and timestamps. Content is plain text. `POST /brief-drafts/{id}/approve` with `{rationale?}` requires a current reviewed version and records an approval. Revision saves do not rewrite earlier content.
- `GET /candidate/applications/{id}/draft`: requires `clarification:respond` and the invitation's approved round; returns `{responses,updated_at}`. `POST` accepts `{responses:[{question_id,text}]}` and saves without submitting. Draft question IDs must be in that invitation; all normal text/boundary limits apply. Candidate drafts are not exposed through recruiter endpoints or used as findings before submission.
- `POST /candidate/applications/{id}/profile-corrections` with `{display_name,email?}`: requires `profile:correct`; creates a pending factual correction. Does not change evidence or the candidate identity automatically. `GET /applications/{id}/profile-corrections` is paginated/recruiter-only; `POST /profile-corrections/{id}/approve` with `{rationale?}` applies the correction after human review and records approval/history.
- `GET /candidate/applications/{id}/source-permissions`: requires `application:read`, returns latest choices (default false). `POST` requires `permissions:write` and `{public_links,work_samples,followup}` booleans; appends a timestamped choice record. These choices do not grant application scopes, verify evidence, or trigger public-link fetching/reference contact. Recruiters can read paginated history at `/applications/{id}/source-permissions`.

Candidate application status is deliberately factual (`received`, `awaiting_clarification`, `in_recruiter_review`) and does not publish internal selection judgments. On submission the response provides a server receipt with `submitted_for_recruiter_review` and submission time, then general invitation access ends. An explicitly bounded exception permits the same unexpired session to read its own receipt and append a factual correction; explicit subsequent revocation closes that exception.

`POST /api/demo-session` (CSRF) creates/reuses a private synthetic organization/session. `POST /demo/vacancies/{id}/seed` creates five deterministic synthetic applications after criteria approval/publication. `POST /demo/reset` discards only the caller's synthetic organization and rotates to a new isolated one. It cannot reset another tenant or a non-demo organization. DEMO rejects real uploads and never invokes a real calendar.

Compatibility endpoints under `/api/vacancies`, `/api/candidates`, `/api/requirements/suggest` and `/api/portal/{token}` remain for older clients. The new frontend does not use them; `/api/demo-session` is used only to establish an isolated demo session. Older clients combined criterion approval/publication; the new wizard makes them separate actions. Compatibility archive retains evidence/history and revokes portal access; it is not legal erasure.


## Ingestion and analysis (schema 006)

Existing upload, extraction, workflow and finding endpoints remain compatible. `GET /documents/{id}/extractions` returns immutable revisions whose `passages` contain exact `page` or `paragraph` (nullable), `text`, and for new real extractions `locator`, `method`, `quality`, and nullable `ocr_confidence`. DOCX has no page number. Methods: `pdf`, `docx`, `tesseract-ocr`, `ocr-unavailable`; quality: `readable`, `ocr-review`, `uncertain`. OCR confidence is not a factual accuracy score. Uncertain pages stay in the authorized extraction history but are excluded from automated evaluation. Review originals, request factual clarification, or upload an accessible replacement through the existing application document endpoint and queue a workflow (`reextract_documents: true` creates new extraction revisions).

Finding revision responses add `provenance`: provider, model, prompt_version, profile_version, extraction_version_ids, citations (`evidence_id`, exact `quote`), citation_validation limitation. Human revisions have an empty provenance object. No credentials, raw provider responses or hidden reasoning are stored. Internal analysis provenance is recruiter-only, never part of the candidate portal response. `extraction.uncertain` events surface correction/reupload needs; controlled parser/model failures appear on persisted workflow jobs with bounded retries and existing retry/cancel controls. A non-demo organization always uses the configured live provider; no credentials means a truthful failed/retrying job, not a demo result. No URL fetching or automatic selection decision occurs.


## Bounded clarification workflow (schema 007)

One automatic round per application/approved criteria version, at most three concise questions, with a hard cap of two historical rounds per application. Prioritization is essentiality then conflicting/unknown/partial gaps; accepted evidence types, existing detailed examples and previously asked stable criterion IDs constrain usefulness. If no permitted clarification is useful, an immutable action result and persisted review-ready brief record direct escalation. No selection decision is made.

- `POST /clarification-rounds/{id}/approve`: `{rationale?, response_hours?:72, max_reminders?:1, reminder_hours?:24}`. Response hours 1?168, reminders 0?1; if enabled the reminder must precede the deadline. Idempotent for the same approved policy; changing approved questions/policy is rejected. This one approval authorizes the exact questions, initial invitation and bounded reminder. No per-worker-step approval is required. Approval persists a `queued` outbox action; delivery can be `completed` (provider acceptance only), `simulated` (demo only), `not_configured`, `needs_attention`, `failed` or `cancelled`.
- `GET /applications/{id}/clarification-workflow`: recruiter-only `{workflow,actions,responses,delivery_actions}`. Workflow states: `draft`, `pending_delivery`, `waiting`, `resume_queued`, `processing`, `review_ready`, `needs_attention`, `superseded`. Contains approved deadline/policy, reminder reservation, error and final brief. Actions contain a short rationale, validated result, provider/model/prompt version when applicable; no hidden reasoning. Before/after results link new evidence IDs and finding revisions. No browser timer changes workflow state.
- `POST /applications/{id}/clarification-workflow/retry`: retries only a failed current evidence continuation after answers were received. It authorizes no new questions or messages. Delivery retries use existing `/outbox/{id}/retry`, preserving the same payload/key and provider retry window.
- Candidate `POST /candidate/applications/{id}/draft` and `/responses` accept `{responses:[{question_id,text,disposition?:"answer"|"decline"|"alternative",artifact_document_id?:null}]}`. All permitted questions must appear exactly once on submission; blank/decline is allowed. Artifacts must already be uploaded through the same application's authorized candidate upload endpoint with `document:upload` scope. PDF/DOCX validation/private storage still applies. The artifact presence is artifact-backed, not proof of contents, authorship or expertise.
- Identical response resubmissions return the same server receipt and create no duplicate answers/evidence/update. Changed bodies receive 409 and must use correction. Simultaneous first submissions serialize the approved?answered transition. Submission and its durable continuation commit together; the worker resumes automatically. General candidate reads still reject the closed invitation. Before submission, the own-application clarification object includes the approved response `deadline` and `invitation_expires_at`; the portal distinguishes these timestamps and makes no ability inference from silence.
- `GET /candidate/applications/{id}/submission`: the original unexpired candidate session may read **only its own** submitted responses and receipt. No other applicant or internal note is included. Explicit subsequent revocation closes this exception too.
- `POST /candidate/applications/{id}/answer-corrections`: `{response_id,text,reason}`. Same original unexpired scoped session, own application/question/round, current criteria, within approved deadline and no currently running update. At most one immutable correction per original answer. Identical retries are idempotent; differing second corrections receive 409. Original evidence stays intact; correction evidence links its original via supersedes and carries candidate-reported strength. This queues another bounded continuation automatically.
- `POST /demo/clarification-example`: explicit demo-only synthetic Customer Support vacancy/application with approved sample criteria (`handle complaints`) and a CV passage `Experience: online shop administrator`. Returns `{vacancy_id,application_id}`; no worker or candidate answer is fabricated by the endpoint.
- `GET /demo/clarification-mailbox?application_id=...`: recruiter-only, same isolated DEMO tenant. Returns simulated clarification/reminder records and their scoped portal links. No live organization can use this mailbox. Portal capabilities are never included in outbox/event JSON; the server derives the demo link using its secret and the hashed invitation record.

Live next-action proposals use strict schema `{action,requirement_id,evidence_ids,question,rationale}` with action enums `retrieve_evidence`, `draft_question`, `await_response`, `revise_findings`, `escalate`. The application restricts actions by persisted state, approved criterion, authorized sources and a ten-proposal logical budget (bounded retries remain separate). At a material question gap, the model may draft or escalate if asking is not useful. It cannot send messages, grant permissions, expand the round or generate a candidate answer. Findings update by a conservative content policy: an unknown may become partial for accepted concrete, requirement-linked personal action detail, but never automatically supported or conflicting. Existing supported/conflicting findings are not silently resolved by generic answers. No-response deadlines produce a brief with remaining uncertainties, not negative ability evidence. Received answers with a failed update are never labeled a no-response timeout.

Operational email contact/configuration is separate from minimized model input. `POST /provider-connections` accepts email config `{from_email}` only; the Resend API key is the organization's server environment credential reference. Live email requires HTTPS `PUBLIC_APP_URL`. The fixed Resend `/emails` adapter uses stable idempotency keys; no replay beyond the safe 23-hour window. Unrelated email templates and inbox-delivery webhooks remain unimplemented; approved interview notifications use the interview action ledger below. Changing criteria or withdrawing an application closes old clarification access before reminder creation. Optional portfolio retrieval remains disabled.


## Review-to-interview coordination (schema 008)

All routes below are under `/api/v1`, use organization membership/session checks, and require CSRF for cookie-authenticated mutation. Candidate routes additionally require `interview:schedule` in the current plan's own-application invitation. Clarification authorization grants no interview permissions. No model records shortlist/reject/hiring decisions.

### Brief and authorization

- `POST /applications/{id}/generated-interview-brief`: generates `{content,requirement_version_id}` from the approved review snapshot. It includes each requirement/observable expectation, stored finding/limitations, exact cited passages, authorized document download paths or response IDs, real page/paragraph locators where available, unresolved questions and structured interview questions. The recruiter edits/saves/approves through existing `brief-drafts` routes; generation is not approval.
- `POST /applications/{id}/interview-plans`: immutable draft with `client_key` (8?100 chars, idempotent per organization), `recipient`, `subject`, `draft`, `confirmation_draft`, `cancellation_draft`, `calendar_title`, `calendar_description`, `notify_interviewers` (default true), `brief_id`, `duration_minutes` (15?120), `buffer_minutes` (0?60), `timezone` (IANA, default Asia/Jakarta), `window_start`, `window_end` (dated ISO local/offset values), `interviewers` (1?5), `max_reminders` (0?1), `reminder_hours` (1?120) and `response_hours` (1?168). Each interviewer is `{email,calendar_id,timezone,working_hours:[{weekday:0..6,start:"09:00",end:"17:00"}]}`. A future horizon spans at most 30 days and starts within 90 days. Reminder must precede the response deadline. Templates support only `{portal_url}`, `{start}`, `{end}`, `{timezone}`; the invite requires `{portal_url}`. Changes use a new client_key/version, never overwrite content.
- `GET /applications/{id}/interview-plans`: standard pagination. A plan carries immutable content/hash, author, version, application, approved-criteria version and brief identity.
- `POST /interview-plans/{id}/approve` `{rationale?}`: requires current human shortlist, no reassessment, an approved brief, latest plan version and recipient equal to authorized operational contact. Writes an append-only authorization with actor/time, exact content/hash/version, criteria/brief/calendar identity and full scheduling/follow-up policy. Identical approval clicks reuse the original coordination/action. Changing content/recipient/policy requires a new version/approval. Running/unknown provider actions block replacement until reconciled.
- `GET /applications/{id}/interview-coordination`: `{coordination,authorizations}`; coordination includes persisted candidate windows, explicit options/selection, deadlines, reminder reservation, stable provider event ID, booked slot, error and actions. This is recruiter-only; candidate responses never include drafts, internal brief, authorization notes or interviewer calendars.
- `GET /interview-coordinations`: standard organization-scoped pagination for calendar views.

Example plan (replace dates with future dates):

```json
{
  "client_key": "unique-plan-request-1",
  "recipient": "candidate@example.test",
  "subject": "Interview invitation",
  "draft": "Please offer dated availability and select a time: {portal_url}",
  "confirmation_draft": "Confirmed {start} to {end} ({timezone}). {portal_url}",
  "cancellation_draft": "Interview coordination cancelled; contact your recruiter.",
  "brief_id": "approved-brief-uuid",
  "duration_minutes": 30,
  "buffer_minutes": 10,
  "timezone": "Asia/Jakarta",
  "window_start": "2030-06-10T09:00",
  "window_end": "2030-06-14T17:00",
  "interviewers": [{"email":"hr@example.test","calendar_id":"primary","timezone":"Asia/Jakarta","working_hours":[{"weekday":0,"start":"09:00","end":"17:00"}]}],
  "max_reminders": 1,
  "reminder_hours": 24,
  "response_hours": 72
}
```

### Candidate availability and explicit selection

- Interview approval creates a hashed, short-lived invitation (at most 24h) with only `application:read` and `interview:schedule`. Existing exchange creates an HttpOnly scoped session (at most one hour). Manual clarification invitations cannot grant scheduling against a different/non-current invitation. Reminders may refresh the same authorized scope once; no new questions or policy are authorized.
- `GET /candidate/applications/{id}/scheduling`: `{id,state,offered_slots,booked_slot,deadline,error,timezone,duration_minutes,buffer_minutes}` only.
- `POST /candidate/applications/{id}/availability`: `{client_key,timezone,windows:[{start,end}],expression?:""}`. Up to 12 dated windows, each future and at most seven days. Ambiguous expression text, including Thursday afternoon, is retained as candidate data and returns `confirmation_required` with no booking. Supply dated windows to proceed. Ambiguous DST wall times require explicit matching UTC offsets; nonexistent times are rejected. Availability intersects all approved interviewer hours, duration/buffers, candidate windows and real free/busy. Returns at most 12 explicit options; empty means conflict, not free time.
- `POST /candidate/applications/{id}/select-interview-slot`: `{client_key,slot_id}`. Only a currently offered option may be selected. Persists selection before queuing a book/reschedule action. Duplicate same-key/same-slot clicks do not create another event/message. An existing booking is updated in place; its provider event ID remains unchanged. Availability is rechecked immediately before the provider write. Conflict returns alternatives and requires another selection; the worker does not choose for the candidate.
- `POST /candidate/applications/{id}/withdraw` `{reason}` records withdrawal, revokes scheduling access and queues cancellation/reconciliation of the existing/possibly uncertain event. No immediate provider-cancellation claim is made.
- `POST /applications/{id}/interview-coordination/cancel` `{reason}` is the recruiter counterpart. Withdrawal, changed shortlist decision or reassessment also invalidates sends and queues cleanup under the authorized cancellation policy.

### Durable actions and providers

`InterviewAction.state` distinguishes `queued`, `running`, `provider_accepted`, `simulated`, `delivery_unknown`, `failed`, `not_configured`, `expired_credential`, `conflict`, `cancelled`. Provider-accepted means only that the provider accepted the event/message. No read/delivered claim or webhook receipt is fabricated. Coordination additionally tracks waiting_availability, confirmation_required, options_ready, booking_queued, booked/simulated, cancellation_queued, response_timeout, needs_attention and cancelled. No response is not a finding about ability.

Actions have stable application-level idempotency keys, persisted first-attempt time, bounded retries, lease tokens, errors and provider IDs. Google uses one predetermined event ID per application coordination, stored before any network call. Every uncertain insert/update/cancellation is reconciled by that ID and private action/plan markers. Updates use ETag/If-Match; concurrent/external edits become conflicts. The final provider read before write is a fresh availability check; Google free/busy and insertion are not atomic. Rescheduling produces one unique confirmation action per accepted change, not a second event. When `notify_interviewers` is approved, Google event attendees are exactly the approved interviewer emails and `sendUpdates=all` sends their calendar invitations/updates. The candidate recipient may not be listed as an interviewer, and is excluded from Google attendees; candidate messages use Resend only. When disabled, no new Google attendees are added; changes to previous approved attendees still receive their cancellation/update. The event title/description and notification option are immutable approved content. An external/unapproved guest-list change requires reconciliation before a write or confirmation. Non-owned interviewer calendars expose only free/busy, so overlapping reschedules may be conservatively unavailable.

`POST /interview-actions/{id}/retry` permits only failed/unknown/unconfigured/expired actions. Retries retain the same identifier and frozen email payload. An email beyond the safe 23-hour Resend key-retention window is blocked for manual provider reconciliation, not resent under a new key. An accepted message has a persisted provider ID. Neither clarification nor interview worker generates candidate responses.

DEMO uses deterministic local calendar busy records and a synthetic Resend mailbox. `GET /demo/interview-mailbox?application_id=...` is same-tenant recruiter-only and returns simulated message records/portal URLs, never live records. Tests prohibit all HTTP client calls in the demo flow. Live missing/expired credentials do not fall back to demo success.

### Google OAuth credentials

- `POST /oauth/google/start` (admin, CSRF): `{mode,authorization_url}`. Demo returns no URL and makes no request. Live requires server `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, exact `GOOGLE_REDIRECT_URI` and encryption configuration. State expires in ten minutes, is hashed/server-persisted, admin-session/browser-bound and atomically single-use. PKCE S256 is used; its verifier is encrypted. A separate HttpOnly SameSite=Lax callback nonce supports the cross-site OAuth return while the recruiter session remains Strict.
- `GET /oauth/google/callback?state&code`: validates browser nonce, state, active admin/session and PKCE exchange. Query codes are redacted from access logs; tokens never enter the browser redirect. Requests `calendar.events.owned`, `calendar.events.freebusy`, `openid email` only. Email's canonical Google `userinfo.email` scope alias is accepted. Verified account identity is fetched server-side to bind the connection; switching accounts with active coordination is rejected, including after disconnect.
- `GET /oauth/google/status` (admin): connection state, requested scopes, access-token expiry and refresh support only; no tokens/verifiers/client secret.
- `POST /oauth/google/disconnect` (admin, CSRF): immediately invalidates stored credentials locally and separately reports confirmed remote revocation. OAuth refresh handles expiry/revocation explicitly and never accepts a static bearer token from the browser.

Access/refresh tokens are Fernet-encrypted in the database with `TOKEN_ENCRYPTION_KEY` required in LIVE. A development-only derived key exists for local demo mode. Backup/rotation of the server encryption key is an operational responsibility; API/worker share the same keys. Account binding survives disconnect; browser-visible connection configuration contains no credential material. No full-calendar, contacts, profile/name scope or live fallback is used. Live Google/Resend test-account checks did not run because credentials were not supplied; mocked HTTP tests are not represented as live validation.
## Operational additions: schema 009

`GET /api/v1/execution-attempts?application_id=...&limit=25&offset=0` uses the normal page envelope and recruiter authentication. An optional application filter is ownership-checked (foreign tenant: 404). Fields: `id`, `org_id`, `target_kind` (`analysis`, `clarification`, `outbox`, `interview`), `target_id`, `application_id`, `number`, `started_at`, `heartbeat_at`, `finished_at`, `state`, `error_code`, `created_at`. Lease tokens, payloads and source content are excluded. Attempt numbers survive explicit retry cycles. A crashed attempt becomes `interrupted` when recovered/exhausted; waiting states do not allocate attempts. Terminal operational states include `completed`, `simulated`, `provider_accepted`, `retry_scheduled`, `needs_attention`, `delivery_unknown`, `not_configured`, `expired_credential` and `cancelled`, depending on adapter. Legacy clarification outbox `completed` means provider acceptance only; `payload.provider_message_id` records its returned identifier. It is not delivered/read.

Events from `/events` and `/events/changes` add `details`, a closed metadata object: optional `tool`, `result`, `error_code`, `duration_seconds`, `attempt`. No arbitrary parameter object is accepted. `created_at`, `application_id`, `run_id`, `kind` and controlled `message` identify the operation, its concise purpose and actual outcome. Poll `/events/changes?after=EVENT_UUID` to resume; preserve the last cursor on disconnection and deduplicate by event ID. `has_more=true` requests the next page immediately; otherwise back off. Organization/application filters remain mandatory access boundaries. Erasure can invalidate a cursor (404); the frontend clears it, refreshes the workspace and refetches a fresh authorized tail automatically. Routine events are not raw model traces.

`GET /metrics` retains prior numeric summary keys and adds processing/attention/retry/workflow/clarification counters, current `findings_by_status`, `remaining_evidence_gaps`, `supported_requirements`, `evidence_gap_resolution_transitions`, `model_input_tokens`, `model_output_tokens`, `estimated_model_cost_usd`, explanatory notes and explicit nulls for unavailable HR review time/manual baseline. Consumers must accept string notes, a nested finding-status object and nulls, not assume every property is a numeric count. Duration is observed finished-attempt wall time in seconds; interrupted/open attempts and candidate/HR waits are excluded. Gap-resolution transitions count gap→supported revisions and can include reopening/re-resolution, not unique hires or an accuracy measure. Historical criterion versions are retained in findings; metrics do not replace the version-aware application checklist.

Model usage is provider-reported and transactionally committed with analysis/clarification; failed or rolled-back provider calls may be missing. Estimated USD cost requires configured prices for the exact `MODEL_PRICE_MODEL`. Missing usage/prices return null, not invented zeros. No efficiency percentage, manual baseline or provider billing completeness is inferred.

Retention uses the offline `python -m backend.retention` maintenance contract documented in README. It is deliberately unavailable to candidate/recruiter HTTP sessions. Database append-only UPDATE protections remain; DELETE protections permit only an expiring maintenance grant, created/removed inside the erasure transaction. Original file deletion has a persisted restartable queue. Unresolved calendar outcomes block erasure. Backups, external providers and physical storage sanitization require separate operator procedures.

## Final journey additions: schema 010

- `POST /demo/workspace` (recruiter, synthetic tenant only): idempotently creates two approved/published **explicit sample** vacancies, five candidates and five separate applications per vacancy. Returns `vacancy_ids`, `synthetic_candidates:5`, `applications_per_vacancy:5`. Real DOCX originals are generated privately; model/email/calendar are DEMO. No arbitrary uploaded bytes are accepted by these endpoints.
- `POST /demo/vacancies/{id}/synthetic-file` with e.g. `{ "variant": "support" }`; allowed values are `support`, `developer`, `scan`, `unreadable`, `hostile`. Creates/reuses a scoped synthetic application and a closed-catalog private original; returns application ID, variant, `parsing:"real"`, `analysis:"deterministic_demo"`. Scan is image-only PDF requiring real worker OCR; malformed is intentionally recoverable. Candidate IDs are shared only within the same isolated sample organization; applications remain distinct by vacancy.
- `POST /demo/applications/{id}/replacement-file` with the same variant enum: attaches/reuses a generated original on the authorized application. Arbitrary public document uploads remain rejected.
- Documents add nullable `excluded_at` and `exclusion_reason`. `POST /documents/{id}/exclude` with `{ "reason": "..." }` (5–500 chars) preserves the original/history, excludes future association and sets reassessment required. HR must rerun sources before a new decision. Excluded sources cannot back newly submitted findings. The reason is source content in the scoped resource, not copied into routine activity logs.
- `POST /demo/applications/{id}/calendar-conflict` (recruiter, same synthetic tenant only): requires current offered slots, persists a demo busy block for the first option and returns its slot ID. Selection is still required; the worker's real state machine rechecks availability and returns conflict/alternatives. No live provider is called and no time is silently selected.

Generated originals have `Document.synthetic=false` because they contain an actual private binary (the old synthetic placeholders have no binary); their candidates/organization and the persistent DEMO banner still explicitly identify synthetic data. The real parser is used only for those binaries, not faked extraction revisions. Reset removes only the caller's synthetic records and transactionally queues associated originals for bounded cleanup under the replacement isolated organization.

Live model selection/base URL and credentials are authoritative server environment settings (`OPENAI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`). Historical `openai` connection metadata is not an execution override. The Settings UI shows actual server model health and edits only effective calendar/email options. No browser credential fields or localStorage bearer tokens are introduced.
