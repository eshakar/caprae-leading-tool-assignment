from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

from app.models.icp import DEFAULT_WEIGHTS


class ICPBase(BaseModel):
    name: str = Field(default="Default profile", max_length=120)
    mode: Literal["acquisition", "sales"] = "acquisition"
    target_industries: list[str] = Field(default_factory=list, max_length=50)
    target_states: list[str] = Field(default_factory=list, max_length=60)
    min_employees: int | None = Field(default=None, ge=0)
    max_employees: int | None = Field(default=None, ge=0)
    min_revenue: int | None = Field(default=None, ge=0)
    max_revenue: int | None = Field(default=None, ge=0)
    min_years_in_business: int | None = Field(default=None, ge=0, le=200)
    weights: dict[str, int] = Field(default_factory=lambda: dict(DEFAULT_WEIGHTS))

    @field_validator("target_industries", "target_states")
    @classmethod
    def clean_list(cls, v: list[str]) -> list[str]:
        return list(dict.fromkeys(s.strip() for s in v if s and s.strip()))

    @field_validator("target_states")
    @classmethod
    def upper_states(cls, v: list[str]) -> list[str]:
        return [s.upper() for s in v]

    @field_validator("weights")
    @classmethod
    def valid_weights(cls, v: dict[str, int]) -> dict[str, int]:
        unknown = set(v) - set(DEFAULT_WEIGHTS)
        if unknown:
            raise ValueError(f"Unknown weight keys: {sorted(unknown)}")
        if any(w < 0 or w > 100 for w in v.values()):
            raise ValueError("Weights must be between 0 and 100")
        merged = {**DEFAULT_WEIGHTS, **v}
        if sum(merged.values()) == 0:
            raise ValueError("At least one weight must be positive")
        return merged

    @model_validator(mode="after")
    def ranges(self) -> "ICPBase":
        if self.min_employees is not None and self.max_employees is not None and self.min_employees > self.max_employees:
            raise ValueError("min_employees cannot exceed max_employees")
        if self.min_revenue is not None and self.max_revenue is not None and self.min_revenue > self.max_revenue:
            raise ValueError("min_revenue cannot exceed max_revenue")
        return self


class ICPIn(ICPBase):
    pass


class ICPOut(ICPBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    updated_at: datetime
