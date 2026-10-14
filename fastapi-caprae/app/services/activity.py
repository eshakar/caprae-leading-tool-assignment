"""Activity timeline + follow-up tracker.

Every meaningful change to a lead is appended to its timeline, and stage changes drive follow-up dates so
nothing falls through the cracks: contacting a lead schedules a follow-up, a reply schedules a "book the call"
nudge, and closing a lead (won/lost/meeting booked) clears it.
"""

from datetime import datetime, timedelta, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Lead, LeadActivity

FOLLOW_UP_AFTER_CONTACT = timedelta(days=3)
FOLLOW_UP_AFTER_REPLY = timedelta(days=1)
OPEN_STAGES = ("contacted", "replied")


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


def as_aware(dt: datetime | None) -> datetime | None:
    if dt is None:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def add_activity(lead: Lead, kind: str, message: str, meta: dict[str, Any] | None = None) -> None:
    """Append to the lead's timeline. Works for unsaved leads too (the row is inserted with the lead)."""
    lead.activities.append(LeadActivity(kind=kind, message=message[:1000], meta=meta or {}))


def change_stage(lead: Lead, new_stage: str, at: datetime | None = None) -> bool:
    """Move a lead to a new stage and manage its follow-up date. Returns False when nothing changed."""
    old = lead.stage
    if old == new_stage:
        return False
    at = at or now_utc()
    lead.stage = new_stage
    if new_stage == "contacted":
        lead.last_contacted_at = at
        lead.follow_up_at = at + FOLLOW_UP_AFTER_CONTACT
    elif new_stage == "replied":
        lead.follow_up_at = at + FOLLOW_UP_AFTER_REPLY
    elif new_stage in ("meeting", "won", "lost", "new"):
        lead.follow_up_at = None
    message = f"Stage changed: {old} → {new_stage}"
    if lead.follow_up_at and new_stage in OPEN_STAGES:
        message += f" · follow-up scheduled for {lead.follow_up_at:%b %d}"
    add_activity(lead, "stage", message, {"from": old, "to": new_stage})
    return True


def set_follow_up(lead: Lead, when: datetime | None) -> None:
    when = as_aware(when)
    if as_aware(lead.follow_up_at) == when:
        return
    lead.follow_up_at = when
    if when:
        add_activity(lead, "follow_up", f"Follow-up set for {when:%b %d, %Y}", {"follow_up_at": when.isoformat()})
    else:
        add_activity(lead, "follow_up", "Follow-up cleared")


def is_follow_up_due(lead: Any, at: datetime | None = None) -> bool:
    due = as_aware(getattr(lead, "follow_up_at", None))
    return bool(due and lead.stage in OPEN_STAGES and due <= (at or now_utc()))


def record_score_change(lead: Lead, before: int, reason: str) -> None:
    if abs(lead.score - before) >= 3:
        direction = "up" if lead.score > before else "down"
        add_activity(lead, "score", f"Score {direction} {before} → {lead.score} ({reason})",
                     {"from": before, "to": lead.score})


def action_center(db: Session, limit: int = 8) -> dict[str, Any]:
    """Today's to-do list: overdue follow-ups, follow-ups coming up this week, and hot leads nobody has touched."""
    now = now_utc()
    due = db.scalars(
        select(Lead).where(Lead.stage.in_(OPEN_STAGES), Lead.follow_up_at.is_not(None), Lead.follow_up_at <= now)
        .order_by(Lead.follow_up_at.asc()).limit(limit)
    ).all()
    upcoming = db.scalars(
        select(Lead).where(Lead.stage.in_(OPEN_STAGES), Lead.follow_up_at > now,
                           Lead.follow_up_at <= now + timedelta(days=7))
        .order_by(Lead.follow_up_at.asc()).limit(limit)
    ).all()
    untouched = db.scalars(
        select(Lead).where(Lead.stage == "new", Lead.score_tier == "hot", Lead.last_contacted_at.is_(None))
        .order_by(Lead.score.desc()).limit(limit)
    ).all()

    def card(lead: Lead) -> dict[str, Any]:
        f = as_aware(lead.follow_up_at)
        return {
            "id": lead.id, "company_name": lead.company_name, "industry": lead.industry, "state": lead.state,
            "score": lead.score, "score_tier": lead.score_tier, "stage": lead.stage, "owner_name": lead.owner_name,
            "follow_up_at": f.isoformat() if f else None,
            "days_overdue": max(0, (now - f).days) if f and f <= now else 0,
        }

    return {
        "follow_ups_due": [card(l) for l in due],
        "upcoming": [card(l) for l in upcoming],
        "hot_untouched": [card(l) for l in untouched],
    }
