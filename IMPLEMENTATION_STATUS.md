# Saring frontend and backend status

The frontend uses the real v1 organization-scoped API and preserves the reference's compact three-column dashboard. It adds all seven requested screen groups, scoped candidate draft/profile/consent flows, versioned brief editing and persisted event reconnection. The backend retains its authenticated relational foundation. Docker is optional; CMD scripts use SQLite by default.

The demo system (synthetic organizations, deterministic adapters, seeded/sample data, demo reset endpoints and its pytest/Playwright suites) was removed entirely. Live mode is the only mode: real provider adapters with server-side credentials only, and truthful failed/not-configured states when anything is unconfigured. This document reflects that state.

## Implemented

| Area | Implementation |
|---|---|
| Domain schema | 47 mapped tables: prior interview/OAuth domain plus execution attempts, controlled erasure grants and restartable private-file deletion. |
| Migrations | Frozen legacy 001/002; explicit DDL in 003; immutable guards in 004; frontend persistence in 005; analysis provenance in 006; clarification in 007; interview/OAuth in 008; execution/retention in 009; document exclusion/recovery in 010; server-level AI model selection in 011. Prior records preserved in `legacy_*`, not assigned to arbitrary tenants. SQLite foreign keys enabled; tenant composite foreign keys enforced. The legacy `is_demo`/`is_sample`/`synthetic` columns are always false and excluded from API output; frozen migrations still reference `is_demo`, so the column is retained. |
| Criteria | Stable requirement identity, essential/preferred importance, accepted evidence types, observable expectation, clarification permission and integer version. Publication requires approved criteria. New approvals flag reassessment without replacing history. **Suggest criteria** requires a configured model (admin AI selection or `OPENAI_API_KEY`/`OPENAI_MODEL`) and returns editable drafts only. |
| Evidence | Exact quote/location, application/document/response/extraction identity, artifact location, timestamp, independent strength and supersedes link. Re-extraction creates superseding versions. Findings use supported/partial/unknown/conflicting and append-only revisions with evidence links. Accepted evidence types are enforced for supported/partial findings. Excluded sources leave association but stay in history. |
| Authentication | pwdlib Argon2 password hashing, Starlette/itsdangerous signed HttpOnly cookie transport (requires `SESSION_SECRET`, 32+ characters), hashed revocable database session handles, current membership/role checks, rotating CSRF tokens, restricted CORS and database-backed token/login rate limits. No shared recruiter bearer token or localStorage credentials. |
| Candidate access | Short-lived hashed scoped invitation tokens, single-use exchange, bounded candidate sessions, expiry/revocation checks, own-application checks and explicit read/upload permissions. Draft recruiter questions and internal findings/decisions are not exposed. |
| AI adapters | Server-side OpenAI-compatible Chat Completions with strict JSON Schema outputs for analysis, gap detection and interview briefs (text-only; no tools, no image input, no URL retrieval). Provider/model/prompt version persisted with exact citations; invalid citations fail the job. No deterministic/mock adapters remain in the request path. |
| Internal messaging | Google Calendar interview coordination via server OAuth/PKCE with Fernet-encrypted tokens; event insert/update/cancel with stable provider event IDs and ETag reconciliations. Resend adapter for approved clarification/interview email with idempotency keys and bounded replay. All produce truthful queued/provider-accepted/delivery-unknown/failed states. |
| Worker | Separate worker with database claims, lease tokens, fenced commits, bounded retries and pause/resume/cancel/retry. Real extraction/review re-extraction jobs persist source-linked records and metrics. Missing or bad provider configuration persists failed/not-configured states; there is no fallback substitution. |
| Local startup | `setup.cmd`, `start-api.cmd`, `start-worker.cmd`, `start-web.cmd`; no Docker/PostgreSQL service required. `SESSION_SECRET` is mandatory. Optional Compose overrides database configuration to PostgreSQL. |

## Verification

Language and build checks after the demo removal: all backend modules pass `py_compile`; the TypeScript/Vite production build passes (`tsc --noEmit && vite build`). Earlier development verified schema 010 and API/worker/Vite startup against local SQLite without Docker, migration upgrade/downgrade round-trips, and real Tesseract 5.5.3 recognition on an image-only page.

The prior automated test suites (87 backend tests, browser journeys) depended on demo fixtures and were removed with the demo system. Live-mode test coverage is not yet rebuilt: credentialed live provider testing and public deployment have not been performed. Operators should replace the removed suites with live-adapter-only tests before relying on unattended changes.

## Frontend file map

| Files | Purpose |
|---|---|
| `src/main.tsx`, `api.ts`, `hooks.ts`, `types.ts`, `ui.tsx` | Authenticated shell/router, typed cookie/CSRF client, paginated reads, abortable loading, event cursor/backoff/reconnection, common accessible dialogs/tabs/panels. |
| `src/Vacancies.tsx` | Vacancy list, editable custom/template wizard, AI suggestions, criterion expectations/evidence controls, approval and publication. |
| `src/Dashboard.tsx`, `data.ts` | Reference-style roster, blind display identifiers, per-application stages, essential findings and source completeness, private CV uploads/downloads, workflow recovery controls. |
| `src/CandidateDetail.tsx`, `Review.tsx` | Five candidate tabs, exact source cards/provenance/revisions, clarification controls, comparisons, human decisions, versioned editable briefs and interview approval. |
| `src/Portal.tsx` | Scoped invitation exchange, factual corrections, optional source permissions, server-saved drafts, confirmation and actual submission receipt. |
| `src/SchedulingPortal.tsx`, `src/InterviewCoordination.tsx` | Candidate-owned explicit availability and dated slot selection/conflicts; recruiter-side coordination state machine. |
| `src/Operations.tsx`, `workspace.css` | Calendar/settings/metrics and the responsive light/dark/system enterprise visual extensions. |
| `/api/health` (backend `main.py`) | Reports `mode: live`, the configured model, calendar configuration requirement and schema revision. |

## External configuration and limits

- Docker is unavailable in the development environment; Compose/PostgreSQL runtime and concurrent-worker PostgreSQL load tests were not exercised. Database DDL/triggers support PostgreSQL, but that path still needs integration validation.
- `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY` are required; secure cookies default on. Local loopback may explicitly use `COOKIE_SECURE=false`. Hosted use requires HTTPS, explicit origin configuration, password recovery/onboarding policy and secret rotation.
- Tesseract is required for scanned PDFs; missing/unavailable OCR is recorded honestly. The worker preserves raw private extractions, then conservatively filters professional lines for association. This can omit relevant evidence and does not guarantee complete sensitive-data removal or eliminate bias.
- The automatic foundation reviewer is deliberately conservative: explicit CV claims can produce partial findings only when their evidence type is accepted; unavailable evidence stays unknown. Concrete accepted requirement-linked answers may move unknown to partial; weak/declined answers do not resolve a gap, and no source is automatically promoted to expertise or authorship. Recruiters make substantive judgments and all selection/hiring decisions.
- AI analysis, suggestions, email and calendar coordination all require real configuration: a model selected by a server admin (Ollama is keyless) or `OPENAI_API_KEY`/`OPENAI_MODEL`, `SARING_PROVIDER_<ORG>_EMAIL` (Resend), `GOOGLE_CLIENT_*`/`GOOGLE_REDIRECT_URI`/`TOKEN_ENCRYPTION_KEY`. No credentialed live provider test or public deployment has run; provider acceptance is at most evidence the provider accepted a request, never that a message was delivered or read.
- Offline, tenant-scoped withdrawn-application erasure and restartable private-file cleanup are implemented. Backups, physical media, provider copies, exports and legal holds need separate operator procedures; archive is not erasure. Hosted use still needs backup policies, encryption, malware/process isolation, quotas and operational review.

The inline reference HTML was used for the original visual implementation because no reference attachment existed on disk. `reference/saring.html` remains a compact reconstruction of that supplied design.
