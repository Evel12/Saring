# Deployment recipe — not a deployment claim

The application has been run locally with SQLite, API, worker and Vite. No public deployment or PostgreSQL/Compose production validation is claimed.

## Components and release order

1. Provision PostgreSQL with separate database/service credentials, encrypted storage, restricted networking, backups and restore/erasure procedures. Do not use the sample Compose password for a hosted database.
2. Provision a private storage directory/volume shared by API and worker at the same `STORAGE_ROOT`. Only the service account may read/write it. Never map it into the web server's static root or an unauthenticated bucket. Preserve consistent mounts across worker restarts.
3. Install Python 3.12+, runtime dependencies from `backend/requirements.lock`, and Tesseract with required language packs on the worker host. The supplied API image installs English Tesseract. Use dedicated service users and OS process/container resource limits; subprocess deadlines are not a hardened malware sandbox.
4. Supply the API and worker environment from a secret manager or restricted service environment file. Required shared settings: `DATABASE_URL`, `STORAGE_ROOT`, `SARING_MODE=live`, `SESSION_SECRET`, `TOKEN_ENCRYPTION_KEY`, `PUBLIC_APP_URL=https://your-host`, `COOKIE_SECURE=true`, and exact HTTPS `ALLOWED_ORIGINS`. Configure model credentials/model/base URL, Google OAuth web client/redirect URI, and organization Resend credential variables only on the server. `.env.example` documents names; Python does not load `.env` automatically.
5. Stop/drain workers during schema changes; back up first. From the release directory run `python -m alembic upgrade head` once. API startup checks the expected schema (010). Do not start a new worker against an old schema. Keep rollback backups; irreversible external actions cannot be rolled back with a database downgrade.
6. Run the API under a process manager: `python -m uvicorn backend.main:app --host 127.0.0.1 --port 8000`. Run `python -m backend.worker` as a separate restartable service with the identical environment/storage mount. Use graceful stops when possible; leases recover actual process crashes. Begin with one worker; validate PostgreSQL concurrency and lease timeouts before scaling.
7. Build the frontend with `npm ci` then `npm run build`; serve **only `dist/`** through an HTTPS web server. Route `/api/` to FastAPI and all other application routes to `index.html`. The provided `nginx.conf` supplies this for Compose; for a host install replace `api:8000` with `127.0.0.1:8000`. Keep the API and database off the public network. Trust forwarded headers only from your reverse proxy if configuring proxy support.
8. Provision the first administrator interactively with `python -m backend.cli create-admin --organization "Your organization" --email hr@example.org`. Configure provider connections in Settings. Use dedicated Google/Resend test accounts before enabling live coordination; approve exact recipients and policies. A saved configuration is not proof a provider connection works.

## Optional local Compose

Copy `.env.example` to `.env`, then `docker compose up --build`. It starts PostgreSQL, a one-shot migration service, API, worker and web at `http://localhost:8080`. File/session/database volumes persist across normal restarts; only the web port is exposed on loopback. This is a development recipe with a development database password, not a hardened internet deployment. No Docker runtime was available for validation.

## Release verification and operations

Check `/api/health`, login/CSRF, private download denial, own-tenant queries, one small synthetic extraction, source citations, worker attempt history and event reconnection. Confirm unconfigured integrations return truthful disconnected errors. Use the UI to approve a test invite, verify actual provider IDs, force a conflict, reschedule the same event and cancel it. Never use real candidates for a first integration test.

Monitor queue age, failed/unknown actions, expired credentials, processing durations, interrupted attempts, file-deletion attention states and database/storage capacity. Metrics do not imply candidate accuracy or savings. Model cost is only a configured-price estimate of recorded usage, not complete provider billing. Do not log HTTP request bodies, invitation fragments, applicant documents or raw model prompts. Rotate/revoke provider credentials and sessions; back up encryption keys securely or encrypted OAuth tokens will be unrecoverable.

Withdrawn applications stop scheduled sends; uncertain existing bookings must be reconciled/cancelled before retention erasure. Run the documented offline retention command on an approved schedule, respect legal holds externally, and propagate erasure to backups, restored databases, replicas, exports and providers. Unlink/VACUUM is not a guarantee of physical-media sanitization. Direct database roles must not expose erasure grants to untrusted users.

Hosted operation still needs identity onboarding/password recovery policy, malware isolation, rate/quota controls at the edge, secret/storage encryption procedures, abuse monitoring and PostgreSQL/load/restore testing. The application does not claim those operational controls are supplied by a local build.
