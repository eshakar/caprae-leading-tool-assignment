from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class OutreachRequest(BaseModel):
    goal: Literal["acquisition", "sales", "partnership"] = "acquisition"
    tone: Literal["warm", "direct", "formal", "casual"] = "warm"
    sender_context: str | None = Field(
        default=None,
        max_length=600,
        description="Who you are / what you offer, e.g. 'Jane, a searcher backed by 12 investors focused on HVAC'",
    )


class OutreachOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    lead_id: int
    goal: str
    tone: str
    subject: str
    email_body: str
    linkedin_note: str
    call_opener: str
    follow_up: str
    personalization_points: list[str]
    generator: str
    created_at: datetime

    @field_validator("personalization_points", mode="before")
    @classmethod
    def split_points(cls, v: object) -> list[str]:
        if isinstance(v, str):
            return [p for p in v.split("\n") if p.strip()]
        return v  # type: ignore[return-value]
