# Saring

An evidence-first recruitment workspace with a real organization-scoped backend. React/TypeScript + Vite, FastAPI, SQLAlchemy/Alembic, SQLite or PostgreSQL, and a separate durable Python worker. Docker is **optional**.

Start with **Explore complete demo** for five synthetic people and ten separate applications in two sample vacancies, or choose the equally visible **Create vacancy** action. The closed synthetic file catalog runs real DOCX/PDF parsing and local OCR; model, email and calendar remain explicitly simulated in DEMO. Public sessions never receive other tenants' applicant records and cannot upload arbitrary real files.

Final verification: **87 backend tests passed**, **10 browser journeys passed**, plus the separate **worker-crash/HR-wait/candidate-wait UI restart journey passed**. Real Tesseract 5.5.3 recognition, production build, `pip check`, npm audit and locked Python dependency audit ran successfully. No credentialed live model/Google/Resend request or public deployment occurred. Read the [truthful test report](docs/TEST_REPORT.md), [architecture and states](docs/ARCHITECTURE.md), [four-minute demo script](docs/DEMO_SCRIPT.md) and [deployment recipe](docs/DEPLOYMENT.md).

## Start from CMD, without Docker

Requires Python 3.12+ and Node 22+. In `E:\Saring`:

```cmd
setup.cmd
```

Then run these in three separate CMD windows:

```cmd
cd /d E:\Saring
start-api.cmd
```

```cmd
cd /d E:\Saring
start-worker.cmd
```

```cmd
cd /d E:\Saring
start-web.cmd
```

Open **http://127.0.0.1:5173**. Interactive API documentation is at **http://127.0.0.1:8000/docs**. These commands default to DEMO mode and a local SQLite database at `saring.db`; PostgreSQL and API keys are unnecessary for the foundation/demo workflow. The worker must remain running to process queued jobs. Closing the browser does not stop workflow progress.

For the scanned-CV journey and full browser suite, run `setup-ocr.cmd` once before starting the worker. It downloads micromamba from its official distribution and installs Tesseract 5.5.3 and language data into ignored `.runtime/ocr` (roughly 217 MB of packages here). `start-worker.cmd` detects that workspace-only installation. An existing installation can instead use `TESSERACT_CMD`/`TESSDATA_PREFIX`; no OCR binary is committed. The default readable-file demo works without OCR and truthfully marks unavailable/uncertain OCR when necessary.

`setup.cmd` creates the virtual environment, installs locked dependencies, installs frontend dependencies, and runs migrations. `start-api.cmd` checks/applies migrations before launching. The scripts run console processes in their current CMD window; they do not require background services or administrator privileges. Stop them with Ctrl+C.

For manual setup, the equivalent commands are:

```cmd
python -m venv .venv
.venv\Scripts\python.exe -m pip install -r backend\requirements.lock
npm.cmd ci
.venv\Scripts\python.exe -m alembic upgrade head
.venv\Scripts\python.exe -m uvicorn backend.main:app --host 127.0.0.1 --port 8000
```

Run `.venv\Scripts\python.exe -m backend.worker` and `npm.cmd run dev` separately. Local Python commands use process environment variables; `.env` is consumed by Docker Compose, not automatically by Python. No `.env` is needed for default local demo startup.

## Recruiter accounts and non-demo records

Provision the initial organization/admin through the CLI, rather than an unauthenticated registration endpoint:

```cmd
.venv\Scripts\python.exe -m backend.cli create-admin --organization "Example organization" --email hr@example.test
```

Enter a password of at least 12 characters at the hidden prompt. Passwords are hashed with Argon2 through pwdlib. The admin can create recruiter/admin memberships through `/api/v1/memberships`. Existing users can join additional organizations without changing their passwords. Recruiters cannot manage memberships or provider connections. Revoking membership immediately invalidates access to that organization.

To run the UI in LIVE mode over **local HTTP**, set these in the API and worker CMD windows before starting them:

```cmd
set SARING_MODE=live
set COOKIE_SECURE=false
set SESSION_SECRET=replace-with-at-least-32-random-characters
```

Generate a secret with `python -c "import secrets; print(secrets.token_urlsafe(48))"`. Use the same secret/environment in API and worker. LIVE defaults to secure cookies; `COOKIE_SECURE=false` is a local HTTP setting. Use `COOKIE_SECURE=true`, HTTPS, and explicit `ALLOWED_ORIGINS` for hosted use. The UI uses email/password login and HttpOnly sessions; there are no shared recruiter bearer tokens and no credentials in localStorage. Only the theme preference uses localStorage.

Session signing uses Starlette SessionMiddleware/itsdangerous. Random session handles are hashed in database records with absolute expiry and revocation. DEMO generates a private ignored `.runtime/session.key`; LIVE requires `SESSION_SECRET`. Candidate invitations are random, hashed, short-lived, revocable, single-use for exchange, and restricted to one application and explicit scopes. Candidate sessions are bounded by invitation expiry. The candidate API never exposes recruiter findings, decisions, other applicants, or original documents without an explicit document-read scope.

## Frontend workspace

The frontend uses the v1 contracts directly, with cookie/CSRF authentication and cursor-based polling of persisted events.

IBM Plex Sans and JetBrains Mono are bundled locally, with OFL notices in `public/licenses/`; no Google Fonts request is needed by the dashboard or candidate portal. Model configuration is read from the API/worker server environment; Settings shows its actual configured/unconfigured health rather than offering an ineffective browser override.

The workspace includes:

- A paginated vacancy list with explicitly labelled synthetic samples.
- A four-step vacancy wizard: custom details, editable criteria/evidence, explicit HR approval, then separate publication. Starter templates are Software Developer, Customer Support and Administrative Assistant. Applying a template preserves an entered custom title.
- The reference-style three-column dashboard with editable summary/CVs, independent applicant stages, essential supported/partial/unknown counts, evidence completeness, approval cards and a terminal activity feed. Tablet/mobile layouts move and stack panels.
- Candidate Overview, Evidence, Clarification, Interview and History tabs, exact source passages, finding revision history, approved-question scopes and authorized document downloads.
- Recruiter comparison, versioned editable interview briefs, explicit brief/shortlist approval, and independent scheduling approval.
- An application-scoped candidate portal with profile correction requests, optional source/consent permissions, server-saved drafts, submit confirmation and a factual application status. Submission closes the invitation; the confirmation receipt reports the actual server submission.
- Calendar, integration/settings and operational metrics views. Missing configuration, offline connections, failures, waiting, retries and simulated results are labelled explicitly.

The candidate invitation link uses a URL fragment and is exchanged for a scoped session. Preview it in a separate browser profile/private window; exchanging it in a recruiter browser replaces that browser's session. Only theme preferences use localStorage. Candidate drafts and briefs are saved on the server. All text/notes/source passages render as escaped plain text; arbitrary HTML/Markdown is not executed.

The event feed initially reads the latest persisted events, then resumes by event ID. Network retries use backoff; manual reconnect retains the cursor. Timers only schedule network polling, never workflow completion. Coverage is the number of criteria with associated evidence, not a hiring-success probability. An applicant awaiting clarification does not put every applicant in a waiting state.

Migration 005 adds explicit sample flags, candidate drafts, factual correction requests, source permission history and interview brief revisions. `start-api.cmd` applies it before startup. Existing approved criteria and source/finding history remain intact.

## Foundation and history (backend)

The schema models organizations, users/memberships, vacancies, approved requirement versions and stable requirement IDs; candidates/applications; documents/extractions/evidence; findings/revisions; clarification rounds/questions/responses; approvals/decisions/interviews; provider connections; workflow runs/jobs/events; outbox actions; metrics; sessions/invitations and rate-limit buckets.

Vacancies move through `draft`, `published`, and `closed`. Publication requires approved criteria. All requirement edits create new versions. Approving a newer version flags affected applications for reassessment; it does not replace previous criteria, findings, approvals or decisions. A review run records the exact version it processes. New human decisions require reassessment to be complete. Vacancy deletion archives it and preserves history.

Evidence records preserve an exact passage, document/response/extraction identifiers, page/paragraph when available, artifact location, observation timestamp and supersedes link. Evidence strength is `candidate_reported`, `artifact_backed`, or `assessment_observed`. Finding status is separately `supported`, `partial`, `unknown`, or `conflicting`, with append-only revisions and evidence links. A supported finding does not turn self-report into verified expertise.

Approved criteria and historical evidence/revisions are protected by ORM guards and database triggers. SQLite enables foreign-key enforcement; composite foreign keys reject cross-organization relational references. Synthetic demo reset is an explicit exception for deleting **only the caller's isolated demo organization**. Other organizations are unaffected.

Migrations 001/002 are frozen legacy metadata. Migration 003 preserves previous records in `legacy_*` tables and creates the relational schema; legacy records are not exposed by the new API or assigned to arbitrary tenants. Migration 004 installs immutable-history guards; 005 supplies frontend persistence; 006 adds analysis provenance; 007 adds bounded clarification; 008 adds interview/OAuth persistence; 009 adds execution history and controlled erasure; 010 adds source exclusion/replacement recovery. All earlier history is preserved. Upgrade/downgrade/upgrade is tested on a temporary database containing a synthetic legacy record. Take backups before migrating real records.

## Processing and adapters

The worker claims database jobs using conditional updates, lease tokens, bounded retries and fenced commits. It supports pause/resume/cancel/retry and persists events/metrics. Re-extraction creates a new extraction version and superseding evidence, retaining original history. The foundation reviewer conservatively associates explicit professional CV claims and generates `partial`/`unknown` findings and bounded draft questions. It never scores, selects, rejects or hires applicants.

PDF/DOCX uploads are limited to 5 MB with extension/media/signature checks and generated private storage keys. DOCX archive size/entry count and macros are checked before parsing. PDF text preserves actual page numbers; DOCX paragraphs (including tables) preserve paragraph numbers, never invented pages. PDFs are limited to 20 pages. Parsing runs in a subprocess killed after 90 seconds. Malformed/encrypted files produce a controlled error and can be replaced; password-protected PDFs must be unlocked before upload. Originals and previous extraction revisions remain private and unchanged.

Sparse or failed PDF pages individually use the local Tesseract OCR adapter (`backend/ingestion.py`), rendered by PDFium with a 24-megapixel limit and a 20-second recognition timeout. No page images go to the model. Install Tesseract locally (Docker is optional), then put it on PATH or set `TESSERACT_CMD` to the executable path. `OCR_LANG=eng` defaults to English; install the corresponding Tesseract language data before using, for example, `OCR_LANG=eng+ind`. In CMD before starting the worker:

```bat
set TESSERACT_CMD=C:\Program Files\Tesseract-OCR\tesseract.exe
set OCR_LANG=eng
start-worker.cmd
```

Missing Tesseract is recorded as `ocr-unavailable`, not invented extracted text. Mean token confidence below 75 or insufficient recognized text marks a page `uncertain`; these passages are excluded from automated findings. OCR confidence is not factual accuracy. Candidate Overview exposes every extraction revision, per-page method/quality and the correction/reupload route. Exclude an unreadable original with a reason, add an accessible replacement and choose **Reanalyze sources**. The original and earlier evidence stay in history; excluded sources do not enter new association. Real image-only synthetic PDF recognition was verified locally with Tesseract 5.5.3 (95.44 mean token confidence on this fixture, not an accuracy claim).

The worker now calls a configurable server-side OpenAI-compatible analysis adapter for **non-demo organizations**, requiring `OPENAI_API_KEY` and `OPENAI_MODEL`; `OPENAI_BASE_URL` is optional. Compatible providers must support strict Chat Completions JSON Schema outputs. Missing credentials, refusal, truncation, incompatible schemas or invalid citations fail the persisted job with bounded retries; there is no fake-success fallback. An explicitly synthetic organization uses the deterministic demo adapter without network calls. Existing domain tests explicitly inject that deterministic adapter; a separate HTTP mock exercises the real OpenAI SDK request/response boundary without credentials or external network.

Each approved requirement retrieves up to eight lexically relevant, minimized passages from permitted evidence types. The model receives requirement IDs and opaque evidence/extraction IDs, never contact records, raw files or images. Only labelled professional lines are retained; known applicant names/contact details, URLs, explicit personal fields and detected instruction-like lines are excluded. This deliberately misses unlabelled material and is not a complete PII detector or a bias guarantee. Recruiters review omissions and use clarification. The adapter has no tools and treats source text as data. Responses require exact requirement/evidence IDs and contiguous source quotations. Invalid citations reject the result. Automatic CV associations are limited to partial/unknown; supported findings and actual incompatible-statement conflicts require human source review. JSON schema compliance and quote containment do not establish factual truth. Finding revisions persist provider/model/prompt/profile versions, exact citations and extraction version IDs, never keys or hidden reasoning. The request follows [official structured-output documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=chat).

Candidate URLs are optional and **retrieval is disabled**: `fetch_candidate_url` refuses every URL without DNS or HTTP access. There is no environment switch to enable unsafe retrieval. A future enabled adapter must separately implement approved public-host allowlisting, IP/redirect revalidation, SSRF protections and bounded transfers. Uploaded materials remain the default.

Only labelled professional lines enter automatic CV evidence association. Candidate answers remain self-reported. Filtering is conservative and incomplete; it does not eliminate bias. Raw originals/extractions/responses remain private records. Recruiters must exclude irrelevant and protected information when evaluating applicants. Missing/private links, unknown evidence, other repository languages and technology mentions do not establish inability, contradiction, authorship or expertise. The foundation does not fetch applicant URLs or infer personality, honesty, emotion, protected characteristics or learning potential.

Clarification uses one automatic round per approved criteria version and at most three questions, prioritized by essentiality, conflicts/unknowns/partials and material usefulness. Existing detailed evidence and previously asked criteria are checked first. Requirements that cannot accept candidate reports or work samples go directly to recruiter review. The original lifetime cap of two historical rounds per application remains a hard stop; no automatic second round is started to chase unresolved answers. A single recruiter approval authorizes the exact questions, a 1?168-hour response deadline, and zero or one reminder before that deadline. Approval queues the initial invitation; it does not claim delivery. Submission automatically queues a leased worker continuation, independent of the original batch run. No candidate response is generated by any live or demo worker.

Candidate invitation links are short-lived (automatic links at most 24 hours, candidate sessions at most one hour). The approved reminder creates a fresh short-lived invitation within the same question scope; the response deadline does not extend token expiry. Explicit token revocation and changed criteria close access. Submission retries with identical answers return the original receipt; changed resubmissions require an append-only factual correction. General portal access closes on submission, while the same unexpired session may read its own receipt or append one correction per answer before the deadline. That exception does not grant other candidate/recruiter reads. Further corrections require recruiter assistance.

Raw submitted answers remain immutable candidate-reported evidence. The bounded update policy requires concrete, requirement-linked, first-person action detail before changing an unknown finding to partial. Weak, declined, missing or inadmissible answers stay unresolved. Protected/contact/instruction-like lines are excluded from that check; conservative checks can miss useful detail and do not verify truth or eliminate bias. Uploaded private artifacts are labeled artifact-backed for their presence; contents, authorship and expertise remain unverified. All changes append revisions with before/after state, new evidence IDs and source provenance. A review-ready brief retains remaining uncertainties and interview follow-ups. No response is recorded as unresolved evidence, never inability.

## Review to interview

Generate an editable source-linked interview brief from approved requirements, stored observations, remaining questions and exact evidence references. References use authenticated document endpoints or response IDs; a source without page/paragraph metadata gets no invented locator. Save a draft, edit it, then approve that brief separately. Recruiters record shortlist, reject or request-more-information decisions with reasons. Hiring decisions remain human.

In the candidate Interview tab, create a versioned interview plan with the exact operational recipient, subject/body, confirmation/cancellation drafts, duration, buffers, interviewers, working hours, IANA timezone and dated scheduling horizon. A second explicit approval authorizes that exact content/policy/version and zero or one reminder. It does not reuse clarification authorization. Recipient changes, edited content or expanded constraints require a new immutable plan version and renewed approval. Ambiguous or running provider actions must be reconciled before replacing the approved version. The old slot-only booking approval endpoint returns 409; existing historical records are retained.

The private scheduling portal lets the candidate offer dated windows and explicitly select a dated option. Expressions such as 'Thursday afternoon' require confirmation; no time is silently guessed. Asia/Jakarta is the default IANA zone. The API rejects nonexistent local times and ambiguous daylight-saving times without an explicit matching UTC offset. Scheduling intersects the candidate windows, all interviewer working hours, duration, buffers and calendar availability. Conflicts produce alternatives and require another explicit selection. Rescheduling updates the existing provider event with an ETag condition and sends one confirmation per accepted change. Cancellation/withdrawal reconciles the same event and queues one approved cancellation message. Interviewer calendars supply free/busy information. When the approved notification setting is enabled, Google adds only the approved interviewers as event attendees and sends them calendar invitations/updates. The candidate is deliberately not a Google attendee and receives only the approved Resend messages. When disabled, give interviewers access to the organizer calendar. Existing busy time on non-owned interviewer calendars is treated conservatively during overlapping reschedules because free/busy does not identify the event.

The worker persists queued, provider-accepted, delivery-unknown, failed, disconnected/expired-credential and simulated results separately. A provider timeout never claims successful delivery or failure. Google retries GET the stored stable event ID and action/plan markers before any write; accepted inserts/updates/deletes are recovered without a second event or confirmation. The last provider read before a calendar write is a fresh availability query. Google offers no atomic free/busy-and-insert transaction, so an external actor can still book between those calls. Email retries reuse the exact payload and Resend key within the safe retention window; older unknown email outcomes require manual provider reconciliation. No email delivered/read state or delivery webhook is implemented.

### Google OAuth setup

Docker is optional. In both API and worker CMD environments set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, a stable `SESSION_SECRET` and `TOKEN_ENCRYPTION_KEY`. Generate the encryption key privately with:

```cmd
.venv\Scripts\python.exe -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

Keep the key outside source control and shared by API/worker. Losing it makes stored tokens unreadable; retain it securely with database backups and rotate it through a controlled decrypt/re-encrypt procedure. LIVE refuses to store OAuth tokens without a configured encryption key. Local DEMO derives a development-only encryption key and never calls live providers.

Create a Google Cloud **Web application** OAuth client, enable the Calendar API, configure the consent screen and add dedicated **test users**. Register the exact callback URI, for example `http://127.0.0.1:8000/api/v1/oauth/google/callback` for loopback development or your HTTPS API callback for staging. Set `PUBLIC_APP_URL` to the actual app origin; LIVE email requires HTTPS. Use `COOKIE_SECURE=false` only for loopback HTTP and true for HTTPS. The CMD scripts inherit environment variables and do not auto-load `.env`; Compose consumes `.env`.

Requested scopes are `calendar.events.owned` (read/create/update/delete events on calendars owned by the connected account), `calendar.events.freebusy` (availability on accessible interviewer calendars), plus `openid email` to bind the verified Google account and prevent accidental account switching during active bookings. No full-calendar, contacts or profile/name scope is requested. In Settings, save the owned organizer calendar ID (`primary` by default), then choose **Connect Google Calendar** as an organization admin. OAuth state is one-time, expires in ten minutes, is bound to the admin session/browser, and uses PKCE. Access/refresh tokens and PKCE verifiers stay Fernet-encrypted server-side; credentials never enter browser storage or API responses. Callback query codes are redacted from access logging. Refresh/revocation failures produce explicit reconnect states; disconnect invalidates credentials locally and reports whether remote revocation was confirmed. A different Google account cannot replace an existing binding while coordination is active, even after local disconnect.

Google uses `sendUpdates=all` only for the approved interviewer attendees (or `none` when that notification option is disabled and no previous attendee updates are needed). Event title, description and notification policy are included in the approved version; external participant changes become a conflict rather than a notification to an unapproved address. The candidate is excluded from Google attendees; the single Resend adapter handles candidate messages. The Google Calendar implementation follows [scope guidance](https://developers.google.com/workspace/calendar/api/auth), [server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server), [account identity](https://developers.google.com/identity/openid-connect/openid-connect), and [ETag/idempotency guidance](https://developers.google.com/workspace/calendar/api/guides/version-resources).

For live clarification and interview email, create an organization **email** provider connection in Settings with a verified `from_email`. Set these in the API/worker environment (CMD scripts do not auto-load `.env`; Compose consumes it):

```cmd
set PUBLIC_APP_URL=https://your-saring-host.example
set SARING_PROVIDER_ORGANIZATIONUUIDWITHOUTDASHES_EMAIL=your-resend-api-key
```

Use the exact `SARING_PROVIDER_<ORG_UUID_WITHOUT_DASHES_UPPERCASE>_EMAIL` variable name shown by the organization credential convention. Supply the real key server-side only. Resend must have the sender domain verified. The adapter calls the fixed HTTPS Resend endpoint with no redirects, a 20-second timeout, an immutable payload and a stable idempotency key. It stops automatic replay after 23 hours to stay within Resend's documented 24-hour idempotency retention; an ambiguous older attempt requires reconciliation. No live model/email/calendar credentials were exercised here. See [Resend idempotency documentation](https://resend.com/docs/dashboard/emails/idempotency-keys) and [send-email contract](https://resend.com/docs/api-reference/emails/send-email).

To demonstrate the actual loop locally without Docker: start the API, worker and web CMD scripts; choose **Load clarification example** on Vacancies; run the agent; open **Synthetic Support Applicant / Clarification**; inspect and approve the complaint question and reminder policy. When the persisted DEMO mailbox appears, open **Open demo candidate portal** in a separate browser profile, continue with the private invitation, and supply your synthetic example. You may decline or choose an alternative. Saving a draft is not submission. Confirm submission, then return to HR: the worker updates findings and the review-ready brief automatically. The browser test enters a concrete complaint example, verifies unknown to partial with a candidate-reported response citation, and appends a factual correction. No email is transmitted in DEMO.

## Optional Docker/PostgreSQL

```cmd
copy .env.example .env
docker compose up --build
```

Open **http://localhost:8080**. Compose explicitly overrides the SQLite default with its PostgreSQL connection, runs migrations first, and mounts private file/session volumes. Only the web port is exposed on loopback. The supplied PostgreSQL password is for local development. Docker is not installed here, so Compose/PostgreSQL execution is unverified; direct CMD/SQLite API, worker, migrations and browser flow were exercised.

## API and checks

See [API_CONTRACT.md](API_CONTRACT.md) for frontend integration, CSRF/session flow, pagination, schemas, state transitions and endpoint groups. OpenAPI is available at `/openapi.json` while the API runs.

```cmd
npm.cmd run build
.venv\Scripts\python.exe -m pytest backend -q
npm.cmd run test:e2e
```

Browser tests need all three local processes, an installed Chrome browser and the worker's OCR runtime for the scan test. The opt-in restart test is excluded from the normal run: stop the normal worker, then run `set SARING_RESTART_E2E=1` and `npm.cmd run test:e2e -- tests/restart.spec.ts`; it owns/restarts its worker and induces lease expiry after an actual process crash. For the real OCR backend test set `TESSERACT_CMD` and `TESSDATA_PREFIX` in the test CMD environment too; otherwise that one test explicitly skips. Tests use only synthetic applicant data. See [docs/TEST_REPORT.md](docs/TEST_REPORT.md) for exact outcomes and limitations.

No deployment, real applicant communication or credentialed provider validation has been performed. Enterprise deployment still needs operational choices for identity onboarding/password recovery, HTTPS, secret rotation, storage encryption, malware/process isolation, quotas, backups, retention/erasure policy and PostgreSQL concurrency/load testing. Do not commit secrets, original applicant files or databases.


### Interview demo and live verification status

Without Docker, start the three CMD launchers. Load the synthetic Customer Support example, run analysis, record a human shortlist, and open Interview. Generate/save/approve a brief, draft an interview plan and inspect the full invitation approval dialog. After approval, open **Open demo scheduling portal** in a separate browser profile. Offer explicit availability, select and confirm a dated option, then select a different option to reschedule. HR can cancel the same event. DEMO uses isolated database fixtures/mailboxes and makes no Google or Resend request, even if live credentials happen to exist in the environment.

Live test-account checks **did not run**: no Google OAuth client/test-account consent or Resend test-domain credentials were provided. Automated HTTP mocks exercise OAuth exchange/refresh/expiry, Google free/busy and event CRUD/timeout reconciliation, and Resend idempotency. They validate application/provider contract handling, not a real Google/Resend deployment or inbox delivery. Required live checks: consent with a dedicated Google test user, successful refresh, free/busy on an accessible test interviewer calendar, booking/conflict/rescheduling/cancellation on an owned test calendar, and Resend provider-accepted IDs using approved test recipients. PostgreSQL/Compose concurrency remains unverified; real local Tesseract recognition is now verified on synthetic scans.
# Persistent execution and retention (schema 009)

Verified locally: 83 backend tests, seven browser scenarios, two additional focused cursor/reconnection checks, migration round-trip and the production build passed. Live provider accounts, PostgreSQL/Compose concurrency and production load remain unverified. Detailed results and changed files are in `IMPLEMENTATION_STATUS.md`.

Workers persist separate per-application analysis jobs, clarification continuations and interview outbox actions. Batch `WorkflowRun.done` means its analysis jobs committed; it does not mean every candidate answered or every interview finished. Candidate and HR waits are durable workflow states and hold no worker lease. A response submission queues its continuation in the same transaction.

Claims use database compare-and-set leases and fencing tokens. Analysis, clarification, email and calendar attempts have durable start/heartbeat/finish records; retries use bounded exponential delays (2, 4, 8 seconds, three automatic attempts). Explicit recruiter retry preserves attempt history while authorizing a new bounded retry cycle. Analysis jobs have an operation uniqueness constraint over organization/run/application/kind. A heartbeat extends only the current owner's lease; final commits check ownership. SQLite serializes writes, so a heartbeat can be delayed by its main transaction; PostgreSQL multi-worker concurrency still needs deployment-specific validation. A crashed process cannot provide its exact last processing duration, so interrupted attempts are excluded from measured processing totals.

External actions are persisted transactionally with their approval/continuation. Calendar retries reconcile the stable provider event ID and approved content before mutation. Email retries reuse the frozen request and provider idempotency key within the safe provider window. Uncertain acceptance is `delivery_unknown`; exhaustion stops for attention, and never proves failure, delivery or reading. Third-party APIs do not provide an end-to-end exactly-once guarantee. Withdrawal cancels pending analysis and messaging; existing or uncertain bookings retain cleanup identifiers until cancellation is reconciled. An already in-flight provider request cannot be recalled by a database state change.

The activity feed uses authenticated `/api/v1/events/changes` cursor polling with reconnect/backoff and persisted history. Cursor timestamps are allocated at commit under a tenant lock and advance monotonically; rollback discards pending events. The browser rebuilds an authorized tail if erasure removes its cursor. New execution events show application/run, controlled tool/result/error code, attempt and observed duration. Routine metadata admits only a closed set of fields: no candidate passages, raw prompts, credentials, invitation tokens or request payloads. React renders source/model text as escaped text, without HTML/markdown execution. Private documents remain behind scoped download endpoints. `/api/v1/execution-attempts` is recruiter-only, paginated, organization-scoped and never exposes lease tokens.

Metrics distinguish processing observations, interrupted attempts, current approval/candidate waits, retries, review-ready workflows, clarification counts and current evidence gaps. `supported` observations and gap-resolution transitions measure recorded evidence states, not candidate accuracy or hiring success. Token counters require provider usage; cost additionally requires matching `MODEL_PRICE_MODEL`, `MODEL_INPUT_USD_PER_MILLION` and `MODEL_OUTPUT_USD_PER_MILLION`. USD cost is explicitly estimated. Counters cover committed analysis/clarification calls, not failed/rolled-back calls that a provider may still bill. No billing-ledger completeness, HR active-review time, manual baseline or efficiency percentage is claimed.

Retention is an explicit offline administrative maintenance operation; stop the API and workers first, resolve any calendar cancellation/uncertainty, and use a restricted database/filesystem maintenance account. It is not exposed as a browser mutation. `RETENTION_WITHDRAWN_DAYS` defaults to 365; legal holds and organization policy must be handled before invoking maintenance. The command is a dry run unless `--execute` is supplied:

```cmd
.venv\Scripts\python.exe -m backend.retention --organization ORGANIZATION_UUID
.venv\Scripts\python.exe -m backend.retention --organization ORGANIZATION_UUID --execute
.venv\Scripts\python.exe -m backend.retention --organization ORGANIZATION_UUID --application APPLICATION_UUID --execute
.venv\Scripts\python.exe -m backend.retention --organization ORGANIZATION_UUID --cleanup-files
```

Only withdrawn applications can be erased; explicit `--application` bypasses the age threshold, not withdrawal or unresolved-provider checks. A tenant-scoped dependency walk removes originals' database metadata, extraction revisions, source passages, derived evidence/findings, candidate answers/drafts/corrections, briefs, invitation sessions, approved messages, action history and application-tagged model metrics. Shared candidate contacts are removed only after their last application. A short-lived maintenance grant permits DELETE through immutable-history guards in that transaction; ordinary UPDATE/DELETE protection remains. Grant tables/maintenance credentials must never be writable by an untrusted direct database user.

Original files are queued transactionally for deletion, then unlinked through resolved-path checks confined to private storage. The worker also resumes pending file cleanup after restart; three bounded attempts use exponential delays before `needs_attention`. Failed paths retain only a controlled error; operators can explicitly retry with `--cleanup-files --retry-files` after correcting permissions/configuration. SQLite CLI maintenance enables secure deletion and runs VACUUM. This is logical application erasure, not a guarantee of physical media sanitization. Backups, snapshots, WAL/replicas, exported reports, administrator copies, provider-held email/calendar/model data and upstream logs have separate retention obligations. Restore procedures must reapply erasures before exposing restored data. No remote-provider erasure or automatic legal-hold discovery is claimed. No candidate URL cache exists because URL retrieval remains disabled. Other active applications and historical vacancy criteria are preserved.
