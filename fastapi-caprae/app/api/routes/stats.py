from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import Lead
from app.services import leads as svc

router = APIRouter(tags=["meta"])


@router.get("/health")
def health(db: Session = Depends(get_db)) -> dict[str, str]:
    """Used by the ALB / App Runner health check - verifies the DB connection too."""
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


@router.get("/stats")
def stats(db: Session = Depends(get_db)) -> dict:
    data = svc.stats(db)
    top = db.scalars(select(Lead).where(Lead.stage.in_(["new", "contacted"])).order_by(Lead.score.desc()).limit(5)).all()
    data["top_leads"] = [
        {"id": l.id, "company_name": l.company_name, "industry": l.industry, "state": l.state, "score": l.score,
         "score_tier": l.score_tier, "stage": l.stage}
        for l in top
    ]
    return data
