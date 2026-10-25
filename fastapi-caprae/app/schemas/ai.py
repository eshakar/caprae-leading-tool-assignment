from pydantic import BaseModel, Field


class AISearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=300)


class LeadFilters(BaseModel):
    tiers: list[str]
    stages: list[str]
    industries: list[str]
    states: list[str]
    min_score: int
    has_email: bool
    follow_up_due: bool
    keywords: str
    sort: str


class AISearchOut(BaseModel):
    filters: LeadFilters
    explanation: str
    generator: str


class BriefInsight(BaseModel):
    title: str
    detail: str
    lead_id: int


class PipelineBrief(BaseModel):
    headline: str
    insights: list[BriefInsight]
    focus_today: str
    generator: str
