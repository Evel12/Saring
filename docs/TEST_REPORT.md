# Verification report — 2026-10-30

All applicant material used below is synthetic. This report distinguishes real local tools, deterministic demo adapters and mocked live-provider transport. No public deployment, real applicant communication, live model completion or credentialed Google/Resend test-account request ran.

## Results

| Check | Actual outcome |
|---|---|
| Backend suite, `python -m pytest backend -q` with OCR environment | **87 passed**, 57.26 seconds; one non-failing Starlette/httpx test-client deprecation warning |
| Final main browser suite against running FastAPI + database + worker | **10 passed**, 3.1 minutes; the opt-in restart case explicitly skipped in this normal run and passed separately |
| Separate opt-in worker-restart browser journey, normal worker stopped | **1 passed**, 55.4 seconds |
| Focused exploration/screenshots after correcting pending-approval stage | **1 passed**, 45.8 seconds |
| TypeScript/Vite production build | Passed; final JS about 372.47 kB / 108.57 kB gzip, CSS about 49 kB; font files bundled locally |
| Real image-only PDF through PDFium → Tesseract → extraction revision | Passed; Tesseract **5.5.3**, actual page 1, `tesseract-ocr`, `ocr-review`; fixture confidence 95.44 (not accuracy) |
| SQLite startup/schema/migration round-trip | Passed at schema **010**, including legacy preservation and upgrade/downgrade/upgrade |
| `npm audit --json` | Zero known vulnerabilities reported in the installed frontend dependency graph |
| `pip-audit -r backend/requirements.lock --no-deps --disable-pip` | Initially found seven advisory entries for cryptography 46.0.7; upgraded/pinned **50.0.2**, then **no known vulnerabilities found** |
| `python -m pip check` | No broken requirements found |
| Desktop/mobile screenshots | Captured and visually inspected at **1440×1000** and **390×844**; no document-level horizontal overflow in the mobile test |

The OCR Windows university binary download returned HTTP 403. A workspace-only conda-forge Tesseract environment was successfully installed using micromamba instead; no OCR binary/runtime is committed. Python advisory requests and some pytest temporary-directory operations required sandbox escalation. These were environment permissions, not application success fallbacks.

## Requested journeys

**A — Custom Customer Support, end to end.** Through the UI, HR created a custom title, requested explicitly DEMO-proposed criteria, removed/edited criteria and the observable expectation, approved and published. The closed synthetic catalog wrote an actual private DOCX; the real parser preserved paragraph references. HR approved the complaint question, a separate candidate browser submitted a concrete answer, and the worker appended source-linked candidate-reported evidence. HR then recorded shortlist, generated/edited/approved the brief and separately approved the exact interview plan/recipient. Candidate scheduling completed in DEMO, then rescheduled the same event and cancelled it. Actual email/calendar transmission did not occur.

**B — Software Developer.** A second custom vacancy went through suggestions/edit/approval/publication and actual DOCX parsing. Missing optional portfolio/code-sample evidence remained unknown, never conflicting or rejected. HR approved an alternative code-sample/walkthrough question and a separate candidate portal submitted an alternative. The application stayed undecided without human selection. Additional backend cases preserve partial self-reported Go evidence despite mostly Python public projects. Portfolio retrieval is disabled, so no claim of a real GitHub 404/private authorization check is made.

**C — Real OCR and unreadable recovery.** The UI saved an image-only synthetic PDF and ran the actual worker/PDFium/Tesseract path. The Overview showed the actual OCR method, page and quality. A malformed synthetic PDF produced a bounded processing error and a failed review with an explicit correction/reupload message. HR excluded that original with a reason, retained its private download/history, added a readable replacement and reanalyzed successfully. Excluded sources do not enter new association; old history is not rewritten. Low-quality/missing OCR and encrypted/malformed/time-limited documents also have backend cases.

**D — Restart during execution and waits.** The opt-in UI journey started a job, actually terminated the analysis process with exit 73 during model association, induced expiry of that persisted lease (rather than waiting ten minutes), and started an ordinary worker. The UI reached the clarification draft without duplicate findings. The test then stopped/restarted its worker at HR approval and candidate-answer waits. Candidate submission while the worker was stopped persisted; restart resumed evidence updates without repeating the invitation. Backend tests additionally verify attempt interruption history, ownership fencing, bounded retries, duplicate job prevention and lost-lease recovery.

**E — Ambiguity and calendar conflict.** In the candidate portal, “Thursday afternoon” produced confirmation-required with no guessed booking. Explicit dated availability produced options. HR's clearly labelled demo conflict control persisted a synthetic busy interval after lookup. Selecting the now-busy slot failed its immediate worker recheck, produced alternatives and required a fresh explicit candidate selection. Booking then succeeded in the demo adapter. Mocked live Google cases test conflict, insert/update/cancel timeouts, stable event-ID reconciliation, ETags, same-event rescheduling, duplicate clicks and expired credentials. These are not credentialed Google tests.

**F — Isolation and hostile documents.** The UI exploration test used five people across separate Support/Developer applications, rejected another browser tenant's application view, and showed no execution effect or positive promotion from embedded hostile instructions. Backend cases cover recruiter/candidate/organization reads, writes, downloads, scopes, token expiry/revocation/replay, protected-field minimization, source-ID/quotation fabrication, unsupported statuses and CSRF/rate limits. A public DEMO session is an isolated synthetic tenant, not public access to real applicant records. Reset is authenticated/scoped and queues generated originals for deletion.

## Visual inspection and fixes

The three-column dashboard, sticky lowercase brand/theme/state, left vacancy/files panel, center requirements/approvals/candidates and terminal activity panel remain. Mobile stacks the panels and confines the candidate table's scroll to its own container. The first full-page capture retained the current scroll position, placing the sticky header mid-capture; captures were corrected by scrolling to the top and blurring focus before shooting, then re-inspected. The pipeline also initially placed pre-clarification approval at later recruiter review; this was corrected to identify-gaps/clarification approval needed, and the focused UI test and production build passed afterward.

Screenshots are captured in disposable `test-results/` and preserved after final checks at `.runtime/verification/final-desktop.png` and `.runtime/verification/final-mobile.png`; they are local ignored synthetic artifacts, not a deployed site or applicant export. Browser tests retain theme persistence, keyboard candidate navigation, accessible approval dialogs, escaped HTML-like text, drafts, idempotent submissions, disconnected states and cursor recovery.

Final frontend cleanup removed duplicate Google Fonts requests: the actual IBM Plex Sans and JetBrains Mono files and their OFL notices are bundled from Fontsource. Three focused exploration/layout/disconnection cases passed after this change and the exploration test asserts zero Google Fonts/Gstatic requests. A separate settings/reconnection case passed after clarifying that model configuration is server-environment controlled and Resend supports both separately approved workflows. The UI no longer presents stored model metadata as an effective model-selection control.

Finally, the worker was restarted through **`cmd.exe /c start-worker.cmd`** without explicitly supplying OCR variables; its automatic workspace-runtime detection passed the real OCR/replacement and sample-exploration UI cases again (**2 passed**, 26.7 seconds). Final screenshots were preserved after this run. Test API, worker and Vite processes were then stopped; no local process is being presented as a deployed service.

## Remaining blockers and limitations

- **Live model:** supply server-only `OPENAI_API_KEY`, `OPENAI_MODEL`, and optional compatible base URL. Strict structured-output support is required. No provider key was supplied; no real model request ran. Citations/schema checks do not establish factual correctness. Filtering is conservative and incomplete; it can omit relevant material and does not eliminate bias.
- **Google Calendar:** supply a web OAuth client ID/secret, configured redirect URI/test-user consent, shared encryption key and accessible owned test calendar/interviewer free-busy access. No consent or live booking was performed. Free/busy + insertion is not atomic; live race/reconciliation behavior still needs account testing.
- **Resend:** supply organization-specific server API key, verified sender/domain, HTTPS public portal origin and approved test recipients. No real provider-accepted ID, delivered/read event or inbox was observed. Unknown acceptance outside the provider's safe idempotency window needs manual reconciliation. Exactly-once external delivery is not promised.
- **Deployment:** Docker was unavailable; PostgreSQL/Compose concurrency, Nginx/CSP runtime, hosted HTTPS, production load, backup restoration and network/process malware isolation remain unverified. Setup/deployment instructions are supplied; nothing was published.
- **Operations/security:** advisory scans are snapshots, not a security audit. Hosted use needs onboarding/password recovery, edge quotas/abuse monitoring, secrets/storage encryption, malware isolation and operational validation. Local original deletion cannot erase backups, exports, replicas, provider copies or physical media. Legal holds and restored-data erasure require operator procedures.
- **Metrics:** processing excludes approval/candidate waits and unknown crash durations. Usage/cost covers committed provider-reported calls with configured prices; rolled-back calls may still be billed. HR active time/manual baselines are not instrumented. Coverage is neither accuracy nor hiring-success probability.

Commands and repeatable demonstration: [README](../README.md), [demo script](DEMO_SCRIPT.md), [architecture](ARCHITECTURE.md), [deployment](DEPLOYMENT.md), [API contract](../API_CONTRACT.md).
