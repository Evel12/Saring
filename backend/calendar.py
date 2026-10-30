import os
from datetime import datetime, timedelta, timezone
import httpx
from urllib.parse import quote


def book(candidate, start, end, *, token=None, calendar_id=None, mode=None):
    a, b = datetime.fromisoformat(start), datetime.fromisoformat(end)
    if (
        not a.tzinfo
        or not b.tzinfo
        or b <= a
        or b - a > timedelta(hours=2)
        or a < datetime.now(timezone.utc)
    ):
        raise ValueError(
            "Choose a future slot of at most two hours, including timezone"
        )
    if (mode or os.getenv("SARING_MODE", "demo")) == "demo":
        return {
            "id": "demo-" + candidate.id,
            "start": start,
            "end": end,
            "mode": "demo",
            "status": "simulated booking; no calendar touched",
        }
    token = token or os.getenv("GOOGLE_CALENDAR_TOKEN")
    if not token:
        raise ValueError("Google Calendar not configured")
    cal = calendar_id or os.getenv("GOOGLE_CALENDAR_ID", "primary")
    with httpx.Client(
        timeout=20, headers={"Authorization": f"Bearer {token}"}
    ) as client:
        event_id = "saring" + candidate.id.replace("-", "")
        event_url = f'https://www.googleapis.com/calendar/v3/calendars/{quote(cal,safe="")}/events/{event_id}'
        existing = client.get(event_url)
        if existing.status_code == 200:
            event = existing.json()
            if (
                datetime.fromisoformat(event["start"]["dateTime"]) != a
                or datetime.fromisoformat(event["end"]["dateTime"]) != b
            ):
                raise ValueError(
                    "Existing booking uses a different slot; update it in Google Calendar"
                )
            return {
                "id": event_id,
                "start": start,
                "end": end,
                "mode": "live",
                "status": "existing calendar event reconciled; candidate notification not sent",
            }
        if existing.status_code != 404:
            existing.raise_for_status()
        free = client.post(
            "https://www.googleapis.com/calendar/v3/freeBusy",
            json={"timeMin": start, "timeMax": end, "items": [{"id": cal}]},
        )
        free.raise_for_status()
        info = free.json()["calendars"][cal]
        if info.get("errors"):
            raise ValueError("Calendar availability could not be established")
        if info["busy"]:
            raise ValueError("That slot is no longer available")
        # Stable ID makes retries idempotent; no candidate email is sent by this integration.
        response = client.post(
            f'https://www.googleapis.com/calendar/v3/calendars/{quote(cal,safe="")}/events',
            json={
                "id": event_id,
                "summary": "Saring interview",
                "start": {"dateTime": start},
                "end": {"dateTime": end},
                "description": "Recruiter-approved interview; candidate identity kept in Saring.",
            },
        )
        if response.status_code == 409:
            response = client.get(
                f'https://www.googleapis.com/calendar/v3/calendars/{quote(cal,safe="")}/events/{event_id}'
            )
            response.raise_for_status()
            existing = response.json()
            if (
                datetime.fromisoformat(existing["start"]["dateTime"]) != a
                or datetime.fromisoformat(existing["end"]["dateTime"]) != b
            ):
                raise ValueError(
                    "An existing booking uses another slot; update it in Google Calendar"
                )
        response.raise_for_status()
        return {
            "id": response.json()["id"],
            "start": start,
            "end": end,
            "mode": "live",
            "status": "calendar event created; candidate notification not sent",
        }
