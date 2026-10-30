"""Server-side Google OAuth authorization-code flow, PKCE and encrypted refresh tokens."""
import base64
import hashlib
import json
import os
import secrets
from urllib.parse import urlencode, urlsplit
from cryptography.fernet import Fernet, InvalidToken
import httpx
from fastapi import HTTPException
from sqlalchemy import select, update
from backend import models as m, auth
from backend.db import now

SCOPES = ["https://www.googleapis.com/auth/calendar.events.owned", "https://www.googleapis.com/auth/calendar.events.freebusy", "openid", "email"]


class CalendarConfiguration(ValueError):
    pass


class ExpiredCredential(CalendarConfiguration):
    pass


def cipher():
    key = os.getenv("TOKEN_ENCRYPTION_KEY")
    if not key:
        if auth.MODE == "live":
            raise CalendarConfiguration("TOKEN_ENCRYPTION_KEY is required for live OAuth")
        key = base64.urlsafe_b64encode(hashlib.sha256((auth.secret_key()+":oauth-development").encode()).digest())
    try:
        return Fernet(key)
    except Exception:
        raise CalendarConfiguration("Invalid server token encryption key") from None


def encrypt(data):
    return cipher().encrypt(json.dumps(data).encode()).decode()


def decrypt(value):
    try:
        return json.loads(cipher().decrypt(value.encode()))
    except (InvalidToken, ValueError):
        raise CalendarConfiguration("Stored OAuth credentials cannot be decrypted; reconnect") from None


def configuration():
    keys = [os.getenv(k) for k in ("GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI")]
    if not all(keys):
        raise CalendarConfiguration("Google OAuth client ID, client secret and redirect URI are not configured")
    uri = urlsplit(keys[2])
    if uri.scheme != "https" and not (uri.scheme == "http" and uri.hostname in ("localhost", "127.0.0.1")):
        raise CalendarConfiguration("OAuth redirect URI must use HTTPS or loopback HTTP")
    cipher()
    return keys


def start(s, p):
    if s.get(m.Organization, p.org_id).is_demo:
        return {"mode": "demo", "authorization_url": None, "status": "Synthetic calendar; OAuth is never called"}, None
    client_id, _, redirect_uri = configuration()
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(48)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    s.add(m.OAuthAttempt(org_id=p.org_id, user_id=p.user_id, session_id=p.session_id, state_hash=auth.digest(state), encrypted_verifier=encrypt(verifier), expires_at=now()+600))
    url = "https://accounts.google.com/o/oauth2/v2/auth?"+urlencode({"client_id": client_id, "redirect_uri": redirect_uri,
        "response_type": "code", "scope": " ".join(SCOPES), "access_type": "offline", "prompt": "consent",
        "state": state, "code_challenge": challenge, "code_challenge_method": "S256"})
    return {"mode": "live", "authorization_url": url}, state


def finish(s, state, code, cookie):
    if not cookie or not secrets.compare_digest(state, cookie):
        raise HTTPException(403, "OAuth browser state mismatch")
    attempt = s.scalar(select(m.OAuthAttempt).where(m.OAuthAttempt.state_hash == auth.digest(state), m.OAuthAttempt.expires_at > now(), m.OAuthAttempt.used_at.is_(None)).with_for_update())
    if not attempt or s.get(m.Organization, attempt.org_id).is_demo:
        raise HTTPException(400, "OAuth state expired or used")
    session = s.get(m.AuthSession, attempt.session_id)
    member = s.scalar(select(m.Membership).where(m.Membership.org_id == attempt.org_id, m.Membership.user_id == attempt.user_id, m.Membership.active == True, m.Membership.role == "admin"))
    if not session or session.revoked_at or session.expires_at <= now() or not member:
        raise HTTPException(403, "OAuth administrator session is no longer valid")
    user=s.get(m.User,attempt.user_id)
    if not user or not user.active:raise HTTPException(403,"OAuth administrator is inactive")
    client_id, secret, redirect = configuration()
    verifier = decrypt(attempt.encrypted_verifier)
    consumed=s.execute(update(m.OAuthAttempt).where(m.OAuthAttempt.id==attempt.id,m.OAuthAttempt.used_at.is_(None),m.OAuthAttempt.expires_at>now()).values(used_at=now())).rowcount
    if not consumed:raise HTTPException(400,"OAuth state already consumed")
    # Commit single-use state before external token exchange. Failure requires a new flow.
    s.commit()
    with httpx.Client(timeout=20, follow_redirects=False) as client:
        response = client.post("https://oauth2.googleapis.com/token", data={"code": code, "client_id": client_id, "client_secret": secret,
            "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verifier})
        if response.status_code != 200:
            raise CalendarConfiguration("Google OAuth exchange failed; reconnect without sharing provider diagnostics")
        tokens = response.json()
        if tokens.get("access_token"):
            identity=client.get("https://openidconnect.googleapis.com/v1/userinfo",headers={"Authorization":"Bearer "+tokens["access_token"]})
            if identity.status_code!=200:raise CalendarConfiguration("Google account identity could not be established")
            account=identity.json()
            if not account.get("sub") or not account.get("email") or not account.get("email_verified"):
                raise CalendarConfiguration("A verified Google account identity is required for safe reconnects")
            tokens["google_sub"]=account["sub"];tokens["google_email"]=account["email"]
    granted=set(tokens.get("scope", "").split())
    if "https://www.googleapis.com/auth/userinfo.email" in granted:granted.add("email")
    if not set(SCOPES) <= granted or not tokens.get("access_token") or not tokens.get("refresh_token"):
        raise CalendarConfiguration("Google did not grant required scopes/offline refresh access; reconnect with consent")
    connection = s.scalar(select(m.ProviderConnection).where(m.ProviderConnection.org_id == attempt.org_id, m.ProviderConnection.provider == "google_calendar"))
    if not connection:
        connection = m.ProviderConnection(org_id=attempt.org_id, provider="google_calendar", config={"calendar_id": "primary"})
        s.add(connection); s.flush()
    binding=connection.config.get("_google_sub")
    if binding and binding!=tokens.get("google_sub"):
        active=s.scalar(select(m.InterviewCoordination.id).where(m.InterviewCoordination.org_id==attempt.org_id,m.InterviewCoordination.state!="cancelled",m.InterviewCoordination.plan_id.is_not(None)).limit(1))
        if active:raise CalendarConfiguration("A different Google account cannot replace this connection while interview coordination is active; cancel/reconcile with the original account first")
    credential = s.scalar(select(m.OAuthCredential).where(m.OAuthCredential.connection_id == connection.id))
    if credential and not credential.revoked_at:
        previous=decrypt(credential.encrypted_tokens)
        if previous.get("google_sub") and previous["google_sub"]!=tokens.get("google_sub"):
            active=s.scalar(select(m.InterviewCoordination.id).where(m.InterviewCoordination.org_id==attempt.org_id,m.InterviewCoordination.state!="cancelled",m.InterviewCoordination.plan_id.is_not(None)).limit(1))
            if active:raise CalendarConfiguration("A different Google account cannot replace this connection while interview coordination is active; cancel/reconcile with the original account first")
    if not credential:
        credential = m.OAuthCredential(org_id=attempt.org_id, connection_id=connection.id, encrypted_tokens="", expires_at=0)
        s.add(credential)
    credential.encrypted_tokens = encrypt(tokens)
    credential.expires_at = now()+min(int(tokens.get("expires_in", 3600)), 86400)
    credential.revoked_at = None
    connection.config={**connection.config,"_google_sub":tokens["google_sub"],"_google_email":tokens["google_email"]}
    connection.state = "connected"
    s.commit()
    return connection


def access_token(s, org_id):
    if s.get(m.Organization, org_id).is_demo:
        raise CalendarConfiguration("Demo must never request live credentials")
    connection = s.scalar(select(m.ProviderConnection).where(m.ProviderConnection.org_id == org_id, m.ProviderConnection.provider == "google_calendar"))
    credential = s.scalar(select(m.OAuthCredential).where(m.OAuthCredential.connection_id == connection.id).with_for_update()) if connection else None
    if not credential or credential.revoked_at:
        raise CalendarConfiguration("Google Calendar OAuth is disconnected; administrator connection required")
    tokens = decrypt(credential.encrypted_tokens)
    if credential.expires_at > now()+60:
        return tokens["access_token"]
    client_id, secret, _ = configuration()
    with httpx.Client(timeout=20, follow_redirects=False) as client:
        response = client.post("https://oauth2.googleapis.com/token", data={"client_id": client_id, "client_secret": secret, "refresh_token": tokens.get("refresh_token", ""), "grant_type": "refresh_token"})
        if response.status_code in (400,401):
            connection.state = "expired_credential"
            s.commit()
            raise ExpiredCredential("Google refresh authorization expired or revoked; reconnect")
        response.raise_for_status()
        data = response.json()
    if not data.get("access_token"):
        raise ExpiredCredential("Google refresh did not provide an access token")
    tokens.update(data)
    credential.encrypted_tokens = encrypt(tokens)
    credential.expires_at = now()+min(int(data.get("expires_in",3600)),86400)
    connection.state = "connected"
    s.commit()
    return tokens["access_token"]
