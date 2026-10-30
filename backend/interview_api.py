"""Authenticated recruitment-review and candidate interview scheduling contracts."""
import os
import httpx
import secrets
from fastapi import APIRouter,Depends,Request,Response,HTTPException
from fastapi.responses import RedirectResponse
from pydantic import Field
from sqlalchemy import select,update
from backend import api,auth,models as m,services as svc,schemas as d,google_oauth as oauth,interview_workflow as flow,scheduling as sched
from backend.db import get_db,now

router=APIRouter(prefix="/api/v1",dependencies=[Depends(api.mutations)])


@router.post("/demo/applications/{id}/calendar-conflict")
def inject_demo_conflict(id:str,p=Depends(auth.recruiter),s=Depends(get_db)):
    if not s.get(m.Organization,p.org_id).is_demo:raise HTTPException(403,"Conflict simulation is synthetic-only")
    a=svc.own(s,m.Application,id,p)
    coord=s.scalar(select(m.InterviewCoordination).where(m.InterviewCoordination.org_id==p.org_id,m.InterviewCoordination.application_id==a.id))
    if not coord or not coord.offered_slots:raise HTTPException(409,"Candidate must first offer explicit availability")
    slot=coord.offered_slots[0]
    connection=s.scalar(select(m.ProviderConnection).where(m.ProviderConnection.org_id==p.org_id,m.ProviderConnection.provider=="google_calendar"))
    if not connection:
        connection=m.ProviderConnection(org_id=p.org_id,provider="google_calendar",state="demo",config={})
        s.add(connection)
    blocked=list(connection.config.get("_demo_busy",[]))
    if not any(x["start"]==slot["start"] and x["end"]==slot["end"] for x in blocked):blocked.append({"start":slot["start"],"end":slot["end"]})
    connection.config={**connection.config,"_demo_busy":blocked[-50:]}
    svc.event(s,p,"demo.calendar_conflict","A synthetic calendar block was added after availability lookup. Selection will require real persisted conflict recovery.",a.vacancy_id,a.id)
    s.commit()
    return {"mode":"demo","blocked_slot_id":slot["id"]}


class CancelInput(d.Input):
    reason:str=Field(min_length=1,max_length=1000)


def public_coord(s,coord,candidate=False):
    if not coord:return None
    plan=s.get(m.InterviewPlan,coord.plan_id) if coord.plan_id else None
    if candidate:
        return {"id":coord.id,"state":coord.state,"offered_slots":coord.offered_slots,"booked_slot":coord.booked_slot,"deadline":coord.deadline,
            "error":coord.error,"timezone":plan.content["timezone"],"duration_minutes":plan.content["duration_minutes"],"buffer_minutes":plan.content["buffer_minutes"]}
    return {**svc.public(coord),"actions":[svc.public(x) for x in s.scalars(select(m.InterviewAction).where(m.InterviewAction.coordination_id==coord.id).order_by(m.InterviewAction.created_at))]}


@router.post("/oauth/google/start")
def oauth_start(response:Response,p=Depends(auth.admin),s=Depends(get_db)):
    try:result,state=oauth.start(s,p)
    except oauth.CalendarConfiguration as exc:raise HTTPException(503,str(exc))
    s.commit()
    if state:response.set_cookie("saring_oauth_state",state,max_age=600,httponly=True,secure=os.getenv("COOKIE_SECURE","true").lower()=="true",samesite="lax",path="/api/v1/oauth/google/callback")
    return result


@router.get("/oauth/google/callback")
def oauth_callback(request:Request,state:str="",code:str="",error:str="",s=Depends(get_db)):
    if error or not state or not code:raise HTTPException(400,"Google consent was denied or callback is incomplete; reconnect")
    try:oauth.finish(s,state,code,request.cookies.get("saring_oauth_state",""))
    except oauth.CalendarConfiguration as exc:raise HTTPException(503,str(exc))
    except httpx.HTTPError:raise HTTPException(503,"Google OAuth is disconnected or unavailable; start a new connection request")
    response=RedirectResponse((os.getenv("PUBLIC_APP_URL") or "http://127.0.0.1:5173").rstrip("/")+"/#/settings",status_code=303)
    response.delete_cookie("saring_oauth_state",path="/api/v1/oauth/google/callback")
    response.headers["Referrer-Policy"]="no-referrer"
    return response


@router.get("/oauth/google/status")
def oauth_status(p=Depends(auth.admin),s=Depends(get_db)):
    if s.get(m.Organization,p.org_id).is_demo:return {"state":"demo","scopes":[],"detail":"Synthetic Google Calendar adapter; no OAuth/provider requests"}
    conn=s.scalar(select(m.ProviderConnection).where(m.ProviderConnection.org_id==p.org_id,m.ProviderConnection.provider=="google_calendar"))
    credential=s.scalar(select(m.OAuthCredential).where(m.OAuthCredential.connection_id==conn.id)) if conn else None
    state="disconnected" if not credential or credential.revoked_at else conn.state
    return {"state":state,"scopes":oauth.SCOPES if credential and not credential.revoked_at else [],"access_token_expires_at":credential.expires_at if credential and not credential.revoked_at else None,"refresh_supported":bool(credential and not credential.revoked_at)}


@router.post("/oauth/google/disconnect")
def oauth_disconnect(p=Depends(auth.admin),s=Depends(get_db)):
    import httpx
    conn=s.scalar(select(m.ProviderConnection).where(m.ProviderConnection.org_id==p.org_id,m.ProviderConnection.provider=="google_calendar"))
    credential=s.scalar(select(m.OAuthCredential).where(m.OAuthCredential.connection_id==conn.id)) if conn else None
    token=None
    if credential:
        if not s.get(m.Organization,p.org_id).is_demo:
            try:data=oauth.decrypt(credential.encrypted_tokens);token=data.get("refresh_token") or data.get("access_token")
            except oauth.CalendarConfiguration:pass
        credential.revoked_at=now();credential.encrypted_tokens=""
    if conn:conn.state="disconnected"
    s.commit()
    remote=False
    if token:
        try:
            with httpx.Client(timeout=10,follow_redirects=False) as client:remote=client.post("https://oauth2.googleapis.com/revoke",data={"token":token}).status_code==200
        except httpx.HTTPError:pass
    return {"state":"disconnected","remote_revocation_confirmed":remote}


@router.post("/applications/{id}/generated-interview-brief")
def generate_brief(id:str,p=Depends(auth.recruiter),s=Depends(get_db)):
    a=svc.own(s,m.Application,id,p);data=svc.brief(s,p,a)
    lines=["INTERVIEW BRIEF", "Approved criteria version: "+str(a.requirement_version_id)]
    for requirement in data["requirements"]:
        finding=next((x["latest_revision"] for x in data["findings"] if x["requirement_id"]==requirement["id"]),None)
        lines += ["",requirement["description"]+" ("+requirement["importance"]+")","Observable expectation: "+requirement["minimum_observable_expectation"],"Finding: "+(finding["state"] if finding else "unknown")]
        if finding:
            lines += ["Stored observation: "+finding["explanation"],"Unresolved: "+finding["unresolved_question"]]
            for evidence_id in finding["evidence_ids"]:
                evidence=next((e for e in data["evidence"] if e["id"]==evidence_id),None)
                if evidence:
                    locator=("page "+str(evidence["page"])) if evidence["page"] else ("paragraph "+str(evidence["paragraph"])) if evidence["paragraph"] else "no page/paragraph reference"
                    source=("/api/v1/documents/"+evidence["document_id"]+"/download") if evidence["document_id"] else "response:"+str(evidence["response_id"])
                    lines += [f"Evidence {evidence_id} [{evidence['strength']}; {locator}] {source}","Exact source: "+evidence["passage"]]
        lines += ["Structured interview question: Describe a concrete example of "+requirement["description"]+", your own actions, result, and what evidence could substantiate the outcome."]
    lines += ["",*data["limitations"],"Source-linked observations are not independently verified expertise or authorship."]
    return {"content":"\n".join(lines)[:20000],"requirement_version_id":a.requirement_version_id}


@router.post("/applications/{id}/interview-plans",status_code=201)
def create_plan(id:str,body:sched.PlanInput,p=Depends(auth.recruiter),s=Depends(get_db)):
    row=flow.draft(s,p,svc.own(s,m.Application,id,p),body);s.commit();return svc.public(row)


@router.get("/applications/{id}/interview-plans")
def plans(id:str,pg=Depends(api.pagination),p=Depends(auth.recruiter),s=Depends(get_db)):
    svc.own(s,m.Application,id,p);return svc.page(s,m.InterviewPlan,p,application_id=id,**pg)


@router.post("/interview-plans/{id}/approve")
def approve_plan(id:str,body:d.ApprovalInput,p=Depends(auth.recruiter),s=Depends(get_db)):
    row=flow.approve(s,p,svc.own(s,m.InterviewPlan,id,p),body.rationale);s.commit();return public_coord(s,row)


@router.get("/applications/{id}/interview-coordination")
def coordination(id:str,p=Depends(auth.recruiter),s=Depends(get_db)):
    a=svc.own(s,m.Application,id,p)
    row=s.scalar(select(m.InterviewCoordination).where(m.InterviewCoordination.application_id==a.id))
    return {"coordination":public_coord(s,row),"authorizations":[svc.public(x) for x in s.scalars(select(m.InterviewAuthorization).join(m.InterviewPlan,m.InterviewPlan.id==m.InterviewAuthorization.plan_id).where(m.InterviewPlan.application_id==id,m.InterviewPlan.org_id==p.org_id))]}


@router.get("/interview-coordinations")
def coordinations(pg=Depends(api.pagination),p=Depends(auth.recruiter),s=Depends(get_db)):
    return svc.page(s,m.InterviewCoordination,p,**pg)


@router.post("/applications/{id}/interview-coordination/cancel")
def cancel(id:str,body:CancelInput,p=Depends(auth.recruiter),s=Depends(get_db)):
    row=flow.cancel(s,p,svc.own(s,m.Application,id,p),body.reason);s.commit();return public_coord(s,row)


@router.post("/interview-actions/{id}/retry")
def retry(id:str,p=Depends(auth.recruiter),s=Depends(get_db)):
    action=svc.own(s,m.InterviewAction,id,p)
    if action.state not in ("failed","delivery_unknown","not_configured","expired_credential"):raise HTTPException(409,"Only failed, unknown or disconnected actions may be reconciled/retried")
    if action.kind in ("invite","reminder","confirmation","cancel_confirmation") and action.first_attempt_at and now()-action.first_attempt_at>=23*3600:
        raise HTTPException(409,"Email outcome cannot be safely replayed after provider idempotency retention; reconcile with the provider before renewing authorization")
    action.state="queued";action.attempts=0;action.available_at=now();action.error=""
    s.commit();return svc.public(action)


@router.get("/demo/interview-mailbox")
def mailbox(application_id:str,p=Depends(auth.recruiter),s=Depends(get_db)):
    if not s.get(m.Organization,p.org_id).is_demo:raise HTTPException(403,"Synthetic mailbox is demo-only")
    svc.own(s,m.Application,application_id,p)
    coord=s.scalar(select(m.InterviewCoordination).where(m.InterviewCoordination.application_id==application_id))
    if not coord:return {"items":[]}
    rows=s.scalars(select(m.InterviewAction).where(m.InterviewAction.coordination_id==coord.id,m.InterviewAction.kind.in_(["invite","reminder","confirmation","cancel_confirmation"]),m.InterviewAction.state=="simulated").order_by(m.InterviewAction.created_at))
    return {"items":[{"id":r.id,"kind":r.kind,"recipient":r.payload["to"],"subject":r.payload["subject"],"portal_url":flow.link(r.payload["invitation_id"],r.payload["origin"])} for r in rows]}


@router.get("/candidate/applications/{id}/scheduling")
def candidate_schedule(id:str,p=Depends(auth.candidate),s=Depends(get_db)):
    a=api.current_application(s,p,id,"interview:schedule");coord,plan=flow.candidate_coord(s,p,a)
    return public_coord(s,coord,True)


@router.post("/candidate/applications/{id}/availability")
def candidate_availability(id:str,body:sched.AvailabilityInput,p=Depends(auth.candidate),s=Depends(get_db)):
    a=api.current_application(s,p,id,"interview:schedule")
    try:coord=flow.availability(s,p,a,body)
    except oauth.ExpiredCredential as exc:raise HTTPException(503,str(exc))
    except oauth.CalendarConfiguration as exc:raise HTTPException(503,str(exc))
    s.commit();return public_coord(s,coord,True)


@router.post("/candidate/applications/{id}/select-interview-slot")
def candidate_select(id:str,body:sched.SelectionInput,p=Depends(auth.candidate),s=Depends(get_db)):
    a=api.current_application(s,p,id,"interview:schedule");coord=flow.select_slot(s,p,a,body);s.commit();return public_coord(s,coord,True)


@router.post("/candidate/applications/{id}/withdraw")
def candidate_withdraw(id:str,body:CancelInput,p=Depends(auth.candidate),s=Depends(get_db)):
    a=api.current_application(s,p,id,"interview:schedule");flow.candidate_coord(s,p,a)
    a.withdrawn_at=now();row=flow.cancel(s,p,a,body.reason);s.commit();return {"state":"withdrawal_recorded","calendar_cleanup":row.state}
