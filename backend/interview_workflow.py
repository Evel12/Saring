"""Approval-versioned interview coordination, durable provider actions and candidate selections."""
import hashlib
import hmac
import json
import os
import secrets
from datetime import datetime
from fastapi import HTTPException
from sqlalchemy import select, update, func, or_
import httpx
from backend import models as m, services as svc, auth, scheduling as sched
from backend.db import Session, now, uid
from backend.google_oauth import CalendarConfiguration, ExpiredCredential
from backend import interview_calendar as calendar


def digest(content):return hashlib.sha256(json.dumps(content,sort_keys=True).encode()).hexdigest()


def token(invitation_id):return hmac.new(auth.secret_key().encode(),("interview-invitation:"+invitation_id).encode(),hashlib.sha256).hexdigest()


def link(invitation_id,origin=None):return (origin or os.getenv("PUBLIC_APP_URL") or "http://127.0.0.1:5173").rstrip("/")+"/#invite="+token(invitation_id)


def coordinate(s,a):
    row=s.scalar(select(m.InterviewCoordination).where(m.InterviewCoordination.application_id==a.id))
    if not row:
        id=uid()
        row=m.InterviewCoordination(id=id,org_id=a.org_id,application_id=a.id,provider_event_id="saring"+id.replace("-",""))
        s.add(row);s.flush()
    return row


def assert_current(a,plan):
    if a.withdrawn_at or a.reassessment_required or a.decision!="shortlist" or a.requirement_version_id!=plan.requirement_version_id:
        raise HTTPException(409,"Current human shortlist and approved criteria are required")


def draft(s,p,a,data):
    assert_current(a,type("Version",(),{"requirement_version_id":a.requirement_version_id}))
    start,end=sched.validate_policy(data,now())
    content=data.model_dump(exclude={"client_key","brief_id"})|{"start_epoch":start,"end_epoch":end}
    existing=s.scalar(select(m.InterviewPlan).where(m.InterviewPlan.org_id==p.org_id,m.InterviewPlan.client_key==data.client_key))
    if existing:
        if existing.application_id!=a.id or existing.content_hash!=digest(content) or existing.brief_id!=data.brief_id:
            raise HTTPException(409,"Idempotency key already belongs to different plan content")
        return existing
    if data.brief_id:
        brief=svc.own(s,m.InterviewBrief,data.brief_id,p)
        if brief.application_id!=a.id or brief.requirement_version_id!=a.requirement_version_id:
            raise HTTPException(422,"Brief must belong to the current application review")
    # A new immutable version requires a new authorization; no update-in-place endpoint.
    version=(s.scalar(select(func.max(m.InterviewPlan.version)).where(m.InterviewPlan.application_id==a.id)) or 0)+1
    row=m.InterviewPlan(org_id=p.org_id,application_id=a.id,requirement_version_id=a.requirement_version_id,brief_id=data.brief_id,
        version=version,client_key=data.client_key,content=content,content_hash=digest(content),author_id=p.user_id)
    s.add(row);s.flush();coordinate(s,a)
    svc.event(s,p,"interview.plan_drafted","Immutable interview plan version drafted; invitation authorization required.",a.vacancy_id,a.id)
    return row


def enqueue(s,coord,plan,kind,key,payload):
    row=s.scalar(select(m.InterviewAction).where(m.InterviewAction.coordination_id==coord.id,m.InterviewAction.idempotency_key==key))
    if not row:
        row=m.InterviewAction(org_id=coord.org_id,coordination_id=coord.id,plan_id=plan.id,kind=kind,idempotency_key=key,payload=payload)
        s.add(row);s.flush()
    return row


def mail_payload(s,coord,plan,kind,slot=None):
    connection=s.scalar(select(m.ProviderConnection).where(m.ProviderConnection.org_id==coord.org_id,m.ProviderConnection.provider=="email"))
    return {"to":plan.content["recipient"],"from":connection.config.get("from_email","") if connection else "",
        "subject":plan.content["subject"],"template":plan.content["draft"] if kind in ("invite","reminder") else plan.content["cancellation_draft"] if kind=="cancel_confirmation" else plan.content["confirmation_draft"],
        "invitation_id":coord.invitation_id,"origin":os.getenv("PUBLIC_APP_URL") or "http://127.0.0.1:5173","slot":slot}


def approve(s,p,plan,rationale):
    a=svc.own(s,m.Application,plan.application_id,p);assert_current(a,plan)
    if digest(plan.content)!=plan.content_hash:raise HTTPException(409,"Plan content does not match its immutable digest")
    candidate=s.get(m.Candidate,a.candidate_id)
    if not candidate.email or plan.content["recipient"].casefold()!=candidate.email.casefold():
        raise HTTPException(409,"Recipient differs from the authorized operational contact; correct contact data or draft a new plan")
    latest=s.scalar(select(func.max(m.InterviewPlan.version)).where(m.InterviewPlan.application_id==a.id))
    if latest!=plan.version:raise HTTPException(409,"Approve the latest content/policy version")
    existing=s.scalar(select(m.InterviewAuthorization).where(m.InterviewAuthorization.plan_id==plan.id))
    coord=coordinate(s,a)
    if existing:
        if coord.plan_id!=plan.id:raise HTTPException(409,"This authorization was superseded")
        return coord
    if s.scalar(select(m.InterviewAction.id).where(m.InterviewAction.coordination_id==coord.id,m.InterviewAction.state.in_(["running","delivery_unknown"])).limit(1)):
        raise HTTPException(409,"Reconcile active or uncertain provider actions before changing approved content or recipients")
    if coord.cancel_requested:raise HTTPException(409,"Cancelled coordination cannot be reauthorized; contact the recruiter")
    if not plan.brief_id:raise HTTPException(409,"Save and approve an interview brief before authorizing invitations")
    brief=s.get(m.InterviewBrief,plan.brief_id)
    if brief.state!="approved":raise HTTPException(409,"Interview brief approval is separate and required")
    if plan.content["start_epoch"]<=now():raise HTTPException(409,"Scheduling horizon expired; draft a new plan")
    if coord.plan_id:
        s.execute(update(m.InterviewAction).where(m.InterviewAction.coordination_id==coord.id,m.InterviewAction.state.in_(["queued","not_configured","failed","expired_credential"])).values(state="cancelled"))
        if coord.invitation_id:s.get(m.CandidateInvitation,coord.invitation_id).revoked_at=now()
    connection=s.scalar(select(m.ProviderConnection).where(m.ProviderConnection.org_id==p.org_id,m.ProviderConnection.provider=="google_calendar"))
    calendar_id=connection.config.get("calendar_id","primary") if connection else "primary"
    if coord.booked_slot and calendar_id!=coord.calendar_id:raise HTTPException(409,"Changing the calendar of an existing event requires explicit cancellation first")
    coord.calendar_id=calendar_id;coord.plan_id=plan.id;coord.state="queued"
    coord.candidate_windows=[];coord.offered_slots=[];coord.selected_slot=None;coord.reminders_reserved=0;coord.error=""
    coord.deadline=min(now()+plan.content["response_hours"]*3600,plan.content["end_epoch"])
    coord.reminder_at=now()+plan.content["reminder_hours"]*3600
    inv=m.CandidateInvitation(id=uid(),org_id=p.org_id,application_id=a.id,token_hash="pending",round_id=None,
        scopes=["application:read","interview:schedule"],expires_at=min(now()+86400,coord.deadline))
    inv.token_hash=auth.digest(token(inv.id));s.add(inv);s.flush();coord.invitation_id=inv.id
    authorization=m.InterviewAuthorization(org_id=p.org_id,plan_id=plan.id,actor_id=p.user_id,content_hash=plan.content_hash,
        snapshot={"content":plan.content,"version":plan.version,"requirement_version_id":plan.requirement_version_id,"brief_id":plan.brief_id,"calendar_id":coord.calendar_id},rationale=rationale)
    s.add(authorization)
    svc.approval(s,p,"interview_invite",plan.id,rationale)
    enqueue(s,coord,plan,"invite","invite:"+plan.id,mail_payload(s,coord,plan,"invite"))
    svc.event(s,p,"interview.invite_approved","Recruiter approved exact recipient, draft and scheduling/follow-up policy; invitation queued.",a.vacancy_id,a.id)
    return coord


def candidate_coord(s,p,a):
    auth.require_scope(p,"interview:schedule")
    coord=s.scalar(select(m.InterviewCoordination).where(m.InterviewCoordination.application_id==a.id,m.InterviewCoordination.org_id==p.org_id).with_for_update())
    if not coord or not coord.plan_id:raise HTTPException(404,"No authorized interview coordination")
    inv=s.get(m.CandidateInvitation,p.invitation_id)
    if not inv or inv.id!=coord.invitation_id or coord.cancel_requested:raise HTTPException(409,"Scheduling invitation closed or superseded")
    plan=s.get(m.InterviewPlan,coord.plan_id);assert_current(a,plan)
    return coord,plan


def response_once(s,coord,plan,key,content):
    old=s.scalar(select(m.SchedulingResponse).where(m.SchedulingResponse.coordination_id==coord.id,m.SchedulingResponse.client_key==key))
    if old:
        if old.plan_id!=plan.id or old.content!=content:raise HTTPException(409,"This scheduling key was already used for different content")
        return True
    s.add(m.SchedulingResponse(org_id=coord.org_id,coordination_id=coord.id,plan_id=plan.id,client_key=key,content=content));s.flush()
    return False


def availability(s,p,a,data):
    coord,plan=candidate_coord(s,p,a)
    if coord.state in ("booking_queued","delivery_unknown","cancellation_queued"):
        raise HTTPException(409,"Wait for the active provider action to be reconciled before changing availability")
    if coord.deadline<=now():raise HTTPException(409,"Scheduling response deadline passed; contact your recruiter")
    content=data.model_dump(exclude={"client_key"})
    old=s.scalar(select(m.SchedulingResponse).where(m.SchedulingResponse.coordination_id==coord.id,m.SchedulingResponse.client_key==data.client_key))
    if old:
        if old.plan_id!=plan.id or old.content!=content:raise HTTPException(409,"Scheduling key reused with different availability or authorization version")
        return coord
    if data.expression.strip():
        response_once(s,coord,plan,data.client_key,content)
        coord.state="confirmation_required";coord.error="Ambiguous expression retained as candidate input. Supply explicit dated availability and select a dated option; no booking time was guessed."
        svc.event(s,p,"interview.time_confirmation","Candidate time expression requires explicit dated confirmation; no booking queued.",a.vacancy_id,a.id)
        return coord
    if not data.windows:raise HTTPException(422,"Provide at least one explicit dated availability window")
    windows=[]
    for w in data.windows:
        if set(w)!={"start","end"}:raise HTTPException(422,"Availability windows require only start and end")
        start,end=sched.instant(w["start"],data.timezone),sched.instant(w["end"],data.timezone)
        if not now()<start<end or end-start>7*86400:raise HTTPException(422,"Choose future availability windows of at most seven days")
        windows.append({"start":start,"end":end})
    busy=calendar.busy(s,coord,plan.content,plan.content["start_epoch"]-3600,plan.content["end_epoch"]+3600)
    offered=sched.options(plan.content,windows,busy,now())
    response_once(s,coord,plan,data.client_key,content)
    coord.candidate_windows=windows;coord.offered_slots=offered;coord.state="options_ready" if offered else "conflict";coord.error="" if offered else "No mutually available slots; supply other explicit windows or ask the recruiter to revise constraints."
    svc.event(s,p,"interview.options","Explicit dated options prepared from candidate availability and approved interviewer constraints.",a.vacancy_id,a.id)
    return coord


def select_slot(s,p,a,data):
    coord,plan=candidate_coord(s,p,a)
    content={"slot_id":data.slot_id}
    old=s.scalar(select(m.SchedulingResponse).where(m.SchedulingResponse.coordination_id==coord.id,m.SchedulingResponse.client_key==data.client_key))
    if old:
        if old.plan_id!=plan.id or old.content!=content:raise HTTPException(409,"Selection key belongs to another slot or authorization version")
        return coord
    if coord.state=="booking_queued" and coord.selected_slot and coord.selected_slot["id"]==data.slot_id:
        return coord
    if coord.deadline<=now():raise HTTPException(409,"Scheduling response deadline passed")
    if coord.state not in ("options_ready","booked","simulated","conflict"):raise HTTPException(409,"A current explicit option is required; another operation may be processing")
    slot=next((x for x in coord.offered_slots if x["id"]==data.slot_id),None)
    if not slot:raise HTTPException(409,"Option is stale or was not offered")
    if coord.booked_slot and coord.booked_slot["start"]==slot["start"] and coord.booked_slot["end"]==slot["end"]:
        response_once(s,coord,plan,data.client_key,content)
        coord.state="simulated" if s.get(m.Organization,coord.org_id).is_demo else "booked"
        return coord
    response_once(s,coord,plan,data.client_key,content)
    coord.selection_version+=1;coord.selected_slot=slot;coord.state="booking_queued";coord.error=""
    kind="reschedule" if coord.booked_slot else "book"
    enqueue(s,coord,plan,kind,f"{kind}:{plan.id}:{coord.selection_version}",{"slot":slot,"previous_slot":coord.booked_slot})
    svc.event(s,p,"interview.slot_selected","Candidate explicitly selected a dated option; availability will be rechecked before booking.",a.vacancy_id,a.id)
    return coord


def cancel(s,p,a,reason):
    coord=coordinate(s,a)
    coord.cancel_requested=True;coord.error=reason[:500]
    if coord.invitation_id:s.get(m.CandidateInvitation,coord.invitation_id).revoked_at=now()
    s.execute(update(m.InterviewAction).where(m.InterviewAction.coordination_id==coord.id,m.InterviewAction.state.in_(["queued","not_configured","failed","expired_credential"]),m.InterviewAction.kind.not_in(["cancel","cancel_confirmation"])).values(state="cancelled"))
    if coord.plan_id:
        plan=s.get(m.InterviewPlan,coord.plan_id)
        # Always reconcile the stable ID: an uncertain insert may have succeeded.
        enqueue(s,coord,plan,"cancel","cancel:"+coord.id,{"reason":reason[:500]})
        coord.state="cancellation_queued"
    else:coord.state="cancelled"
    svc.event(s,p,"interview.cancellation","Cancellation requested; provider cleanup is queued, not yet confirmed.",a.vacancy_id,a.id)
    return coord


def transmit(s,action,coord,plan):
    from backend.email_adapter import send_message
    payload=action.payload
    text=payload["template"]
    slot=payload.get("slot")
    replacements={"portal_url":link(payload["invitation_id"],payload["origin"]),"timezone":plan.content["timezone"],"start":"","end":""}
    if slot:
        replacements["start"]=datetime.fromtimestamp(slot["start"],sched.zone(plan.content["timezone"])).isoformat()
        replacements["end"]=datetime.fromtimestamp(slot["end"],sched.zone(plan.content["timezone"])).isoformat()
    for key,value in replacements.items():text=text.replace("{"+key+"}",value)
    return send_message(s,coord.org_id,action.idempotency_key,payload["to"],payload.get("from",""),payload["subject"],text,action.first_attempt_at,payload["origin"])


def process(s,action,coord,plan):
    a=s.get(m.Application,coord.application_id);demo=s.get(m.Organization,coord.org_id).is_demo
    p=auth.Principal(coord.org_id,None,"worker","")
    cancellation=action.kind in ("cancel","cancel_confirmation")
    if not cancellation:
        if coord.cancel_requested or a.withdrawn_at or a.decision!="shortlist" or a.reassessment_required or coord.plan_id!=plan.id or a.requirement_version_id!=plan.requirement_version_id:
            action.state="cancelled";return
        authorization=s.scalar(select(m.InterviewAuthorization).where(m.InterviewAuthorization.plan_id==plan.id))
        if not authorization or authorization.content_hash!=plan.content_hash or digest(plan.content)!=plan.content_hash:raise CalendarConfiguration("Interview invitation authorization is missing or does not match current content")
        candidate=s.get(m.Candidate,a.candidate_id)
        if not candidate.email or candidate.email.casefold()!=plan.content["recipient"].casefold():raise CalendarConfiguration("Recipient changed; renewed interview authorization required")
    if action.kind in ("invite","reminder","confirmation","cancel_confirmation"):
        candidate=s.get(m.Candidate,a.candidate_id)
        if not candidate.email or candidate.email.casefold()!=action.payload["to"].casefold():
            raise CalendarConfiguration("Operational recipient changed; renewed content/recipient authorization is required before messaging")
        if action.kind in ("invite","reminder") and (coord.deadline<=now() or s.get(m.CandidateInvitation,action.payload["invitation_id"]).expires_at<=now()):
            raise CalendarConfiguration("Scheduling invitation expired; explicit recruiter renewal required")
        result=transmit(s,action,coord,plan)
        action.provider_id=result["id"];action.state="simulated" if demo else "provider_accepted"
        if action.kind in ("invite","reminder") and coord.state=="queued":coord.state="waiting_availability"
    elif action.kind in ("book","reschedule","cancel"):
        recovered=calendar.reconcile(s,coord,plan,action) if not demo else False
        if not recovered and action.kind!="cancel":
            slot=action.payload["slot"]
            busy=calendar.busy(s,coord,plan.content,plan.content["start_epoch"]-3600,plan.content["end_epoch"]+3600)
            if not sched.valid_slot(slot["start"],slot["end"],plan.content,coord.candidate_windows,busy,now()):
                coord.offered_slots=sched.options(plan.content,coord.candidate_windows,busy,now());coord.state="conflict";coord.error="Selected slot is no longer available. Select an explicit alternative; no silent booking."
                action.state="conflict";action.error=coord.error
                svc.event(s,p,"interview.conflict",coord.error,a.vacancy_id,a.id);return
        result={"id":coord.provider_event_id} if recovered else calendar.apply(s,coord,plan,action,cancel=action.kind=="cancel")
        action.provider_id=result["id"];action.state="simulated" if demo else "provider_accepted"
        if action.kind=="cancel":
            coord.state="cancelled"
            enqueue(s,coord,plan,"cancel_confirmation","cancel-confirmation:"+coord.id,mail_payload(s,coord,plan,"cancel_confirmation",coord.booked_slot))
            legacy=s.scalar(select(m.Interview).where(m.Interview.org_id==coord.org_id,m.Interview.external_id==coord.provider_event_id))
            if legacy:legacy.state="cancelled"
        else:
            coord.booked_slot=action.payload["slot"];coord.state="simulated" if demo else "booked";coord.error=""
            enqueue(s,coord,plan,"confirmation","confirmation:"+action.id,mail_payload(s,coord,plan,"confirmation",coord.booked_slot))
            legacy=s.scalar(select(m.Interview).where(m.Interview.org_id==coord.org_id,m.Interview.external_id==coord.provider_event_id))
            if not legacy:
                legacy=m.Interview(org_id=coord.org_id,application_id=a.id,external_id=coord.provider_event_id,starts_at=coord.booked_slot["start"],ends_at=coord.booked_slot["end"],timezone=plan.content["timezone"]);s.add(legacy)
            legacy.starts_at=coord.booked_slot["start"];legacy.ends_at=coord.booked_slot["end"];legacy.state=coord.state
    else:raise CalendarConfiguration("Unsupported interview action")
    svc.event(s,p,"interview.action_result",f"Interview {action.kind}: {action.state}. Provider acceptance is not proof of email delivery or reading.",a.vacancy_id,a.id)


def tick():
    from backend import execution
    with Session() as s:
        # Withdrawal/rejection invalidates sends and schedules cleanup, including uncertain bookings.
        stale=s.scalar(select(m.InterviewCoordination).join(m.Application,m.Application.id==m.InterviewCoordination.application_id).where(m.InterviewCoordination.plan_id.is_not(None),m.InterviewCoordination.cancel_requested==False,
            or_(m.Application.withdrawn_at.is_not(None),m.Application.decision!="shortlist",m.Application.reassessment_required==True)).limit(1))
        if stale:
            a=s.get(m.Application,stale.application_id);cancel(s,auth.Principal(a.org_id,None,"worker",""),a,"Application withdrawn, decision changed or review requires reassessment")
            s.commit();return True
        reminder=s.scalar(select(m.InterviewCoordination).where(m.InterviewCoordination.state.in_(["waiting_availability","options_ready","confirmation_required"]),m.InterviewCoordination.reminders_reserved==0,m.InterviewCoordination.reminder_at<=now(),m.InterviewCoordination.deadline>now()).limit(1))
        if reminder:
            plan=s.get(m.InterviewPlan,reminder.plan_id)
            reserved=s.execute(update(m.InterviewCoordination).where(m.InterviewCoordination.id==reminder.id,m.InterviewCoordination.reminders_reserved==0).values(reminders_reserved=1)).rowcount
            if reserved and plan.content["max_reminders"]:
                old=s.get(m.CandidateInvitation,reminder.invitation_id)
                if old and not old.revoked_at:
                    inv=m.CandidateInvitation(id=uid(),org_id=reminder.org_id,application_id=reminder.application_id,token_hash="pending",scopes=old.scopes,expires_at=min(now()+86400,reminder.deadline))
                    inv.token_hash=auth.digest(token(inv.id));s.add(inv);s.flush();reminder.invitation_id=inv.id
                    old.revoked_at=now()
                    enqueue(s,reminder,plan,"reminder","reminder:"+plan.id,mail_payload(s,reminder,plan,"reminder"))
            s.commit();return True
        expired=s.scalar(select(m.InterviewCoordination).where(m.InterviewCoordination.state.in_(["queued","waiting_availability","options_ready","confirmation_required","conflict"]),m.InterviewCoordination.deadline<=now()).limit(1))
        if expired:
            expired.state="response_timeout";expired.error="No confirmed slot by the response deadline. No inference about ability."
            if expired.invitation_id:s.get(m.CandidateInvitation,expired.invitation_id).revoked_at=now()
            s.commit();return True
        # After three uncertain attempts stop for recruiter reconciliation; never declare delivery failure.
        for old in s.scalars(select(m.InterviewAction).where(m.InterviewAction.state=="running",m.InterviewAction.lease_until<now(),m.InterviewAction.attempts>=3)):
            execution.end(s,"interview",old.id,old.lease_token,"interrupted","lease_exhausted")
            old.state="delivery_unknown";old.error="Worker lease expired after bounded attempts; provider reconciliation required";old.lease_token=None
        s.commit()
        eligible=or_(m.InterviewAction.state=="queued",(m.InterviewAction.state=="delivery_unknown")&(m.InterviewAction.attempts<3), (m.InterviewAction.state=="running")&(m.InterviewAction.lease_until<now()))
        row=s.scalar(select(m.InterviewAction).where(eligible,m.InterviewAction.attempts<3,m.InterviewAction.available_at<=now()).order_by(m.InterviewAction.created_at).limit(1))
        if not row:return False
        id,lease=row.id,secrets.token_hex(24)
        # Freeze sender before the first request, so retry content cannot change with configuration.
        if row.kind in ("invite","reminder","confirmation","cancel_confirmation") and not row.payload.get("from"):
            conn=s.scalar(select(m.ProviderConnection).where(m.ProviderConnection.org_id==row.org_id,m.ProviderConnection.provider=="email"))
            row.payload={**row.payload,"from":conn.config.get("from_email","") if conn else ""}
        changed=s.execute(update(m.InterviewAction).where(m.InterviewAction.id==id,eligible).values(state="running",lease_token=lease,lease_until=now()+120,attempts=m.InterviewAction.attempts+1,first_attempt_at=row.first_attempt_at or now())).rowcount
        if changed:execution.begin(s,row,"interview",lease)
        s.commit()
        if not changed:return True
    with Session() as s:
        action=s.get(m.InterviewAction,id);coord=s.get(m.InterviewCoordination,action.coordination_id);plan=s.get(m.InterviewPlan,action.plan_id)
        started=now()
        try:
            with execution.heartbeat(m.InterviewAction,id,lease,lease_seconds=120):
                process(s,action,coord,plan)
            # Final lease fence covers provider result plus any confirmation enqueue.
            changed=s.execute(update(m.InterviewAction).where(m.InterviewAction.id==id,m.InterviewAction.lease_token==lease).values(lease_token=None,lease_until=0)).rowcount
            if changed:
                execution.end(s,"interview",id,lease,action.state)
                svc.event(s,auth.Principal(coord.org_id,None,"worker",""),"execution.provider_result","Approved provider action finished; acceptance does not establish delivery.",s.get(m.Application,coord.application_id).vacancy_id,coord.application_id,
                    details={"tool":action.kind,"result":action.state,"duration_seconds":max(0,now()-started),"attempt":action.attempts})
                s.commit()
            else:s.rollback()
        except Exception as exc:
            s.rollback();s.expire_all();action=s.get(m.InterviewAction,id);coord=s.get(m.InterviewCoordination,action.coordination_id)
            if action.lease_token!=lease:return True
            if isinstance(exc,ExpiredCredential):state,error="expired_credential",str(exc)
            elif isinstance(exc,CalendarConfiguration):state,error="not_configured",str(exc)
            elif isinstance(exc,calendar.CalendarConflict):state,error="conflict",str(exc)
            elif isinstance(exc,(httpx.TimeoutException,httpx.TransportError)):state,error="delivery_unknown","Provider outcome unknown; stable identifiers will be reconciled before any retry"
            else:state,error="failed","Provider action failed; no successful booking or email delivery is claimed"
            action.state=state;action.error=error[:500];action.available_at=now()+2**action.attempts;action.lease_token=None;action.lease_until=0
            execution.end(s,"interview",id,lease,state,type(exc).__name__)
            coord.error=action.error
            if state=="conflict":
                coord.state="conflict"
                try:coord.offered_slots=sched.options(plan.content,coord.candidate_windows,calendar.busy(s,coord,plan.content,plan.content["start_epoch"]-3600,plan.content["end_epoch"]+3600),now())
                except Exception:coord.offered_slots=[]
            elif state in ("not_configured","expired_credential","failed"):coord.state="needs_attention"
            elif state=="delivery_unknown":coord.state="delivery_unknown"
            svc.event(s,auth.Principal(coord.org_id,None,"worker",""),"interview.action_attention",error,s.get(m.Application,coord.application_id).vacancy_id,coord.application_id)
            s.commit()
    return True
