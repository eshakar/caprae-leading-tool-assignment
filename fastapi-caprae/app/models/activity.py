from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

# created | enriched | enrichment_failed | stage | score | outreach | note | follow_up | edited
ACTIVITY_KINDS = ("created", "enriched", "enrichment_failed", "stage", "score", "outreach", "note", "follow_up", "edited")


class LeadActivity(Base):
    """Append-only timeline of everything that happened to a lead - the audit trail a CRM would keep."""

    __tablename__ = "lead_activities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(32))
    message: Mapped[str] = mapped_column(Text)
    meta: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), index=True)

    lead = relationship("Lead", back_populates="activities")
