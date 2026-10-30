"""Explicit demo and Google Calendar adapters, stable IDs and conditional updates."""
from datetime import datetime, timezone
from urllib.parse import quote
import httpx
from sqlalchemy import select
from backend import models as m
from backend.google_oauth import access_token, ExpiredCredential, CalendarConfiguration
from backend.scheduling import iso, zone
from backend.db import now


class CalendarConflict(ValueError):
    pass


def check(response):
    if response.status_code in (401,403):
        raise ExpiredCredential("Google Calendar authorization expired or lacks access to a requested calendar")
    response.raise_for_status()
    return response.json() if response.content else {}


def busy(s,coord,policy,start,end):
    if s.get(m.Organization,coord.org_id).is_demo:
        connection=s.scalar(select(m.ProviderConnection).where(m.ProviderConnection.org_id==coord.org_id,m.ProviderConnection.provider=="google_calendar"))
        injected=connection.config.get("_demo_busy",[]) if connection else []
        return injected + [{"start":x.booked_slot["start"],"end":x.booked_slot["end"]} for x in s.scalars(select(m.InterviewCoordination).where(m.InterviewCoordination.org_id==coord.org_id,m.InterviewCoordination.id!=coord.id)) if x.booked_slot and x.state!="cancelled"]
    token=access_token(s,coord.org_id)
    calendars=list(dict.fromkeys([coord.calendar_id]+[x["calendar_id"] for x in policy["interviewers"]]))
    result=[]
    with httpx.Client(timeout=20,follow_redirects=False,headers={"Authorization":"Bearer "+token}) as client:
        data=check(client.post("https://www.googleapis.com/calendar/v3/freeBusy",json={"timeMin":iso(start),"timeMax":iso(end),"items":[{"id":x} for x in calendars]}))
        for calendar in calendars:
            info=data.get("calendars",{}).get(calendar)
            if not info or info.get("errors"):
                raise CalendarConfiguration("Interviewer/calendar free-busy access is unavailable; no time is assumed free")
            if coord.booked_slot and calendar==coord.calendar_id:
                # Free/busy has no event IDs: list minimal fields on the owned
                # organizer calendar to exclude ONLY our existing event safely.
                page=None
                for _ in range(4):
                    params={"timeMin":iso(start),"timeMax":iso(end),"singleEvents":"true","maxResults":250,
                        "fields":"timeZone,nextPageToken,items(id,status,transparency,start,end)"}
                    if page:params["pageToken"]=page
                    events=check(client.get(f"https://www.googleapis.com/calendar/v3/calendars/{quote(calendar,safe='')}/events",params=params))
                    for event in events.get("items",[]):
                        if event["id"]==coord.provider_event_id or event.get("status")=="cancelled" or event.get("transparency")=="transparent":continue
                        def stamp(value):
                            if value.get("dateTime"):return datetime.fromisoformat(value["dateTime"].replace("Z","+00:00")).timestamp()
                            return datetime.fromisoformat(value["date"]).replace(tzinfo=zone(events.get("timeZone",policy["timezone"]))).timestamp()
                        result.append({"start":stamp(event["start"]),"end":stamp(event["end"])})
                    page=events.get("nextPageToken")
                    if not page:break
                if page:raise CalendarConfiguration("Calendar conflict scan exceeds the bounded page limit")
            else:
                result += [{"start":datetime.fromisoformat(x["start"].replace("Z","+00:00")).timestamp(),"end":datetime.fromisoformat(x["end"].replace("Z","+00:00")).timestamp()} for x in info.get("busy",[])]
    return result


def apply(s,coord,plan,action,cancel=False):
    """GET stable event ID before every write/retry; never create a second event."""
    if s.get(m.Organization,coord.org_id).is_demo:
        return {"id":coord.provider_event_id,"mode":"demo"}
    token=access_token(s,coord.org_id)
    url=f"https://www.googleapis.com/calendar/v3/calendars/{quote(coord.calendar_id,safe='')}/events/{coord.provider_event_id}"
    selected=action.payload.get("slot")
    with httpx.Client(timeout=20,follow_redirects=False,headers={"Authorization":"Bearer "+token}) as client:
        response=client.get(url)
        existing=None if response.status_code in (404,410) else check(response)
        prior_plan=None
        if existing and existing.get("extendedProperties",{}).get("private",{}).get("saring_coordination")==coord.id:
            old_hash=existing.get("extendedProperties",{}).get("private",{}).get("saring_plan")
            prior_plan=s.scalar(select(m.InterviewPlan).where(m.InterviewPlan.application_id==coord.application_id,m.InterviewPlan.org_id==coord.org_id,m.InterviewPlan.content_hash==old_hash).limit(1))
            if not prior_plan:raise CalendarConflict("Provider event no longer identifies an authorized participant/content version")
            expected={p["email"].casefold() for p in prior_plan.content["interviewers"]} if prior_plan.content.get("notify_interviewers",False) else set()
            actual={p["email"].casefold() for p in existing.get("attendees",[])}
            if expected!=actual:raise CalendarConflict("Calendar participants changed outside the approved list; reconcile before sending updates")
        updates="all" if plan.content.get("notify_interviewers",False) or (prior_plan and prior_plan.content.get("notify_interviewers",False)) else "none"
        if cancel:
            if not existing or existing.get("status")=="cancelled":return {"id":coord.provider_event_id,"reconciled":True}
            if existing.get("extendedProperties",{}).get("private",{}).get("saring_coordination")!=coord.id:
                raise CalendarConflict("Provider event ownership cannot be established; cancellation requires reconciliation")
            response=client.delete(url,params={"sendUpdates":updates},headers={"If-Match":existing.get("etag","")})
            if response.status_code not in (204,404,410):check(response)
            return {"id":coord.provider_event_id}
        if existing:
            private=existing.get("extendedProperties",{}).get("private",{})
            if private.get("saring_action")==action.idempotency_key and private.get("saring_plan")==plan.content_hash:
                a=datetime.fromisoformat(existing["start"]["dateTime"].replace("Z","+00:00")).timestamp()
                b=datetime.fromisoformat(existing["end"]["dateTime"].replace("Z","+00:00")).timestamp()
                if a==selected["start"] and b==selected["end"]:return {"id":coord.provider_event_id,"reconciled":True}
                raise CalendarConflict("Provider event differs from the approved selected slot")
            if private.get("saring_coordination")!=coord.id or not coord.booked_slot:
                raise CalendarConflict("Existing event cannot be safely matched to this booking")
            # External edits must not be silently overwritten.
            a=datetime.fromisoformat(existing["start"]["dateTime"].replace("Z","+00:00")).timestamp()
            b=datetime.fromisoformat(existing["end"]["dateTime"].replace("Z","+00:00")).timestamp()
            if a!=coord.booked_slot["start"] or b!=coord.booked_slot["end"]:
                raise CalendarConflict("Provider event changed outside Saring; recruiter reconciliation required")
        body={"summary":plan.content.get("calendar_title","Saring interview"),"start":{"dateTime":iso(selected["start"]),"timeZone":plan.content["timezone"]},
            "end":{"dateTime":iso(selected["end"]),"timeZone":plan.content["timezone"]},
            "description":plan.content.get("calendar_description","Recruiter-approved interview. Evidence and private notes remain in Saring."),
            "attendees":[{"email":p["email"]} for p in plan.content["interviewers"]] if plan.content.get("notify_interviewers",False) else [],
            "extendedProperties":{"private":{"saring_coordination":coord.id,"saring_action":action.idempotency_key,"saring_plan":plan.content_hash}}}
        # Last external read before the write is a fresh availability lookup.
        # Google does not offer an atomic free/busy-and-insert transaction.
        from backend.scheduling import valid_slot
        current_busy=busy(s,coord,plan.content,plan.content["start_epoch"]-3600,plan.content["end_epoch"]+3600)
        if not valid_slot(selected["start"],selected["end"],plan.content,coord.candidate_windows,current_busy,now()):
            raise CalendarConflict("Availability changed immediately before the calendar write; choose an explicit alternative")
        if existing:
            response=client.patch(url,params={"sendUpdates":updates},headers={"If-Match":existing.get("etag","")},json=body)
        else:
            body["id"]=coord.provider_event_id
            response=client.post(url.rsplit("/",1)[0],params={"sendUpdates":updates},json=body)
        if response.status_code in (409,412):
            current=check(client.get(url))
            private=current.get("extendedProperties",{}).get("private",{})
            if (private.get("saring_action")==action.idempotency_key and private.get("saring_plan")==plan.content_hash
                and datetime.fromisoformat(current["start"]["dateTime"].replace("Z","+00:00")).timestamp()==selected["start"]
                and datetime.fromisoformat(current["end"]["dateTime"].replace("Z","+00:00")).timestamp()==selected["end"]):
                return {"id":coord.provider_event_id,"reconciled":True}
            raise CalendarConflict("Calendar changed concurrently; select an available option again")
        result=check(response)
        if result.get("id")!=coord.provider_event_id:raise CalendarConfiguration("Provider returned an unexpected event identifier")
        return result


def reconcile(s,coord,plan,action):
    """Read-only recovery before free/busy (our uncertain insert may already be busy)."""
    if s.get(m.Organization,coord.org_id).is_demo:return False
    token=access_token(s,coord.org_id)
    url=f"https://www.googleapis.com/calendar/v3/calendars/{quote(coord.calendar_id,safe='')}/events/{coord.provider_event_id}"
    with httpx.Client(timeout=20,follow_redirects=False,headers={"Authorization":"Bearer "+token}) as client:
        response=client.get(url)
        if response.status_code in (404,410):return action.kind=="cancel"
        event=check(response)
    if action.kind=="cancel":return event.get("status")=="cancelled"
    selected=action.payload["slot"]
    private=event.get("extendedProperties",{}).get("private",{})
    if private.get("saring_action")==action.idempotency_key:
        expected={p["email"].casefold() for p in plan.content["interviewers"]} if plan.content.get("notify_interviewers",False) else set()
        if {p["email"].casefold() for p in event.get("attendees",[])}!=expected:
            raise CalendarConflict("Calendar participants differ from the approved list; provider outcome requires reconciliation")
    return (private.get("saring_action")==action.idempotency_key and private.get("saring_plan")==plan.content_hash
        and datetime.fromisoformat(event["start"]["dateTime"].replace("Z","+00:00")).timestamp()==selected["start"]
        and datetime.fromisoformat(event["end"]["dateTime"].replace("Z","+00:00")).timestamp()==selected["end"])
