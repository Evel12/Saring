"""Argon2 passwords, signed cookies, revocable server sessions and scoped invitations."""

import os, secrets, hashlib
from dataclasses import dataclass
from pathlib import Path
from fastapi import Depends, HTTPException, Request
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from pwdlib import PasswordHash
from backend.db import Session, get_db, now
from backend import models as m

passwords = PasswordHash.recommended()
DUMMY_HASH = passwords.hash(secrets.token_urlsafe(32))
MODE = os.getenv("SARING_MODE", "demo")
if MODE not in ("demo", "live"):
    raise RuntimeError("SARING_MODE must be demo or live")
ORIGINS = [
    v.strip()
    for v in os.getenv(
        "ALLOWED_ORIGINS",
        "http://127.0.0.1:5173,http://localhost:5173,http://127.0.0.1:8080,http://localhost:8080",
    ).split(",")
    if v.strip()
]
if "*" in ORIGINS:
    raise RuntimeError("Explicit ALLOWED_ORIGINS required")


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def secret_key():
    key = os.getenv("SESSION_SECRET")
    if key and len(key) >= 32:
        return key
    if MODE == "live":
        raise RuntimeError(
            "Set SESSION_SECRET to at least 32 random characters in LIVE"
        )
    path = Path(".runtime/session.key")
    path.parent.mkdir(exist_ok=True)
    try:
        with path.open("x") as f:
            f.write(secrets.token_urlsafe(48))
    except FileExistsError:
        pass
    return path.read_text().strip()


def csrf(request: Request):
    origin = request.headers.get("origin")
    if origin and origin not in ORIGINS:
        raise HTTPException(403, "Origin not allowed")
    supplied = request.headers.get("x-csrf-token", "")
    if not supplied or not secrets.compare_digest(
        supplied, request.session.get("csrf", "")
    ):
        raise HTTPException(403, "CSRF token missing or invalid")


def csrf_value(request):
    if not request.session.get("csrf"):
        request.session["csrf"] = secrets.token_urlsafe(32)
    return request.session["csrf"]


def rate_limit(request, label, limit=15, window_seconds=300, identity=""):
    key = digest(
        label
        + ":"
        + (request.client.host if request.client else "unknown")
        + ":"
        + identity
    )
    window = int(now() // window_seconds)
    with Session() as s:
        bucket = s.get(m.RateLimitBucket, (key, window))
        if not bucket:
            try:
                s.add(m.RateLimitBucket(key=key, window=window, count=0))
                s.commit()
            except IntegrityError:
                s.rollback()
        count = s.scalar(
            update(m.RateLimitBucket)
            .where(m.RateLimitBucket.key == key, m.RateLimitBucket.window == window)
            .values(count=m.RateLimitBucket.count + 1)
            .returning(m.RateLimitBucket.count)
        )
        s.commit()
    if count > limit:
        raise HTTPException(
            429,
            "Too many attempts; retry later",
            headers={"Retry-After": str(window_seconds)},
        )


@dataclass
class Principal:
    org_id: str
    user_id: str | None
    role: str
    session_id: str
    application_id: str | None = None
    invitation_id: str | None = None
    scopes: tuple = ()


def principal(request: Request, s=Depends(get_db)):
    token = request.session.get("sid", "")
    row = (
        s.scalar(
            select(m.AuthSession).where(
                m.AuthSession.token_hash == digest(token),
                m.AuthSession.expires_at > now(),
                m.AuthSession.revoked_at.is_(None),
            )
        )
        if token
        else None
    )
    if not row:
        raise HTTPException(401, "Authentication required")
    if row.user_id:
        user = s.get(m.User, row.user_id)
        org_id = request.headers.get("x-organization-id", row.org_id)
        member = s.scalar(
            select(m.Membership).where(
                m.Membership.org_id == org_id,
                m.Membership.user_id == row.user_id,
                m.Membership.active == True,
            )
        )
        if not user or not user.active or not member:
            raise HTTPException(403, "Organization membership required")
        return Principal(org_id, row.user_id, member.role, row.id)
    invitation = s.get(m.CandidateInvitation, row.invitation_id)
    if not invitation or invitation.revoked_at or invitation.expires_at <= now():
        raise HTTPException(401, "Candidate invitation expired or revoked")
    if request.headers.get("x-organization-id", row.org_id) != row.org_id:
        raise HTTPException(403, "Candidate scope cannot change organizations")
    return Principal(
        row.org_id,
        None,
        "candidate",
        row.id,
        row.application_id,
        row.invitation_id,
        tuple(row.scopes),
    )


def recruiter(p=Depends(principal)):
    if p.role not in ("admin", "recruiter"):
        raise HTTPException(403, "Recruiter role required")
    return p


def admin(p=Depends(recruiter)):
    if p.role != "admin":
        raise HTTPException(403, "Administrator role required")
    return p


def candidate(p=Depends(principal)):
    if p.role != "candidate":
        raise HTTPException(403, "Candidate session required")
    return p


def submission_candidate(request: Request, s=Depends(get_db)):
    """Only receipt retries/corrections may use a closed submitted invitation.

    General candidate endpoints still reject revoked sessions. This is not a new
    bearer credential and does not bypass expiry, tenant or application checks.
    """
    handle = request.session.get("sid", "")
    row = s.scalar(select(m.AuthSession).where(m.AuthSession.token_hash == digest(handle), m.AuthSession.expires_at > now(), m.AuthSession.revoked_at.is_(None))) if handle else None
    if not row or row.user_id or not row.invitation_id:
        raise HTTPException(401, "Active candidate submission session required")
    inv = s.get(m.CandidateInvitation, row.invitation_id)
    if not inv or inv.expires_at <= now():
        raise HTTPException(401, "Candidate invitation expired")
    if inv.revoked_at:
        submitted = s.scalar(select(m.ClarificationSubmission.id).where(m.ClarificationSubmission.round_id == inv.round_id, m.ClarificationSubmission.application_id == row.application_id))
        if not submitted:
            raise HTTPException(401, "Candidate invitation revoked")
        workflow = s.scalar(select(m.ClarificationWorkflow).where(m.ClarificationWorkflow.round_id == inv.round_id, m.ClarificationWorkflow.org_id == row.org_id))
        action = s.scalar(select(m.ClarificationAction).where(m.ClarificationAction.workflow_id == workflow.id, m.ClarificationAction.action_key == "submission")) if workflow else None
        if not action or action.result.get("invitation_id") != inv.id or action.result.get("closed_revoked_at") != inv.revoked_at:
            raise HTTPException(401, "Candidate invitation explicitly revoked")
    if request.headers.get("x-organization-id", row.org_id) != row.org_id:
        raise HTTPException(403, "Candidate scope cannot change organizations")
    return Principal(row.org_id, None, "candidate", row.id, row.application_id, row.invitation_id, tuple(row.scopes))


def require_scope(p, scope):
    if scope not in p.scopes:
        raise HTTPException(403, "Invitation does not grant this permission")


def login_session(s, request, org_id, user_id=None, invitation=None):
    old = request.session.get("sid")
    if old:
        s.execute(
            update(m.AuthSession)
            .where(m.AuthSession.token_hash == digest(old))
            .values(revoked_at=now())
        )
    token = secrets.token_urlsafe(32)
    row = m.AuthSession(
        org_id=org_id,
        user_id=user_id,
        token_hash=digest(token),
        application_id=invitation.application_id if invitation else None,
        invitation_id=invitation.id if invitation else None,
        scopes=invitation.scopes if invitation else [],
        expires_at=(
            min(now() + 3600, invitation.expires_at) if invitation else now() + 8 * 3600
        ),
    )
    s.add(row)
    s.flush()
    request.session.clear()
    request.session.update(sid=token, csrf=secrets.token_urlsafe(32))
    return row


def invitation_for(s, token, allow_redeemed=False):
    inv = s.scalar(
        select(m.CandidateInvitation).where(
            m.CandidateInvitation.token_hash == digest(token),
            m.CandidateInvitation.expires_at > now(),
            m.CandidateInvitation.revoked_at.is_(None),
        )
    )
    if not inv or (inv.redeemed_at and not allow_redeemed):
        raise HTTPException(404, "Invitation expired, revoked or already redeemed")
    return inv
