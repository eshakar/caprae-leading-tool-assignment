from datetime import datetime
from typing import Any

from sqlalchemy import BigInteger, DateTime, Integer, String, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

DEFAULT_WEIGHTS: dict[str, int] = {
    "industry_fit": 20,
    "size_fit": 15,
    "revenue_fit": 15,
    "location_fit": 10,
    "longevity": 10,
    "succession": 10,
    "independence": 5,
    "contactability": 10,
    "growth": 5,
}


class ICPProfile(Base):
    """Ideal Customer / Acquisition Profile. The app keeps a single active row (id=1)."""

    __tablename__ = "icp_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), default="Default profile")
    # "acquisition" = search fund / PE sourcing, "sales" = B2B prospecting
    mode: Mapped[str] = mapped_column(String(16), default="acquisition")

    target_industries: Mapped[list[str]] = mapped_column(JSONB, default=list)
    target_states: Mapped[list[str]] = mapped_column(JSONB, default=list)
    min_employees: Mapped[int | None] = mapped_column(Integer)
    max_employees: Mapped[int | None] = mapped_column(Integer)
    min_revenue: Mapped[int | None] = mapped_column(BigInteger)
    max_revenue: Mapped[int | None] = mapped_column(BigInteger)
    min_years_in_business: Mapped[int | None] = mapped_column(Integer)
    weights: Mapped[dict[str, Any]] = mapped_column(JSONB, default=lambda: dict(DEFAULT_WEIGHTS))

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
