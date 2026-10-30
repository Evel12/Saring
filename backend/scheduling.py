"""IANA-zone scheduling constraints; never interpret ambiguous natural language as a booking."""
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError
from fastapi import HTTPException
from pydantic import Field, field_validator
from backend.schemas import Input


def zone(name):
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(422, "Unknown IANA timezone") from None


def instant(value, tz):
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        raise HTTPException(422, "Use an explicit dated ISO time; ambiguous expressions require confirmation") from None
    local_zone = zone(tz)
    wall = dt.replace(tzinfo=None)
    if dt.tzinfo:
        if dt.astimezone(local_zone).replace(tzinfo=None) != wall:
            raise HTTPException(422, "Explicit offset does not match the selected IANA zone")
        return dt.timestamp()
    first, second = wall.replace(tzinfo=local_zone, fold=0), wall.replace(tzinfo=local_zone, fold=1)
    if first.astimezone(timezone.utc).astimezone(local_zone).replace(tzinfo=None) != wall:
        raise HTTPException(422, "That local time does not exist because of a clock change")
    if first.utcoffset() != second.utcoffset():
        raise HTTPException(422, "That local time is ambiguous; supply its explicit UTC offset")
    return first.timestamp()


def iso(value):
    return datetime.fromtimestamp(value, timezone.utc).isoformat()


class Hours(Input):
    weekday: int = Field(ge=0, le=6)
    start: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")
    end: str = Field(pattern=r"^([01]\d|2[0-3]):[0-5]\d$")


class Interviewer(Input):
    email: str = Field(min_length=3, max_length=254)
    calendar_id: str = Field(min_length=1, max_length=250)
    timezone: str = "Asia/Jakarta"
    working_hours: list[Hours] = Field(min_length=1,max_length=14)


class PlanInput(Input):
    client_key: str = Field(min_length=8, max_length=100)
    recipient: str = Field(min_length=3,max_length=254)
    subject: str = Field(min_length=1,max_length=200)
    draft: str = Field(min_length=1,max_length=4000)
    confirmation_draft: str = Field(min_length=1,max_length=2000)
    cancellation_draft: str = Field(min_length=1,max_length=2000)
    calendar_title: str = Field(default="Saring interview",min_length=1,max_length=200)
    calendar_description: str = Field(default="Recruiter-approved interview. Evidence and private notes remain in Saring.",min_length=1,max_length=2000)
    notify_interviewers: bool = True
    duration_minutes: int = Field(default=30,ge=15,le=120)
    buffer_minutes: int = Field(default=10,ge=0,le=60)
    timezone: str = "Asia/Jakarta"
    window_start: str
    window_end: str
    interviewers: list[Interviewer] = Field(min_length=1,max_length=5)
    max_reminders: int = Field(default=1,ge=0,le=1)
    reminder_hours: int = Field(default=24,ge=1,le=120)
    response_hours: int = Field(default=72,ge=1,le=168)
    brief_id: str | None = None


class AvailabilityInput(Input):
    client_key: str = Field(min_length=8,max_length=100)
    timezone: str = "Asia/Jakarta"
    windows: list[dict[str,str]] = Field(default_factory=list,max_length=12)
    expression: str = Field(default="",max_length=500)


class SelectionInput(Input):
    client_key: str = Field(min_length=8,max_length=100)
    slot_id: str = Field(min_length=8,max_length=100)


def validate_policy(data, current_time):
    import re
    if not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+",data.recipient):
        raise HTTPException(422,"A valid operational recipient email is required")
    start, end = instant(data.window_start,data.timezone), instant(data.window_end,data.timezone)
    if not current_time < start < end or end-start > 30*86400 or end > current_time+90*86400:
        raise HTTPException(422,"Choose a future scheduling horizon of at most 30 days, within 90 days")
    if data.max_reminders and data.reminder_hours >= data.response_hours:
        raise HTTPException(422,"Reminder must precede the response deadline")
    if len({x.email.casefold() for x in data.interviewers}) != len(data.interviewers):
        raise HTTPException(422,"Duplicate interviewer")
    for person in data.interviewers:
        zone(person.timezone)
        if not re.fullmatch(r"[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+",person.email):
            raise HTTPException(422,"Valid interviewer email required")
        if person.email.casefold()==data.recipient.casefold():
            raise HTTPException(422,"The candidate recipient must not also be an interviewer; candidate notifications use the approved email adapter only")
        if any(hour.start >= hour.end for hour in person.working_hours):
            raise HTTPException(422,"Working-hour start must precede end; split overnight hours by day")
    for text in (data.draft,data.confirmation_draft,data.cancellation_draft):
        if set(re.findall(r"\{([^{}]+)\}",text)) - {"portal_url","start","end","timezone"}:
            raise HTTPException(422,"Only portal_url, start, end and timezone template placeholders are allowed")
    if "{portal_url}" not in data.draft:
        raise HTTPException(422,"Invitation draft must include the private {portal_url} placeholder")
    return start,end


def within_hours(start,end,policy):
    buffer = policy["buffer_minutes"]*60
    for person in policy["interviewers"]:
        local_start = datetime.fromtimestamp(start-buffer,zone(person["timezone"]))
        local_end = datetime.fromtimestamp(end+buffer,zone(person["timezone"]))
        if local_start.date()!=local_end.date() or not any(h["weekday"]==local_start.weekday() and h["start"]<=local_start.strftime("%H:%M") and local_end.strftime("%H:%M")<=h["end"] for h in person["working_hours"]):
            return False
    return True


def valid_slot(start,end,policy,windows,busy,current_time):
    buffer=policy["buffer_minutes"]*60
    return (start>current_time and policy["start_epoch"]<=start<end<=policy["end_epoch"]
        and abs(end-start-policy["duration_minutes"]*60)<1
        and any(w["start"]<=start and end<=w["end"] for w in windows)
        and within_hours(start,end,policy)
        and not any(start-buffer<b["end"] and end+buffer>b["start"] for b in busy))


def options(policy,windows,busy,current_time):
    import hashlib, math
    result=[]
    # Grid is in absolute instants; rendering uses explicit IANA zones and dates.
    start=math.ceil(max(current_time+60,policy["start_epoch"])/900)*900
    while start+policy["duration_minutes"]*60<=policy["end_epoch"] and len(result)<12:
        end=start+policy["duration_minutes"]*60
        if valid_slot(start,end,policy,windows,busy,current_time):
            result.append({"id":hashlib.sha256(f"{start}:{end}".encode()).hexdigest()[:24],"start":start,"end":end,"timezone":policy["timezone"]})
        start+=900
    return result
