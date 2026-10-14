from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class OutreachDraft(Base):
    __tablename__ = "outreach_drafts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    goal: Mapped[str] = mapped_column(String(32))  # acquisition | sales | partnership
    tone: Mapped[str] = mapped_column(String(32))
    subject: Mapped[str] = mapped_column(String(255))
    email_body: Mapped[str] = mapped_column(Text)
    linkedin_note: Mapped[str] = mapped_column(Text)
    call_opener: Mapped[str] = mapped_column(Text)
    follow_up: Mapped[str] = mapped_column(Text)
    personalization_points: Mapped[str] = mapped_column(Text, default="")
    generator: Mapped[str] = mapped_column(String(64))  # claude model id or "template"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    lead = relationship("Lead", back_populates="outreach_drafts")
