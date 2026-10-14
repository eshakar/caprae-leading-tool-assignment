from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Index, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

STAGES = ("new", "contacted", "replied", "meeting", "won", "lost")
ENRICHMENT_STATUSES = ("pending", "enriched", "failed", "skipped")


class Lead(Base):
    __tablename__ = "leads"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    company_name: Mapped[str] = mapped_column(String(255))
    # Normalized registrable host (no scheme / www / path). Used for deduplication.
    domain: Mapped[str | None] = mapped_column(String(255), unique=True, index=True)
    website: Mapped[str | None] = mapped_column(String(512))
    industry: Mapped[str | None] = mapped_column(String(120), index=True)
    description: Mapped[str | None] = mapped_column(Text)

    city: Mapped[str | None] = mapped_column(String(120))
    state: Mapped[str | None] = mapped_column(String(64), index=True)
    country: Mapped[str | None] = mapped_column(String(64), default="US")

    employee_count: Mapped[int | None] = mapped_column(Integer)
    revenue_usd: Mapped[int | None] = mapped_column(BigInteger)
    founded_year: Mapped[int | None] = mapped_column(Integer)

    owner_name: Mapped[str | None] = mapped_column(String(255))
    owner_title: Mapped[str | None] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(64))
    linkedin_url: Mapped[str | None] = mapped_column(String(512))

    # Enrichment output
    emails: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)
    phones: Mapped[list[str]] = mapped_column(JSONB, default=list)
    socials: Mapped[dict[str, str]] = mapped_column(JSONB, default=dict)
    tech_stack: Mapped[list[str]] = mapped_column(JSONB, default=list)
    signals: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)

    enrichment_status: Mapped[str] = mapped_column(String(16), default="pending")
    enrichment_error: Mapped[str | None] = mapped_column(Text)
    enriched_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    # Deal Signal Score
    score: Mapped[int] = mapped_column(Integer, default=0, index=True)
    score_tier: Mapped[str] = mapped_column(String(8), default="cold")
    score_breakdown: Mapped[list[dict[str, Any]]] = mapped_column(JSONB, default=list)

    # Workflow
    stage: Mapped[str] = mapped_column(String(16), default="new", index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    tags: Mapped[list[str]] = mapped_column(JSONB, default=list)
    source: Mapped[str] = mapped_column(String(16), default="manual")
    # Follow-up tracker
    last_contacted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    follow_up_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    outreach_drafts = relationship(
        "OutreachDraft", back_populates="lead", cascade="all, delete-orphan", passive_deletes=True
    )

    activities = relationship(
        "LeadActivity", back_populates="lead", cascade="all, delete-orphan", passive_deletes=True,
        order_by="LeadActivity.created_at.desc()",
    )

    __table_args__ = (Index("ix_leads_stage_score", "stage", "score"),)
