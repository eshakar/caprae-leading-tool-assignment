from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Stage = Literal["new", "contacted", "replied", "meeting", "won", "lost"]
Tier = Literal["hot", "warm", "cold"]


class EmailOut(BaseModel):
    email: str
    status: str
    reason: str
    is_role: bool = False
    is_free: bool = False
    source: str = "website"


class ScoreFactor(BaseModel):
    key: str
    label: str
    points: float
    max: float
    reason: str
    sentiment: str


class LeadBase(BaseModel):
    company_name: str | None = Field(default=None, max_length=255)
    domain: str | None = Field(default=None, max_length=512, description="Domain or full website URL")
    industry: str | None = Field(default=None, max_length=120)
    description: str | None = None
    city: str | None = Field(default=None, max_length=120)
    state: str | None = Field(default=None, max_length=64)
    country: str | None = Field(default=None, max_length=64)
    employee_count: int | None = Field(default=None, ge=0, le=10_000_000)
    revenue_usd: int | None = Field(default=None, ge=0)
    founded_year: int | None = Field(default=None, ge=1700, le=2100)
    owner_name: str | None = Field(default=None, max_length=255)
    owner_title: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=64)
    linkedin_url: str | None = Field(default=None, max_length=512)
    notes: str | None = None
    tags: list[str] | None = None

    @field_validator("*", mode="before")
    @classmethod
    def blank_to_none(cls, v: Any) -> Any:
        if isinstance(v, str):
            v = v.strip()
            return v or None
        return v


class LeadCreate(LeadBase):
    email: str | None = Field(default=None, max_length=255, description="Optional known contact email")
    auto_enrich: bool = True


class LeadUpdate(LeadBase):
    stage: Stage | None = None
    follow_up_at: datetime | None = None


class LeadOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company_name: str
    domain: str | None
    website: str | None
    industry: str | None
    description: str | None
    city: str | None
    state: str | None
    country: str | None
    employee_count: int | None
    revenue_usd: int | None
    founded_year: int | None
    owner_name: str | None
    owner_title: str | None
    phone: str | None
    linkedin_url: str | None
    emails: list[EmailOut]
    phones: list[str]
    socials: dict[str, str]
    tech_stack: list[str]
    signals: dict[str, Any]
    enrichment_status: str
    enrichment_error: str | None
    enriched_at: datetime | None
    score: int
    score_tier: Tier
    score_breakdown: list[ScoreFactor]
    stage: Stage
    notes: str | None
    tags: list[str]
    source: str
    last_contacted_at: datetime | None
    follow_up_at: datetime | None
    follow_up_due: bool = False
    next_action: str = ""
    created_at: datetime
    updated_at: datetime


class LeadListItem(BaseModel):
    """Lightweight row for the table view - avoids shipping full breakdowns for every lead."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    company_name: str
    domain: str | None
    website: str | None
    industry: str | None
    city: str | None
    state: str | None
    employee_count: int | None
    revenue_usd: int | None
    founded_year: int | None
    owner_name: str | None
    best_email: str | None = None
    email_status: str | None = None
    phone: str | None
    score: int
    score_tier: Tier
    top_reason: str | None = None
    stage: Stage
    enrichment_status: str
    tags: list[str]
    follow_up_at: datetime | None = None
    follow_up_due: bool = False
    created_at: datetime


class LeadPage(BaseModel):
    items: list[LeadListItem]
    total: int
    page: int
    page_size: int


class BulkIds(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)


class BulkStage(BulkIds):
    stage: Stage


class EnrichRequest(BaseModel):
    ids: list[int] = Field(min_length=1, max_length=500)
    force: bool = False


class JobOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str
    total: int
    completed: int
    failed: int
    errors: list[dict[str, Any]]
    created_at: datetime
    finished_at: datetime | None


class ActivityOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    kind: str
    message: str
    meta: dict[str, Any]
    created_at: datetime


class ImportResult(BaseModel):
    created: int
    merged: int
    skipped: int
    errors: list[str]
    columns_mapped: dict[str, str]


class DedupeResult(BaseModel):
    groups_merged: int
    records_removed: int
