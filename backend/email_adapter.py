"""Resend REST adapter with provider idempotency. Demo never calls HTTP."""
import os
import re
from datetime import datetime, timezone
from urllib.parse import urlsplit
import httpx
from sqlalchemy import select
from backend import models as m
from backend.db import now
from backend import clarification as loop


def send_message(s,org_id,key,to,sender,subject,text,first_attempt_at,origin):
    """Shared real Resend adapter for approved interview messages, explicit demo boundary."""
    from backend.google_oauth import CalendarConfiguration, ExpiredCredential
    if s.get(m.Organization,org_id).is_demo:
        import hashlib
        return {"id":"demo-"+hashlib.sha256(key.encode()).hexdigest()[:24],"mode":"demo"}
    connection=s.scalar(select(m.ProviderConnection).where(m.ProviderConnection.org_id==org_id,m.ProviderConnection.provider=="email"))
    credential=os.getenv(connection.credential_ref) if connection else None
    if not credential or not sender:raise CalendarConfiguration("Organization Resend credential or verified sender is not configured")
    public=urlsplit(origin)
    if public.scheme!="https" or not public.hostname or public.username or public.password or public.query or public.fragment:
        raise CalendarConfiguration("Live interview invitations require an HTTPS PUBLIC_APP_URL")
    if not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+",to):raise CalendarConfiguration("Approved recipient is not a valid email address")
    if not first_attempt_at or now()-first_attempt_at>=23*3600:
        raise httpx.TransportError("Provider idempotency retention window expired; manual reconciliation required")
    with httpx.Client(timeout=20,follow_redirects=False) as client:
        response=client.post("https://api.resend.com/emails",headers={"Authorization":"Bearer "+credential,"Idempotency-Key":key},
            json={"from":sender,"to":[to],"subject":subject,"text":text})
        if response.status_code in (401,403):raise ExpiredCredential("Email provider credential expired or sender access denied")
        if response.status_code>=500:raise httpx.TransportError("Email provider result is uncertain; reconcile using the same idempotency key")
        response.raise_for_status()
        id=response.json().get("id")
        if not isinstance(id,str):raise httpx.TransportError("Email provider acceptance could not be established")
    return {"id":id,"mode":"live"}


def send(s, row, org):
    workflow = s.scalar(select(m.ClarificationWorkflow).where(m.ClarificationWorkflow.round_id == row.round_id).with_for_update())
    round = s.get(m.ClarificationRound, row.round_id)
    a = s.get(m.Application, row.application_id)
    if not workflow or not workflow.approved_at or not round or round.state != "approved" or a.reassessment_required or a.withdrawn_at or a.requirement_version_id != workflow.requirement_version_id:
        return "cancelled", "Approval scope is no longer active"
    if not workflow.deadline or now() >= workflow.deadline:
        return "cancelled", "Response deadline passed; no email sent"
    invitation = s.get(m.CandidateInvitation, row.payload.get("invitation_id"))
    if not invitation or invitation.revoked_at:
        return "cancelled", "Invitation is no longer active"
    if invitation.redeemed_at:
        return "cancelled", "Candidate has opened the portal; no additional invitation email sent"
    if invitation.expires_at <= now():
        return "needs_attention", "Invitation expired; recruiter must explicitly reissue access"
    if org.is_demo:
        workflow.state = "waiting"
        a.review_state = "awaiting_response"
        return "simulated", "Synthetic mailbox only; no email transmitted"
    candidate = s.get(m.Candidate, a.candidate_id)
    if candidate.email and candidate.email != row.payload.get("to"):
        return "needs_attention", "Operational email changed after approval; reconcile the approved recipient before sending"
    connection = s.scalar(select(m.ProviderConnection).where(m.ProviderConnection.org_id == org.id, m.ProviderConnection.provider == "email"))
    key = os.getenv(connection.credential_ref) if connection else None
    if not key or not row.payload.get("from"):
        return "not_configured", "Organization Resend API key or verified from_email not configured"
    if not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+", row.payload.get("to", "")):
        return "needs_attention", "Candidate operational email missing or invalid"
    public = urlsplit(os.getenv("PUBLIC_APP_URL", ""))
    if public.scheme != "https" or not public.hostname or public.username or public.password or public.query or public.fragment:
        return "not_configured", "PUBLIC_APP_URL must be an HTTPS application origin for live invitations"
    # Do not replay uncertain sends after the provider's 24h idempotency retention.
    if now() - row.created_at >= 23 * 3600:
        return "needs_attention", "Safe provider retry window closed; reconcile delivery before any new action"
    text = ("Please clarify the following approved job-related questions in your private application portal. "
        "You may decline or offer an alternative.\n\n" + "\n".join(row.payload["questions"]) +
        "\n\nResponse deadline (UTC): " + datetime.fromtimestamp(row.payload["deadline"], timezone.utc).isoformat() +
        "\n" + loop.portal_link(invitation.id) + "\nThis invitation expires; contact your recruiter if access has expired.")
    # Same immutable payload and idempotency key on every retry. No redirects or URL from candidate data.
    with httpx.Client(timeout=20, follow_redirects=False) as client:
        response = client.post("https://api.resend.com/emails", headers={"Authorization": "Bearer " + key, "Idempotency-Key": row.idempotency_key},
            json={"from": row.payload["from"], "to": [row.payload["to"]], "subject": "Application evidence clarification", "text": text})
        response.raise_for_status()
        if not isinstance(response.json().get("id"), str):
            raise httpx.TransportError("Email provider did not confirm acceptance")
        row.payload = {**row.payload, "provider_message_id": response.json()["id"]}
    workflow.state = "waiting"
    a.review_state = "awaiting_response"
    return "completed", "Email provider accepted the request; inbox delivery is not confirmed"
