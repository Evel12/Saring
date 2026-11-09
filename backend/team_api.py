"""HR team accounts: admins invite members by link, everyone sets their own password.

Tokens are random, stored only as SHA-256, valid 7 days, single use and
revocable. Public preview/accept take the token in the POST body so it never
lands in access logs, and every failure returns the same generic 404.
"""
import secrets
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import Field
from sqlalchemy import func, select, update
from typing import Literal
from backend import api, auth, models as m, schemas as d, services as svc
from backend.db import get_db, now

router = APIRouter(prefix="/api/v1", dependencies=[Depends(api.mutations)])
INVITE_TTL = 7 * 24 * 3600
NOT_VALID = "Invitation not valid"


class InviteInput(d.Input):
    email: str = Field(min_length=3, max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    display_name: str = Field(min_length=1, max_length=160)
    role: Literal["admin", "recruiter"] = "recruiter"


class TokenInput(d.Input):
    token: str = Field(min_length=10, max_length=200)


class AcceptInput(TokenInput):
    display_name: str | None = Field(default=None, max_length=160)
    password: str = Field(min_length=1, max_length=256)


def create_team_invitation(s, org_id, email, display_name, role, invited_by):
    """Shared by the team page, the platform console and the CLI."""
    email = email.strip().lower()
    user = s.scalar(select(m.User).where(m.User.email == email))
    if user:
        member = s.scalar(select(m.Membership).where(
            m.Membership.org_id == org_id, m.Membership.user_id == user.id))
        if member and member.active:
            raise HTTPException(409, "Email ini sudah menjadi anggota aktif")
    # One pending invitation per (organization, email).
    s.execute(update(m.TeamInvitation).where(
        m.TeamInvitation.org_id == org_id, m.TeamInvitation.email == email,
        m.TeamInvitation.accepted_at.is_(None), m.TeamInvitation.revoked_at.is_(None),
    ).values(revoked_at=now()))
    token = secrets.token_urlsafe(32)
    inv = m.TeamInvitation(org_id=org_id, email=email, display_name=display_name.strip(),
        role=role, token_hash=auth.digest(token), invited_by=invited_by,
        expires_at=now() + INVITE_TTL)
    s.add(inv)
    s.flush()
    return inv, token


def _public(inv):
    return {"id": inv.id, "email": inv.email, "display_name": inv.display_name,
        "role": inv.role, "expires_at": inv.expires_at, "created_at": inv.created_at}


# --- Organization admin ---

@router.get("/team/members")
def members(p=Depends(auth.admin), s=Depends(get_db)):
    rows = s.execute(
        select(m.Membership, m.User).join(m.User, m.User.id == m.Membership.user_id)
        .where(m.Membership.org_id == p.org_id).order_by(m.Membership.created_at)
    ).all()
    return {"items": [{
        "id": mem.id, "user_id": user.id, "email": user.email, "display_name": user.display_name,
        "role": mem.role, "active": mem.active, "is_you": user.id == p.user_id,
        "created_at": mem.created_at,
    } for mem, user in rows]}


@router.get("/team-invitations")
def invitations(p=Depends(auth.admin), s=Depends(get_db)):
    rows = s.scalars(select(m.TeamInvitation).where(
        m.TeamInvitation.org_id == p.org_id, m.TeamInvitation.accepted_at.is_(None),
        m.TeamInvitation.revoked_at.is_(None), m.TeamInvitation.expires_at > now(),
    ).order_by(m.TeamInvitation.created_at)).all()
    return {"items": [_public(x) for x in rows]}


@router.post("/team-invitations", status_code=201)
def invite(body: InviteInput, p=Depends(auth.admin), s=Depends(get_db)):
    inv, token = create_team_invitation(s, p.org_id, body.email, body.display_name, body.role, p.user_id)
    svc.event(s, p, "team_invitation.created", "Administrator invited a team member.")
    s.commit()
    return {"invitation": _public(inv), "token": token}


@router.post("/team-invitations/{id}/resend")
def resend(id: str, p=Depends(auth.admin), s=Depends(get_db)):
    old = svc.own(s, m.TeamInvitation, id, p)
    if old.accepted_at:
        raise HTTPException(409, "Undangan sudah diterima")
    inv, token = create_team_invitation(s, p.org_id, old.email, old.display_name, old.role, p.user_id)
    svc.event(s, p, "team_invitation.resent", "Administrator re-issued a team invitation link.")
    s.commit()
    return {"invitation": _public(inv), "token": token}


@router.post("/team-invitations/{id}/revoke")
def revoke(id: str, p=Depends(auth.admin), s=Depends(get_db)):
    inv = svc.own(s, m.TeamInvitation, id, p)
    if not inv.accepted_at and not inv.revoked_at:
        inv.revoked_at = now()
        svc.event(s, p, "team_invitation.revoked", "Administrator cancelled a team invitation.")
    s.commit()
    return {"ok": True}


# --- Public: accept an invitation ---

def _valid(s, token):
    inv = s.scalar(select(m.TeamInvitation).where(m.TeamInvitation.token_hash == auth.digest(token)))
    if not inv or inv.accepted_at or inv.revoked_at or inv.expires_at <= now():
        raise HTTPException(404, NOT_VALID)
    org = s.get(m.Organization, inv.org_id)
    if not org or org.status != "active":
        raise HTTPException(404, NOT_VALID)
    return inv, org


@router.post("/auth/team-invitations/preview")
def preview(body: TokenInput, request: Request, s=Depends(get_db)):
    auth.rate_limit(request, "team-invite", 20)
    inv, org = _valid(s, body.token)
    exists = s.scalar(select(func.count()).select_from(m.User).where(m.User.email == inv.email)) > 0
    return {"organization_name": org.name, "email": inv.email, "display_name": inv.display_name,
        "role": inv.role, "account_exists": exists}


@router.post("/auth/team-invitations/accept")
def accept(body: AcceptInput, request: Request, s=Depends(get_db)):
    auth.rate_limit(request, "team-invite", 20)
    inv, _ = _valid(s, body.token)
    auth.rate_limit(request, "team-invite-account", 10, identity=inv.email)
    user = s.scalar(select(m.User).where(m.User.email == inv.email))
    if user:
        if not user.active or not auth.passwords.verify(body.password, user.password_hash):
            raise HTTPException(401, "Password akun salah")
    else:
        if len(body.password) < 12:
            raise HTTPException(422, "Password minimal 12 karakter")
        user = m.User(email=inv.email, display_name=(body.display_name or inv.display_name).strip()[:160],
            password_hash=auth.passwords.hash(body.password))
        s.add(user)
        s.flush()
    claimed = s.execute(update(m.TeamInvitation).where(
        m.TeamInvitation.id == inv.id, m.TeamInvitation.accepted_at.is_(None),
        m.TeamInvitation.revoked_at.is_(None), m.TeamInvitation.expires_at > now(),
    ).values(accepted_at=now(), accepted_user_id=user.id)).rowcount
    if not claimed:
        raise HTTPException(404, NOT_VALID)
    member = s.scalar(select(m.Membership).where(
        m.Membership.org_id == inv.org_id, m.Membership.user_id == user.id))
    if member:  # previously deactivated: re-activate (org_id+user_id is unique)
        member.active, member.role = True, inv.role
    else:
        s.add(m.Membership(org_id=inv.org_id, user_id=user.id, role=inv.role))
    auth.login_session(s, request, inv.org_id, user.id)
    svc.event(s, auth.Principal(inv.org_id, user.id, inv.role, "join"),
        "team_invitation.accepted", "A team member accepted an invitation and joined.")
    s.commit()
    return {"csrf_token": request.session["csrf"], "organization_id": inv.org_id, "role": inv.role}
