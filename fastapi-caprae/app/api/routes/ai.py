from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.schemas.ai import AISearchOut, AISearchRequest, PipelineBrief
from app.services.ai_insights import ai_search, pipeline_brief

router = APIRouter(prefix="/ai", tags=["ai"])


@router.post("/search", response_model=AISearchOut)
async def search(payload: AISearchRequest, db: Session = Depends(get_db)) -> dict:
    """Turn a plain-English request ("hot HVAC leads in Texas we haven't contacted") into lead filters."""
    return await ai_search(db, payload.query.strip())


@router.post("/brief", response_model=PipelineBrief)
async def brief(db: Session = Depends(get_db)) -> dict:
    """A short, grounded brief on the pipeline: what changed, what's at risk, what to do first."""
    return await pipeline_brief(db)
