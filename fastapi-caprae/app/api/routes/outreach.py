from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.db.session import get_db
from app.models import Lead, OutreachDraft
from app.schemas.outreach import OutreachOut, OutreachRequest
from app.services.activity import add_activity
from app.services.outreach import generate_outreach

router = APIRouter(tags=["outreach"])


@router.get("/ai/status")
def ai_status() -> dict[str, object]:
    s = get_settings()
    return {"enabled": s.ai_enabled, "provider": s.ai_provider, "model": s.ai_model}


@router.post("/leads/{lead_id}/outreach", response_model=OutreachOut, status_code=201)
async def create_outreach(lead_id: int, payload: OutreachRequest, db: Session = Depends(get_db)) -> OutreachDraft:
    lead = db.get(Lead, lead_id)
    if lead is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    result = await generate_outreach(lead, payload.goal, payload.tone, payload.sender_context)
    draft = OutreachDraft(
        lead_id=lead.id,
        goal=payload.goal,
        tone=payload.tone,
        subject=result.subject,
        email_body=result.email_body,
        linkedin_note=result.linkedin_note,
        call_opener=result.call_opener,
        follow_up=result.follow_up,
        personalization_points="\n".join(result.personalization_points),
        generator=result.generator,
    )
    db.add(draft)
    add_activity(lead, "outreach", f"Drafted {payload.goal} outreach ({payload.tone}): \"{result.subject}\"",
                 {"generator": result.generator})
    db.commit()
    db.refresh(draft)
    return draft


@router.get("/leads/{lead_id}/outreach", response_model=list[OutreachOut])
def list_outreach(lead_id: int, db: Session = Depends(get_db)) -> list[OutreachDraft]:
    if db.get(Lead, lead_id) is None:
        raise HTTPException(status_code=404, detail="Lead not found")
    return list(db.scalars(
        select(OutreachDraft).where(OutreachDraft.lead_id == lead_id).order_by(OutreachDraft.created_at.desc()).limit(20)
    ).all())
